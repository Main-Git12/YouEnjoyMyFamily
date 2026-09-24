import { describe, it, expect } from "vitest";
import { mealRhythms, groceryCadences, dayLoads, busiestDay, draftWeek, weekdayName } from "./routines";
import type { MealPlanEntry, CartItem, ScheduleEntry, Task, TaskCompletion } from "../types";

const dinner = (date: string, mealName: string): MealPlanEntry => ({ date, slot: "dinner", mealName, ingredients: [] });

// 2026-09-01 is a Tuesday.
const TUESDAYS = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"];
const FRIDAYS = ["2026-09-04", "2026-09-11", "2026-09-18"];

describe("weekdayName", () => {
  it("reads the day off the date, not the viewer's timezone", () => {
    expect(weekdayName("2026-09-01")).toBe("Tuesday");
    expect(weekdayName("2026-09-26")).toBe("Saturday");
  });
});

describe("meal rhythms", () => {
  it("finds the thing the family does on a particular day", () => {
    const rhythms = mealRhythms(TUESDAYS.map((d) => dinner(d, "Tacos")));

    expect(rhythms[0]).toMatchObject({ mealName: "Tacos", weekdayLabel: "Tuesday", timesOnThisDay: 4 });
  });

  it("won't call a single coincidence a rhythm", () => {
    expect(mealRhythms([dinner("2026-09-01", "Tacos")])).toEqual([]);
  });

  it("keeps two different days' rhythms apart", () => {
    const rhythms = mealRhythms([
      ...TUESDAYS.map((d) => dinner(d, "Tacos")),
      ...FRIDAYS.map((d) => dinner(d, "Pizza")),
    ]);

    expect(rhythms.find((r) => r.mealName === "Tacos")?.weekdayLabel).toBe("Tuesday");
    expect(rhythms.find((r) => r.mealName === "Pizza")?.weekdayLabel).toBe("Friday");
  });

  it("treats the same meal typed differently as the same meal", () => {
    const rhythms = mealRhythms([dinner("2026-09-01", "Tacos"), dinner("2026-09-08", "tacos")]);
    expect(rhythms).toHaveLength(1);
    expect(rhythms[0]?.timesOnThisDay).toBe(2);
  });

  it("ignores breakfast and lunch, which don't have the same rhythm", () => {
    const entries: MealPlanEntry[] = TUESDAYS.map((d) => ({ date: d, slot: "lunch", mealName: "Sandwich", ingredients: [] }));
    expect(mealRhythms(entries)).toEqual([]);
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
    gemsAwarded: 0,
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

  it("explains every choice it makes", () => {
    for (const drafted of draftWeek(history, week)) {
      expect(drafted.because.length).toBeGreaterThan(0);
    }
  });
});
