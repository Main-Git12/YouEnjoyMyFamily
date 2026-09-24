import type { Task, TaskCompletion, MealPlanEntry, CartItem } from "../types";
import { DUE_WINDOW_LABELS } from "./choreCatalog";

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

export type InsightKind = "streak" | "slipping" | "meal_repeat" | "grocery_regular";

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

/** A meal has to recur this often before suggesting it again. */
const MEAL_REPEATS_WORTH_SUGGESTING = 3;

export interface InsightSources {
  tasks: Task[];
  completions: TaskCompletion[];
  mealPlan: MealPlanEntry[];
  cartItems: CartItem[];
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

/** Meals the family keeps coming back to, offered rather than assumed. */
function mealInsights({ mealPlan }: InsightSources): Insight[] {
  const counts = new Map<string, number>();
  for (const entry of mealPlan) {
    if (entry.slot !== "dinner") continue;
    const name = entry.mealName.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= MEAL_REPEATS_WORTH_SUGGESTING)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 1)
    .map(([name, count]) => ({
      id: `meal:${name}`,
      kind: "meal_repeat" as const,
      title: `${name} has been dinner ${count} times lately.`,
      because: `${count} dinners planned with that name in what's on the meal plan.`,
      action: { label: `Plan ${name} again`, kind: "plan_meal" as const, payload: name },
    }));
}

/**
 * Something the family buys again and again that isn't on the list right
 * now. Only ever a suggestion with a name attached — the app never puts
 * anything in the trolley by itself.
 */
function groceryInsights({ cartItems }: InsightSources): Insight[] {
  const normalize = (description: string) => description.trim().toLowerCase();
  const ordered = cartItems.filter((item) => item.status === "ordered");
  const outstanding = new Set(
    cartItems.filter((item) => item.status !== "ordered").map((item) => normalize(item.description))
  );

  const counts = new Map<string, { description: string; count: number }>();
  for (const item of ordered) {
    const key = normalize(item.description);
    if (outstanding.has(key)) continue;
    const current = counts.get(key);
    counts.set(key, { description: current?.description ?? item.description.trim(), count: (current?.count ?? 0) + 1 });
  }

  return [...counts.values()]
    .filter((entry) => entry.count >= 3)
    .sort((a, b) => b.count - a.count || a.description.localeCompare(b.description))
    .slice(0, 1)
    .map((entry) => ({
      id: `grocery:${normalize(entry.description)}`,
      kind: "grocery_regular" as const,
      title: `${entry.description} isn't on the list this time.`,
      because: `It's been on ${entry.count} shops already.`,
      action: { label: `Add ${entry.description}`, kind: "add_to_list" as const, payload: entry.description },
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
    ...mealInsights(sources),
    ...groceryInsights(sources),
  ].slice(0, 4);
}
