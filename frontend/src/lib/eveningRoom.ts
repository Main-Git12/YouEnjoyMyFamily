import type { MealPlanEntry, ScheduleEntry } from "../types";
import { WINDOW_CLOSES_AT_MINUTE } from "./timeOfDay";
import { weekdayOf } from "./routines";

/**
 * Whether there is room to cook.
 *
 * Meal planning rarely fails at the choosing. It fails on a Wednesday at ten
 * past five, when the thing that was planned needs forty minutes and
 * somebody has to be at soccer at half past. The meal was never the problem;
 * the evening was, and it was already on the calendar when the plan was
 * made — nobody was looking at it.
 *
 * So this module answers one question at the moment it is useful: which of
 * these evenings are already spoken for? It does not infer anything about
 * what happened afterwards. The app has no record of a dinner being
 * abandoned for a drive-through, and inventing one would be exactly the kind
 * of claim this codebase refuses to make. It shows the family their own
 * calendar next to their own meal plan, while they are choosing, and lets
 * them decide.
 */

/**
 * When cooking actually has to happen: from the end of the school run to
 * the end of dinner. Both ends come from the windows the rest of the app
 * already uses, so there is one definition of when a family's evening is,
 * not one per feature.
 */
export const COOKING_STARTS_AT_MINUTE = (WINDOW_CLOSES_AT_MINUTE.after_school ?? 17 * 60) - 30;
export const COOKING_ENDS_AT_MINUTE = WINDOW_CLOSES_AT_MINUTE.after_dinner ?? 19 * 60 + 30;

/** "17:30" to minutes past midnight; null for anything unparseable. */
function minutesFromClock(clock: string | null): number | null {
  if (!clock) return null;
  const [hour, minute] = clock.split(":");
  const minutes = Number(hour) * 60 + Number(minute);
  return Number.isFinite(minutes) ? minutes : null;
}

/**
 * Whether a calendar entry lands in the stretch when dinner gets made.
 *
 * An all-day entry — no start time — does not count. "Parker's birthday" is
 * on the calendar all day and takes no time out of the evening, and treating
 * every untimed entry as a blocker would mark most weeks as impossible.
 */
export function eatsIntoTheEvening(entry: ScheduleEntry): boolean {
  const start = minutesFromClock(entry.startTime);
  if (start === null) return false;
  if (start >= COOKING_ENDS_AT_MINUTE) return false;

  const end = minutesFromClock(entry.endTime);
  // An entry with no end time is a point in time, not a guessed duration:
  // the app knows when it starts and nothing else. A point *on* the hour
  // cooking starts is in the way — a 16:30 swimming lesson is the whole
  // problem with a 16:30 start — so the boundary is inclusive here.
  if (end === null) return start >= COOKING_STARTS_AT_MINUTE;

  // A real interval is half-open: something that *finishes* at 16:30 is
  // finished, and counting it would mark the evening full on the strength
  // of a thing that has already ended.
  return end > COOKING_STARTS_AT_MINUTE;
}

export interface EveningRoom {
  date: string;
  /** The entries that land in the cooking stretch, in the order they happen. */
  inTheWay: ScheduleEntry[];
  /** Plain words for the screen — the entries themselves, never a verdict. */
  because: string | null;
}

/** What each of these dates already has on it, between school and dinner. */
export function eveningRoom(schedule: ScheduleEntry[], dates: string[]): EveningRoom[] {
  return dates.map((date) => {
    const inTheWay = schedule
      .filter((entry) => entry.date === date && eatsIntoTheEvening(entry))
      .sort((a, b) => (minutesFromClock(a.startTime) ?? 0) - (minutesFromClock(b.startTime) ?? 0));

    return {
      date,
      inTheWay,
      because: inTheWay.length
        ? inTheWay
            .map((entry) => `${entry.title}${entry.startTime ? ` at ${entry.startTime}` : ""}`)
            .join(", ")
        : null,
    };
  });
}

/** Two is a coincidence; three is something this family does. */
const ENOUGH_TIMES = 3;

export interface EveningStandby {
  mealName: string;
  /** How many busy evenings this family has actually put it on. */
  times: number;
  because: string;
}

/**
 * The meals this family already falls back on when the evening is full.
 *
 * Read entirely out of their own records: dinners they planned on dates
 * that had something on between school and dinner. Nothing is suggested
 * that they have not cooked, and nothing is called "quick" — the app has no
 * idea how long anything takes to make, and a recipe database that claimed
 * to would be guessing about this kitchen.
 *
 * Today and everything after it are excluded. A plan is not yet a thing
 * that happened, and counting next Wednesday's dinner as evidence about
 * busy Wednesdays is the app reading its own suggestions back to itself.
 */
export function eveningStandbys(
  mealPlan: MealPlanEntry[],
  schedule: ScheduleEntry[],
  today: string
): EveningStandby[] {
  // Every evening that had something on, whenever it was. The cutoff to
  // what has actually happened is applied once, below, against the meal
  // plan — one place deciding "the past only" rather than two agreeing.
  const busyDates = new Set(schedule.filter(eatsIntoTheEvening).map((entry) => entry.date));

  const counts = new Map<string, { mealName: string; dates: Set<string> }>();
  for (const entry of mealPlan) {
    if (entry.slot !== "dinner") continue;
    if (entry.date >= today) continue;
    if (!busyDates.has(entry.date)) continue;
    const name = entry.mealName.trim();
    if (!name) continue;
    const bucket = counts.get(name.toLowerCase()) ?? { mealName: name, dates: new Set<string>() };
    bucket.dates.add(entry.date);
    counts.set(name.toLowerCase(), bucket);
  }

  return [...counts.values()]
    .filter((bucket) => bucket.dates.size >= ENOUGH_TIMES)
    .map((bucket) => ({
      mealName: bucket.mealName,
      times: bucket.dates.size,
      because: `Planned on ${bucket.dates.size} evenings that already had something on.`,
    }))
    .sort((a, b) => b.times - a.times || a.mealName.localeCompare(b.mealName));
}

/**
 * Which weekday is reliably the full one, if any.
 *
 * A fact about a weekday, never about the people in it — the same rule the
 * rest of the app keeps. "Wednesdays usually have something on between
 * school and dinner" is checkable against the calendar; "you never cook on
 * Wednesdays" is a story about a family.
 */
export function theFullWeekday(
  schedule: ScheduleEntry[],
  today: string
): { weekday: number; weeks: number } | null {
  const byWeekday = new Map<number, Set<string>>();
  for (const entry of schedule) {
    if (entry.date >= today || !eatsIntoTheEvening(entry)) continue;
    const weekday = weekdayOf(entry.date);
    const dates = byWeekday.get(weekday) ?? new Set<string>();
    dates.add(entry.date);
    byWeekday.set(weekday, dates);
  }

  let best: { weekday: number; weeks: number } | null = null;
  for (const [weekday, dates] of byWeekday) {
    if (dates.size < ENOUGH_TIMES) continue;
    if (!best || dates.size > best.weeks) best = { weekday, weeks: dates.size };
  }
  return best;
}
