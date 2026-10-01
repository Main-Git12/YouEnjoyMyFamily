import { describe, it, expect } from "vitest";
import { eatsIntoTheEvening, eveningRoom, eveningStandbys, theFullWeekday } from "./eveningRoom";
import type { MealPlanEntry, ScheduleEntry } from "../types";

let seq = 0;
const event = (date: string, title: string, startTime: string | null, endTime: string | null = null): ScheduleEntry => ({
  scheduleId: `s${(seq += 1)}`,
  date,
  title,
  startTime,
  endTime,
  memberIds: [],
});

const dinner = (date: string, mealName: string): MealPlanEntry => ({ date, slot: "dinner", mealName, ingredients: [] });

describe("what lands in the cooking stretch", () => {
  it("counts something that overlaps the run-up to dinner", () => {
    expect(eatsIntoTheEvening(event("2026-10-07", "Soccer", "17:30", "18:30"))).toBe(true);
  });

  it("ignores the middle of the school day and the far side of bedtime", () => {
    expect(eatsIntoTheEvening(event("2026-10-07", "Dentist", "10:00", "11:00"))).toBe(false);
    expect(eatsIntoTheEvening(event("2026-10-07", "Book club", "20:00", "22:00"))).toBe(false);
  });

  it("doesn't treat an all-day entry as taking the evening", () => {
    // "Parker's birthday" is on the calendar all day and takes no time out
    // of it. Counting every untimed entry would mark most weeks impossible.
    expect(eatsIntoTheEvening(event("2026-10-07", "Parker's birthday", null))).toBe(false);
  });

  it("treats an entry with no end time as a point, not a guessed duration", () => {
    expect(eatsIntoTheEvening(event("2026-10-07", "Pickup", "17:00"))).toBe(true);
    expect(eatsIntoTheEvening(event("2026-10-07", "Pickup", "19:45"))).toBe(false);
  });

  it("counts a point event right on the hour cooking starts", () => {
    // A 16:30 swimming lesson is the whole problem with a 16:30 start. An
    // exclusive boundary here put a one-minute cliff between 16:30 (ignored)
    // and 16:31 (counted), which is not a line anybody could defend.
    expect(eatsIntoTheEvening(event("2026-10-07", "Swimming lesson", "16:30"))).toBe(true);
    expect(eatsIntoTheEvening(event("2026-10-07", "Pickup", "16:29"))).toBe(false);
  });

  it("doesn't count something that has already finished by then", () => {
    // Half-open: a thing that *ends* as cooking starts is over.
    expect(eatsIntoTheEvening(event("2026-10-07", "Playdate", "15:00", "16:30"))).toBe(false);
    expect(eatsIntoTheEvening(event("2026-10-07", "Playdate", "15:00", "16:31"))).toBe(true);
  });
});

describe("eveningRoom", () => {
  it("names what's in the way, in the order it happens", () => {
    const schedule = [
      event("2026-10-07", "Soccer", "17:30", "18:30"),
      event("2026-10-07", "Swim", "16:45", "17:15"),
      event("2026-10-07", "Book club", "20:00", "22:00"),
    ];

    const [wednesday] = eveningRoom(schedule, ["2026-10-07"]);

    expect(wednesday?.inTheWay.map((e) => e.title)).toEqual(["Swim", "Soccer"]);
    expect(wednesday?.because).toBe("Swim at 16:45, Soccer at 17:30");
  });

  it("says nothing at all about an evening with room in it", () => {
    const [thursday] = eveningRoom([event("2026-10-08", "Dentist", "10:00", "11:00")], ["2026-10-08"]);
    expect(thursday?.inTheWay).toEqual([]);
    expect(thursday?.because).toBeNull();
  });
});

describe("what this family already falls back on", () => {
  // 2026-09-02, -09, -16, -23 are Wednesdays; today is 2026-10-01.
  const busyWednesdays = ["2026-09-02", "2026-09-09", "2026-09-16"].map((d) => event(d, "Soccer", "17:30", "18:30"));

  it("only offers meals they've actually put on a full evening", () => {
    const plan = [
      ...["2026-09-02", "2026-09-09", "2026-09-16"].map((d) => dinner(d, "Pasta bake")),
      dinner("2026-09-03", "Roast chicken"),
    ];

    const standbys = eveningStandbys(plan, busyWednesdays, "2026-10-01");

    expect(standbys.map((s) => s.mealName)).toEqual(["Pasta bake"]);
    expect(standbys[0]?.because).toBe("Planned on 3 evenings that already had something on.");
  });

  it("won't call twice a habit", () => {
    const plan = ["2026-09-02", "2026-09-09"].map((d) => dinner(d, "Pasta bake"));
    expect(eveningStandbys(plan, busyWednesdays, "2026-10-01")).toEqual([]);
  });

  it("won't read its own future suggestions back as evidence", () => {
    // Three Wednesdays planned ahead is the family filling in a calendar,
    // not a thing they do.
    const ahead = ["2026-10-07", "2026-10-14", "2026-10-21"];
    const plan = ahead.map((d) => dinner(d, "Pasta bake"));
    const schedule = ahead.map((d) => event(d, "Soccer", "17:30", "18:30"));

    expect(eveningStandbys(plan, schedule, "2026-10-01")).toEqual([]);
  });

  it("never claims to know how long anything takes to cook", () => {
    const plan = ["2026-09-02", "2026-09-09", "2026-09-16"].map((d) => dinner(d, "Pasta bake"));
    for (const standby of eveningStandbys(plan, busyWednesdays, "2026-10-01")) {
      expect(standby.because).not.toMatch(/quick|fast|minutes|easy|simple|30|15/i);
    }
  });
});

describe("the full weekday", () => {
  it("finds the weekday that keeps having something on", () => {
    const schedule = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"].map((d) =>
      event(d, "Soccer", "17:30", "18:30")
    );

    expect(theFullWeekday(schedule, "2026-10-01")).toEqual({ weekday: 3, weeks: 4 });
  });

  it("holds off until there's a pattern rather than a coincidence", () => {
    const schedule = ["2026-09-02", "2026-09-09"].map((d) => event(d, "Soccer", "17:30", "18:30"));
    expect(theFullWeekday(schedule, "2026-10-01")).toBeNull();
  });

  it("counts the weekday, not the number of things on it", () => {
    // Four entries on one Wednesday is one busy Wednesday, not four.
    const schedule = [
      event("2026-09-02", "Soccer", "17:30", "18:30"),
      event("2026-09-02", "Swim", "17:00", "17:25"),
      event("2026-09-02", "Scouts", "18:40", "19:20"),
    ];
    expect(theFullWeekday(schedule, "2026-10-01")).toBeNull();
  });
});
