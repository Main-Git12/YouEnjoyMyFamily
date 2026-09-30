import type { MealPlanEntry, Routine, RoutineRun, ScheduleEntry, SchoolPrep, SchoolProfile } from "../types";
import { toLocalIsoDate } from "./dates";
import { anchorMomentOn, appliesOn } from "./routinePlan";
import { weekdayName, weekdayOf } from "./routines";
import { specialsOn } from "./schoolDay";
import { WINDOW_CLOSES_AT_MINUTE, minutesIntoDay } from "./timeOfDay";

/**
 * Tomorrow, read tonight.
 *
 * Everything else in this app answers "what is happening now". This answers
 * the question nobody has time for at ten to eight in the morning: was
 * today's scramble avoidable, and is tomorrow's already visible? All of the
 * facts it needs were in the app by seven the previous evening — three
 * things on the calendar, a library book to remember, no dinner planned,
 * and the plain fact that Thursday mornings in this house have been
 * finishing late. Nobody was ever shown them together, at the hour when
 * something could still be done about them.
 *
 * The rules the rest of the app is held to apply here without exception,
 * and one of them is sharper in a forward-looking feature than anywhere
 * else:
 *
 *   1. **It describes days, not people.** "Thursday mornings have been
 *      finishing late" is a fact about Thursdays. "Paige struggles on
 *      Thursdays" is a theory about a person, on a wall she and her
 *      children walk past, and this file will not produce it.
 *
 *   2. **Every line carries its evidence.** A forward-looking claim is
 *      easier to get wrong and harder to check than a backward-looking one,
 *      so each signal names the records it came from and how many there
 *      were. A prediction you cannot audit is a prediction you can only
 *      obey.
 *
 *   3. **It reports, it does not decide.** Nothing here reschedules a
 *      routine, plans a meal or moves a chore. Where there is an obvious
 *      next step it opens the question and the family answers it.
 *
 *   4. **Silence is a valid answer.** A quiet Tuesday produces nothing.
 *      A briefing that always has something to say is one nobody reads by
 *      the second week.
 */

/**
 * How many past mornings of the same weekday before the app will claim to
 * have noticed anything about it. Two is a coincidence.
 */
const MIN_MORNINGS_FOR_A_CLAIM = 3;

/** Slack at or below this counts as "finished with nothing to spare". */
export const THIN_MARGIN_MINUTES = 5;

/** When the evening — and therefore this briefing — begins. */
const EVENING_BEGINS_AT_MINUTE = WINDOW_CLOSES_AT_MINUTE.after_school ?? 17 * 60;

export interface WeekdayMargin {
  weekday: number;
  weekdayLabel: string;
  /**
   * Median minutes between finishing and the deadline, across finished runs
   * on that weekday. Positive is spare time; negative means the routine was
   * still going after the bus had gone.
   */
  medianMarginMinutes: number;
  /** How many finished mornings that median is built from. */
  mornings: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

/**
 * How each weekday's morning has actually gone, as the median gap between
 * the moment the routine was finished and the moment it had to be.
 *
 * Median rather than mean, for the same reason the step durations use one:
 * a single morning where somebody went back to bed should not become the
 * app's opinion of every Tuesday.
 *
 * Runs that were never finished are excluded — `finishedAt` is null for a
 * morning that was started and abandoned, and there is no honest margin to
 * compute from one. So is `today`, which is not evidence about itself.
 */
export function weekdayMargins(
  routine: Routine | null,
  runs: RoutineRun[],
  today: string
): Map<number, WeekdayMargin> {
  const byWeekday = new Map<number, number[]>();
  if (!routine) return new Map();

  for (const run of runs) {
    if (run.routineId !== routine.routineId) continue;
    if (!run.finishedAt) continue;
    if (run.date >= today) continue;

    const finishedAt = Date.parse(run.finishedAt);
    if (Number.isNaN(finishedAt)) continue;
    const deadline = anchorMomentOn(run.date, routine.anchorTime).getTime();
    const weekday = weekdayOf(run.date);
    const margins = byWeekday.get(weekday) ?? [];
    margins.push((deadline - finishedAt) / 60_000);
    byWeekday.set(weekday, margins);
  }

  const result = new Map<number, WeekdayMargin>();
  for (const [weekday, margins] of byWeekday) {
    if (margins.length < MIN_MORNINGS_FOR_A_CLAIM) continue;
    result.set(weekday, {
      weekday,
      weekdayLabel: DAY_NAMES[weekday] ?? "",
      // Floor, not round. `Math.round(-2.5)` is -2 in JavaScript, which
      // reports a morning that finished two and a half minutes late as two
      // — rounding a missed deadline towards looking better. Flooring is
      // pessimistic in both directions: less spare time claimed, more
      // lateness admitted. This app does not get to flatter its own plans.
      medianMarginMinutes: Math.floor(median(margins)),
      mornings: margins.length,
    });
  }
  return result;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type SignalKind = "calendar" | "school" | "meal" | "morning";

export interface TomorrowSignal {
  id: string;
  kind: SignalKind;
  /** The subject is always the day, the plan or the thing — never a person. */
  headline: string;
  /** The records this came from, so it can be checked rather than believed. */
  because: string;
  /** An opened question, never a decision already taken. */
  question?: { label: string; panel: "kitchen" | "morning" | "school" };
}

export type Tightness = "clear" | "busy" | "tight";

export interface TomorrowBrief {
  date: string;
  weekdayLabel: string;
  signals: TomorrowSignal[];
  /**
   * The overall read, and what it was based on. Null when there is not
   * enough on tomorrow to say anything — which is most days, and is the
   * point.
   */
  outlook: { tightness: Tightness; because: string } | null;
}

export interface TomorrowSources {
  now: Date;
  schedule: ScheduleEntry[];
  profiles: SchoolProfile[];
  prep: SchoolPrep[];
  mealPlan: MealPlanEntry[];
  routines: Routine[];
  runs: RoutineRun[];
}

/** Only from the evening on. Tomorrow is not tomorrow's problem at breakfast. */
export function briefingIsDue(now: Date): boolean {
  return minutesIntoDay(now) >= EVENING_BEGINS_AT_MINUTE;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

export function buildTomorrow(sources: TomorrowSources): TomorrowBrief | null {
  const { now, schedule, profiles, prep, mealPlan, routines, runs } = sources;
  if (!briefingIsDue(now)) return null;

  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(now.getDate() + 1);
  const date = toLocalIsoDate(tomorrowDate);
  const today = toLocalIsoDate(now);
  const weekdayLabel = weekdayName(date);
  const signals: TomorrowSignal[] = [];

  // --- what is already on the calendar -------------------------------------
  const events = schedule
    .filter((entry) => entry.date === date)
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  if (events.length) {
    signals.push({
      id: "calendar",
      kind: "calendar",
      headline: `${plural(events.length, "thing", "things")} on ${weekdayLabel}'s calendar.`,
      because: events
        .map((entry) => (entry.startTime ? `${entry.startTime} ${entry.title}` : entry.title))
        .join(" · "),
    });
  }

  // --- what the school has asked for ---------------------------------------
  const packed = new Set(prep.filter((row) => row.date === date).map((row) => row.memberId));
  const outstanding = specialsOn(profiles, date).filter(
    (entry) => entry.prepNote !== null && !packed.has(entry.memberId)
  );
  for (const entry of outstanding) {
    signals.push({
      id: `school:${entry.memberId}`,
      kind: "school",
      headline: `${entry.subject} for ${entry.memberId} — ${entry.prepNote}`,
      because: entry.because,
      question: { label: "Tick it off", panel: "school" },
    });
  }

  // --- dinner --------------------------------------------------------------
  const plannedTomorrow = mealPlan.some(
    (entry) => entry.date === date && entry.slot === "dinner" && entry.mealName.trim()
  );
  // Only worth raising for a household that plans dinners at all. Asking a
  // family who have never used the meal planner to plan one is a feature
  // advertising itself, not an observation.
  const dinnersPlannedRecently = mealPlan.filter(
    (entry) => entry.slot === "dinner" && entry.mealName.trim() && entry.date < date
  ).length;
  if (!plannedTomorrow && dinnersPlannedRecently >= 3) {
    signals.push({
      id: "meal",
      kind: "meal",
      headline: `No dinner planned for ${weekdayLabel}.`,
      because: `${plural(dinnersPlannedRecently, "dinner", "dinners")} planned on other days.`,
      question: { label: "Plan it", panel: "kitchen" },
    });
  }

  // --- how this weekday's mornings have actually gone -----------------------
  const morning = routines.find((routine) => routine.kind === "morning" && routine.active) ?? null;
  const runsOnThisWeekday =
    morning && appliesOn(morning, tomorrowDate)
      ? weekdayMargins(morning, runs, today).get(weekdayOf(date)) ?? null
      : null;

  let thinMorning = false;
  if (runsOnThisWeekday) {
    const { medianMarginMinutes: margin, mornings } = runsOnThisWeekday;
    thinMorning = margin <= THIN_MARGIN_MINUTES;
    if (thinMorning) {
      const described =
        margin < 0
          ? `finishing about ${Math.abs(margin)} ${Math.abs(margin) === 1 ? "minute" : "minutes"} after ${morning?.anchorTime}`
          : margin === 0
            ? `finishing right on ${morning?.anchorTime}`
            : `finishing with about ${plural(margin, "minute", "minutes")} to spare`;
      signals.push({
        id: "morning",
        kind: "morning",
        headline: `${weekdayLabel} mornings have been tight.`,
        because: `The last ${plural(mornings, `${weekdayLabel} morning`, `${weekdayLabel} mornings`)}, ${described}.`,
        question: { label: "Look at the steps", panel: "morning" },
      });
    }
  }

  if (!signals.length) return null;

  // --- the overall read ----------------------------------------------------
  // Deliberately a small, legible rule rather than a score: a number nobody
  // can argue with is a number nobody should trust. `because` names the same
  // facts the rule used, so a parent can disagree with it on the evidence.
  const load = events.length + outstanding.length;
  const tightness: Tightness = thinMorning && load >= 1 ? "tight" : load >= 2 ? "busy" : "clear";
  const parts: string[] = [];
  if (events.length) parts.push(plural(events.length, "calendar entry", "calendar entries"));
  if (outstanding.length) parts.push(plural(outstanding.length, "thing to pack", "things to pack"));
  if (thinMorning && runsOnThisWeekday) {
    parts.push(`${weekdayLabel} mornings finishing with little to spare over ${runsOnThisWeekday.mornings} of them`);
  }

  return {
    date,
    weekdayLabel,
    signals,
    outlook: parts.length ? { tightness, because: parts.join(", ") } : null,
  };
}
