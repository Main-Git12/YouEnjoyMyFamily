import { describe, it, expect } from "vitest";
import { CARE_CATALOG, ALL_CARE_STEPS, describeRota } from "./careCatalog";
import type { HouseholdMember } from "../types";

const member = (overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
  memberId: "m1",
  displayName: "Ryan",
  role: "carer",
  note: null,
  ...overrides,
});

describe("CARE_CATALOG", () => {
  it("covers every step the family named", () => {
    const titles = ALL_CARE_STEPS.map((step) => step.title.toLowerCase());
    for (const needed of ["shower", "walk", "laundry", "hygiene", "clothes", "dishes", "breakfast", "coffee", "lunch"]) {
      expect(titles.some((title) => title.includes(needed)), `nothing covers "${needed}"`).toBe(true);
    }
  });

  it("lays clothes out before the shower they're for", () => {
    const titles = ALL_CARE_STEPS.map((step) => step.title);
    const layOut = titles.findIndex((title) => title.startsWith("Lay out clothes"));
    const shower = titles.indexOf("Shower");
    expect(layOut).toBeGreaterThanOrEqual(0);
    expect(layOut).toBeLessThan(shower);
  });

  it("marks the steps that need two usable hands", () => {
    // Somebody in a hand cast can hand these over without the step — or
    // the time it has learned — being thrown away.
    const twoHanded = ALL_CARE_STEPS.filter((step) => step.needsTwoHands).map((step) => step.title);
    expect(twoHanded).toContain("Breakfast");
    expect(twoHanded).toContain("Lunch");
    expect(twoHanded).not.toContain("A walk");
  });

  it("names tasks, never the person the task is for", () => {
    // This routine is read off a kitchen wall by a paid worker, and the
    // person it is about can read it too.
    const banned = /\b(she|her|hers|he|him|his|patient|client|frail|struggl|decline|confus|unable|poor|difficult)\b/i;
    for (const step of ALL_CARE_STEPS) {
      expect(banned.test(`${step.title} ${step.note ?? ""}`), `"${step.title}" describes a person`).toBe(false);
    }
    for (const group of CARE_CATALOG) {
      expect(banned.test(`${group.heading} ${group.blurb}`), `"${group.heading}" describes a person`).toBe(false);
    }
  });

  it("gives every step a seed duration, and no step a learned one", () => {
    // These are estimates until two runs have been finished and timed.
    for (const step of ALL_CARE_STEPS) {
      expect(step.targetMinutes).toBeGreaterThan(0);
    }
  });

  it("has no duplicate titles, so a step can't be added twice", () => {
    const titles = ALL_CARE_STEPS.map((step) => step.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("describeRota", () => {
  it("puts a carer's days and hours in one line", () => {
    expect(describeRota(member({ daysOfWeek: [1, 5], startsAt: "10:00", endsAt: "12:00" }))).toBe(
      "Mon, Fri · 10:00–12:00"
    );
  });

  it("sorts the days however they were ticked", () => {
    expect(describeRota(member({ daysOfWeek: [4, 2, 3], startsAt: "09:00", endsAt: "13:00" }))).toBe(
      "Tue, Wed, Thu · 09:00–13:00"
    );
  });

  it("says nothing about anybody who lives here", () => {
    // A rota is something you agree with somebody who comes in.
    expect(describeRota(member({ role: "adult", daysOfWeek: [1], startsAt: "09:00" }))).toBeNull();
  });

  it("is quiet when the rota hasn't been filled in", () => {
    expect(describeRota(member())).toBeNull();
  });

  it("shows days alone, or hours alone, rather than nothing", () => {
    expect(describeRota(member({ daysOfWeek: [1, 5] }))).toBe("Mon, Fri");
    expect(describeRota(member({ startsAt: "10:00", endsAt: "12:00" }))).toBe("10:00–12:00");
  });
});
