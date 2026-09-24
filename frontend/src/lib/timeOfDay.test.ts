import { describe, it, expect } from "vitest";
import { currentWindow, greeting, isWindowPast, windowOrderFor } from "./timeOfDay";

const at = (hour: number, minute = 0) => new Date(2026, 8, 23, hour, minute);

describe("currentWindow", () => {
  it("is the morning first thing", () => {
    expect(currentWindow(at(7))).toBe("morning");
  });

  it("moves on as each window closes", () => {
    expect(currentWindow(at(9, 1))).toBe("after_school");
    expect(currentWindow(at(17, 1))).toBe("after_dinner");
    expect(currentWindow(at(19, 45))).toBe("bedtime");
  });

  it("is nothing once the day is over, rather than looping back to morning", () => {
    expect(currentWindow(at(23))).toBeNull();
  });
});

describe("windowOrderFor", () => {
  it("leads with what's still ahead and buries what's gone", () => {
    // Half eight in the evening: only bedtime is left.
    expect(windowOrderFor(at(20))).toEqual([
      "bedtime",
      "anytime",
      "morning",
      "after_school",
      "after_dinner",
    ]);
  });

  it("keeps the day in its natural order first thing", () => {
    expect(windowOrderFor(at(6))).toEqual([
      "morning",
      "after_school",
      "after_dinner",
      "bedtime",
      "anytime",
    ]);
  });

  it("always lists every window, so no chore can fall off the screen", () => {
    for (const hour of [0, 6, 9, 12, 17, 20, 23]) {
      expect(new Set(windowOrderFor(at(hour))).size).toBe(5);
    }
  });
});

describe("isWindowPast", () => {
  it("never calls an anytime chore late", () => {
    expect(isWindowPast("anytime", at(23, 59))).toBe(false);
  });

  it("turns over exactly when the window closes", () => {
    expect(isWindowPast("morning", at(8, 59))).toBe(false);
    expect(isWindowPast("morning", at(9, 0))).toBe(true);
  });
});

describe("greeting", () => {
  it("matches the time someone actually walks past", () => {
    expect(greeting(at(7))).toBe("Good morning");
    expect(greeting(at(14))).toBe("Good afternoon");
    expect(greeting(at(19))).toBe("Good evening");
  });
});
