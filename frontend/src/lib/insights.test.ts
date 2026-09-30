import { describe, it, expect } from "vitest";
import { buildInsights, currentStreak, type InsightSources } from "./insights";
import type { Task, TaskCompletion, CartItem, MealPlanEntry } from "../types";

const task = (overrides: Partial<Task> = {}): Task => ({
  taskId: "t1",
  title: "Wipe Table",
  assignedTo: "Parker",
  dueDate: null,
  date: "2026-09-23",
  status: "pending",
  gemValue: 10,
  dueWindow: "after_dinner",
  recurrence: "daily",
  completedOn: null,
  gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
  ...overrides,
});

const done = (date: string, overrides: Partial<TaskCompletion> = {}): TaskCompletion => ({
  taskId: "t1",
  date,
  title: "Wipe Table",
  memberId: "Parker",
  gemsAwarded: 10,
  ...overrides,
});

const sources = (overrides: Partial<InsightSources> = {}): InsightSources => ({
  tasks: [],
  completions: [],
  mealPlan: [],
  cartItems: [],
  schedule: [],
  today: "2026-09-23",
  ...overrides,
});

describe("currentStreak", () => {
  it("counts consecutive days ending today", () => {
    const completions = ["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d));
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(3);
  });

  it("keeps a streak alive at breakfast, before tonight's chore has happened", () => {
    // Counting only from today would report "broken" every morning, which
    // is both wrong and disheartening.
    const completions = ["2026-09-20", "2026-09-21", "2026-09-22"].map((d) => done(d));
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(3);
  });

  it("is broken by a missed day, not merely dented", () => {
    const completions = ["2026-09-18", "2026-09-19", "2026-09-22"].map((d) => done(d));
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(1);
  });

  it("is zero once two days have gone by", () => {
    const completions = ["2026-09-20", "2026-09-21"].map((d) => done(d));
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(0);
  });

  it("doesn't credit one child for another's chore", () => {
    const completions = ["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d, { memberId: "Isla" }));
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(0);
  });

  it("doesn't mix two chores into one streak", () => {
    const completions = [done("2026-09-22"), done("2026-09-23", { taskId: "t2" })];
    expect(currentStreak(completions, "t1", "Parker", "2026-09-23")).toBe(1);
  });

  it("is zero with nothing to go on", () => {
    expect(currentStreak([], "t1", "Parker", "2026-09-23")).toBe(0);
  });
});

describe("streaks", () => {
  it("celebrates a run, and names the child who earned it", () => {
    const insights = buildInsights(
      sources({
        tasks: [task()],
        completions: ["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d)),
      })
    );

    expect(insights[0]?.kind).toBe("streak");
    expect(insights[0]?.title).toBe("Parker has done Wipe Table 3 days running.");
    expect(insights[0]?.because).toContain("3 completions in a row");
  });

  it("says nothing about two days, which isn't a habit yet", () => {
    const insights = buildInsights(
      sources({ tasks: [task()], completions: ["2026-09-22", "2026-09-23"].map((d) => done(d)) })
    );
    expect(insights.filter((i) => i.kind === "streak")).toHaveLength(0);
  });

  it("has no streak to report for a one-off", () => {
    const insights = buildInsights(
      sources({
        tasks: [task({ recurrence: "none" })],
        completions: ["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d)),
      })
    );
    expect(insights.filter((i) => i.kind === "streak")).toHaveLength(0);
  });
});

describe("chores that keep getting left", () => {
  const weekOfMisses = sources({
    tasks: [task({ dueWindow: "bedtime" })],
    // Set daily for four weeks, done twice.
    completions: [done("2026-09-22"), done("2026-09-15")],
  });

  it("names the chore and what would help, never the child", () => {
    const slipping = buildInsights(weekOfMisses).find((i) => i.kind === "slipping");

    expect(slipping?.title).toBe("Wipe Table is the one that keeps getting left.");
    // The chore is the subject. Nobody is being told off on the kitchen wall.
    expect(slipping?.title).not.toContain("Parker");
    expect(slipping?.action?.kind).toBe("reschedule_chore");
  });

  it("shows its working, so a parent can check rather than trust", () => {
    const slipping = buildInsights(weekOfMisses).find((i) => i.kind === "slipping");
    expect(slipping?.because).toMatch(/Done 2 of the last \d+ days it was set for bedtime\./);
  });

  it("leaves a chore alone when it mostly does get done", () => {
    const mostlyDone = Array.from({ length: 25 }, (_, i) => done(`2026-09-${String(i + 1).padStart(2, "0")}`));
    const insights = buildInsights(sources({ tasks: [task({ dueWindow: "bedtime" })], completions: mostlyDone }));
    expect(insights.filter((i) => i.kind === "slipping")).toHaveLength(0);
  });

  it("says nothing about an anytime chore, which can't be late", () => {
    const insights = buildInsights(sources({ tasks: [task({ dueWindow: "anytime" })], completions: [] }));
    expect(insights.filter((i) => i.kind === "slipping")).toHaveLength(0);
  });

  it("mentions only the worst one, rather than listing every shortfall", () => {
    const insights = buildInsights(
      sources({
        tasks: [
          task({ taskId: "t1", title: "Wipe Table", dueWindow: "bedtime" }),
          task({ taskId: "t2", title: "Pick up toys", dueWindow: "bedtime" }),
          task({ taskId: "t3", title: "Take a bath", dueWindow: "bedtime" }),
        ],
        completions: [],
      })
    );
    expect(insights.filter((i) => i.kind === "slipping")).toHaveLength(1);
  });
});

describe("the rhythm a family has settled into", () => {
  // 2026-09-01, -08, -15 are Tuesdays.
  const tacos = (date: string): MealPlanEntry => ({ date, slot: "dinner", mealName: "Tacos", ingredients: [] });

  it("names the day, not just the meal", () => {
    const insights = buildInsights(
      sources({ mealPlan: [tacos("2026-09-01"), tacos("2026-09-08"), tacos("2026-09-15")] })
    );
    const meal = insights.find((i) => i.kind === "meal_rhythm");

    expect(meal?.title).toBe("Tacos has become a Tuesday thing.");
    expect(meal?.action?.label).toBe("Put Tacos on the next Tuesday");
  });

  it("says nothing about one Tuesday, which isn't a rhythm", () => {
    const insights = buildInsights(sources({ mealPlan: [tacos("2026-09-01")] }));
    expect(insights.filter((i) => i.kind === "meal_rhythm")).toHaveLength(0);
  });
});

describe("the regular that's due again", () => {
  const item = (description: string, status: CartItem["status"], itemId: string, on = "2026-09-01"): CartItem => ({
    itemId,
    description,
    quantity: 1,
    status,
    substituteDescription: null,
    orderedAt: status === "ordered" ? `${on}T00:00:00Z` : null,
    source: "manual",
  });

  it("works out the cadence and says when it's overdue", () => {
    const insights = buildInsights(
      sources({
        cartItems: [
          item("Milk", "ordered", "1", "2026-09-05"),
          item("Milk", "ordered", "2", "2026-09-11"),
          item("Milk", "ordered", "3", "2026-09-17"),
        ],
      })
    );
    const grocery = insights.find((i) => i.kind === "grocery_due");

    expect(grocery?.title).toBe("Milk is probably due.");
    expect(grocery?.because).toBe("Usually bought about every 6 days; it's been 6.");
    expect(grocery?.action?.kind).toBe("add_to_list");
  });

  it("stays quiet when it's already on the list", () => {
    const insights = buildInsights(
      sources({
        cartItems: [
          item("Milk", "ordered", "1", "2026-09-05"),
          item("Milk", "ordered", "2", "2026-09-11"),
          item("Milk", "ordered", "3", "2026-09-17"),
          item("milk", "pending", "4"),
        ],
      })
    );
    expect(insights.filter((i) => i.kind === "grocery_due")).toHaveLength(0);
  });
});

describe("the panel as a whole", () => {
  it("says nothing at all for a family that's only just started", () => {
    expect(buildInsights(sources())).toEqual([]);
  });

  it("keeps it to a handful, because twelve observations get ignored", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task({ taskId: `t${i}`, title: `Chore ${i}`, assignedTo: "Parker" })
    );
    const completions = tasks.flatMap((t) =>
      ["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d, { taskId: t.taskId }))
    );

    expect(buildInsights(sources({ tasks, completions })).length).toBeLessThanOrEqual(4);
  });

  it("never describes a person outside of praise they earned", () => {
    const insights = buildInsights(
      sources({
        tasks: [task({ dueWindow: "bedtime" }), task({ taskId: "t2", title: "Homework", assignedTo: "Isla" })],
        completions: [
          done("2026-09-22"),
          ...["2026-09-21", "2026-09-22", "2026-09-23"].map((d) => done(d, { taskId: "t2", memberId: "Isla" })),
        ],
      })
    );

    for (const insight of insights) {
      if (insight.kind === "streak") continue;
      expect(insight.title).not.toMatch(/Parker|Isla/);
    }
  });
});

/**
 * The failures a family would have met in their first fortnight — every one
 * of these produced a wrong sentence on the kitchen wall before it was
 * fixed, and none of them failed a test or threw.
 */
describe("claims the records cannot support", () => {
  it("says nothing about a chore added today, with no history to judge it by", () => {
    // Day one in the kitchen: one chore, created an hour ago, nothing done
    // yet. This used to render "Wipe Table is the one that keeps getting
    // left", because the denominator counted 29 calendar days and the
    // numerator counted the zero completions there had been time for.
    const fresh = task({ createdAt: "2026-09-23T18:00:00.000Z", dueWindow: "bedtime" });
    const insights = buildInsights(sources({ tasks: [fresh], completions: [] }));
    expect(insights.filter((i) => i.kind === "slipping")).toEqual([]);
  });

  it("counts only the days since a chore existed, not the whole window", () => {
    // Created four days ago and never done: still not enough of a record to
    // call it the one that keeps getting left.
    const recent = task({ createdAt: "2026-09-20T09:00:00.000Z", dueWindow: "bedtime" });
    const insights = buildInsights(sources({ tasks: [recent], completions: [] }));
    const slipping = insights.find((i) => i.kind === "slipping");
    if (slipping) expect(slipping.because).toContain("of the last 4 days");
  });

  it("still notices a chore that really has been left, once there is a record of it", () => {
    const old = task({ createdAt: "2026-01-01T00:00:00.000Z", dueWindow: "bedtime" });
    const insights = buildInsights(sources({ tasks: [old], completions: [] }));
    expect(insights.find((i) => i.kind === "slipping")?.title).toBe(
      "Wipe Table is the one that keeps getting left."
    );
  });

  it("names the worst chore, not the first one alphabetically", () => {
    // "Brush teeth" done on 12 of the days, "Wipe Table" on none. The
    // superlative used to be decided by localeCompare on the title.
    const brush = task({ taskId: "t2", title: "Brush teeth", dueWindow: "bedtime", createdAt: "2026-01-01T00:00:00.000Z" });
    const wipe = task({ taskId: "t1", title: "Wipe Table", dueWindow: "bedtime", createdAt: "2026-01-01T00:00:00.000Z" });
    const brushed = ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17",
      "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]
      .map((d) => done(d, { taskId: "t2", title: "Brush teeth" }));

    const insights = buildInsights(sources({ tasks: [brush, wipe], completions: brushed }));
    expect(insights.find((i) => i.kind === "slipping")?.title).toBe(
      "Wipe Table is the one that keeps getting left."
    );
  });

  it("leads with the longest streak, not with whoever's name sorts last", () => {
    // Mia's forty days used to be pushed off the panel by two of Parker's
    // three-day runs, because the sort read the rendered sentence and the
    // sentence starts with the child's name.
    const days = (n: number, end: string) => {
      const out: string[] = [];
      const cursor = new Date(`${end}T12:00:00Z`);
      for (let i = 0; i < n; i += 1) {
        out.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      return out;
    };
    const cat = task({ taskId: "t9", title: "Feed the cat", assignedTo: "Mia", createdAt: "2026-01-01T00:00:00.000Z" });
    const wipe = task({ taskId: "t1", title: "Wipe Table", assignedTo: "Parker", createdAt: "2026-01-01T00:00:00.000Z" });
    const completions = [
      ...days(40, "2026-09-23").map((d) => done(d, { taskId: "t9", title: "Feed the cat", memberId: "Mia" })),
      ...days(3, "2026-09-23").map((d) => done(d, { taskId: "t1", title: "Wipe Table", memberId: "Parker" })),
    ];

    const streaks = buildInsights(sources({ tasks: [cat, wipe], completions })).filter((i) => i.kind === "streak");
    expect(streaks[0]?.title).toContain("Mia");
    expect(streaks[0]?.title).toContain("40 days running");
  });
});

/**
 * A missing field must never take the whole wall down. The first version of
 * the createdAt rule called `.slice()` on it unguarded: the type says it is
 * always present and the API always sends it, so every test passed — and
 * the dashboard went to its error boundary the first time a response came
 * back without it.
 */
describe("when the data is not the shape the types promise", () => {
  it("does not crash on a chore with no creation date, and makes no claim about it", () => {
    // Built the way a real response arrives — the field simply absent —
    // rather than set to undefined, which is a different shape.
    const withField: Record<string, unknown> = { ...task({ dueWindow: "bedtime" }) };
    delete withField.createdAt;
    const shapeless = withField as unknown as Task;
    expect(() => buildInsights(sources({ tasks: [shapeless], completions: [] }))).not.toThrow();
    expect(buildInsights(sources({ tasks: [shapeless], completions: [] })).filter((i) => i.kind === "slipping")).toEqual([]);
  });
});
