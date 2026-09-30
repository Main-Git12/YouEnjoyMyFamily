import { describe, it, expect } from "vitest";
import { suggestBlockLength, tallyDay, recentMatters, focusNotes, toBillableTenths } from "./focusRhythm";
import type { FocusBlock, FocusOutcome } from "../types";

let seq = 0;
function block(overrides: Partial<FocusBlock> = {}): FocusBlock {
  seq += 1;
  const planned = overrides.plannedMinutes ?? 52;
  return {
    blockId: `b${seq}`,
    memberId: "Paige",
    date: "2026-09-25",
    startedAt: "2026-09-25T09:00:00.000Z",
    endedAt: "2026-09-25T09:52:00.000Z",
    plannedMinutes: planned,
    actualMinutes: overrides.actualMinutes ?? planned,
    outcome: (overrides.outcome ?? "completed") as FocusOutcome,
    matter: overrides.matter ?? "DR-1042",
    note: null,
    ...overrides,
  };
}

/** `count` blocks of `minutes`, of which `held` ran to the end. */
function runs(minutes: number, count: number, held: number): FocusBlock[] {
  return Array.from({ length: count }, (_, index) =>
    block(
      index < held
        ? { plannedMinutes: minutes, actualMinutes: minutes, outcome: "completed" }
        : { plannedMinutes: minutes, actualMinutes: Math.round(minutes * 0.2), outcome: "abandoned" }
    )
  );
}

describe("suggestBlockLength", () => {
  it("says it doesn't know yet rather than inventing a number", () => {
    const suggestion = suggestBlockLength([block(), block()]);
    expect(suggestion.minutes).toBe(52);
    expect(suggestion.because).toMatch(/once there are a few blocks/);
  });

  it("picks the length she actually finishes, not the longest she's attempted", () => {
    // 90s are ambitious and mostly abandoned; 52s hold.
    const suggestion = suggestBlockLength([...runs(90, 5, 1), ...runs(52, 5, 5)]);
    expect(suggestion.minutes).toBe(52);
    expect(suggestion.because).toMatch(/100% of your 52-minute blocks/);
  });

  it("carries the evidence for the number it gives", () => {
    const suggestion = suggestBlockLength([...runs(60, 4, 3), ...runs(25, 4, 1)]);
    expect(suggestion.because).toMatch(/75% of your 60-minute blocks ran to the end, over 4 of them/);
  });

  it("prefers the longer block when two lengths do equally well", () => {
    const suggestion = suggestBlockLength([...runs(25, 4, 4), ...runs(90, 4, 4)]);
    expect(suggestion.minutes).toBe(90);
  });

  it("ignores a length that's barely been tried", () => {
    // One lucky 90 is not evidence against eight solid 52s.
    const suggestion = suggestBlockLength([...runs(52, 8, 7), ...runs(90, 1, 1)]);
    expect(suggestion.minutes).toBe(52);
  });

  it("counts a block that all but finished as having held", () => {
    const nearlyAll = Array.from({ length: 5 }, () =>
      block({ plannedMinutes: 60, actualMinutes: 57, outcome: "cut_short" })
    );
    expect(suggestBlockLength(nearlyAll).minutes).toBe(60);
  });
});

describe("toBillableTenths", () => {
  it("rounds to the tenth of an hour legal time is filed in", () => {
    expect(toBillableTenths(52)).toBe(0.9);
    expect(toBillableTenths(60)).toBe(1);
    expect(toBillableTenths(6)).toBe(0.1);
    expect(toBillableTenths(0)).toBe(0);
  });
});

describe("tallyDay", () => {
  it("separates what's been logged from what can actually be filed", () => {
    const tally = tallyDay(
      [
        block({ actualMinutes: 60, matter: "DR-1042" }),
        block({ actualMinutes: 60, matter: null }),
        block({ actualMinutes: 30, matter: "   " }),
        block({ date: "2026-09-24", actualMinutes: 120, matter: "DR-9" }),
      ],
      "2026-09-25"
    );
    expect(tally.blocks).toBe(3);
    expect(tally.loggedHours).toBe(2.5);
    // Only the hour with a matter on it. The other 1.5 is the hour that
    // gets reconstructed from memory on Friday.
    expect(tally.attributedHours).toBe(1);
  });

  it("is zero on a day with nothing on it", () => {
    expect(tallyDay([], "2026-09-25")).toEqual({ loggedHours: 0, attributedHours: 0, blocks: 0 });
  });
});

describe("recentMatters", () => {
  it("offers what she last worked on, most recent first, without repeats", () => {
    const matters = recentMatters([
      block({ matter: "DR-1042", startedAt: "2026-09-25T09:00:00.000Z" }),
      block({ matter: "DR-77", startedAt: "2026-09-25T11:00:00.000Z" }),
      block({ matter: "DR-1042", startedAt: "2026-09-25T14:00:00.000Z" }),
      block({ matter: null, startedAt: "2026-09-25T15:00:00.000Z" }),
    ]);
    expect(matters).toEqual(["DR-1042", "DR-77"]);
  });

  it("returns nothing when nothing has been filed against a matter", () => {
    expect(recentMatters([block({ matter: null })])).toEqual([]);
  });
});

describe("focusNotes", () => {
  const atHour = (hour: number, held: boolean) =>
    block({
      startedAt: new Date(2026, 8, 25, hour, 0).toISOString(),
      plannedMinutes: 52,
      actualMinutes: held ? 52 : 8,
      outcome: held ? "completed" : "abandoned",
    });

  it("says nothing at all until there's enough to go on", () => {
    expect(focusNotes([block(), block(), block()])).toEqual([]);
  });

  it("describes the blocks, never the person", () => {
    const blocks = [
      ...Array.from({ length: 5 }, () => atHour(9, true)),
      ...Array.from({ length: 5 }, () => atHour(16, false)),
    ];
    const notes = focusNotes(blocks);
    const band = notes.find((note) => note.id === "band");
    expect(band?.text).toBe("Blocks before 11am are the ones that run to the end.");
    // Not "you lose focus in the afternoon". A label is no use to anyone.
    for (const note of notes) {
      for (const banned of ["you ", "your focus", "distracted", "unproductive", "bad at"]) {
        expect(note.text.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it("carries the counts behind the claim", () => {
    const blocks = [
      ...Array.from({ length: 5 }, () => atHour(9, true)),
      ...Array.from({ length: 5 }, () => atHour(16, false)),
    ];
    const band = focusNotes(blocks).find((note) => note.id === "band");
    expect(band?.because).toBe("5 of 5 before 11am, against 0 of 5 after 3pm");
  });

  it("stays quiet when the difference between times of day is just noise", () => {
    const blocks = [
      ...Array.from({ length: 5 }, (_, i) => atHour(9, i < 4)),
      ...Array.from({ length: 5 }, (_, i) => atHour(16, i < 4)),
    ];
    expect(focusNotes(blocks).find((note) => note.id === "band")).toBeUndefined();
  });

  it("flags time that has nothing to file it against", () => {
    const blocks = [
      ...Array.from({ length: 7 }, () => block({ matter: "DR-1042" })),
      ...Array.from({ length: 3 }, () => block({ matter: null })),
    ];
    const note = focusNotes(blocks).find((entry) => entry.id === "unattributed");
    expect(note?.text).toBe("3 blocks have no matter against them.");
    expect(note?.because).toMatch(/out of 10 recorded/);
  });

  it("says nothing about attribution when everything is attributed", () => {
    const blocks = Array.from({ length: 10 }, () => block({ matter: "DR-1042" }));
    expect(focusNotes(blocks).find((note) => note.id === "unattributed")).toBeUndefined();
  });
});
