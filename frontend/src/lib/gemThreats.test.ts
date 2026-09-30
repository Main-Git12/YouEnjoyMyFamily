import { describe, it, expect } from "vitest";
import { chooseThreatenedChore, isPastWindow, isCarriedOver, threatForChore, GEM_THREATS } from "./gemThreats";
import type { Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "t1",
    title: "Wipe Table",
    assignedTo: "Parker",
    dueDate: null,
    gemValue: 10,
    dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null,
    status: "pending",
    gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
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
    expect(chooseThreatenedChore([task({ status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"})], at(21, 0))).toBeNull();
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

describe("chores carried over from an earlier day", () => {
  it("knows one when it sees one", () => {
    expect(isCarriedOver(task({ dueDate: "2026-09-21", date: "2026-09-23" }))).toBe(true);
    expect(isCarriedOver(task({ dueDate: "2026-09-23", date: "2026-09-23" }))).toBe(false);
    // A recurring chore has no due date and belongs to every day it shows on.
    expect(isCarriedOver(task({ dueDate: null, date: "2026-09-23" }))).toBe(false);
  });

  it("doesn't summon a monster over a library book that was due last Monday", () => {
    // One-offs now stay on the list until somebody does them. Left in the
    // game, the same monster would arrive over the same child's name every
    // night until the book went back — which stops being a game and starts
    // being the screen telling a child what they're like.
    const carried = task({
      taskId: "t_library",
      title: "Return the library book",
      dueWindow: "after_school",
      dueDate: "2026-09-21",
      date: "2026-09-23",
    });

    expect(chooseThreatenedChore([carried], at(19, 0))).toBeNull();
  });

  it("still lets today's chores raise one, with the carried-over chore in the list", () => {
    // And the carried-over chore must not win the sort and silence the rest:
    // after_school closes before after_dinner, so it would have, every time.
    const carried = task({
      taskId: "t_library",
      title: "Return the library book",
      dueWindow: "after_school",
      dueDate: "2026-09-21",
      date: "2026-09-23",
    });
    const todays = task({ taskId: "t_table", title: "Wipe Table", dueWindow: "after_dinner" });

    const chosen = chooseThreatenedChore([carried, todays], at(20, 0));
    expect(chosen?.task.taskId).toBe("t_table");
  });

  it("still raises one for a one-off that is due today", () => {
    const dueToday = task({ taskId: "t_bins", title: "Take the bins out", dueDate: "2026-09-23", date: "2026-09-23" });
    expect(chooseThreatenedChore([dueToday], at(20, 0))?.task.taskId).toBe("t_bins");
  });
});
