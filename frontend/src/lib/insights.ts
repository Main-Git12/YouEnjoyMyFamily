import type { Task, TaskCompletion, MealPlanEntry, CartItem } from "../types";
import { DUE_WINDOW_LABELS } from "./choreCatalog";
import { busiestDay, dayLoads, groceryCadences, mealRhythms } from "./routines";
import type { ScheduleEntry } from "../types";

/**
 * What the app has noticed — and the rules it is bound by.
 *
 * Everything here is arithmetic over records the family themselves created:
 * chores someone set up, days someone ticked them off, meals someone
 * planned, items someone added to a list. Nothing is observed, nothing is
 * predicted about a person, and no profile of anyone is built or kept.
 *
 * Two rules the whole file obeys, and they are not negotiable:
 *
 * 1. **An insight describes a chore or a plan, never a person.** "Wipe
 *    Table is the one that most often gets left" is a fact about a chore.
 *    "Parker is bad at wiping the table" is a judgement about a child, and
 *    a screen on a kitchen wall has no business making it where he can read
 *    it. Streaks are the one place a child is named, because a streak is
 *    praise they earned and asked for by doing the thing.
 *
 * 2. **Every insight carries its own evidence.** `because` says exactly
 *    which records produced it, so a parent can check the app's working
 *    rather than trust it. An assistant that can't show why is just a
 *    confident guess.
 */

export type InsightKind = "streak" | "slipping" | "meal_rhythm" | "grocery_due" | "busy_day";

export interface Insight {
  id: string;
  kind: InsightKind;
  /** The headline, as it appears on the screen. */
  title: string;
  /** The records this came from, in plain words. */
  because: string;
  /** A concrete thing the family can do about it, if there is one. */
  action?: { label: string; kind: "reschedule_chore" | "plan_meal" | "add_to_list"; payload: string };
}

/** Records this many days back are what the app reasons over. */
export const INSIGHT_WINDOW_DAYS = 28;

const isoDaysAgo = (days: number, from: Date): string => {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * How many days in a row, ending today or yesterday, a child has finished a
 * given chore. Counting back from yesterday too, so a streak isn't reported
 * as broken at breakfast just because tonight's chore hasn't happened yet.
 */
export function currentStreak(completions: TaskCompletion[], taskId: string, memberId: string, today: string): number {
  const done = new Set(
    completions.filter((c) => c.taskId === taskId && c.memberId === memberId).map((c) => c.date)
  );
  if (done.size === 0) return 0;

  const from = new Date(`${today}T12:00:00`);
  // Start at today if it's already done, otherwise at yesterday.
  let offset = done.has(today) ? 0 : 1;
  if (!done.has(isoDaysAgo(offset, from))) return 0;

  let streak = 0;
  while (done.has(isoDaysAgo(offset, from))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

/** A streak worth putting on the wall. Two days isn't a habit. */
const STREAK_WORTH_SHOWING = 3;

/** A chore has to have been missed this often before the app says anything. */
const SLIPS_WORTH_MENTIONING = 3;
/** ...and missed more often than not, so a mostly-done chore is left alone. */
const SLIP_RATE_WORTH_MENTIONING = 0.5;

export interface InsightSources {
  tasks: Task[];
  completions: TaskCompletion[];
  mealPlan: MealPlanEntry[];
  cartItems: CartItem[];
  schedule: ScheduleEntry[];
  today: string;
}

function streakInsights({ tasks, completions, today }: InsightSources): Insight[] {
  const found: Insight[] = [];
  for (const task of tasks) {
    if (!task.assignedTo || task.recurrence === "none") continue;
    const streak = currentStreak(completions, task.taskId, task.assignedTo, today);
    if (streak < STREAK_WORTH_SHOWING) continue;
    found.push({
      id: `streak:${task.taskId}:${task.assignedTo}`,
      kind: "streak",
      title: `${task.assignedTo} has done ${task.title} ${streak} days running.`,
      because: `${streak} completions in a row, ending ${today}.`,
    });
  }
  return found.sort((a, b) => b.title.localeCompare(a.title));
}

/**
 * The chore that most often doesn't happen in the part of the day it was
 * put in. Framed as a question about the plan, with the obvious fix
 * attached: maybe bedtime was the wrong slot for it, and after dinner is
 * where it would actually get done. This is the app proposing a change to
 * the family's own plan from the family's own record — and the family
 * deciding, never the app.
 */
function slippingInsights({ tasks, completions, today }: InsightSources): Insight[] {
  const windowStart = isoDaysAgo(INSIGHT_WINDOW_DAYS, new Date(`${today}T12:00:00`));
  const recent = completions.filter((c) => c.date >= windowStart);

  const found: Insight[] = [];
  for (const task of tasks) {
    if (task.recurrence === "none" || task.dueWindow === "anytime") continue;

    // How many days it was meant to happen on, versus how many it did.
    const daysDone = new Set(recent.filter((c) => c.taskId === task.taskId).map((c) => c.date)).size;
    const daysExpected = expectedDays(task, windowStart, today);
    const missed = daysExpected - daysDone;
    if (missed < SLIPS_WORTH_MENTIONING) continue;
    if (daysExpected === 0 || missed / daysExpected < SLIP_RATE_WORTH_MENTIONING) continue;

    found.push({
      id: `slipping:${task.taskId}`,
      kind: "slipping",
      title: `${task.title} is the one that keeps getting left.`,
      because: `Done ${daysDone} of the last ${daysExpected} days it was set for ${DUE_WINDOW_LABELS[
        task.dueWindow
      ].toLowerCase()}.`,
      action: { label: "Try a different time of day", kind: "reschedule_chore", payload: task.taskId },
    });
  }
  return found.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 1);
}

/** The days in the window a recurring chore was actually meant to happen. */
function expectedDays(task: Task, windowStart: string, today: string): number {
  let days = 0;
  const cursor = new Date(`${windowStart}T12:00:00`);
  const end = new Date(`${today}T12:00:00`);
  while (cursor <= end) {
    const weekend = [0, 6].includes(cursor.getDay());
    if (
      task.recurrence === "daily" ||
      (task.recurrence === "weekdays" && !weekend) ||
      (task.recurrence === "weekends" && weekend)
    ) {
      days += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Not "you eat this a lot", but "this is a Tuesday thing" — the rhythm the
 * family has actually settled into, offered back for the day it belongs to.
 */
function mealInsights({ mealPlan }: InsightSources): Insight[] {
  return mealRhythms(mealPlan)
    .slice(0, 1)
    .map((rhythm) => ({
      id: `meal:${rhythm.weekday}:${rhythm.mealName}`,
      kind: "meal_rhythm" as const,
      title: `${rhythm.mealName} has become a ${rhythm.weekdayLabel} thing.`,
      because: `Planned for dinner on ${rhythm.timesOnThisDay} of the last few ${rhythm.weekdayLabel}s.`,
      action: { label: `Put ${rhythm.mealName} on the next ${rhythm.weekdayLabel}`, kind: "plan_meal" as const, payload: rhythm.mealName },
    }));
}

/**
 * The day of the week that's stacked *and* where the chore list fares
 * worst. A fact about a Wednesday, never about a person — see routines.ts.
 */
function busyDayInsights({ schedule, completions, tasks, today }: InsightSources): Insight[] {
  const windowStart = isoDaysAgo(INSIGHT_WINDOW_DAYS, new Date(`${today}T12:00:00`));
  const worst = busiestDay(dayLoads(schedule, completions, tasks, windowStart, today));
  if (!worst) return [];

  return [
    {
      id: `busy:${worst.weekday}`,
      kind: "busy_day",
      title: `${worst.weekdayLabel}s are the stacked one.`,
      because: `About ${worst.eventsPerDay.toFixed(1)} things on the calendar, and ${Math.round(
        worst.choreCompletionRate * 100
      )}% of the chores get done — the lowest of the week.`,
    },
  ];
}

/**
 * Not just "you buy this a lot" but "it's been longer than usual" — the
 * cadence the shops themselves describe. Only ever a suggestion: the app
 * never puts anything in the trolley by itself.
 */
function groceryInsights({ cartItems, today }: InsightSources): Insight[] {
  const outstanding = new Set(
    cartItems.filter((item) => item.status !== "ordered").map((item) => item.description.trim().toLowerCase())
  );

  return groceryCadences(cartItems, today)
    .filter((cadence) => cadence.overdue && !outstanding.has(cadence.description.toLowerCase()))
    .slice(0, 1)
    .map((cadence) => ({
      id: `grocery:${cadence.description.toLowerCase()}`,
      kind: "grocery_due" as const,
      title: `${cadence.description} is probably due.`,
      because: `Usually bought about every ${cadence.everyDays} days; it's been ${cadence.daysSinceLast}.`,
      action: { label: `Add ${cadence.description}`, kind: "add_to_list" as const, payload: cadence.description },
    }));
}

/**
 * Everything worth saying today, most encouraging first. Capped, because a
 * wall of observations is noise — and a screen that says four things is
 * read, where one that says twelve is ignored.
 */
export function buildInsights(sources: InsightSources): Insight[] {
  return [
    ...streakInsights(sources),
    ...slippingInsights(sources),
    ...busyDayInsights(sources),
    ...mealInsights(sources),
    ...groceryInsights(sources),
  ].slice(0, 4);
}
