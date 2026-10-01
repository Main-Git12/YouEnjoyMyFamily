import { describe, it, expect } from "vitest";
import { knownMembers, assignableNames, childrenOnly } from "./members";
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
  gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
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

describe("assignableNames", () => {
  const roster = (...members: { displayName: string; role: "adult" | "child" }[]) => ({
    members: members.map((m) => ({ memberId: m.displayName.toLowerCase(), note: null, ...m })),
  });

  it("offers everyone in the house, adults included", () => {
    // Adults own most of the jobs; a picker that only offers children is
    // useless for the half of the work that isn't a chore chart.
    const names = assignableNames(roster({ displayName: "Sheliah", role: "adult" }, { displayName: "Parker", role: "child" }), []);
    expect(names).toEqual(["Parker", "Sheliah"]);
  });

  it("keeps working for a household that never opened the roster", () => {
    expect(assignableNames({ members: [] }, ["Parker", "Wren"])).toEqual(["Parker", "Wren"]);
  });

  it("treats a rostered name and the same name typed on a chore as one person", () => {
    const names = assignableNames(roster({ displayName: "Sheliah", role: "adult" }), ["sheliah", "Parker"]);
    // And the roster's spelling wins, because that is the one typed on purpose.
    expect(names).toEqual(["Parker", "Sheliah"]);
  });
});

describe("childrenOnly", () => {
  const roster = (...members: { displayName: string; role: "adult" | "child" }[]) => ({
    members: members.map((m) => ({ memberId: m.displayName.toLowerCase(), note: null, ...m })),
  });

  it("keeps adults out of the gem economy", () => {
    // The whole point of the roster. A grandmother who drives to
    // appointments and a child who feeds the cat are not the same kind of
    // participant in a game built for a seven-year-old.
    const children = childrenOnly(
      roster({ displayName: "Sheliah", role: "adult" }, { displayName: "Andrew", role: "adult" }, { displayName: "Parker", role: "child" }),
      ["Sheliah", "Andrew", "Parker"]
    );
    expect(children).toEqual(["Parker"]);
  });

  it("falls back to every known name while the roster is empty", () => {
    // A household that hasn't filled it in must see what it saw before,
    // not an app that has quietly removed its children's screens.
    expect(childrenOnly({ members: [] }, ["Parker", "Wren"])).toEqual(["Parker", "Wren"]);
  });

  it("takes a roster of adults only at its word", () => {
    // A real answer — a house with no children in the gem economy — not a
    // reason to go back to guessing from chore assignments.
    expect(childrenOnly(roster({ displayName: "Sheliah", role: "adult" }), ["Sheliah", "Parker"])).toEqual([]);
  });
});
