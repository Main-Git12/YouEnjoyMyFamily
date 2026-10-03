import type { MealPlanEntry, ScheduleEntry, Task, TaskCompletion, CartItem } from "../types";
import { toLocalIsoDate } from "./dates";

/**
 * The rhythms a household falls into, read back out of its own records.
 *
 * Everything here is a pattern in things the family typed: meals they
 * planned, events they put on the calendar, chores they ticked off, items
 * they bought. Nothing is observed, and nothing describes a person's
 * character or state of mind.
 *
 * That last point is worth being exact about, because "learn the family's
 * stressors" is easy to read as something this file deliberately does not
 * do. A *day* can be busy — three things on the calendar and the evening
 * chores historically don't get done. That's a fact about a Wednesday, and
 * it's useful: it's the difference between "you're failing at bedtime" and
 * "Wednesday is stacked, maybe move one thing". A *person* is not modelled
 * here at all, and no profile of anyone is built or stored.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday for a date-only string, via UTC so no timezone shifts the day. */
export function weekdayOf(isoDate: string): number {
  const [year, month, day] = isoDate.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
}

export const weekdayName = (isoDate: string): string => DAY_NAMES[weekdayOf(isoDate)] ?? "";

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * The middle value, never the mean — the same rule the morning routine
 * learns its step durations by (see routinePlan.ts). One fortnight away
 * from home is not evidence that the milk lasts three weeks, and a mean
 * lets that one gap rewrite the whole cadence.
 */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

// ---------------------------------------------------------------------------
// Meal rhythms

export interface MealRhythm {
  weekday: number;
  weekdayLabel: string;
  mealName: string;
  /** How many of that weekday in the window had this meal. */
  timesOnThisDay: number;
  weeksSeen: number;
}

/** A meal is a "thing we do on Tuesdays" only once it's happened this often. */
const RHYTHM_MINIMUM = 2;

/**
 * "Tacos is a Tuesday thing." Found by grouping dinners by weekday, not by
 * guessing — if the family has eaten tacos on three of the last four
 * Tuesdays, that's simply what the records say.
 *
 * Only dinners before `today` count. A plan is not an observation: if the
 * family sat down and filled in tacos for the next three Tuesdays, telling
 * them back that tacos "has become a Tuesday thing" is the app repeating
 * their own typing to them as though it had noticed something. Today is out
 * too — tonight's dinner hasn't happened yet either.
 */
export function mealRhythms(entries: MealPlanEntry[], today: string): MealRhythm[] {
  const byDayAndMeal = new Map<string, { weekday: number; mealName: string; dates: Set<string> }>();

  for (const entry of entries) {
    if (entry.slot !== "dinner") continue;
    if (entry.date >= today) continue;
    const name = entry.mealName.trim();
    if (!name) continue;
    const weekday = weekdayOf(entry.date);
    const key = `${weekday}:${name.toLowerCase()}`;
    const bucket = byDayAndMeal.get(key) ?? { weekday, mealName: name, dates: new Set<string>() };
    bucket.dates.add(entry.date);
    byDayAndMeal.set(key, bucket);
  }

  return [...byDayAndMeal.values()]
    .filter((bucket) => bucket.dates.size >= RHYTHM_MINIMUM)
    .map((bucket) => ({
      weekday: bucket.weekday,
      weekdayLabel: DAY_NAMES[bucket.weekday] ?? "",
      mealName: bucket.mealName,
      timesOnThisDay: bucket.dates.size,
      weeksSeen: bucket.dates.size,
    }))
    .sort((a, b) => b.timesOnThisDay - a.timesOnThisDay || a.weekday - b.weekday);
}

// ---------------------------------------------------------------------------
// Grocery cadence

export interface GroceryCadence {
  description: string;
  /** Typical gap between shops that included it. */
  everyDays: number;
  daysSinceLast: number;
  /** True once it's gone longer than usual without being bought. */
  overdue: boolean;
}

/**
 * How often something actually gets bought, from the dates it was ordered.
 * Two purchases is a coincidence; three is a cadence.
 */
export function groceryCadences(items: CartItem[], today: string): GroceryCadence[] {
  const byDescription = new Map<string, { description: string; dates: string[] }>();

  for (const item of items) {
    if (item.status !== "ordered" || !item.orderedAt) continue;
    const key = item.description.trim().toLowerCase();
    const bucket = byDescription.get(key) ?? { description: item.description.trim(), dates: [] };
    // The family's own calendar date, not the UTC one. orderedAt is a UTC
    // timestamp, so a Sunday-evening shop in Ohio is stamped Monday: slicing
    // the string turns one weekly rhythm into alternating 6- and 8-day gaps,
    // and puts the last shop a day off from `today`, which is local.
    bucket.dates.push(toLocalIsoDate(new Date(item.orderedAt)));
    byDescription.set(key, bucket);
  }

  const cadences: GroceryCadence[] = [];
  for (const { description, dates } of byDescription.values()) {
    const ordered = [...new Set(dates)].sort();
    if (ordered.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i += 1) {
      gaps.push(daysBetween(ordered[i - 1] as string, ordered[i] as string));
    }
    const typicalGap = median(gaps);
    if (typicalGap === null) continue;
    const everyDays = Math.round(typicalGap);
    if (everyDays <= 0) continue;

    const daysSinceLast = daysBetween(ordered[ordered.length - 1] as string, today);
    cadences.push({ description, everyDays, daysSinceLast, overdue: daysSinceLast >= everyDays });
  }

  return cadences.sort((a, b) => b.daysSinceLast - a.daysSinceLast);
}

// ---------------------------------------------------------------------------
// Which day of the week is the stacked one

export interface DayLoad {
  weekday: number;
  weekdayLabel: string;
  /** Average number of calendar entries on that weekday. */
  eventsPerDay: number;
  /** Share of that weekday's chores that actually got done, 0–1. */
  choreCompletionRate: number;
  daysSeen: number;
}

/**
 * How each weekday actually goes for this household: how much tends to be
 * on the calendar, and how much of the chore list survives it.
 *
 * This is about days, never people. "Wednesday is the stacked one" earns
 * its place on a kitchen screen; "Parker struggles on Wednesdays" does not,
 * and isn't something these records could honestly support anyway.
 */
export function dayLoads(
  schedule: ScheduleEntry[],
  completions: TaskCompletion[],
  tasks: Task[],
  windowStart: string,
  today: string
): DayLoad[] {
  const recurring = tasks.filter((task) => task.recurrence !== "none");
  if (recurring.length === 0) return [];

  // The denominator's membership list. The numerator is filtered through it
  // below, because a completion can outlive the chore it belongs to (a chore
  // deleted last week, or a one-off, which `expected` never counts) and a
  // rate whose top half counts things its bottom half doesn't is not a rate.
  // Left unchecked it produced completion rates over 100%.
  const countedTaskIds = new Set(recurring.map((task) => task.taskId));

  const eventsByDate = new Map<string, number>();
  for (const entry of schedule) {
    if (entry.date < windowStart || entry.date > today) continue;
    eventsByDate.set(entry.date, (eventsByDate.get(entry.date) ?? 0) + 1);
  }
  const doneByDate = new Map<string, Set<string>>();
  for (const completion of completions) {
    if (completion.date < windowStart || completion.date > today) continue;
    if (!countedTaskIds.has(completion.taskId)) continue;
    const set = doneByDate.get(completion.date) ?? new Set<string>();
    set.add(completion.taskId);
    doneByDate.set(completion.date, set);
  }

  const buckets = new Map<number, { events: number; done: number; expected: number; days: number }>();
  const cursor = new Date(`${windowStart}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    const weekend = [0, 6].includes(weekday);
    const expected = recurring.filter((task) => {
      // A chore cannot have been missed on a day before it existed. Without
      // this, adding a chore on Friday makes every Wednesday for the last
      // month look like a Wednesday it was skipped on, and the app invents
      // a history the records do not contain.
      if (typeof task.createdAt === "string" && task.createdAt.slice(0, 10) > date) return false;
      return (
        task.recurrence === "daily" ||
        (task.recurrence === "weekdays" && !weekend) ||
        (task.recurrence === "weekends" && weekend)
      );
    }).length;

    const bucket = buckets.get(weekday) ?? { events: 0, done: 0, expected: 0, days: 0 };
    bucket.events += eventsByDate.get(date) ?? 0;
    bucket.done += doneByDate.get(date)?.size ?? 0;
    bucket.expected += expected;
    bucket.days += 1;
    buckets.set(weekday, bucket);

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [...buckets.entries()]
    .map(([weekday, bucket]) => ({
      weekday,
      weekdayLabel: DAY_NAMES[weekday] ?? "",
      eventsPerDay: bucket.days ? bucket.events / bucket.days : 0,
      choreCompletionRate: bucket.expected ? bucket.done / bucket.expected : 1,
      daysSeen: bucket.days,
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

/**
 * The one day worth mentioning: busier than usual on the calendar *and*
 * where the chore list fares worst. Both conditions, because a busy day
 * that still runs smoothly needs no comment, and a quiet day where chores
 * slip is a different problem entirely.
 */
export function busiestDay(loads: DayLoad[]): DayLoad | null {
  const seen = loads.filter((load) => load.daysSeen >= 2);
  if (seen.length < 3) return null;

  const averageEvents = seen.reduce((sum, load) => sum + load.eventsPerDay, 0) / seen.length;
  const worst = [...seen].sort((a, b) => a.choreCompletionRate - b.choreCompletionRate)[0];
  if (!worst) return null;

  const busier = worst.eventsPerDay > averageEvents && worst.eventsPerDay >= 1;
  const choresSuffer = worst.choreCompletionRate < 0.6;
  return busier && choresSuffer ? worst : null;
}

// ---------------------------------------------------------------------------
// Drafting a week from the family's own rotation

export interface DraftedMeal {
  date: string;
  mealName: string;
  /** Why this one landed on this day. */
  because: string;
  /**
   * What it needs, where that's known. Repeating a week brings the
   * ingredients with it — it is the same meal — while a draft built from
   * the rotation leaves this off, because which version of a dish is
   * meant is the family's to say.
   */
  ingredients?: string[];
}

/** Nobody wants the same dinner twice in four days. */
const NO_REPEAT_WITHIN_DAYS = 4;

/**
 * A proposed week of dinners, built only from meals this family has
 * actually cooked — never an invented recipe. Days that already have a
 * dinner are left alone.
 *
 * Preference order is the family's own: a meal that belongs to that weekday
 * wins, otherwise whatever hasn't come round for longest. A draft, not a
 * decision — nothing is saved until someone says so.
 */
export function draftWeek(history: MealPlanEntry[], days: string[]): DraftedMeal[] {
  const dinners = history.filter((entry) => entry.slot === "dinner" && entry.mealName.trim());
  const planned = new Set(dinners.map((entry) => entry.date));
  if (dinners.length === 0) return [];

  // The rhythm is read from what came before the week being drafted. Drafting
  // reads its own output otherwise: a draft that puts tacos on Tuesday would
  // come back next time as evidence that tacos is a Tuesday thing.
  const from = [...days].sort()[0];
  const rhythms = from ? mealRhythms(dinners, from) : [];
  const lastSeen = new Map<string, string>();
  for (const entry of dinners) {
    const name = entry.mealName.trim();
    const current = lastSeen.get(name);
    if (!current || entry.date > current) lastSeen.set(name, entry.date);
  }

  const drafted: DraftedMeal[] = [];
  const usedOn = new Map<string, string>();

  for (const date of days) {
    if (planned.has(date)) continue;

    // Checked against what was actually eaten as well as what this draft
    // has already used. Without the history half it will happily propose
    // Thursday's dinner as the thing they had on Wednesday.
    const tooRecent = (name: string): boolean => {
      for (const when of [usedOn.get(name), lastSeen.get(name)]) {
        if (when !== undefined && Math.abs(daysBetween(when, date)) < NO_REPEAT_WITHIN_DAYS) return true;
      }
      return false;
    };

    const weekday = weekdayOf(date);
    const forThisDay = rhythms.find((rhythm) => rhythm.weekday === weekday && !tooRecent(rhythm.mealName));

    let chosen: DraftedMeal | null = null;
    if (forThisDay) {
      chosen = {
        date,
        mealName: forThisDay.mealName,
        because: `${forThisDay.mealName} has been dinner on ${forThisDay.timesOnThisDay} ${forThisDay.weekdayLabel}s.`,
      };
    } else {
      const longestAgo = [...lastSeen.entries()]
        .filter(([name]) => !tooRecent(name))
        .sort((a, b) => a[1].localeCompare(b[1]))[0];
      if (longestAgo) {
        chosen = {
          date,
          mealName: longestAgo[0],
          because: `Not had since ${longestAgo[1]}.`,
        };
      }
    }

    if (!chosen) continue;
    usedOn.set(chosen.mealName, date);
    lastSeen.set(chosen.mealName, date);
    drafted.push(chosen);
  }

  return drafted;
}

/**
 * Last week, again.
 *
 * The least glamorous button in any meal planner and reliably the most
 * used one. Some weeks nobody wants to make seven decisions; they want
 * the week they already decided, and the thing standing between them and
 * it is seven lots of typing.
 *
 * This is not a suggestion engine and deliberately does nothing clever:
 * each day gets whatever was on that same weekday seven days earlier, and
 * days that already have a dinner are left alone. The ingredients come
 * with it, because they are the same meal.
 *
 * Nothing is saved until somebody says so, and the week it offers back is
 * the family's own. If last week had a gap, this week has the same gap —
 * filling it in would be the app quietly adding a meal nobody chose.
 */
export function lastWeekAgain(history: MealPlanEntry[], days: string[]): DraftedMeal[] {
  const dinners = new Map<string, MealPlanEntry>();
  for (const entry of history) {
    if (entry.slot !== "dinner" || !entry.mealName.trim()) continue;
    dinners.set(entry.date, entry);
  }

  const drafted: DraftedMeal[] = [];
  for (const date of days) {
    if (dinners.has(date)) continue;
    const weekBefore = shiftDays(date, -7);
    const source = weekBefore ? dinners.get(weekBefore) : undefined;
    if (!source) continue;
    drafted.push({
      date,
      mealName: source.mealName.trim(),
      because: `Same as last ${weekdayName(date)}.`,
      ingredients: [...source.ingredients],
    });
  }
  return drafted;
}

/** `date` moved by whole days, as an ISO date. Null if the date can't be read. */
function shiftDays(isoDate: string, by: number): string | null {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const moved = new Date(year, month - 1, day + by);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}-${pad(moved.getDate())}`;
}
