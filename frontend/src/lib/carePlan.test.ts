import { describe, it, expect } from "vitest";
import { carersOn, isPaused, planCareShift, overlapWithMorning } from "./carePlan";
import type { HouseholdMember, Routine, RoutineRun, RoutineStep } from "../types";

const carer = (displayName: string, daysOfWeek: number[], startsAt: string, endsAt: string): HouseholdMember => ({
  memberId: displayName.toLowerCase(),
  displayName,
  role: "carer",
  note: null,
  daysOfWeek,
  startsAt,
  endsAt,
});

// Ryan is in Mondays and Fridays, 10 till 12. Kimmie Tuesday to Thursday, 9 till 1.
const RYAN = carer("Ryan", [1, 5], "10:00", "12:00");
const KIMMIE = carer("Kimmie", [2, 3, 4], "09:00", "13:00");
const SHELIAH: HouseholdMember = { memberId: "sheliah", displayName: "Sheliah", role: "adult", note: null };

const step = (title: string, targetMinutes: number, extra: Partial<RoutineStep> = {}): RoutineStep => ({
  stepId: title.toLowerCase().replace(/\W+/g, "-"),
  title,
  targetMinutes,
  memberId: null,
  ...extra,
});

const routine = (steps: RoutineStep[], daysOfWeek = [1, 2, 3, 4, 5]): Routine => ({
  routineId: "r_care",
  name: "Sheliah's morning",
  kind: "care",
  anchorTime: "09:00",
  daysOfWeek,
  steps,
  active: true,
});

const run = (date: string, entries: { title: string; minutes: number }[]): RoutineRun => ({
  routineId: "r_care",
  date,
  startedAt: `${date}T09:00:00.000Z`,
  finishedAt: `${date}T12:00:00.000Z`,
  steps: entries.map((entry, index) => ({
    stepId: `s${index}`,
    title: entry.title,
    startedAt: `${date}T09:00:00.000Z`,
    finishedAt: new Date(Date.parse(`${date}T09:00:00.000Z`) + entry.minutes * 60000).toISOString(),
  })),
});

// A Tuesday and a Monday.
const TUESDAY = new Date(2026, 9, 6, 8, 0);
const MONDAY = new Date(2026, 9, 5, 8, 0);

describe("who is on today", () => {
  it("reads the rota rather than guessing", () => {
    expect(carersOn([RYAN, KIMMIE, SHELIAH], TUESDAY).map((c) => c.displayName)).toEqual(["Kimmie"]);
    expect(carersOn([RYAN, KIMMIE, SHELIAH], MONDAY).map((c) => c.displayName)).toEqual(["Ryan"]);
  });

  it("never counts somebody who simply lives here as being on shift", () => {
    expect(carersOn([SHELIAH], TUESDAY)).toEqual([]);
  });

  it("says nobody rather than guessing on a day with no rota", () => {
    const SUNDAY = new Date(2026, 9, 4, 8, 0);
    expect(carersOn([RYAN, KIMMIE], SUNDAY)).toEqual([]);
  });
});

describe("the shift plan", () => {
  const steps = [step("Shower", 25), step("Lay out clothes", 10), step("Breakfast and coffee", 20)];

  it("lays the steps out forwards from when the carer actually arrives", () => {
    // Not backwards from a deadline: there is no bus. Kimmie starts at 9.
    const plan = planCareShift({
      routine: routine(steps),
      runs: [],
      members: [RYAN, KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    expect(plan?.carer?.displayName).toBe("Kimmie");
    expect(plan?.steps.map((s) => s.title)).toEqual(["Shower", "Lay out clothes", "Breakfast and coffee"]);
    expect(plan?.steps[0]?.startsAt.getHours()).toBe(9);
    expect(plan?.steps[1]?.startsAt.getMinutes()).toBe(25);
    expect(plan?.steps[2]?.startsAt.getMinutes()).toBe(35);
  });

  it("uses the carer's own hours, not the routine's anchor", () => {
    // One routine, two carers, different hours. Ryan is 10 till 12.
    const plan = planCareShift({
      routine: routine(steps),
      runs: [],
      members: [RYAN, KIMMIE],
      isoDate: "2026-10-05",
      now: MONDAY,
    });

    expect(plan?.carer?.displayName).toBe("Ryan");
    expect(plan?.shiftStart?.getHours()).toBe(10);
    expect(plan?.shiftEnd?.getHours()).toBe(12);
  });

  it("says whether the work actually fits inside the agreed hours", () => {
    // 55 minutes of steps in Ryan's two hours: 65 minutes of room.
    const plan = planCareShift({
      routine: routine(steps),
      runs: [],
      members: [RYAN],
      isoDate: "2026-10-05",
      now: MONDAY,
    });

    expect(plan?.totalExpectedMinutes).toBe(55);
    expect(plan?.roomMinutes).toBe(65);
  });

  it("says plainly when more has been written down than the shift holds", () => {
    // A fact about a plan — too much was scheduled — never about whoever
    // is working it.
    const tooMuch = [step("Shower", 40), step("Walk", 45), step("Lunch", 45), step("Laundry", 30)];
    const plan = planCareShift({
      routine: routine(tooMuch),
      runs: [],
      members: [RYAN],
      isoDate: "2026-10-05",
      now: MONDAY,
    });

    expect(plan?.roomMinutes).toBeLessThan(0);
  });

  it("learns how long a step really takes, and says how many times it was timed", () => {
    const runs = [
      run("2026-09-29", [{ title: "Shower", minutes: 35 }]),
      run("2026-09-30", [{ title: "Shower", minutes: 40 }]),
      run("2026-10-01", [{ title: "Shower", minutes: 36 }]),
    ];

    const plan = planCareShift({
      routine: routine(steps),
      runs,
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });
    const shower = plan?.steps.find((s) => s.title === "Shower");

    // The median of 35, 36, 40 — not the family's original guess of 25.
    expect(shower?.expectedMinutes).toBe(36);
    expect(shower?.basis).toEqual({ kind: "learned", samples: 3 });
  });

  it("says a step is still somebody's estimate until it has been timed twice", () => {
    const plan = planCareShift({
      routine: routine(steps),
      runs: [run("2026-09-29", [{ title: "Shower", minutes: 35 }])],
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    expect(plan?.steps.find((s) => s.title === "Shower")?.basis).toEqual({ kind: "estimate" });
    expect(plan?.measuredSteps).toBe(0);
  });

  it("isn't planned at all on a day the routine doesn't run", () => {
    const SATURDAY = new Date(2026, 9, 10, 8, 0);
    expect(
      planCareShift({ routine: routine(steps), runs: [], members: [RYAN], isoDate: "2026-10-10", now: SATURDAY })
    ).toBeNull();
  });

  it("ignores a routine that isn't a care routine", () => {
    const morning = { ...routine(steps), kind: "morning" as const };
    expect(
      planCareShift({ routine: morning, runs: [], members: [KIMMIE], isoDate: "2026-10-06", now: TUESDAY })
    ).toBeNull();
  });
});

describe("a step somebody can't do for a while", () => {
  const withCast = [
    step("Shower", 25),
    step("Make lunch", 30, { pausedUntil: "2026-10-30", pausedReason: "hand cast", coveredBy: "Andrew" }),
  ];

  it("is kept out of the shift's timeline", () => {
    const plan = planCareShift({
      routine: routine(withCast),
      runs: [],
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    expect(plan?.steps.map((s) => s.title)).toEqual(["Shower"]);
    expect(plan?.totalExpectedMinutes).toBe(25);
  });

  it("is still shown, with who picked it up and when it comes back", () => {
    // Lunch still has to happen. Dropping it off the screen is how a job
    // gets lost for a month.
    const plan = planCareShift({
      routine: routine(withCast),
      runs: [],
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    expect(plan?.paused).toEqual([
      { stepId: "make-lunch", title: "Make lunch", until: "2026-10-30", reason: "hand cast", coveredBy: "Andrew" },
    ]);
  });

  it("comes back by itself the day after the pause ends", () => {
    expect(isPaused(withCast[1] as never, "2026-10-30")).toBe(true);
    expect(isPaused(withCast[1] as never, "2026-10-31")).toBe(false);
  });

  it("is not paused at all without an end date", () => {
    expect(isPaused(step("Make lunch", 30, { pausedReason: "hand cast" }), "2026-10-06")).toBe(false);
  });

  it("shows a paused step nobody has picked up, which is the point of showing it", () => {
    const orphan = [step("Make lunch", 30, { pausedUntil: "2026-10-30", pausedReason: "hand cast" })];
    const plan = planCareShift({
      routine: routine(orphan),
      runs: [],
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    expect(plan?.paused[0]?.coveredBy).toBeNull();
  });
});

describe("whether the shift lands on the family's morning", () => {
  const morning = { anchorAt: new Date(2026, 9, 6, 7, 52), totalExpectedMinutes: 40 };

  it("says so plainly when it doesn't, which is the answer nobody expects", () => {
    // Bus at 07:52, Kimmie at 09:00. A household reorganising around a
    // clash it believes in will move things that never needed moving.
    const overlap = overlapWithMorning(
      { shiftStart: new Date(2026, 9, 6, 9, 0), shiftEnd: new Date(2026, 9, 6, 13, 0) },
      morning
    );

    expect(overlap?.minutes).toBe(0);
    expect(overlap?.because).toMatch(/don't run into each other/);
  });

  it("counts the minutes when they really do overlap", () => {
    const overlap = overlapWithMorning(
      { shiftStart: new Date(2026, 9, 6, 7, 30), shiftEnd: new Date(2026, 9, 6, 11, 0) },
      morning
    );

    expect(overlap?.minutes).toBe(22);
    expect(overlap?.because).toContain("22 minutes");
  });

  it("measures the morning's own window, not the whole morning", () => {
    // A 40-minute routine ending at 07:52 begins at 07:12. A shift from
    // 06:00 does not overlap three hours of it.
    const overlap = overlapWithMorning(
      { shiftStart: new Date(2026, 9, 6, 6, 0), shiftEnd: new Date(2026, 9, 6, 7, 20) },
      morning
    );

    expect(overlap?.minutes).toBe(8);
  });

  it("says nothing at all when there is no morning routine to compare against", () => {
    expect(
      overlapWithMorning({ shiftStart: new Date(2026, 9, 6, 9, 0), shiftEnd: new Date(2026, 9, 6, 13, 0) }, null)
    ).toBeNull();
  });

  it("says nothing when the shift has no agreed end", () => {
    expect(overlapWithMorning({ shiftStart: new Date(2026, 9, 6, 9, 0), shiftEnd: null }, morning)).toBeNull();
  });
});

describe("what it never says", () => {
  it("describes steps and shifts, never the person being helped or the one helping", () => {
    const plan = planCareShift({
      routine: routine([step("Shower", 25), step("Make lunch", 30, { pausedUntil: "2026-10-30", pausedReason: "hand cast" })]),
      runs: [],
      members: [KIMMIE],
      isoDate: "2026-10-06",
      now: TUESDAY,
    });

    const words = JSON.stringify({ steps: plan?.steps, paused: plan?.paused, room: plan?.roomMinutes });
    expect(words).not.toMatch(/can't|cannot|unable|struggles|slow|declining|frail|unreliable|lazy|poor/i);
  });
});
