import { describe, it, expect } from "vitest";
import { buildChildView } from "./childView";
import type { Task, TaskCompletion, GemBalance } from "../types";

const TODAY = "2026-09-25";

function task(overrides: Partial<Task> & { taskId: string; assignedTo: string | null }): Task {
  return {
    title: overrides.taskId,
    dueDate: null,
    date: TODAY,
    status: "pending",
    gemValue: 5,
    dueWindow: "anytime",
    recurrence: "daily",
    completedOn: null,
    gemsAwarded: 0,
    ...overrides,
  };
}

/** `days` consecutive completions ending yesterday. */
function streakOf(taskId: string, memberId: string, days: number): TaskCompletion[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(`${TODAY}T12:00:00`);
    date.setDate(date.getDate() - (index + 1));
    return { taskId, date: date.toISOString().slice(0, 10), title: taskId, memberId, gemsAwarded: 5 };
  });
}

const BALANCES: GemBalance[] = [
  { memberId: "Parker", earned: 337, spent: 40, balance: 297 },
  { memberId: "Wren", earned: 191, spent: 0, balance: 191 },
];

function build(memberId: string, over: Partial<Parameters<typeof buildChildView>[0]> = {}) {
  return buildChildView({
    memberId,
    tasks: [
      task({ taskId: "beds", assignedTo: "Parker", gemValue: 3, status: "done" }),
      task({ taskId: "dishes", assignedTo: "Parker", gemValue: 5 }),
      task({ taskId: "homework", assignedTo: "Parker", gemValue: 6 }),
      task({ taskId: "teeth", assignedTo: "Wren", gemValue: 2 }),
      task({ taskId: "bins", assignedTo: null, gemValue: 5 }),
    ],
    completions: [],
    goals: [
      { memberId: "Parker", title: "Skate park trip", gemCost: 400, note: null },
      { memberId: "Wren", title: "New art set", gemCost: 80, note: null },
    ],
    balances: BALANCES,
    today: TODAY,
    ...over,
  });
}

describe("buildChildView", () => {
  it("shows only this child's chores — not a sibling's, not the unassigned ones", () => {
    const view = build("Parker");
    expect(view.chores.map((chore) => chore.taskId)).toEqual(["beds", "dishes", "homework"]);
  });

  it("counts what's left and what it's worth", () => {
    const view = build("Parker");
    expect(view.choresLeft).toBe(2);
    expect(view.gemsStillToEarnToday).toBe(11);
  });

  it("carries their spendable balance, not what they've ever earned", () => {
    // 337 earned, 40 already spent on a prize.
    expect(build("Parker").balance).toBe(297);
  });

  it("shows progress toward their own prize", () => {
    const view = build("Wren");
    expect(view.progress.goal?.title).toBe("New art set");
    expect(view.progress.goal?.gemsSoFar).toBe(80);
    expect(view.progress.goal?.fraction).toBe(1);
  });

  it("does not overfill the bar when they have more than they need", () => {
    const view = build("Wren");
    // 191 gems against an 80-gem prize.
    expect(view.progress.goal?.fraction).toBe(1);
    expect(view.progress.goal?.gemsSoFar).toBe(80);
  });

  it("has nothing to show when no prize is set", () => {
    expect(build("Parker", { goals: [] }).progress.goal).toBeNull();
  });

  it("names a streak, because that is praise they earned", () => {
    const view = build("Parker", { completions: streakOf("beds", "Parker", 6) });
    expect(view.bestStreak).toEqual({ title: "beds", days: 6 });
  });

  it("stays quiet about a run too short to mean anything", () => {
    const view = build("Parker", { completions: streakOf("beds", "Parker", 2) });
    expect(view.bestStreak).toBeNull();
  });

  it("never counts a sibling's completions toward their streak", () => {
    // Wren has a nine-day run on a chore Parker also has. Parker's screen
    // must show his own, which is none. (Two layers enforce this: the
    // filter here and currentStreak's own — either alone would do, and
    // both are kept.)
    const view = build("Parker", { completions: streakOf("beds", "Wren", 9) });
    expect(view.bestStreak).toBeNull();
    expect(view.chores.find((chore) => chore.taskId === "beds")?.streak).toBe(0);
  });

  describe("the comparison that must not be possible", () => {
    it("carries no trace of any other child", () => {
      // A screen about one child, on a wall the whole family walks past,
      // is the most tempting place in the product to put a leaderboard —
      // and a leaderboard is how a seven-year-old learns their sibling is
      // better at being good. The other child's rows are filtered out
      // before the view is built, not hidden while rendering.
      const view = build("Parker", { completions: streakOf("teeth", "Wren", 9) });
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain("Wren");
      expect(serialized).not.toContain("art set");
      expect(serialized).not.toContain("191");
      expect(serialized).not.toContain("teeth");
    });

    it("has no field that could hold a ranking or a sibling total", () => {
      const view = build("Parker");
      const keys = Object.keys(view);
      for (const banned of ["rank", "position", "compare", "others", "family", "leaderboard", "versus"]) {
        expect(keys.some((key) => key.toLowerCase().includes(banned))).toBe(false);
      }
    });
  });
});
