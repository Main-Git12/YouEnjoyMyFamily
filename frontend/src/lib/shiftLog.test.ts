import { describe, it, expect } from "vitest";
import { readShiftLog, describeMinutes } from "./shiftLog";
import type { HouseholdMember, RoutineRun } from "../types";

// Ryan: Mondays and Fridays, 10:00–12:00 as agreed.
const ryan: HouseholdMember = {
  memberId: "ryan",
  displayName: "Ryan",
  role: "carer",
  note: null,
  daysOfWeek: [1, 5],
  startsAt: "10:00",
  endsAt: "12:00",
};

/** A shift on `date`, signed in at `from` and out at `to` (local clock). */
const shift = (date: string, from: string | null, to: string | null): RoutineRun => ({
  routineId: "r-care",
  date,
  startedAt: from ? new Date(`${date}T${from}:00`).toISOString() : null,
  finishedAt: to ? new Date(`${date}T${to}:00`).toISOString() : null,
  steps: [],
});

// Mondays in Sept/Oct 2026: 7th, 14th, 21st, 28th Sept; 5th Oct.
const MONDAYS = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
const TODAY = "2026-10-05";

describe("readShiftLog", () => {
  it("counts a shift against the hours agreed, not against a guess", () => {
    const log = readShiftLog({ carer: ryan, runs: [shift("2026-09-07", "10:00", "11:10")], today: TODAY });
    expect(log.records).toHaveLength(1);
    expect(log.records[0]?.agreedMinutes).toBe(120);
    expect(log.records[0]?.recordedMinutes).toBe(70);
    expect(log.records[0]?.differenceMinutes).toBe(-50);
  });

  it("treats a shift that was never signed out as open, not as short", () => {
    // The wi-fi drops, somebody forgets. Counting that as zero minutes
    // worked would put a fair worker in front of an unfair number.
    const log = readShiftLog({ carer: ryan, runs: [shift("2026-09-07", "10:00", null)], today: TODAY });
    expect(log.records[0]?.recordedMinutes).toBeNull();
    expect(log.records[0]?.differenceMinutes).toBeNull();
    expect(log.countedShifts).toBe(0);
    expect(log.question).toBeNull();
    expect(log.because).toBe("1 shift weren't signed out at both ends.");
  });

  it("says nothing on one short shift, or two", () => {
    // Two is an anecdote. The same threshold the routine engine uses
    // before it will call a duration learned.
    const runs = [shift(MONDAYS[0] as string, "10:00", "11:00"), shift(MONDAYS[1] as string, "10:00", "11:00")];
    expect(readShiftLog({ carer: ryan, runs, today: TODAY }).question).toBeNull();
  });

  it("opens the question once there's a run of short shifts, both ways", () => {
    const runs = MONDAYS.map((date) => shift(date, "10:00", "11:10"));
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });

    expect(log.countedShifts).toBe(4);
    expect(log.recordedMinutes).toBe(280);
    expect(log.agreedMinutes).toBe(480);
    expect(log.question).toContain("4 of the last 4 shifts finished before the hours agreed");
    expect(log.question).toContain("3h 20m short");
    // The honest reading cuts both ways, and the app cannot tell which it
    // is. Reaching for the one that costs somebody their job would be the
    // app deciding on the family's behalf.
    expect(log.question).toContain("are the hours themselves wrong");
  });

  it("says so just as plainly when the shifts run long", () => {
    const runs = MONDAYS.map((date) => shift(date, "10:00", "12:40"));
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });
    expect(log.question).toContain("ran past the hours agreed");
    expect(log.question).toContain("more in the shift than the hours hold");
  });

  it("keeps quiet about a few minutes either side", () => {
    // Ten minutes on a two-hour booking is a bus, a kettle, and a
    // conversation on the way out.
    const runs = MONDAYS.map((date) => shift(date, "10:00", "11:53"));
    expect(readShiftLog({ carer: ryan, runs, today: TODAY }).question).toBeNull();
  });

  it("only counts the days this carer is actually rostered for", () => {
    // One care routine is shared across the rota on purpose, so the runs
    // are mixed together. A Wednesday is Kimmie's, not Ryan's.
    const runs = [
      shift("2026-09-07", "10:00", "11:00"), // Monday — Ryan's
      shift("2026-09-09", "09:00", "13:00"), // Wednesday — not Ryan's
      shift("2026-09-11", "10:00", "11:00"), // Friday — Ryan's
    ];
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });
    expect(log.records.map((record) => record.date)).toEqual(["2026-09-11", "2026-09-07"]);
  });

  it("leaves today out of its own record", () => {
    // A shift in progress is not a short one.
    const runs = [shift(TODAY, "10:00", null), shift("2026-09-07", "10:00", "11:00")];
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });
    expect(log.records.map((record) => record.date)).toEqual(["2026-09-07"]);
  });

  it("holds its tongue when no hours were ever agreed", () => {
    // Without a rota there is nothing to compare against, and inventing a
    // number to measure somebody by would be the worst thing in this file.
    const noHours = { ...ryan, startsAt: null, endsAt: null };
    const log = readShiftLog({ carer: noHours, runs: MONDAYS.map((d) => shift(d, "10:00", "10:30")), today: TODAY });
    expect(log.question).toBeNull();
    expect(log.records[0]?.differenceMinutes).toBeNull();
  });

  it("newest shift first, because that's the one being asked about", () => {
    const runs = [shift(MONDAYS[0] as string, "10:00", "12:00"), shift(MONDAYS[2] as string, "10:00", "12:00")];
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });
    expect(log.records.map((r) => r.date)).toEqual([MONDAYS[2], MONDAYS[0]]);
  });

  it("the subject of every sentence is a shift, never the person working it", () => {
    const runs = MONDAYS.map((date) => shift(date, "10:00", "11:00"));
    const log = readShiftLog({ carer: ryan, runs, today: TODAY });
    const text = `${log.because} ${log.question}`;
    expect(text).not.toContain("Ryan");
    // Nothing about what kind of worker anybody is.
    for (const word of ["lazy", "unreliable", "always", "keeps", "late", "slacking", "dishonest"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});

describe("describeMinutes", () => {
  it("reads at a glance on a wall", () => {
    expect(describeMinutes(45)).toBe("45m");
    expect(describeMinutes(60)).toBe("1h");
    expect(describeMinutes(70)).toBe("1h 10m");
    expect(describeMinutes(200)).toBe("3h 20m");
  });
});
