import type { ScheduleEntry, MealPlanEntry, Routine, RoutineRun } from "../types";
import type { Insight } from "./insights";
import { anchorMomentOn } from "./routinePlan";
import { weekdayName } from "./routines";

/**
 * Noticing things no single card can see.
 *
 * Every other engine here reasons inside one domain: chores about chores,
 * meals about meals, routines about routines. Each is useful and each is
 * blind to the others — which means the app can know that Wednesday
 * evening is stacked, and separately that Wednesday has no dinner planned,
 * and never put the two together. A person looking at the same screen
 * makes that connection in about a second.
 *
 * This module is the part that reads across. It produces the same
 * `Insight` shape as lib/insights.ts so it lands in the same "what we've
 * noticed" panel, and it holds the same two rules:
 *
 *   1. The subject is a night, a morning, a day or a block — never a
 *      person. "The mornings after a late bedtime have been the tight
 *      ones" is about mornings. "Parker stays up too late" is a verdict
 *      on a child, and this app doesn't hand those out.
 *   2. Every notice carries the counts it came from, so a parent can
 *      check the working.
 *
 * And one rule of its own, because reading across domains is exactly
 * where an assistant starts inventing causes:
 *
 *   3. **It reports what co-occurred, never why.** "The mornings after a
 *      late bedtime have been the tight ones" is a fact about fifteen
 *      days of this family's own records. "Late bedtimes are making your
 *      mornings hard" is a theory, and a screen that states theories as
 *      findings teaches a family to stop believing the ones that are
 *      true.
 */

/** Below this there isn't a pattern, there's a fortnight of noise. */
const MIN_PAIRED_NIGHTS = 5;
/** And the two rates have to actually differ before it's worth saying. */
const MIN_RATE_GAP = 0.3;
/** A morning is "tight" if it finished within this of the deadline, or not at all. */
const TIGHT_MARGIN_MINUTES = 5;

export interface AwarenessSources {
  routines: Routine[];
  routineRuns: RoutineRun[];
  schedule: ScheduleEntry[];
  mealPlan: MealPlanEntry[];
  /** The days on screen, soonest first. */
  weekDays: string[];
  today: string;
}

const nextDay = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Did this run get past its own deadline? Null when it never finished. */
function minutesPastAnchor(run: RoutineRun, routine: Routine): number | null {
  if (!run.finishedAt) return null;
  const finished = Date.parse(run.finishedAt);
  if (Number.isNaN(finished)) return null;
  return (finished - anchorMomentOn(run.date, routine.anchorTime).getTime()) / 60_000;
}

/**
 * What the records show about the nights before the tight mornings.
 *
 * This is the one observation in the app that spans two days, and it is
 * the one the household actually asked about: the mornings are hard. It
 * says only what co-occurred — see rule 3 above. Whether a later bedtime
 * *causes* a tighter morning is not something fifteen rows can settle,
 * and the app does not pretend otherwise.
 */
function bedtimeAndMornings(sources: AwarenessSources): Insight[] {
  const bedtime = sources.routines.find((routine) => routine.kind === "bedtime");
  const morning = sources.routines.find((routine) => routine.kind === "morning");
  if (!bedtime || !morning) return [];

  const bedtimeRuns = new Map(
    sources.routineRuns.filter((run) => run.routineId === bedtime.routineId).map((run) => [run.date, run])
  );
  const morningRuns = new Map(
    sources.routineRuns.filter((run) => run.routineId === morning.routineId).map((run) => [run.date, run])
  );

  let tightAfterLate = 0;
  let late = 0;
  let tightAfterOnTime = 0;
  let onTime = 0;

  for (const [date, night] of bedtimeRuns) {
    const nextMorning = morningRuns.get(nextDay(date));
    // Only nights followed by a morning that actually ran — a Saturday
    // lie-in is not evidence about a school run.
    if (!nextMorning) continue;
    const nightOver = minutesPastAnchor(night, bedtime);
    if (nightOver === null) continue;

    const morningOver = minutesPastAnchor(nextMorning, morning);
    // A morning that never finished is the tightest kind there is.
    const wasTight = morningOver === null || morningOver > -TIGHT_MARGIN_MINUTES;

    if (nightOver > 0) {
      late += 1;
      if (wasTight) tightAfterLate += 1;
    } else {
      onTime += 1;
      if (wasTight) tightAfterOnTime += 1;
    }
  }

  if (late + onTime < MIN_PAIRED_NIGHTS || late === 0 || onTime === 0) return [];
  const lateRate = tightAfterLate / late;
  const onTimeRate = tightAfterOnTime / onTime;
  if (lateRate - onTimeRate < MIN_RATE_GAP) return [];

  return [
    {
      id: "awareness:bedtime-mornings",
      kind: "bedtime_and_mornings",
      title: "The mornings after a late bedtime have been the tight ones.",
      because: `${tightAfterLate} of ${late} mornings after lights-out ran over, against ${tightAfterOnTime} of ${onTime} after an on-time night`,
    },
  ];
}

/** Enough on one evening that dinner is worth deciding in advance. */
const STACKED_DAY_ENTRIES = 3;

/**
 * A day the calendar is stacked and nothing is planned to eat.
 *
 * Two facts each card already holds separately, put next to each other —
 * which is the whole point of this module.
 */
function stackedDayWithNoDinner(sources: AwarenessSources): Insight[] {
  for (const date of sources.weekDays) {
    if (date < sources.today) continue;
    const entries = sources.schedule.filter((entry) => entry.date === date);
    if (entries.length < STACKED_DAY_ENTRIES) continue;
    const hasDinner = sources.mealPlan.some((entry) => entry.date === date && entry.slot === "dinner");
    if (hasDinner) continue;

    const when = date === sources.today ? "Today" : weekdayName(date);
    return [
      {
        id: `awareness:stacked-no-dinner:${date}`,
        kind: "stacked_day_no_dinner",
        title: `${when} has ${entries.length} things on it and no dinner planned.`,
        because: entries
          .map((entry) => entry.title)
          .slice(0, 3)
          .join(", "),
        action: { label: "Plan something", kind: "plan_meal", payload: date },
      },
    ];
  }
  return [];
}

/**
 * Everything the app has noticed that needed more than one card to see.
 *
 * Deliberately few. A panel of six observations is a panel nobody reads,
 * and the cost of a weak one is not just clutter — it is that the strong
 * one next to it gets trusted less.
 */
export function buildAwareness(sources: AwarenessSources): Insight[] {
  return [...bedtimeAndMornings(sources), ...stackedDayWithNoDinner(sources)].slice(0, 2);
}
