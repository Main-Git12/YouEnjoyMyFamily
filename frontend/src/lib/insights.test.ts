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
  gemsAwarded: 0,
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
