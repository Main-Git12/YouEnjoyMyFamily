import { describe, it, expect } from "vitest";
import {
  learnedDurations,
  planRoutine,
  appliesOn,
  isRoutineDue,
  anchorMomentOn,
  normalizeStepTitle,
  suggestMorningSteps,
} from "./routinePlan";
import type { Routine, RoutineRun, Task } from "../types";

const ROUTINE: Routine = {
  routineId: "r1",
  name: "School morning",
  kind: "morning",
  anchorTime: "07:52",
  daysOfWeek: [1, 2, 3, 4, 5],
  active: true,
  steps: [
    { stepId: "s1", title: "Get dressed", targetMinutes: 10, memberId: "Parker" },
    { stepId: "s2", title: "Breakfast", targetMinutes: 15, memberId: null },
    { stepId: "s3", title: "Shoes and coat", targetMinutes: 5, memberId: null },
  ],
};

/** 2026-09-25 is a Friday. */
const TODAY = "2026-09-25";
const at = (time: string) => anchorMomentOn(TODAY, time);

function run(date: string, steps: [string, string, string, string | null][]): RoutineRun {
  return {
    routineId: "r1",
    date,
    startedAt: null,
    finishedAt: null,
    steps: steps.map(([stepId, title, startedAt, finishedAt]) => ({ stepId, title, startedAt, finishedAt })),
  };
}

/** A step that ran for `minutes` on `date`, as ISO instants. */
function timed(date: string, stepId: string, title: string, startTime: string, minutes: number): RoutineRun {
  const start = anchorMomentOn(date, startTime);
  const end = new Date(start.getTime() + minutes * 60_000);
  return run(date, [[stepId, title, start.toISOString(), end.toISOString()]]);
}

describe("learnedDurations", () => {
  it("takes the median of what a step has actually taken", () => {
    const runs = [
      timed("2026-09-21", "s1", "Get dressed", "07:10", 8),
      timed("2026-09-22", "s1", "Get dressed", "07:10", 12),
      timed("2026-09-23", "s1", "Get dressed", "07:10", 10),
    ];
    expect(learnedDurations(runs).get("get dressed")).toEqual({ medianMinutes: 10, samples: 3 });
  });

  it("is not dragged by the one morning someone wandered off", () => {
    const runs = [
      timed("2026-09-21", "s1", "Get dressed", "07:10", 9),
      timed("2026-09-22", "s1", "Get dressed", "07:10", 10),
      timed("2026-09-23", "s1", "Get dressed", "07:10", 11),
      timed("2026-09-24", "s1", "Get dressed", "07:10", 75),
    ];
    // The mean of these is 26. A plan built on 26 minutes for getting
    // dressed would tell this family to start half an hour early, for ever,
    // because of one bad Thursday.
    expect(learnedDurations(runs).get("get dressed")?.medianMinutes).toBe(11);
  });

  it("ignores a step that was started and never ticked", () => {
    const start = anchorMomentOn("2026-09-21", "07:10").toISOString();
    const runs = [run("2026-09-21", [["s1", "Get dressed", start, null]])];
    expect(learnedDurations(runs).has("get dressed")).toBe(false);
  });

  it("does not learn a duration from a step that was ticked the instant it started", () => {
    // The first tick of a morning used to record startedAt === finishedAt,
    // because there was no previous step and no run row yet. Two of those
    // and the plan believes getting dressed takes a minute — and then
    // tells a family they have fourteen minutes spare while they are
    // twelve minutes late. Worse than having no plan at all.
    const sameMoment = anchorMomentOn("2026-09-21", "07:20").toISOString();
    const runs = [
      run("2026-09-21", [["s1", "Get dressed", sameMoment, sameMoment]]),
      run("2026-09-22", [["s1", "Get dressed", sameMoment, sameMoment]]),
    ];
    expect(learnedDurations(runs).has("get dressed")).toBe(false);
  });

  it("still learns from a step that was genuinely quick", () => {
    // Half a minute is the floor, not a minute — "put your shoes on" can
    // honestly take forty seconds.
    const runs = [
      timed("2026-09-21", "s1", "Shoes", "07:40", 0.7),
      timed("2026-09-22", "s1", "Shoes", "07:40", 0.7),
    ];
    expect(learnedDurations(runs).get("shoes")?.samples).toBe(2);
  });

  it("discards a duration too long to be a measurement of the step", () => {
    const runs = [
      timed("2026-09-21", "s1", "Get dressed", "07:10", 9),
      timed("2026-09-22", "s1", "Get dressed", "07:10", 11),
      // The screen was left on the step overnight.
      timed("2026-09-23", "s1", "Get dressed", "07:10", 400),
    ];
    expect(learnedDurations(runs).get("get dressed")?.samples).toBe(2);
  });

  it("matches a step to its history by title, not by id", () => {
    // Editing the step list reissues ids; the history must survive that.
    const runs = [
      timed("2026-09-21", "old-id-a", "Breakfast", "07:20", 14),
      timed("2026-09-22", "old-id-b", "breakfast ", "07:20", 16),
    ];
    expect(learnedDurations(runs).get("breakfast")).toEqual({ medianMinutes: 15, samples: 2 });
  });

  it("never returns a zero-minute expectation — it declines to answer instead", () => {
    // This used to clamp a zero to one minute, which is what let the
    // first-tick bug through: a one-minute "Get dressed" still wrecks the
    // plan. A step with no credible measurement has none, and the family's
    // own estimate is used until there is one.
    const runs = [timed("2026-09-21", "s1", "Teeth", "07:40", 0), timed("2026-09-22", "s1", "Teeth", "07:40", 0)];
    expect(learnedDurations(runs).get("teeth")).toBeUndefined();
  });

  it("rounds a real short duration up rather than down to nothing", () => {
    const runs = [
      timed("2026-09-21", "s1", "Teeth", "07:40", 0.6),
      timed("2026-09-22", "s1", "Teeth", "07:40", 0.6),
    ];
    expect(learnedDurations(runs).get("teeth")?.medianMinutes).toBe(1);
  });
});

describe("planRoutine", () => {
  it("plans each step backwards from the deadline, not forwards from now", () => {
    const plan = planRoutine({ routine: ROUTINE, history: [], today: null, isoDate: TODAY, now: at("07:00") });
    // 10 + 15 + 5 = 30 minutes of routine, ending at 07:52.
    expect(plan.totalExpectedMinutes).toBe(30);
    expect(plan.steps[0]?.startBy).toEqual(at("07:22"));
    expect(plan.steps[1]?.startBy).toEqual(at("07:32"));
    expect(plan.steps[2]?.startBy).toEqual(at("07:47"));
  });

  it("reports slack as time left minus time still needed", () => {
    const plan = planRoutine({ routine: ROUTINE, history: [], today: null, isoDate: TODAY, now: at("07:00") });
    // 52 minutes until the bus, 30 minutes of routine left.
    expect(plan.minutesToAnchor).toBe(52);
    expect(plan.slackMinutes).toBe(22);
    expect(plan.standing).toBe("ahead");
  });

  it("goes behind when the remaining steps no longer fit", () => {
    const plan = planRoutine({ routine: ROUTINE, history: [], today: null, isoDate: TODAY, now: at("07:30") });
    // 22 minutes left, 30 minutes of routine still to do.
    expect(plan.slackMinutes).toBe(-8);
    expect(plan.standing).toBe("behind");
  });

  it("warns while it's tight, before it's already late", () => {
    const plan = planRoutine({ routine: ROUTINE, history: [], today: null, isoDate: TODAY, now: at("07:19") });
    expect(plan.slackMinutes).toBe(3);
    expect(plan.standing).toBe("tight");
  });

  it("stops counting a step that's done, so finishing early buys real slack", () => {
    const start = anchorMomentOn(TODAY, "07:05").toISOString();
    const end = anchorMomentOn(TODAY, "07:11").toISOString();
    const plan = planRoutine({
      routine: ROUTINE,
      history: [],
      today: run(TODAY, [["s1", "Get dressed", start, end]]),
      isoDate: TODAY,
      now: at("07:11"),
    });
    // 41 minutes left; only Breakfast (15) and Shoes (5) remain.
    expect(plan.slackMinutes).toBe(21);
    expect(plan.steps[0]?.state).toBe("done");
    expect(plan.steps[0]?.actualMinutes).toBe(6);
    expect(plan.current?.title).toBe("Breakfast");
  });

  it("uses what a step actually takes once there's more than one timing", () => {
    const history = [
      timed("2026-09-23", "s1", "Get dressed", "07:10", 18),
      timed("2026-09-24", "s1", "Get dressed", "07:10", 18),
    ];
    const plan = planRoutine({ routine: ROUTINE, history, today: null, isoDate: TODAY, now: at("07:00") });
    expect(plan.steps[0]?.expectedMinutes).toBe(18);
    expect(plan.steps[0]?.basis).toEqual({ kind: "learned", samples: 2 });
    // And the plan moves with it: 18 + 15 + 5 = 38, so the morning has to start earlier.
    expect(plan.steps[0]?.startBy).toEqual(at("07:14"));
  });

  it("keeps the family's own estimate until a single timing has been corroborated", () => {
    const history = [timed("2026-09-24", "s1", "Get dressed", "07:10", 25)];
    const plan = planRoutine({ routine: ROUTINE, history, today: null, isoDate: TODAY, now: at("07:00") });
    expect(plan.steps[0]?.expectedMinutes).toBe(10);
    expect(plan.steps[0]?.basis).toEqual({ kind: "estimate" });
  });

  it("does not learn from today while today is still running", () => {
    const start = anchorMomentOn(TODAY, "07:00").toISOString();
    const end = anchorMomentOn(TODAY, "07:40").toISOString();
    // Chosen so the two medians genuinely differ: [9, 21] is 15,
    // and [9, 21, 40] is 21. A test where both come out the same would
    // pass whether or not today were being filtered out.
    const history = [
      timed("2026-09-23", "s1", "Get dressed", "07:10", 9),
      timed("2026-09-24", "s1", "Get dressed", "07:10", 21),
      // A 40-minute crawl this morning must not reshape this morning's own plan.
      run(TODAY, [["s1", "Get dressed", start, end]]),
    ];
    const plan = planRoutine({ routine: ROUTINE, history, today: null, isoDate: TODAY, now: at("07:00") });
    expect(plan.steps[0]?.expectedMinutes).toBe(15);
  });

  it("is finished, not behind, once every step is ticked", () => {
    const steps = ROUTINE.steps.map((step, index) => {
      const start = anchorMomentOn(TODAY, `07:0${index}`).toISOString();
      const end = anchorMomentOn(TODAY, `07:0${index + 1}`).toISOString();
      return [step.stepId, step.title, start, end] as [string, string, string, string];
    });
    const plan = planRoutine({
      routine: ROUTINE,
      history: [],
      today: run(TODAY, steps),
      isoDate: TODAY,
      // Well past the bus — but they made it, so nothing should say "behind".
      now: at("08:30"),
    });
    expect(plan.finished).toBe(true);
    expect(plan.standing).toBe("done");
    expect(plan.current).toBeNull();
  });
});

describe("appliesOn", () => {
  it("runs on a weekday it's set for", () => {
    expect(appliesOn(ROUTINE, anchorMomentOn("2026-09-25", "07:00"))).toBe(true); // Friday
  });
  it("does not run at the weekend", () => {
    expect(appliesOn(ROUTINE, anchorMomentOn("2026-09-26", "07:00"))).toBe(false); // Saturday
  });
  it("does not run when it's been switched off", () => {
    expect(appliesOn({ ...ROUTINE, active: false }, anchorMomentOn("2026-09-25", "07:00"))).toBe(false);
  });
});

describe("isRoutineDue", () => {
  const planAt = (time: string, today: RoutineRun | null = null) =>
    planRoutine({ routine: ROUTINE, history: [], today, isoDate: TODAY, now: at(time) });

  it("is not due the evening before", () => {
    expect(isRoutineDue(planAt("21:00"), at("21:00"))).toBe(false);
  });

  it("opens shortly before there is only just enough time", () => {
    // 30 minutes of routine + 20 minutes of lead = open from 07:02.
    expect(isRoutineDue(planAt("06:55"), at("06:55"))).toBe(false);
    expect(isRoutineDue(planAt("07:05"), at("07:05"))).toBe(true);
  });

  it("stays up a little past the deadline for the late run", () => {
    expect(isRoutineDue(planAt("08:00"), at("08:00"))).toBe(true);
    expect(isRoutineDue(planAt("08:30"), at("08:30"))).toBe(false);
  });

  it("closes the moment the routine is finished, however early", () => {
    const steps = ROUTINE.steps.map((step, index) => {
      const start = anchorMomentOn(TODAY, `07:1${index}`).toISOString();
      const end = anchorMomentOn(TODAY, `07:1${index + 1}`).toISOString();
      return [step.stepId, step.title, start, end] as [string, string, string, string];
    });
    const done = planAt("07:20", run(TODAY, steps));
    expect(isRoutineDue(done, at("07:20"))).toBe(false);
  });
});

describe("anchorMomentOn", () => {
  it("reads the anchor as a wall-clock time on the family's own day", () => {
    const moment = anchorMomentOn("2026-09-25", "07:52");
    expect(moment.getFullYear()).toBe(2026);
    expect(moment.getMonth()).toBe(8);
    expect(moment.getDate()).toBe(25);
    expect(moment.getHours()).toBe(7);
    expect(moment.getMinutes()).toBe(52);
  });
});

describe("normalizeStepTitle", () => {
  it("treats the same step written differently as the same step", () => {
    expect(normalizeStepTitle("  Shoes and Coat ")).toBe("shoes and coat");
  });
});

describe("suggestMorningSteps", () => {
  const task = (title: string, dueWindow: Task["dueWindow"], assignedTo: string | null): Task => ({
    taskId: title,
    title,
    assignedTo,
    dueDate: null,
    date: TODAY,
    status: "pending",
    gemValue: 5,
    dueWindow,
    recurrence: "daily",
    completedOn: null,
    gemsAwarded: 0,
  });

  it("offers the family's own morning chores as a starting point", () => {
    const steps = suggestMorningSteps([
      task("Get dressed", "morning", "Parker"),
      task("Homework", "after_school", "Parker"),
      task("Brush teeth", "morning", "Wren"),
    ]);
    expect(steps.map((step) => step.title)).toEqual(["Get dressed", "Brush teeth"]);
    expect(steps[0]?.memberId).toBe("Parker");
  });

  it("invents nothing when the family has no morning chores yet", () => {
    expect(suggestMorningSteps([task("Homework", "after_school", null)])).toEqual([]);
  });
});

describe("what the plan is allowed to say", () => {
  it("describes steps, never the people doing them", () => {
    // The plan's own vocabulary is step titles, minutes and a standing.
    // There is deliberately no field anywhere on it that characterises a
    // person — no "slowest", no "usual offender", no per-child rating.
    const plan = planRoutine({ routine: ROUTINE, history: [], today: null, isoDate: TODAY, now: at("07:00") });
    const serialized = JSON.stringify(plan).toLowerCase();
    for (const banned of ["slow", "always", "never", "worst", "lazy", "bad at", "struggles"]) {
      expect(serialized).not.toContain(banned);
    }
    // memberId is carried so a step can be addressed to someone — that is
    // "Parker, shoes", which is a request, not a character assessment.
    expect(plan.steps[0]?.memberId).toBe("Parker");
  });

  it("says where every duration came from, so a parent can check its working", () => {
    const history = [
      timed("2026-09-23", "s2", "Breakfast", "07:20", 12),
      timed("2026-09-24", "s2", "Breakfast", "07:20", 12),
    ];
    const plan = planRoutine({ routine: ROUTINE, history, today: null, isoDate: TODAY, now: at("07:00") });
    for (const step of plan.steps) {
      expect(step.basis.kind === "learned" || step.basis.kind === "estimate").toBe(true);
    }
    expect(plan.steps[1]?.basis).toEqual({ kind: "learned", samples: 2 });
  });
});
