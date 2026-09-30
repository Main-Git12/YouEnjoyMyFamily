import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { toLocalIsoDate, localDaysFromToday } from "./dates";

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
