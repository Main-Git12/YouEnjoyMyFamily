import { describe, it, expect } from "vitest";
import { buildAwareness, type AwarenessSources } from "./awareness";
import { anchorMomentOn } from "./routinePlan";
import type { Routine, RoutineRun, ScheduleEntry, MealPlanEntry } from "../types";

const BEDTIME: Routine = {
  routineId: "bed", name: "Bedtime", kind: "bedtime", anchorTime: "20:00",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], active: true,
  steps: [{ stepId: "b1", title: "Story", targetMinutes: 10, memberId: null }],
};
const MORNING: Routine = {
  routineId: "morn", name: "The bus", kind: "morning", anchorTime: "07:52",
  daysOfWeek: [1, 2, 3, 4, 5], active: true,
  steps: [{ stepId: "m1", title: "Get dressed", targetMinutes: 10, memberId: null }],
};

/** A run of `routineId` on `date` that finished `minutesPast` its anchor. */
function run(routineId: string, date: string, anchor: string, minutesPast: number | null): RoutineRun {
  const finishedAt =
    minutesPast === null
      ? null
      : new Date(anchorMomentOn(date, anchor).getTime() + minutesPast * 60_000).toISOString();
  return { routineId, date, startedAt: null, finishedAt, steps: [] };
}

function sources(over: Partial<AwarenessSources> = {}): AwarenessSources {
  return {
    routines: [BEDTIME, MORNING],
    routineRuns: [],
    schedule: [],
    mealPlan: [],
    weekDays: ["2026-09-25"],
    today: "2026-09-25",
    ...over,
  };
}

/**
 * `nights` pairs of (bedtime over by N, next morning over by M). Dates are
 * consecutive weekdays starting 2026-09-07 (a Monday).
 */
function paired(nights: [number | null, number | null][]): RoutineRun[] {
  const runs: RoutineRun[] = [];
  nights.forEach(([night, morning], index) => {
    const day = new Date(Date.UTC(2026, 8, 7 + index));
    const date = day.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(2026, 8, 8 + index)).toISOString().slice(0, 10);
    runs.push(run("bed", date, "20:00", night));
    runs.push(run("morn", next, "07:52", morning));
  });
  return runs;
}

describe("bedtime and the mornings after", () => {
  it("says nothing until there are enough paired nights", () => {
    const runs = paired([[20, 3], [15, 5], [-10, -20]]);
    expect(buildAwareness(sources({ routineRuns: runs }))).toEqual([]);
  });

  it("notices when the tight mornings follow the late nights", () => {
    const runs = paired([
      [25, 4], [30, 2], [20, 6], [18, 1],      // late nights, tight mornings
      [-15, -20], [-20, -18], [-10, -25], [-12, -15], // on-time nights, comfortable mornings
    ]);
    const [notice] = buildAwareness(sources({ routineRuns: runs }));
    expect(notice?.kind).toBe("bedtime_and_mornings");
    expect(notice?.title).toBe("The mornings after a late bedtime have been the tight ones.");
    expect(notice?.because).toBe(
      "4 of 4 mornings after lights-out ran over, against 0 of 4 after an on-time night"
    );
  });

  it("stays quiet when the mornings go the same way either way", () => {
    const runs = paired([
      [25, 4], [30, -20], [20, 6], [18, -18],
      [-15, 3], [-20, -22], [-10, 5], [-12, -19],
    ]);
    expect(buildAwareness(sources({ routineRuns: runs }))).toEqual([]);
  });

  it("counts a morning that never finished as the tightest kind there is", () => {
    const runs = paired([
      [25, null], [30, null], [20, null], [18, null],
      [-15, -20], [-20, -18], [-10, -25], [-12, -15],
    ]);
    const [notice] = buildAwareness(sources({ routineRuns: runs }));
    expect(notice?.because).toMatch(/^4 of 4 mornings/);
  });

  it("ignores a night with no school morning after it", () => {
    // Bedtime rows with no following morning run — a weekend lie-in is
    // not evidence about a school run.
    const runs = [
      ...paired([[25, 4], [30, 2], [20, 6], [18, 1], [-15, -20], [-20, -18], [-10, -25], [-12, -15]]),
      run("bed", "2026-09-26", "20:00", 40),
      run("bed", "2026-09-27", "20:00", 45),
    ];
    const [notice] = buildAwareness(sources({ routineRuns: runs }));
    expect(notice?.because).toBe(
      "4 of 4 mornings after lights-out ran over, against 0 of 4 after an on-time night"
    );
  });

  it("says nothing when one of the two routines doesn't exist", () => {
    const runs = paired([[25, 4], [30, 2], [20, 6], [18, 1], [-15, -20], [-20, -18], [-10, -25], [-12, -15]]);
    expect(buildAwareness(sources({ routineRuns: runs, routines: [MORNING] }))).toEqual([]);
  });

  it("reports what co-occurred and never why", () => {
    const runs = paired([
      [25, 4], [30, 2], [20, 6], [18, 1],
      [-15, -20], [-20, -18], [-10, -25], [-12, -15],
    ]);
    const notice = buildAwareness(sources({ routineRuns: runs }))[0];
    const text = `${notice?.title} ${notice?.because}`.toLowerCase();
    // "Late bedtimes are making your mornings hard" is a theory. A screen
    // that states theories as findings teaches a family to stop believing
    // the ones that are true.
    for (const causal of ["because", "causes", "causing", "makes", "making", "leads to", "why", "due to"]) {
      expect(text).not.toContain(causal);
    }
    // And it is about nights and mornings, not about a person. Whole
    // words: "he" lives inside "the", and a substring check would fail
    // on its own sentence.
    for (const person of ["parker", "wren", "you", "your", "they", "their", "he", "she"]) {
      expect(text).not.toMatch(new RegExp(`\\b${person}\\b`));
    }
  });
});

describe("a stacked day with nothing to eat", () => {
  const busy: ScheduleEntry[] = ["Swimming", "Cello", "Scouts"].map((title, index) => ({
    scheduleId: `s${index}`, date: "2026-09-30", title, startTime: null, endTime: null, memberIds: [],
  }));

  it("puts the calendar and the meal plan next to each other", () => {
    const [notice] = buildAwareness(
      sources({ schedule: busy, weekDays: ["2026-09-25", "2026-09-30"], mealPlan: [] })
    );
    expect(notice?.kind).toBe("stacked_day_no_dinner");
    expect(notice?.title).toBe("Wednesday has 3 things on it and no dinner planned.");
    expect(notice?.because).toBe("Swimming, Cello, Scouts");
    expect(notice?.action).toEqual({ label: "Plan something", kind: "plan_meal", payload: "2026-09-30" });
  });

  it("stays quiet once dinner is planned", () => {
    const mealPlan: MealPlanEntry[] = [
      { date: "2026-09-30", slot: "dinner", mealName: "Tacos", ingredients: [] },
    ];
    expect(
      buildAwareness(sources({ schedule: busy, weekDays: ["2026-09-25", "2026-09-30"], mealPlan }))
    ).toEqual([]);
  });

  it("stays quiet on a day with only a couple of things on it", () => {
    expect(
      buildAwareness(sources({ schedule: busy.slice(0, 2), weekDays: ["2026-09-25", "2026-09-30"] }))
    ).toEqual([]);
  });

  it("does not raise a day that has already gone", () => {
    const past = busy.map((entry) => ({ ...entry, date: "2026-09-20" }));
    expect(buildAwareness(sources({ schedule: past, weekDays: ["2026-09-20"] }))).toEqual([]);
  });

  it("says Today rather than the weekday for today", () => {
    const todayBusy = busy.map((entry) => ({ ...entry, date: "2026-09-25" }));
    const [notice] = buildAwareness(sources({ schedule: todayBusy }));
    expect(notice?.title).toBe("Today has 3 things on it and no dinner planned.");
  });
});

describe("how much it says at once", () => {
  it("keeps to two, because a weak notice costs the strong one its credit", () => {
    const runs = paired([
      [25, 4], [30, 2], [20, 6], [18, 1],
      [-15, -20], [-20, -18], [-10, -25], [-12, -15],
    ]);
    const busy: ScheduleEntry[] = ["A", "B", "C"].map((title, index) => ({
      scheduleId: `s${index}`, date: "2026-09-25", title, startTime: null, endTime: null, memberIds: [],
    }));
    expect(buildAwareness(sources({ routineRuns: runs, schedule: busy })).length).toBeLessThanOrEqual(2);
  });

  it("has nothing to say about a household that has only just started", () => {
    expect(buildAwareness(sources())).toEqual([]);
  });
});

/**
 * One late night is not a pattern. The guard used to require only that
 * neither group be empty, so a single late night followed by a single tight
 * morning was a rate of 100% and cleared the threshold on its own.
 */
describe("how much evidence a cross-domain claim needs", () => {
  const nights = (dates: string[], minutesPast: number) =>
    dates.map((d) => run("bed", d, "20:00", minutesPast));
  const mornings = (dates: string[], minutesPast: number | null) =>
    dates.map((d) => run("morn", d, "07:52", minutesPast));

  it("says nothing from a single late night, however badly that morning went", () => {
    const onTimeNights = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
    const runs = [
      ...nights(onTimeNights, -20),
      ...mornings(["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"], -30),
      ...nights(["2026-09-21"], 45),
      ...mornings(["2026-09-22"], 10),
    ];
    const found = buildAwareness(sources({ routineRuns: runs }));
    expect(found.filter((i) => i.kind === "bedtime_and_mornings")).toEqual([]);
  });

  it("still speaks once both sides have enough nights behind them", () => {
    const lateNights = ["2026-09-07", "2026-09-14", "2026-09-21"];
    const calmNights = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const runs = [
      ...nights(lateNights, 45),
      ...mornings(["2026-09-08", "2026-09-15", "2026-09-22"], 10),
      ...nights(calmNights, -20),
      ...mornings(["2026-09-02", "2026-09-03", "2026-09-04"], -30),
    ];
    const found = buildAwareness(sources({ routineRuns: runs }));
    expect(found.find((i) => i.kind === "bedtime_and_mornings")?.because).toContain("3 mornings after lights-out ran over");
  });
});
