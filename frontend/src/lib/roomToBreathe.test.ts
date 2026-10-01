import { describe, it, expect } from "vitest";
import { freeEvenings, somethingTogether } from "./roomToBreathe";
import type { HouseholdMember, ScheduleEntry, StatedPreference } from "../types";

let seq = 0;
const event = (date: string, title: string, startTime: string | null = "17:30"): ScheduleEntry => ({
  scheduleId: `s${(seq += 1)}`,
  date,
  title,
  startTime,
  endTime: null,
  memberIds: [],
});

const said = (memberId: string, statement: string, category: "activity" | "meal" = "activity"): StatedPreference => ({
  preferenceId: `p${(seq += 1)}`,
  memberId,
  category,
  statement,
});

const member = (displayName: string, role: "adult" | "child"): HouseholdMember => ({
  memberId: displayName.toLowerCase(),
  displayName,
  role,
  note: null,
});

// 2026-10-05 is a Monday.
const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const TODAY = "2026-10-05";

describe("freeEvenings", () => {
  it("finds the evenings with nothing in them", () => {
    const schedule = [event("2026-10-05", "Football"), event("2026-10-07", "Scouts")];

    expect(freeEvenings(schedule, WEEK, TODAY).map((e) => e.date)).toEqual([
      "2026-10-06",
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("names the weekday, so it reads as a day rather than a number", () => {
    expect(freeEvenings([], ["2026-10-08"], TODAY)[0]?.weekdayLabel).toBe("Thursday");
  });

  it("doesn't offer an evening that has already gone", () => {
    expect(freeEvenings([], ["2026-10-01", "2026-10-06"], TODAY).map((e) => e.date)).toEqual(["2026-10-06"]);
  });

  it("counts today as free when today is free", () => {
    expect(freeEvenings([], [TODAY], TODAY).map((e) => e.date)).toEqual([TODAY]);
  });
});

describe("somethingTogether", () => {
  const PEALS = [member("Andrew", "adult"), member("Paige", "adult"), member("Parker", "child")];

  it("pairs the first free evening with something somebody actually said", () => {
    const schedule = [event("2026-10-05", "Football")];
    const result = somethingTogether(schedule, WEEK, TODAY, [said("Parker", "I like going to the skate park")], PEALS);

    expect(result?.date).toBe("2026-10-06");
    expect(result?.weekdayLabel).toBe("Tuesday");
    expect(result?.statement).toBe("I like going to the skate park");
    expect(result?.saidBy).toBe("Parker");
  });

  it("says nothing when nobody has said they like anything", () => {
    expect(somethingTogether([], WEEK, TODAY, [], PEALS)).toBeNull();
  });

  it("won't quietly turn a food preference into an evening out", () => {
    // The only source is what somebody said about activities. A statement
    // about dinner is not an idea for a Thursday.
    expect(somethingTogether([], WEEK, TODAY, [said("Paige", "I don't like mushrooms", "meal")], PEALS)).toBeNull();
  });

  it("says nothing when every evening is spoken for", () => {
    const schedule = WEEK.map((date) => event(date, "Something"));
    expect(somethingTogether(schedule, WEEK, TODAY, [said("Parker", "Skate park")], PEALS)).toBeNull();
  });

  it("prefers what a child said, when a child has said anything", () => {
    // Ordered so the deterministic pick would land on the adult if the
    // child's statements weren't preferred — otherwise this passes by
    // coincidence of the index and tests nothing.
    const prefs = [said("Parker", "I like the skate park"), said("Andrew", "I like a long walk")];
    expect(somethingTogether([], WEEK, TODAY, prefs, PEALS)?.saidBy).toBe("Parker");
    // Without the roster there is no way to tell who is a child, and the
    // pick falls through to the plain deterministic one.
    expect(somethingTogether([], WEEK, TODAY, prefs)?.saidBy).toBe("Andrew");
  });

  it("falls back to the adults rather than going quiet", () => {
    const result = somethingTogether([], WEEK, TODAY, [said("Andrew", "I like a long walk")], PEALS);
    expect(result?.saidBy).toBe("Andrew");
  });

  it("offers the same thing for the same evening, however often the screen refreshes", () => {
    const prefs = [said("Parker", "Skate park"), said("Parker", "Bike ride"), said("Parker", "Library")];
    const first = somethingTogether([], WEEK, TODAY, prefs, PEALS);
    const again = somethingTogether([], WEEK, TODAY, prefs, PEALS);

    expect(again?.statement).toBe(first?.statement);
  });

  it("attributes the statement rather than claiming it as the app's idea", () => {
    const result = somethingTogether([], WEEK, TODAY, [said("Parker", "Skate park")], PEALS);

    expect(result?.because).toContain("Parker's list");
    expect(result?.because).not.toMatch(/we think|you might|recommend|suggest|based on|people like/i);
  });

  it("never rewords what somebody said", () => {
    const exact = "I like it when we go to the woods and get chips after";
    const result = somethingTogether([], WEEK, TODAY, [said("Parker", exact)], PEALS);

    expect(result?.statement).toBe(exact);
  });

  it("works for a household that hasn't filled in a roster", () => {
    const result = somethingTogether([], WEEK, TODAY, [said("Parker", "Skate park")]);
    expect(result?.saidBy).toBe("Parker");
  });
});
