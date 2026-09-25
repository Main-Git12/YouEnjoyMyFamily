import type { Routine, RoutineRun, RoutineStep, Task } from "../types";

/**
 * Planning a morning backwards from the moment it has to be over.
 *
 * The bus leaves at 07:52. It leaves at 07:52 whether or not anyone has
 * shoes on, and no amount of "hurry up" moves it. So this module never
 * reasons forward from "when did we start" — it starts at the deadline,
 * subtracts what each remaining step actually takes, and reports one
 * number: how many minutes of slack are left.
 *
 * That number is the entire point of the feature. A parent saying "we're
 * going to be late" is an opinion a seven-year-old can argue with. A
 * screen saying "4 minutes behind" is a fact, and crucially it is the
 * *screen* saying it, not the parent — which is the difference between
 * a morning with one adult nagging three people and a morning where
 * everyone, adult included, is reading the same clock.
 *
 * Two rules this module holds to, both tested:
 *
 *  1. It describes *steps*, never people. "Shoes and coat usually takes
 *     4 minutes" is a fact about a step. "Parker is slow in the mornings"
 *     is a characterisation of a child, on a screen that child can read,
 *     and this app does not do that. (Same rule as lib/insights.ts.)
 *  2. Every duration says where it came from. A step that has been timed
 *     nine times says so; a step running on a parent's original guess says
 *     that instead. A plan you can't check is a plan you can only obey.
 */

/** Steps are matched to their own history by title, not id — see schema.md. */
export function normalizeStepTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Longer than this and it isn't a measurement of the step, it's a screen
 * someone walked away from. Counting it would quietly inflate every plan
 * built afterwards, which is exactly the failure that makes a planning app
 * useless: it starts telling you you have time you don't have.
 */
const MAX_CREDIBLE_STEP_MINUTES = 90;

/** How long a step has actually been taking, and how many times it's been timed. */
export interface LearnedDuration {
  medianMinutes: number;
  samples: number;
}

function median(values: number[]): number {
  // Median rather than mean, deliberately. One morning where a child
  // wandered off mid-step for twenty minutes is not evidence about the
  // step, and a mean would let that single morning reshape every plan
  // from then on.
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

/**
 * What each step has actually taken, from finished runs only.
 *
 * A step that was started and never ticked has no duration and never gets
 * one — it contributes nothing rather than a guess.
 */
export function learnedDurations(runs: RoutineRun[]): Map<string, LearnedDuration> {
  const samples = new Map<string, number[]>();

  for (const run of runs) {
    for (const step of run.steps) {
      if (!step.finishedAt) continue;
      const startedAt = Date.parse(step.startedAt);
      const finishedAt = Date.parse(step.finishedAt);
      if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) continue;
      const minutes = (finishedAt - startedAt) / 60_000;
      // A negative duration means a clock changed under us, not a step done
      // before it started.
      if (minutes < 0 || minutes > MAX_CREDIBLE_STEP_MINUTES) continue;
      const key = normalizeStepTitle(step.title);
      const existing = samples.get(key);
      if (existing) existing.push(minutes);
      else samples.set(key, [minutes]);
    }
  }

  const learned = new Map<string, LearnedDuration>();
  for (const [key, values] of samples) {
    learned.set(key, { medianMinutes: Math.max(1, Math.round(median(values))), samples: values.length });
  }
  return learned;
}

/** Where a step's expected duration came from. Always shown, never implied. */
export type DurationBasis =
  | { kind: "learned"; samples: number }
  | { kind: "estimate" };

export interface PlannedStep {
  stepId: string;
  title: string;
  memberId: string | null;
  /** What this step is expected to take — learned if we know, else the family's own estimate. */
  expectedMinutes: number;
  basis: DurationBasis;
  /** The latest this step can begin and still leave room for everything after it. */
  startBy: Date;
  state: "done" | "current" | "upcoming";
  /** How long it took today, once it's done. */
  actualMinutes: number | null;
}

export type Standing = "ahead" | "tight" | "behind" | "done";

export interface RoutinePlan {
  /** The deadline, as a real moment today. */
  anchorAt: Date;
  steps: PlannedStep[];
  /** The one step being worked on now — what the screen should be showing. */
  current: PlannedStep | null;
  /** Minutes left, minus the minutes everything still to do needs. Negative means late. */
  slackMinutes: number;
  minutesToAnchor: number;
  standing: Standing;
  finished: boolean;
  /** Total expected minutes for the whole routine, used to decide when to open. */
  totalExpectedMinutes: number;
}

/**
 * The anchor as a moment on a given local day.
 *
 * Built with the local Date constructor, not `Date.UTC` — and that is the
 * opposite of what `dates.ts` does when it *parses* an ISO date, for a
 * reason worth stating. Reading "2026-09-25" back as a local date shifts
 * the day west of UTC, so parsing must be UTC. But "07:52" is a wall-clock
 * time in this family's kitchen; it means 07:52 on the clock they are
 * looking at, and combining it with their own local date has to be local
 * too. Mixing the two up is how an app ends up an hour out twice a year.
 */
export function anchorMomentOn(isoDate: string, anchorTime: string, ): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = anchorTime.split(":").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0);
}

/** Does this routine run today? Weekday and on/off only — nothing inferred. */
export function appliesOn(routine: Routine, date: Date): boolean {
  return routine.active && routine.daysOfWeek.includes(date.getDay());
}

function expectedFor(step: RoutineStep, learned: Map<string, LearnedDuration>): {
  minutes: number;
  basis: DurationBasis;
} {
  const match = learned.get(normalizeStepTitle(step.title));
  // One timing is an anecdote. Two is the beginning of a pattern, and is
  // still better than a number typed in once and never revisited.
  if (match && match.samples >= 2) {
    return { minutes: match.medianMinutes, basis: { kind: "learned", samples: match.samples } };
  }
  return { minutes: step.targetMinutes, basis: { kind: "estimate" } };
}

/**
 * The whole plan for one day: what's done, what's now, what's left, and
 * whether the remaining time is actually enough.
 */
export function planRoutine(input: {
  routine: Routine;
  /** Past runs, for learning. Today's run may be among them; it's handled separately. */
  history: RoutineRun[];
  /** Today's run so far, if it's started. */
  today: RoutineRun | null;
  isoDate: string;
  now: Date;
}): RoutinePlan {
  const { routine, history, today, isoDate, now } = input;
  // Today is excluded from its own learning — a step timed an hour ago
  // shouldn't be quietly reshaping the plan it's part of.
  const learned = learnedDurations(history.filter((run) => run.date !== isoDate));
  const anchorAt = anchorMomentOn(isoDate, routine.anchorTime);

  const runSteps = new Map((today?.steps ?? []).map((step) => [step.stepId, step]));
  const firstUnfinishedIndex = routine.steps.findIndex((step) => !runSteps.get(step.stepId)?.finishedAt);

  // Built back-to-front: the last step must finish at the anchor, so its
  // latest start is anchor minus its own length; the one before it must
  // start early enough for both. Nothing here depends on when the morning
  // actually began.
  const expected = routine.steps.map((step) => ({ step, ...expectedFor(step, learned) }));
  const startByMs: number[] = new Array<number>(expected.length);
  let runningTailMinutes = 0;
  for (let index = expected.length - 1; index >= 0; index--) {
    runningTailMinutes += expected[index]?.minutes ?? 0;
    startByMs[index] = anchorAt.getTime() - runningTailMinutes * 60_000;
  }
  const totalExpectedMinutes = runningTailMinutes;

  const steps: PlannedStep[] = expected.map((entry, index) => {
    const run = runSteps.get(entry.step.stepId);
    const done = Boolean(run?.finishedAt);
    let actualMinutes: number | null = null;
    if (run?.finishedAt) {
      const elapsed = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60_000;
      if (!Number.isNaN(elapsed) && elapsed >= 0) actualMinutes = Math.round(elapsed);
    }
    return {
      stepId: entry.step.stepId,
      title: entry.step.title,
      memberId: entry.step.memberId,
      expectedMinutes: entry.minutes,
      basis: entry.basis,
      startBy: new Date(startByMs[index] ?? anchorAt.getTime()),
      state: done ? "done" : index === firstUnfinishedIndex ? "current" : "upcoming",
      actualMinutes,
    };
  });

  const finished = firstUnfinishedIndex === -1;
  const remainingMinutes = steps
    .filter((step) => step.state !== "done")
    .reduce((total, step) => total + step.expectedMinutes, 0);
  const minutesToAnchor = (anchorAt.getTime() - now.getTime()) / 60_000;
  const slackMinutes = Math.round(minutesToAnchor - remainingMinutes);

  let standing: Standing;
  if (finished) standing = "done";
  else if (slackMinutes < 0) standing = "behind";
  // Under five minutes of slack isn't comfortable, and saying so before it
  // becomes "behind" is the only part of this that's any use — once you're
  // late, knowing you're late is worth very little.
  else if (slackMinutes < 5) standing = "tight";
  else standing = "ahead";

  return {
    anchorAt,
    steps,
    current: steps.find((step) => step.state === "current") ?? null,
    slackMinutes,
    minutesToAnchor: Math.round(minutesToAnchor),
    standing,
    finished,
    totalExpectedMinutes,
  };
}

/**
 * How long before the routine needs to start that the screen should switch
 * over to it. Enough warning to be useful, not so much that the kitchen
 * display is a countdown clock for half the evening.
 */
const LEAD_MINUTES = 20;
/** And how long it stays up after the deadline, for the inevitable late run. */
const GRACE_MINUTES = 15;

/**
 * Should the screen be showing this routine right now, rather than the
 * dashboard? True from shortly before there's only just enough time, until
 * a little after the deadline — and never once the routine is finished,
 * because a screen still counting down at a family who are already in the
 * car is just noise.
 */
export function isRoutineDue(plan: RoutinePlan, now: Date): boolean {
  if (plan.finished) return false;
  const opensAt = plan.anchorAt.getTime() - (plan.totalExpectedMinutes + LEAD_MINUTES) * 60_000;
  const closesAt = plan.anchorAt.getTime() + GRACE_MINUTES * 60_000;
  return now.getTime() >= opensAt && now.getTime() <= closesAt;
}

/**
 * A first draft of a morning routine, from the chores this family already
 * keeps in the morning window.
 *
 * Setting up a routine means typing six steps and six durations on a
 * wall-mounted screen, which is precisely the kind of chore that means a
 * feature never gets used. The family has already told the app what their
 * mornings contain; this offers it back as a starting point they can edit,
 * rather than an empty form. It proposes and never saves — same rule as
 * everything else here.
 */
export function suggestMorningSteps(tasks: Task[]): { title: string; targetMinutes: number; memberId: string | null }[] {
  const DEFAULT_MINUTES = 10;
  return tasks
    .filter((task) => task.dueWindow === "morning")
    .map((task) => ({ title: task.title, targetMinutes: DEFAULT_MINUTES, memberId: task.assignedTo }));
}
