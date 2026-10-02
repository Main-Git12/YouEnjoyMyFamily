import type { HouseholdMember, Routine, RoutineRun, RoutineStep } from "../types";
import { learnedDurations, normalizeStepTitle, anchorMomentOn, type DurationBasis } from "./routinePlan";

/**
 * A carer's shift, laid out forwards.
 *
 * Every other routine in this app is planned backwards from the moment it
 * has to be *over* — the bus goes at 07:52 whether or not anyone has shoes
 * on. A care shift is the opposite shape and it would be a lie to force it:
 * somebody arrives at ten, and there is no bus. Planning it backwards would
 * mean inventing a finishing time nobody agreed to, which is exactly the
 * kind of made-up number the rest of this codebase refuses to produce.
 *
 * So the layout is its own, and the half that is shared is the half that
 * matters: step durations learned as the median of finished runs, each one
 * saying whether it was measured and from how many. How long a shower takes
 * is a fact about the person being helped, not about who is helping — so
 * one care routine is shared across every carer on the rota, and the
 * learning pools where it belongs instead of splitting per person.
 *
 * The rules the rest of the app keeps apply here hardest, because this
 * routine is about an older adult and is run by a paid worker, and both are
 * people an app could very easily start describing. The subject of every
 * line below is a *step* or a *shift*. Never a person, never a body, never
 * how somebody is doing.
 */

/** Who is on today, from the rota the family typed in. Nothing inferred. */
export function carersOn(members: HouseholdMember[], date: Date): HouseholdMember[] {
  const weekday = date.getDay();
  return members
    .filter((member) => member.role === "carer" && (member.daysOfWeek ?? []).includes(weekday))
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.displayName.localeCompare(b.displayName));
}

/** Whether a step is parked for now. A pause with no date never lifts, so it isn't one. */
export function isPaused(step: RoutineStep, onDate: string): boolean {
  return Boolean(step.pausedUntil) && (step.pausedUntil as string) >= onDate;
}

export interface CareStep {
  stepId: string;
  title: string;
  expectedMinutes: number;
  basis: DurationBasis;
  /** When this step is expected to begin, laid out forwards from the shift start. */
  startsAt: Date;
  /** Who it belongs to normally. */
  memberId: string | null;
}

export interface PausedStep {
  stepId: string;
  title: string;
  until: string;
  reason: string | null;
  /** Who picked it up. Null is the whole point of showing it: nobody has. */
  coveredBy: string | null;
}

export interface CarePlan {
  carer: HouseholdMember | null;
  /** The shift as agreed, not as it turned out. */
  shiftStart: Date | null;
  shiftEnd: Date | null;
  steps: CareStep[];
  paused: PausedStep[];
  /** What the live steps are expected to take, all told. */
  totalExpectedMinutes: number;
  /** Minutes of shift minus minutes of work. Negative means the shift is over-full. */
  roomMinutes: number | null;
  /** How much of the plan rests on measured time rather than somebody's guess. */
  measuredSteps: number;
}

const minutesBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / 60000);

/**
 * The shift for one day: who, when, in what order, and whether it fits.
 *
 * `roomMinutes` is the one number worth reading, and it is deliberately the
 * same shape as the morning's slack: positive means there is room, negative
 * means the agreed hours do not cover the work that has been written down.
 * That second case is a fact about a *plan* — too much was scheduled — and
 * never about whoever is working it.
 */
export function planCareShift(input: {
  routine: Routine | null;
  runs: RoutineRun[];
  members: HouseholdMember[];
  isoDate: string;
  now: Date;
}): CarePlan | null {
  const { routine, runs, members, isoDate, now } = input;
  if (!routine || routine.kind !== "care" || !routine.active) return null;
  if (!routine.daysOfWeek.includes(now.getDay())) return null;

  const [carer = null] = carersOn(members, now);

  // The carer's own hours win over the routine's anchor: the rota is what
  // the family agreed with that person, and two carers on the same routine
  // keep different hours (Ryan 10-12, Kimmie 9-1). The routine's anchor is
  // only the fallback for a day with nobody rostered.
  const startClock = carer?.startsAt ?? routine.anchorTime;
  const shiftStart = anchorMomentOn(isoDate, startClock);
  const shiftEnd = carer?.endsAt ? anchorMomentOn(isoDate, carer.endsAt) : null;

  const learned = learnedDurations(runs);
  const live: CareStep[] = [];
  const paused: PausedStep[] = [];
  let cursor = shiftStart;

  for (const step of routine.steps) {
    if (isPaused(step, isoDate)) {
      paused.push({
        stepId: step.stepId,
        title: step.title,
        until: step.pausedUntil as string,
        reason: step.pausedReason ?? null,
        coveredBy: step.coveredBy ?? null,
      });
      continue;
    }

    const match = learned.get(normalizeStepTitle(step.title));
    // One timing is an anecdote; two is the beginning of a pattern. Same
    // threshold the morning uses, for the same reason.
    const measured = match && match.samples >= 2;
    const expectedMinutes = measured ? match.medianMinutes : step.targetMinutes;

    live.push({
      stepId: step.stepId,
      title: step.title,
      expectedMinutes,
      basis: measured ? { kind: "learned", samples: match.samples } : { kind: "estimate" },
      startsAt: cursor,
      memberId: step.memberId ?? null,
    });
    cursor = new Date(cursor.getTime() + expectedMinutes * 60000);
  }

  const totalExpectedMinutes = live.reduce((sum, step) => sum + step.expectedMinutes, 0);

  return {
    carer,
    shiftStart,
    shiftEnd,
    steps: live,
    paused,
    totalExpectedMinutes,
    roomMinutes: shiftEnd ? minutesBetween(shiftStart, shiftEnd) - totalExpectedMinutes : null,
    measuredSteps: live.filter((step) => step.basis.kind === "learned").length,
  };
}

export interface Overlap {
  minutes: number;
  /** Plain words for the screen: what overlaps what, and by how long. */
  because: string;
}

/**
 * Whether the care shift actually lands on top of the family's morning.
 *
 * Worth computing rather than assuming, and that is the entire point of
 * this function. A household reorganising itself around a clash it believes
 * in will move things that did not need moving; the two windows are both
 * written down, so the app can just look. When they do not overlap it says
 * so, which is the more useful answer and the one nobody expects.
 *
 * The morning's window is the time it is expected to take, ending at its
 * deadline — not the whole morning. A bus at 07:52 and a shift at 10:00 do
 * not compete for anything, however busy both are.
 */
export function overlapWithMorning(
  care: { shiftStart: Date | null; shiftEnd: Date | null },
  morning: { anchorAt: Date; totalExpectedMinutes: number } | null
): Overlap | null {
  if (!care.shiftStart || !care.shiftEnd || !morning) return null;

  const morningStart = new Date(morning.anchorAt.getTime() - morning.totalExpectedMinutes * 60000);
  const start = Math.max(morningStart.getTime(), care.shiftStart.getTime());
  const end = Math.min(morning.anchorAt.getTime(), care.shiftEnd.getTime());
  const minutes = Math.round((end - start) / 60000);

  if (minutes <= 0) {
    return {
      minutes: 0,
      because: "The school morning is finished before the shift starts — they don't run into each other.",
    };
  }
  return {
    minutes,
    because: `The school morning and the shift share ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}
