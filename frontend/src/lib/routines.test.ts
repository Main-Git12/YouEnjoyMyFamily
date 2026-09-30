import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mealRhythms, groceryCadences, dayLoads, busiestDay, draftWeek, weekdayName } from "./routines";
import type { MealPlanEntry, CartItem, ScheduleEntry, Task, TaskCompletion } from "../types";

const dinner = (date: string, mealName: string): MealPlanEntry => ({ date, slot: "dinner", mealName, ingredients: [] });

// 2026-09-01 is a Tuesday.
const TUESDAYS = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"];
const FRIDAYS = ["2026-09-04", "2026-09-11", "2026-09-18"];
/** A "today" past every fixture date, so these tests are about grouping, not the cutoff. */
const AFTER_ALL = "2026-10-01";

// The family's screen sits in Ohio, and several of these numbers are the
// difference between a UTC date and a local one. A UTC test runner cannot
// see that difference at all.
beforeAll(() => {
  vi.stubEnv("TZ", "America/New_York");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("weekdayName", () => {
  it("reads the day off the date, not the viewer's timezone", () => {
    expect(weekdayName("2026-09-01")).toBe("Tuesday");
    expect(weekdayName("2026-09-26")).toBe("Saturday");
  });
});

describe("meal rhythms", () => {
  it("finds the thing the family does on a particular day", () => {
    const rhythms = mealRhythms(TUESDAYS.map((d) => dinner(d, "Tacos")), AFTER_ALL);

    expect(rhythms[0]).toMatchObject({ mealName: "Tacos", weekdayLabel: "Tuesday", timesOnThisDay: 4 });
  });

  it("won't call a single coincidence a rhythm", () => {
    expect(mealRhythms([dinner("2026-09-01", "Tacos")], AFTER_ALL)).toEqual([]);
  });

  it("keeps two different days' rhythms apart", () => {
    const rhythms = mealRhythms(
      [...TUESDAYS.map((d) => dinner(d, "Tacos")), ...FRIDAYS.map((d) => dinner(d, "Pizza"))],
      AFTER_ALL
    );

    expect(rhythms.find((r) => r.mealName === "Tacos")?.weekdayLabel).toBe("Tuesday");
    expect(rhythms.find((r) => r.mealName === "Pizza")?.weekdayLabel).toBe("Friday");
  });

  it("treats the same meal typed differently as the same meal", () => {
    const rhythms = mealRhythms([dinner("2026-09-01", "Tacos"), dinner("2026-09-08", "tacos")], AFTER_ALL);
    expect(rhythms).toHaveLength(1);
    expect(rhythms[0]?.timesOnThisDay).toBe(2);
  });

  it("ignores breakfast and lunch, which don't have the same rhythm", () => {
    const entries: MealPlanEntry[] = TUESDAYS.map((d) => ({ date: d, slot: "lunch", mealName: "Sandwich", ingredients: [] }));
    expect(mealRhythms(entries, AFTER_ALL)).toEqual([]);
  });

  it("won't call a plan a habit", () => {
    // The family sat down and filled in tacos for the next four Tuesdays.
    // That is them typing, not the app noticing, and reading it back as
    // "tacos has become a Tuesday thing" is the app quoting them to
    // themselves.
    expect(mealRhythms(TUESDAYS.map((d) => dinner(d, "Tacos")), "2026-08-25")).toEqual([]);
  });

  it("counts only the days that have actually been and gone", () => {
    const rhythms = mealRhythms(TUESDAYS.map((d) => dinner(d, "Tacos")), "2026-09-15");
    // 1 Sep and 8 Sep have happened; 15 Sep is today and 22 Sep is ahead.
    expect(rhythms[0]?.timesOnThisDay).toBe(2);
  });

  it("leaves today out of its own evidence", () => {
    // Two Tuesdays, one of which is today: tonight's dinner hasn't happened.
    expect(mealRhythms([dinner("2026-09-01", "Tacos"), dinner("2026-09-08", "Tacos")], "2026-09-08")).toEqual([]);
  });
});

describe("grocery cadence", () => {
  const bought = (description: string, date: string, itemId: string): CartItem => ({
    itemId,
    description,
    quantity: 1,
    status: "ordered",
    substituteDescription: null,
    orderedAt: `${date}T10:00:00Z`,
    source: "manual",
  });

  it("works out how often something actually gets bought", () => {
    const cadences = groceryCadences(
      [bought("Milk", "2026-09-01", "1"), bought("Milk", "2026-09-07", "2"), bought("Milk", "2026-09-13", "3")],
      "2026-09-19"
    );

    expect(cadences[0]).toMatchObject({ description: "Milk", everyDays: 6, daysSinceLast: 6, overdue: true });
  });

  it("says nothing on two purchases, which is a coincidence not a cadence", () => {
    expect(groceryCadences([bought("Milk", "2026-09-01", "1"), bought("Milk", "2026-09-07", "2")], "2026-09-19")).toEqual([]);
  });

  it("isn't overdue while it's still within the usual gap", () => {
    const cadences = groceryCadences(
      [bought("Milk", "2026-09-01", "1"), bought("Milk", "2026-09-07", "2"), bought("Milk", "2026-09-13", "3")],
      "2026-09-16"
    );
    expect(cadences[0]?.overdue).toBe(false);
  });

  it("dates a shop by the family's calendar, not UTC's", () => {
    // Three Sunday-evening shops in Ohio. Each is stamped Monday in UTC, so
    // slicing the timestamp turned one weekly rhythm into an alternating
    // 6-and-8-day one and put the last shop a day off from today.
    const sundayEvening = (date: string, id: string): CartItem => ({
      ...bought("Milk", "2026-01-01", id),
      orderedAt: `${date}T01:00:00Z`, // 8pm the previous day in New York
    });
    const cadences = groceryCadences(
      [sundayEvening("2026-09-07", "1"), sundayEvening("2026-09-14", "2"), sundayEvening("2026-09-21", "3")],
      "2026-09-27"
    );

    // Bought on the 6th, 13th and 20th locally: every 7 days, 7 days ago.
    expect(cadences[0]).toMatchObject({ everyDays: 7, daysSinceLast: 7, overdue: true });
  });

  it("takes the middle gap, so one fortnight away doesn't rewrite the cadence", () => {
    const cadences = groceryCadences(
      [
        bought("Milk", "2026-09-01", "1"),
        bought("Milk", "2026-09-08", "2"),
        bought("Milk", "2026-09-15", "3"),
        // Away for a fortnight.
        bought("Milk", "2026-10-06", "4"),
      ],
      "2026-10-13"
    );

    // Gaps of 7, 7 and 21. The mean is about 12 — which would say the milk
    // isn't due for another five days. The middle gap is 7, and it is.
    expect(cadences[0]?.everyDays).toBe(7);
    expect(cadences[0]?.overdue).toBe(true);
  });

  it("ignores what's still in the trolley — only what was actually bought", () => {
    const stillInCart: CartItem = {
      itemId: "x",
      description: "Milk",
      quantity: 1,
      status: "pending",
      substituteDescription: null,
      orderedAt: null,
      source: "manual",
    };
    expect(groceryCadences([stillInCart], "2026-09-19")).toEqual([]);
  });
});

describe("how each weekday actually goes", () => {
  const task = (taskId: string): Task => ({
    taskId,
    title: taskId,
    assignedTo: "Parker",
    dueDate: null,
    date: "2026-09-23",
    status: "pending",
    gemValue: 10,
    dueWindow: "after_dinner",
    recurrence: "daily",
    completedOn: null,
    gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
  });
  const event = (date: string, scheduleId: string): ScheduleEntry => ({
    scheduleId,
    date,
    title: "Soccer",
    startTime: "17:30",
    endTime: "18:30",
    memberIds: [],
  });
  const didIt = (taskId: string, date: string): TaskCompletion => ({
    taskId,
    date,
    title: taskId,
    memberId: "Parker",
    gemsAwarded: 10,
  });

  // Wednesdays in the window: 2nd, 9th, 16th.
  const tasks = [task("a"), task("b")];

  it("names a day that's both stacked and where chores fare worst", () => {
    const schedule = ["2026-09-02", "2026-09-09", "2026-09-16"].flatMap((d) => [event(d, `${d}-1`), event(d, `${d}-2`)]);
    // Every other day both chores get done; Wednesdays neither.
    const completions: TaskCompletion[] = [];
    for (let day = 1; day <= 21; day += 1) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      if (["2026-09-02", "2026-09-09", "2026-09-16"].includes(date)) continue;
      completions.push(didIt("a", date), didIt("b", date));
    }

    const busiest = busiestDay(dayLoads(schedule, completions, tasks, "2026-09-01", "2026-09-21"));
    expect(busiest?.weekdayLabel).toBe("Wednesday");
  });

  it("says nothing about a busy day where the chores still get done", () => {
    const schedule = ["2026-09-02", "2026-09-09", "2026-09-16"].flatMap((d) => [event(d, `${d}-1`), event(d, `${d}-2`)]);
    const completions: TaskCompletion[] = [];
    for (let day = 1; day <= 21; day += 1) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      completions.push(didIt("a", date), didIt("b", date));
    }

    expect(busiestDay(dayLoads(schedule, completions, tasks, "2026-09-01", "2026-09-21"))).toBeNull();
  });

  it("says nothing about a quiet day where chores slip, which is a different problem", () => {
    const completions: TaskCompletion[] = [];
    for (let day = 1; day <= 21; day += 1) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      if (["2026-09-02", "2026-09-09", "2026-09-16"].includes(date)) continue;
      completions.push(didIt("a", date), didIt("b", date));
    }

    // Nothing on the calendar at all.
    expect(busiestDay(dayLoads([], completions, tasks, "2026-09-01", "2026-09-21"))).toBeNull();
  });

  it("holds off until there's enough of a week to compare", () => {
    expect(busiestDay(dayLoads([], [], tasks, "2026-09-01", "2026-09-02"))).toBeNull();
  });

  it("doesn't count a chore against days before it existed", () => {
    // A chore added on the 18th. The first two Wednesdays of the window are
    // not Wednesdays it was skipped on — it wasn't there to skip.
    const added = { ...task("c"), createdAt: "2026-09-18T09:00:00.000Z" };
    const loads = dayLoads([], [], [added], "2026-09-01", "2026-09-21");
    const wednesday = loads.find((load) => load.weekdayLabel === "Wednesday");

    // The Wednesdays in the window are the 2nd, 9th and 16th — all before
    // the chore appeared on the 18th. Nothing was ticked off, but there was
    // nothing to tick off either, so the day is not marked down for it.
    expect(wednesday?.daysSeen).toBe(3);
    expect(wednesday?.choreCompletionRate).toBe(1);
  });

  it("counts an existing chore against days it really was around for", () => {
    const added = { ...task("c"), createdAt: "2026-09-08T09:00:00.000Z" };
    const loads = dayLoads([], [], [added], "2026-09-01", "2026-09-21");
    const wednesday = loads.find((load) => load.weekdayLabel === "Wednesday");

    // The 9th and the 16th both count, and neither was done.
    expect(wednesday?.choreCompletionRate).toBe(0);
  });

  it("won't count a completion the expected list never counted", () => {
    // A one-off ticked off every Wednesday. `expected` only ever counts
    // recurring chores, so counting these would make the rate exceed 1 —
    // a share of a thing larger than the thing.
    const oneOff: Task = { ...task("one-off"), recurrence: "none" };
    const completions = ["2026-09-02", "2026-09-09", "2026-09-16"].flatMap((date) => [
      didIt("a", date),
      didIt("b", date),
      didIt("one-off", date),
    ]);

    const loads = dayLoads([], completions, [...tasks, oneOff], "2026-09-01", "2026-09-21");
    const wednesday = loads.find((load) => load.weekdayLabel === "Wednesday");

    expect(wednesday?.choreCompletionRate).toBe(1);
    expect(loads.every((load) => load.choreCompletionRate <= 1)).toBe(true);
  });

  it("won't count a completion belonging to a chore that has since been deleted", () => {
    const completions = ["2026-09-02", "2026-09-09", "2026-09-16"].flatMap((date) => [
      didIt("a", date),
      didIt("b", date),
      didIt("deleted-last-week", date),
    ]);

    const loads = dayLoads([], completions, tasks, "2026-09-01", "2026-09-21");
    expect(loads.every((load) => load.choreCompletionRate <= 1)).toBe(true);
  });
});

describe("drafting a week from the family's own rotation", () => {
  const history = [
    ...TUESDAYS.map((d) => dinner(d, "Tacos")),
    ...FRIDAYS.map((d) => dinner(d, "Pizza")),
    dinner("2026-09-03", "Chilli"),
    dinner("2026-09-10", "Chilli"),
  ];
  // 2026-09-29 is a Tuesday; the week runs Tue–Mon.
  const week = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];

  it("puts the weekday's own meal on the weekday", () => {
    const draft = draftWeek(history, week);
    const tuesday = draft.find((d) => d.date === "2026-09-29");

    expect(tuesday?.mealName).toBe("Tacos");
    expect(tuesday?.because).toContain("Tuesdays");
  });

  it("only ever proposes meals the family has actually cooked", () => {
    const names = new Set(history.map((e) => e.mealName));
    for (const drafted of draftWeek(history, week)) {
      expect(names).toContain(drafted.mealName);
    }
  });

  it("doesn't serve the same dinner twice in four days", () => {
    const draft = draftWeek(history, week);
    for (const [i, drafted] of draft.entries()) {
      const clash = draft
        .slice(i + 1)
        .find((other) => other.mealName === drafted.mealName && Date.parse(other.date) - Date.parse(drafted.date) < 4 * 86_400_000);
      expect(clash).toBeUndefined();
    }
  });

  it("leaves a day alone when someone has already planned it", () => {
    const withPlan = [...history, dinner("2026-09-29", "Roast")];
    expect(draftWeek(withPlan, week).find((d) => d.date === "2026-09-29")).toBeUndefined();
  });

  it("has nothing to propose to a family that hasn't cooked anything yet", () => {
    expect(draftWeek([], week)).toEqual([]);
  });

  it("won't treat a plan made for later as a habit already formed", () => {
    // Two dinners actually cooked: Chilli on Thursdays. Then someone plans
    // Roast for the three Tuesdays *after* the week being drafted. Those are
    // a plan, not a rotation, and must not decide this Tuesday's dinner —
    // otherwise the draft reads its own output back as evidence.
    const cooked = [dinner("2026-09-03", "Chilli"), dinner("2026-09-10", "Chilli")];
    const plannedLater = ["2026-10-06", "2026-10-13", "2026-10-20"].map((d) => dinner(d, "Roast"));

    const draft = draftWeek([...cooked, ...plannedLater], week);
    const tuesday = draft.find((d) => d.date === "2026-09-29");

    expect(tuesday?.because).not.toContain("Tuesdays");
  });

  it("explains every choice it makes", () => {
    for (const drafted of draftWeek(history, week)) {
      expect(drafted.because.length).toBeGreaterThan(0);
    }
  });

  it("won't propose tonight's dinner as tomorrow's", () => {
    // The only meal they cook, eaten yesterday. Proposing it again for
    // tomorrow is technically "their rotation" and completely useless.
    const justHadIt = [dinner("2026-09-28", "Tacos"), dinner("2026-09-21", "Tacos"), dinner("2026-09-14", "Tacos")];
    const draft = draftWeek(justHadIt, ["2026-09-29", "2026-09-30"]);

    expect(draft.find((d) => d.date === "2026-09-29")).toBeUndefined();
  });

  it("proposes it again once enough days have passed", () => {
    const history = [dinner("2026-09-21", "Tacos"), dinner("2026-09-14", "Tacos"), dinner("2026-09-07", "Tacos")];
    const draft = draftWeek(history, ["2026-09-28"]);

    expect(draft[0]?.mealName).toBe("Tacos");
  });
});
