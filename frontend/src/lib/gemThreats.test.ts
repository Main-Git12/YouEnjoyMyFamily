import { describe, it, expect } from "vitest";
import { chooseThreatenedChore, isPastWindow, threatForChore, GEM_THREATS } from "./gemThreats";
import type { Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "t1",
    title: "Wipe Table",
    assignedTo: "Parker",
    dueDate: null,
    gemValue: 10,
    dueWindow: "after_dinner",
    status: "pending",
    gemsAwarded: 0,
    ...overrides,
  };
}

const at = (hour: number, minute = 0) => new Date(2026, 8, 23, hour, minute);

describe("isPastWindow", () => {
  it("is false while the window is still open", () => {
    expect(isPastWindow("after_dinner", at(18, 45))).toBe(false);
  });

  it("is true once the window has closed", () => {
    expect(isPastWindow("after_dinner", at(19, 45))).toBe(true);
  });

  it("never treats an anytime chore as late", () => {
    expect(isPastWindow("anytime", at(23, 59))).toBe(false);
  });
});

describe("threatForChore", () => {
  it("always brings the same character for the same chore", () => {
    expect(threatForChore("Wipe Table")).toBe(threatForChore("Wipe Table"));
  });

  it("only ever returns a character from the cast", () => {
    for (const title of ["Wipe Table", "Homework", "Take a bath", "Let dogs out", "Pick up toys"]) {
      expect(GEM_THREATS).toContain(threatForChore(title));
    }
  });

  it("spreads the cast across the chore library rather than picking one villain", () => {
    const used = new Set(
      ["Wipe Table", "Homework", "Take a bath", "Let dogs out", "Pick up toys", "Get Dressed", "Brush Hair"].map(
        (title) => threatForChore(title).id
      )
    );
    expect(used.size).toBeGreaterThan(1);
  });
});

describe("chooseThreatenedChore", () => {
  it("raises nothing when every chore is still inside its window", () => {
    expect(chooseThreatenedChore([task({ dueWindow: "bedtime" })], at(7, 0))).toBeNull();
  });

  it("raises nothing for a chore nobody is responsible for", () => {
    expect(chooseThreatenedChore([task({ assignedTo: null })], at(21, 0))).toBeNull();
  });

  it("raises nothing for a chore already ticked off", () => {
    expect(chooseThreatenedChore([task({ status: "done", gemsAwarded: 10 })], at(21, 0))).toBeNull();
  });

  it("picks the chore furthest past its window", () => {
    const chosen = chooseThreatenedChore(
      [
        task({ taskId: "late", title: "Get Dressed", dueWindow: "morning" }),
        task({ taskId: "later", title: "Put on pajamas", dueWindow: "bedtime" }),
      ],
      at(21, 0)
    );
    expect(chosen?.task.taskId).toBe("late");
  });

  it("hands back the assignee and the chore's own gem value to play the scene with", () => {
    const chosen = chooseThreatenedChore([task({ gemValue: 20 })], at(21, 0));
    expect(chosen?.assignee).toBe("Parker");
    expect(chosen?.task.gemValue).toBe(20);
    expect(chosen?.threat.taunt("Parker", "Wipe Table", 20)).toContain("Parker");
    expect(chosen?.threat.taunt("Parker", "Wipe Table", 20)).toContain("Wipe Table");
  });
});
