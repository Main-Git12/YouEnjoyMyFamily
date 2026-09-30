import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { toLocalIsoDate, localDaysFromToday, describeDueDate } from "./dates";

// Pinned to a west-of-UTC zone on purpose: the bug this guards against
// (using toISOString(), which converts to UTC first) is invisible when the
// test runner's own clock is UTC.
beforeAll(() => {
  vi.stubEnv("TZ", "America/New_York");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("toLocalIsoDate", () => {
  it("uses the local calendar date, not the UTC one", () => {
    // 9:30pm on Sep 19 in New York is already Sep 20 in UTC.
    const lateEvening = new Date("2026-09-20T01:30:00Z");

    expect(toLocalIsoDate(lateEvening)).toBe("2026-09-19");
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
  });
});

describe("localDaysFromToday", () => {
  it("returns consecutive local dates starting with today", () => {
    const days = localDaysFromToday(7, new Date(2026, 8, 19, 21, 30));
    expect(days).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
  });

  it("rolls over month and year boundaries", () => {
    expect(localDaysFromToday(3, new Date(2026, 11, 30, 9, 0))).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("describeDueDate", () => {
  it("says nothing on the day a chore is due", () => {
    // Every row on today's list is due today. Printing it is noise.
    expect(describeDueDate("2026-09-25", "2026-09-25")).toBeNull();
  });

  it("says nothing for a chore with no due date at all", () => {
    expect(describeDueDate(null, "2026-09-25")).toBeNull();
  });

  it("names the day a chore was due once that day has gone", () => {
    expect(describeDueDate("2026-09-25", "2026-09-26")).toBe("was due yesterday");
    expect(describeDueDate("2026-09-25", "2026-09-27")).toBe("was due Friday");
    expect(describeDueDate("2026-09-25", "2026-10-01")).toBe("was due Friday");
  });

  it("falls back to a date once a weekday name would be ambiguous", () => {
    // Seven days later "Friday" is a different Friday, and the row would be
    // quietly wrong rather than merely vague.
    expect(describeDueDate("2026-09-25", "2026-10-02")).toBe("was due 25 Sep");
    expect(describeDueDate("2026-09-25", "2026-12-01")).toBe("was due 25 Sep");
  });

  it("looks forward the same way, for a list shown for a future day", () => {
    expect(describeDueDate("2026-09-25", "2026-09-24")).toBe("due tomorrow");
    expect(describeDueDate("2026-09-25", "2026-09-22")).toBe("due Friday");
    expect(describeDueDate("2026-09-25", "2026-09-18")).toBe("due 25 Sep");
  });

  it("counts whole calendar days, not hours, across a daylight-saving change", () => {
    // 1 Nov 2026 is when US clocks go back. A day either side of it is still
    // one day, even though the wall clock between them is 25 hours.
    expect(describeDueDate("2026-10-31", "2026-11-01")).toBe("was due yesterday");
    expect(describeDueDate("2026-11-01", "2026-11-02")).toBe("was due yesterday");
  });

  it("never mentions a person", () => {
    const phrasings = [
      describeDueDate("2026-09-25", "2026-09-26"),
      describeDueDate("2026-09-25", "2026-09-27"),
      describeDueDate("2026-09-25", "2026-10-02"),
    ];
    for (const phrase of phrasings) {
      expect(phrase).not.toMatch(/you|your|they|nobody|someone|still haven't|forgot/i);
    }
  });
});
