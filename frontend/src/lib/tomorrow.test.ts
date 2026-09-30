import { describe, expect, it } from "vitest";
import { buildTomorrow, briefingIsDue, weekdayMargins, type TomorrowSources } from "./tomorrow";
import type { Routine, RoutineRun, SchoolProfile } from "../types";

// 2026-09-30 is a Wednesday; 2026-10-01 a Thursday.
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (y: number, m: number, d: number, h: number, min = 0) => at(y, m, d, h, min).toISOString();

const MORNING: Routine = {
  routineId: "r1",
  name: "School morning",
  kind: "morning",
  anchorTime: "07:52",
  daysOfWeek: [1, 2, 3, 4, 5],
  steps: [{ stepId: "s1", title: "Shoes and coat", targetMinutes: 4, memberId: null }],
  active: true,
};

/** A finished run on `date`, ending `lateMinutes` after 07:52 (negative = early). */
const run = (date: [number, number, number], lateMinutes: number): RoutineRun => {
  const [y, m, d] = date;
  const end = at(y, m, d, 7, 52 + lateMinutes);
  return { routineId: "r1", date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, startedAt: iso(y, m, d, 7, 10), finishedAt: end.toISOString(), steps: [] };
};

const PARKER: SchoolProfile = {
  memberId: "Parker",
  schoolName: "Violet Elementary",
  teacher: "Miss Hineline",
  gradeLabel: null,
  specials: [{ dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." }],
  menuSource: null,
};

const base = (over: Partial<TomorrowSources> = {}): TomorrowSources => ({
  now: at(2026, 9, 30, 20, 0),
  schedule: [],
  profiles: [],
  prep: [],
  mealPlan: [],
  routines: [],
  runs: [],
  ...over,
});

describe("when the briefing is due", () => {
  it("is not due during the day — tomorrow is not a breakfast problem", () => {
    expect(briefingIsDue(at(2026, 9, 30, 7, 30))).toBe(false);
    expect(briefingIsDue(at(2026, 9, 30, 16, 59))).toBe(false);
    // With something real on tomorrow, so this fails if the time guard goes
    // rather than passing because there was nothing to say either way.
    const busyTomorrow = base({
      now: at(2026, 9, 30, 9, 0),
      schedule: [{ scheduleId: "a", date: "2026-10-01", title: "Swimming", startTime: "17:30", endTime: null, memberIds: [] }],
    });
    expect(buildTomorrow(busyTomorrow)).toBeNull();
    expect(buildTomorrow({ ...busyTomorrow, now: at(2026, 9, 30, 20, 0) })).not.toBeNull();
  });

  it("is due once the after-school window has closed", () => {
    expect(briefingIsDue(at(2026, 9, 30, 17, 0))).toBe(true);
  });
});

/**
 * A briefing that always has something to say is one nobody reads by the
 * second week. Most evenings should produce nothing at all.
 */
describe("saying nothing", () => {
  it("says nothing when tomorrow is empty", () => {
    expect(buildTomorrow(base())).toBeNull();
  });

  it("says nothing about a dinner for a family that has never planned one", () => {
    expect(buildTomorrow(base({ mealPlan: [] }))).toBeNull();
  });

  it("says nothing about a school note that is already ticked off", () => {
    const brief = buildTomorrow(
      base({
        profiles: [PARKER],
        prep: [{ memberId: "Parker", date: "2026-10-01", subject: "Library", note: null, packedAt: iso(2026, 9, 30, 19, 0) }],
      })
    );
    expect(brief).toBeNull();
  });
});

describe("what it notices about tomorrow", () => {
  it("names what is on the calendar, and lists it as the evidence", () => {
    const brief = buildTomorrow(
      base({
        schedule: [
          { scheduleId: "a", date: "2026-10-01", title: "Swimming", startTime: "17:30", endTime: null, memberIds: [] },
          { scheduleId: "b", date: "2026-10-01", title: "Dentist", startTime: "09:00", endTime: null, memberIds: [] },
          { scheduleId: "c", date: "2026-09-30", title: "Today's thing", startTime: "10:00", endTime: null, memberIds: [] },
        ],
      })
    );
    const calendar = brief?.signals.find((s) => s.kind === "calendar");
    expect(calendar?.headline).toBe("2 things on Thursday's calendar.");
    // Sorted by time, and today's entry is not tomorrow's business.
    expect(calendar?.because).toBe("09:00 Dentist · 17:30 Swimming");
  });

  it("raises what the school has asked for, in the school's own words", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER] }));
    const school = brief?.signals.find((s) => s.kind === "school");
    expect(school?.headline).toBe(
      "Library for Parker — Have your student bring in their library book to return."
    );
    expect(school?.because).toContain("Miss Hineline");
  });

  it("mentions an unplanned dinner only once the family plans dinners", () => {
    const history = [
      { date: "2026-09-28", slot: "dinner" as const, mealName: "Tacos", ingredients: [] },
      { date: "2026-09-29", slot: "dinner" as const, mealName: "Pasta", ingredients: [] },
    ];
    expect(buildTomorrow(base({ mealPlan: history }))).toBeNull();

    const brief = buildTomorrow(
      base({ mealPlan: [...history, { date: "2026-09-27", slot: "dinner", mealName: "Chilli", ingredients: [] }] })
    );
    expect(brief?.signals.find((s) => s.kind === "meal")?.headline).toBe("No dinner planned for Thursday.");
  });

  it("says nothing about dinner when tomorrow's is already planned", () => {
    const brief = buildTomorrow(
      base({
        mealPlan: [
          { date: "2026-09-27", slot: "dinner", mealName: "Chilli", ingredients: [] },
          { date: "2026-09-28", slot: "dinner", mealName: "Tacos", ingredients: [] },
          { date: "2026-09-29", slot: "dinner", mealName: "Pasta", ingredients: [] },
          { date: "2026-10-01", slot: "dinner", mealName: "Fish", ingredients: [] },
        ],
      })
    );
    expect(brief).toBeNull();
  });

  it("rolls into the next month correctly", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER] }));
    expect(brief?.date).toBe("2026-10-01");
    expect(brief?.weekdayLabel).toBe("Thursday");
  });
});

/**
 * The genuinely anticipatory part: what this weekday's mornings have
 * actually done, from the family's own finished runs.
 */
describe("what the mornings have been doing", () => {
  const thursdays = [run([2026, 9, 24], 2), run([2026, 9, 17], 3), run([2026, 9, 10], 1)];

  it("needs three mornings of the same weekday before it claims anything", () => {
    const two = weekdayMargins(MORNING, thursdays.slice(0, 2), "2026-09-30");
    expect(two.get(4)).toBeUndefined();
    const three = weekdayMargins(MORNING, thursdays, "2026-09-30");
    expect(three.get(4)?.mornings).toBe(3);
  });

  it("takes the median, so one bad morning is not an opinion about every Thursday", () => {
    const withOutlier = [...thursdays, run([2026, 9, 3], 60)];
    const margins = weekdayMargins(MORNING, withOutlier, "2026-09-30");
    // Lateness of 1, 2, 3 and 60 minutes → margins -1, -2, -3, -60. The
    // median of four is -2.5, and it is floored to -3 rather than rounded:
    // `Math.round(-2.5)` is -2 in JavaScript, which would quietly report a
    // missed deadline as smaller than it was.
    expect(margins.get(4)?.medianMarginMinutes).toBe(-3);
  });

  it("ignores a morning that was started and never finished", () => {
    const abandoned: RoutineRun = { ...run([2026, 9, 3], 0), finishedAt: null };
    const margins = weekdayMargins(MORNING, [...thursdays, abandoned], "2026-09-30");
    expect(margins.get(4)?.mornings).toBe(3);
  });

  /**
   * A separate case from the one above, and it needs its own test: a null
   * `finishedAt` is caught by the explicit guard, and a corrupt one only by
   * the parse check. Removing either guard leaves the other covering the
   * first case, so one test cannot speak for both.
   */
  it("ignores a morning whose finish time cannot be read", () => {
    const corrupt: RoutineRun = { ...run([2026, 9, 3], 0), finishedAt: "not a timestamp" };
    const margins = weekdayMargins(MORNING, [...thursdays, corrupt], "2026-09-30");
    expect(margins.get(4)?.mornings).toBe(3);
  });

  it("excludes today from its own learning", () => {
    // Today is itself a Thursday here, so a run dated today would land in
    // the same bucket as the three before it. An earlier version of this
    // test used a Wednesday, where the extra run fell below the
    // three-morning threshold and the test passed whether or not today was
    // being excluded at all.
    const today = "2026-10-01";
    const margins = weekdayMargins(MORNING, [...thursdays, run([2026, 10, 1], 45)], today);
    expect(margins.get(4)?.mornings).toBe(3);
    // And the median is the one from the three past mornings, untouched by
    // today's 45 minutes.
    expect(margins.get(4)?.medianMarginMinutes).toBe(-2);
  });

  it("ignores another routine's runs", () => {
    const bedtime = { ...run([2026, 9, 24], 0), routineId: "r2" };
    expect(weekdayMargins(MORNING, [...thursdays, bedtime], "2026-09-30").get(4)?.mornings).toBe(3);
  });

  it("rounds a half-minute of lateness against itself, never in its own favour", () => {
    // Two mornings 2 late and two 3 late → median 2.5 late, reported as 3.
    const half = [run([2026, 9, 24], 2), run([2026, 9, 17], 2), run([2026, 9, 10], 3), run([2026, 9, 3], 3)];
    expect(weekdayMargins(MORNING, half, "2026-09-30").get(4)?.medianMarginMinutes).toBe(-3);
  });

  it("raises a tight weekday, saying how many mornings and how late", () => {
    const brief = buildTomorrow(base({ routines: [MORNING], runs: thursdays }));
    const morning = brief?.signals.find((s) => s.kind === "morning");
    expect(morning?.headline).toBe("Thursday mornings have been tight.");
    expect(morning?.because).toBe("The last 3 Thursday mornings, finishing about 2 minutes after 07:52.");
  });

  it("says nothing about a weekday whose mornings have room in them", () => {
    const roomy = [run([2026, 9, 24], -15), run([2026, 9, 17], -12), run([2026, 9, 10], -20)];
    expect(buildTomorrow(base({ routines: [MORNING], runs: roomy }))).toBeNull();
  });

  it("says nothing when the routine does not run on that weekday at all", () => {
    const weekendOnly = { ...MORNING, daysOfWeek: [0, 6] };
    expect(buildTomorrow(base({ routines: [weekendOnly], runs: thursdays }))).toBeNull();
  });
});

describe("the overall read", () => {
  const thursdays = [run([2026, 9, 24], 2), run([2026, 9, 17], 3), run([2026, 9, 10], 1)];
  const swimming = {
    scheduleId: "a",
    date: "2026-10-01",
    title: "Swimming",
    startTime: "17:30",
    endTime: null,
    memberIds: [],
  };

  it("calls it tight when a thin morning meets something else on the day", () => {
    const brief = buildTomorrow(base({ routines: [MORNING], runs: thursdays, schedule: [swimming] }));
    expect(brief?.outlook?.tightness).toBe("tight");
    expect(brief?.outlook?.because).toBe(
      "1 calendar entry, Thursday mornings finishing with little to spare over 3 of them"
    );
  });

  it("calls it busy on load alone, without claiming anything about the morning", () => {
    const brief = buildTomorrow(
      base({
        schedule: [swimming, { ...swimming, scheduleId: "b", title: "Dentist", startTime: "09:00" }],
        profiles: [PARKER],
      })
    );
    expect(brief?.outlook?.tightness).toBe("busy");
    expect(brief?.outlook?.because).not.toContain("morning");
  });

  it("calls a single quiet thing clear", () => {
    const brief = buildTomorrow(base({ schedule: [swimming] }));
    expect(brief?.outlook?.tightness).toBe("clear");
  });
});

/**
 * The rule that matters most in a forward-looking feature, because a
 * prediction about a household is one short step from a prediction about a
 * person — on a wall that person's children walk past.
 */
describe("what it will never say", () => {
  const everything = base({
    now: at(2026, 9, 30, 20, 0),
    schedule: [{ scheduleId: "a", date: "2026-10-01", title: "Swimming", startTime: "17:30", endTime: null, memberIds: [] }],
    profiles: [PARKER],
    mealPlan: [
      { date: "2026-09-27", slot: "dinner", mealName: "Chilli", ingredients: [] },
      { date: "2026-09-28", slot: "dinner", mealName: "Tacos", ingredients: [] },
      { date: "2026-09-29", slot: "dinner", mealName: "Pasta", ingredients: [] },
    ],
    routines: [MORNING],
    runs: [run([2026, 9, 24], 2), run([2026, 9, 17], 3), run([2026, 9, 10], 1)],
  });

  const BANNED = [
    /\byou (always|never|keep|struggle|forget)\b/i,
    /\b(she|he|they) (always|never|keeps?|struggles?|forgets?)\b/i,
    /\bParker (always|never|keeps?|struggles?|forgets?|is slow)\b/i,
    /\brunning late again\b/i,
    /\bbad at\b/i,
    /\blazy\b/i,
    /\bfailed\b/i,
  ];

  it("produces every kind of signal at once, so the scan below has something to scan", () => {
    const brief = buildTomorrow(everything);
    expect(new Set(brief?.signals.map((s) => s.kind))).toEqual(new Set(["calendar", "school", "meal", "morning"]));
  });

  it("never characterises a person in any line it produces", () => {
    const brief = buildTomorrow(everything);
    const lines = (brief?.signals ?? []).flatMap((s) => [s.headline, s.because, s.question?.label ?? ""]);
    lines.push(brief?.outlook?.because ?? "");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      for (const banned of BANNED) expect(line).not.toMatch(banned);
    }
  });

  it("gives every signal evidence to be checked against", () => {
    const brief = buildTomorrow(everything);
    for (const signal of brief?.signals ?? []) {
      expect(signal.because.trim().length).toBeGreaterThan(0);
    }
    expect(brief?.outlook?.because.trim().length).toBeGreaterThan(0);
  });

  it("only ever opens a question — it never reports having changed anything", () => {
    const brief = buildTomorrow(everything);
    for (const signal of brief?.signals ?? []) {
      if (!signal.question) continue;
      expect(signal.question.label).not.toMatch(/\b(moved|rescheduled|planned it|done for you|updated)\b/i);
    }
  });
});

/**
 * The panel sits in a column that scrolls on a screen nobody scrolls, so
 * last means invisible. The learned morning line is the whole point of the
 * feature and used to be the one that fell off the bottom.
 */
describe("the order things are said in", () => {
  it("leads with what can be packed tonight, then the learned morning", () => {
    const everything = base({
      now: at(2026, 9, 30, 20, 0),
      schedule: [{ scheduleId: "a", date: "2026-10-01", title: "Swimming", startTime: "17:30", endTime: null, memberIds: [] }],
      profiles: [PARKER],
      mealPlan: [
        { date: "2026-09-27", slot: "dinner", mealName: "Chilli", ingredients: [] },
        { date: "2026-09-28", slot: "dinner", mealName: "Tacos", ingredients: [] },
        { date: "2026-09-29", slot: "dinner", mealName: "Pasta", ingredients: [] },
      ],
      routines: [MORNING],
      runs: [run([2026, 9, 24], 2), run([2026, 9, 17], 3), run([2026, 9, 10], 1)],
    });
    expect(buildTomorrow(everything)?.signals.map((s) => s.kind)).toEqual([
      "school",
      "morning",
      "meal",
      "calendar",
    ]);
  });
});

/**
 * The forecast is only ever mentioned when it changes what somebody picks
 * up on the way out. A five-day outlook is a phone's job; this is a coat's.
 */
describe("what the weather will be doing at the door", () => {
  const reading = (over: Partial<import("../types").WeatherAtHour> = {}, outer = {}) => ({
    date: "2026-10-01",
    atTime: "07:52",
    stale: false,
    fetchedAt: "2026-09-30T18:00:00.000Z",
    label: "Pickerington",
    weather: {
      time: "2026-10-01T07:00",
      temperatureF: 62,
      feelsLikeF: 60,
      chanceOfRain: 5,
      conditions: "clear",
      beforeSunrise: false,
      sunrise: "2026-10-01T07:27",
      ...over,
    },
    ...outer,
  });

  it("says nothing about a mild, dry, daylit morning", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER], weather: reading() }));
    expect(brief?.signals.find((s) => s.kind === "weather")).toBeUndefined();
  });

  it("speaks up when it is cold enough for a coat", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER], weather: reading({ temperatureF: 41, feelsLikeF: 34 }) }));
    const weather = brief?.signals.find((s) => s.kind === "weather");
    expect(weather?.headline).toContain("41°F");
    expect(weather?.headline).toContain("Feels like 34°F");
  });

  it("speaks up when it is going to be wet", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER], weather: reading({ conditions: "rain", chanceOfRain: 80 }) }));
    expect(brief?.signals.find((s) => s.kind === "weather")?.headline).toContain("80% chance of rain");
  });

  it("says when they will be leaving before the sun is up", () => {
    const brief = buildTomorrow(
      base({ profiles: [PARKER], weather: reading({ beforeSunrise: true, sunrise: "2026-10-01T07:58" }) })
    );
    expect(brief?.signals.find((s) => s.kind === "weather")?.headline).toContain("Still dark — sunrise is 07:58");
  });

  it("names the hour and the place it is a forecast for", () => {
    const brief = buildTomorrow(base({ profiles: [PARKER], weather: reading({ temperatureF: 30, feelsLikeF: 22 }) }));
    expect(brief?.signals.find((s) => s.kind === "weather")?.because).toBe(
      "Forecast for Pickerington at the time the morning has to be finished."
    );
  });

  it("admits when it is showing a saved copy", () => {
    const brief = buildTomorrow(
      base({ profiles: [PARKER], weather: reading({ temperatureF: 30, feelsLikeF: 22 }, { stale: true }) })
    );
    expect(brief?.signals.find((s) => s.kind === "weather")?.because).toContain("from a copy saved earlier");
  });

  it("ignores a forecast that is for a different day than the one being briefed", () => {
    const brief = buildTomorrow(
      base({ profiles: [PARKER], weather: reading({ temperatureF: 20, feelsLikeF: 12 }, { date: "2026-10-05" }) })
    );
    expect(brief?.signals.find((s) => s.kind === "weather")).toBeUndefined();
  });

  it("puts the coat above everything except what goes in the bag", () => {
    const brief = buildTomorrow(
      base({
        profiles: [PARKER],
        routines: [MORNING],
        runs: [run([2026, 9, 24], 2), run([2026, 9, 17], 3), run([2026, 9, 10], 1)],
        weather: reading({ temperatureF: 30, feelsLikeF: 22 }),
      })
    );
    expect(brief?.signals.map((s) => s.kind)).toEqual(["school", "weather", "morning"]);
  });
});
