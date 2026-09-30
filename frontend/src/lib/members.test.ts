import { describe, it, expect } from "vitest";
import { knownMembers } from "./members";
import type { Task } from "../types";

const task = (assignedTo: string | null): Task => ({
  taskId: `t${assignedTo ?? "x"}`,
  title: "Wipe Table",
  assignedTo,
  dueDate: null,
  date: "2026-09-23",
  status: "pending",
  gemValue: 10,
  dueWindow: "anytime",
  recurrence: "daily",
  completedOn: null,
  gemsAwarded: 0,
});

describe("knownMembers", () => {
  it("gathers names from everywhere the family has already used them", () => {
    expect(
      knownMembers({
        tasks: [task("Parker")],
        completions: [{ taskId: "t1", date: "2026-09-22", title: "Homework", memberId: "Isla", gemsAwarded: 10 }],
        goals: [{ memberId: "Nora", title: "Skates", gemCost: 20, note: null }],
        balances: [{ memberId: "Rhys", earned: 5, spent: 0, balance: 5 }],
      })
    ).toEqual(["Isla", "Nora", "Parker", "Rhys"]);
  });

  it("lists each name once, however many chores they have", () => {
    expect(knownMembers({ tasks: [task("Parker"), task("Parker")] })).toEqual(["Parker"]);
  });

  it("leaves out chores nobody is named on", () => {
    expect(knownMembers({ tasks: [task(null)] })).toEqual([]);
  });

  it("is empty for a family that hasn't named anyone yet", () => {
    expect(knownMembers({})).toEqual([]);
  });

  it("sorts them, so the chips don't shuffle between renders", () => {
    expect(knownMembers({ tasks: [task("Rhys"), task("Isla"), task("Parker")] })).toEqual(["Isla", "Parker", "Rhys"]);
  });
});
