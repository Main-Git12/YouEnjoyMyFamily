import { describe, expect, it } from "vitest";
import {
  horizonFor,
  isStillOpen,
  lunchOn,
  menuSource,
  packingNotes,
  prepRecordFor,
  schoolDayNotes,
  specialOn,
  stillOpenThisMorning,
} from "./schoolDay";
import type { SchoolMenu, SchoolProfile } from "../types";
import { WINDOW_CLOSES_AT_MINUTE } from "./timeOfDay";

/** Miss Hineline's sheet, word for word off the paper on the fridge. */
const PARKER: SchoolProfile = {
  memberId: "Parker",
  schoolName: "Violet Elementary",
  teacher: "Miss Hineline",
  gradeLabel: null,
  specials: [
    { dayOfWeek: 1, subject: "Art", prepNote: null },
    {
      dayOfWeek: 2,
      subject: "Gym",
      prepNote: "Have students wear closed toed shoes or bring in a pair to change into.",
    },
    { dayOfWeek: 3, subject: "Technology", prepNote: "Make sure computers are fulled charged." },
    { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
    { dayOfWeek: 5, subject: "Music", prepNote: null },
  ],
  menuSource: { provider: "myschoolmenus", organizationId: 2230, siteId: 13754, menuId: 117559 },
};

// 2026-09-30 is a Wednesday; 2026-10-01 a Thursday; 2026-10-02 a Friday.
const at = (isoDate: string, hour: number, minute = 0): Date =>
  new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)), hour, minute);

describe("which day is the one to prepare for", () => {
  it("is today during the day", () => {
    expect(horizonFor(at("2026-09-30", 7, 30))).toEqual({ horizon: "today", date: "2026-09-30" });
    expect(horizonFor(at("2026-09-30", 16, 59))).toEqual({ horizon: "today", date: "2026-09-30" });
  });

  it("becomes tomorrow once the after-school window has closed", () => {
    expect(horizonFor(at("2026-09-30", 17, 0))).toEqual({ horizon: "tomorrow", date: "2026-10-01" });
    expect(horizonFor(at("2026-09-30", 21, 15))).toEqual({ horizon: "tomorrow", date: "2026-10-01" });
  });

  it("rolls the month over correctly in the evening", () => {
    expect(horizonFor(at("2026-09-30", 20, 0)).date).toBe("2026-10-01");
  });
});

describe("the specials rotation", () => {
  it("reads the right subject off the sheet for a given date", () => {
    expect(specialOn(PARKER, "2026-09-30")?.subject).toBe("Technology");
    expect(specialOn(PARKER, "2026-10-01")?.subject).toBe("Library");
    expect(specialOn(PARKER, "2026-10-02")?.subject).toBe("Music");
  });

  it("has nothing to say about a Saturday", () => {
    expect(specialOn(PARKER, "2026-10-03")).toBeNull();
  });
});

/**
 * The point of the whole module. At half eight on a Wednesday evening the
 * useful sentence is about Thursday, because that is when the library book
 * can still be found.
 */
describe("what has to be in the bag", () => {
  it("is tomorrow's on a school night", () => {
    const notes = packingNotes([PARKER], at("2026-09-30", 20, 30));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.horizon).toBe("tomorrow");
    expect(notes[0]?.date).toBe("2026-10-01");
    expect(notes[0]?.subject).toBe("Library");
    expect(notes[0]?.prepNote).toBe("Have your student bring in their library book to return.");
  });

  it("is today's in the morning, while there is still time to act on it", () => {
    const notes = packingNotes([PARKER], at("2026-09-30", 6, 45));
    expect(notes[0]?.horizon).toBe("today");
    expect(notes[0]?.subject).toBe("Technology");
  });

  it("says nothing on a Friday evening, because Monday is not a Friday-night problem", () => {
    expect(packingNotes([PARKER], at("2026-10-02", 19, 0))).toEqual([]);
  });

  it("says nothing on a Sunday morning", () => {
    expect(packingNotes([PARKER], at("2026-10-04", 9, 0))).toEqual([]);
  });

  it("does look ahead to Monday on a Sunday evening", () => {
    const notes = schoolDayNotes([PARKER], at("2026-10-04", 19, 0));
    expect(notes[0]?.subject).toBe("Art");
    expect(notes[0]?.prepNote).toBeNull();
  });

  it("puts the days that need something ahead of the days that don't", () => {
    const sibling: SchoolProfile = { ...PARKER, memberId: "Rowan", specials: [{ dayOfWeek: 4, subject: "Art", prepNote: null }] };
    const notes = schoolDayNotes([sibling, PARKER], at("2026-09-30", 20, 0));
    expect(notes.map((n) => n.memberId)).toEqual(["Parker", "Rowan"]);
  });

  it("keeps the school's own wording, typos and all", () => {
    const notes = packingNotes([PARKER], at("2026-09-29", 20, 0));
    expect(notes[0]?.prepNote).toBe("Make sure computers are fulled charged.");
  });

  it("names the sheet it came from so a parent can check it", () => {
    const notes = packingNotes([PARKER], at("2026-09-30", 20, 0));
    expect(notes[0]?.because).toBe("From Miss Hineline's specials schedule for Violet Elementary.");
    const noTeacher = packingNotes([{ ...PARKER, teacher: null }], at("2026-09-30", 20, 0));
    expect(noTeacher[0]?.because).toBe("From the specials schedule for Violet Elementary.");
  });
});

/**
 * The same rule the insights engine is held to: the subject of a line is a
 * day or a subject, never the child. A screen on a kitchen wall does not get
 * to characterise a six-year-old where he can read it.
 */
describe("what it will not say", () => {
  const BANNED = [
    /\bkeeps? (forgetting|leaving)\b/i,
    /\balways\b/i,
    /\bnever remembers\b/i,
    /\bbad at\b/i,
    /\bstruggles?\b/i,
    /\bneeds to (try|do) better\b/i,
  ];

  it("never characterises the child in any line it produces", () => {
    const hours = [6, 7, 12, 17, 20, 22];
    const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
    const lines: string[] = [];
    for (const date of dates) {
      for (const hour of hours) {
        for (const note of schoolDayNotes([PARKER], at(date, hour))) {
          lines.push(note.subject, note.prepNote ?? "", note.because);
        }
      }
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const banned of BANNED) expect(line).not.toMatch(banned);
    }
  });
});

describe("the lunch menu", () => {
  const menu: SchoolMenu = {
    memberId: "Parker",
    schoolName: "Violet Elementary",
    menuId: 117559,
    days: [
      { date: "2026-10-01", groups: [{ heading: "Lunch Entree", items: ["Walking Taco"] }] },
      { date: "2026-10-02", groups: [{ heading: "Lunch Entree", items: ["Breaded Chicken Patty w/ Bun"] }] },
    ],
    stale: false,
    fetchedAt: "2026-10-01T06:00:00.000Z",
    missingMonths: [],
  };

  it("finds the day, and says nothing for a day the school was closed", () => {
    expect(lunchOn(menu, "2026-10-02")?.groups[0]?.items).toEqual(["Breaded Chicken Patty w/ Bun"]);
    expect(lunchOn(menu, "2026-10-09")).toBeNull();
    expect(lunchOn(null, "2026-10-02")).toBeNull();
  });

  it("says plainly when it is showing a saved copy rather than a fresh one", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(menuSource(menu, now)).toBe("Violet Elementary's published lunch menu.");
    expect(menuSource({ ...menu, stale: true }, now)).toBe(
      "Violet Elementary's published lunch menu, from a copy saved 6 hours ago."
    );
    expect(menuSource({ ...menu, stale: true, fetchedAt: "2026-09-27T12:00:00.000Z" }, now)).toBe(
      "Violet Elementary's published lunch menu, from a copy saved 4 days ago."
    );
    expect(menuSource({ ...menu, stale: true, fetchedAt: null }, now)).toBe(
      "Violet Elementary's published lunch menu — couldn't be loaded."
    );
    expect(menuSource(null, now)).toBeNull();
  });
});

describe("what has been ticked off", () => {
  const packed = (date: string, memberId = "Parker") => ({
    memberId,
    date,
    subject: "Library",
    note: "Have your student bring in their library book to return.",
    packedAt: `${date}T06:40:00.000Z`,
  });

  it("marks a note as ticked when there is a record for that child on that day", () => {
    const notes = schoolDayNotes([PARKER], at("2026-09-30", 20), [packed("2026-10-01")]);
    expect(notes[0]?.packedAt).toBe("2026-10-01T06:40:00.000Z");
    expect(isStillOpen(notes[0]!)).toBe(false);
  });

  it("does not credit one child's tick to another, or one day's to the next", () => {
    const wrongChild = schoolDayNotes([PARKER], at("2026-09-30", 20), [packed("2026-10-01", "Rowan")]);
    expect(wrongChild[0]?.packedAt).toBeNull();
    const wrongDay = schoolDayNotes([PARKER], at("2026-09-30", 20), [packed("2026-09-30")]);
    expect(wrongDay[0]?.packedAt).toBeNull();
  });

  it("puts what is still open above what is already done", () => {
    const sibling: SchoolProfile = {
      ...PARKER,
      memberId: "Rowan",
      specials: [{ dayOfWeek: 4, subject: "Gym", prepNote: "Closed toed shoes." }],
    };
    const notes = schoolDayNotes([PARKER, sibling], at("2026-09-30", 20), [packed("2026-10-01")]);
    expect(notes.map((n) => n.memberId)).toEqual(["Rowan", "Parker"]);
  });

  it("puts a day that needs nothing last, ticked or not", () => {
    const quiet: SchoolProfile = {
      ...PARKER,
      memberId: "Rowan",
      specials: [{ dayOfWeek: 4, subject: "Music", prepNote: null }],
    };
    const notes = schoolDayNotes([quiet, PARKER], at("2026-09-30", 20), [packed("2026-10-01")]);
    expect(notes.map((n) => n.memberId)).toEqual(["Parker", "Rowan"]);
  });
});

/**
 * The evening prompt is the useful one, but it is not the last one. An
 * unticked library book is worth something at ten to seven and worth
 * nothing at nine.
 */
describe("what is still open while there is time to do something", () => {
  it("raises today's unticked note in the morning", () => {
    const open = stillOpenThisMorning([PARKER], at("2026-10-01", 6, 50), []);
    expect(open.map((n) => n.subject)).toEqual(["Library"]);
  });

  it("says nothing once the morning window has closed", () => {
    expect(stillOpenThisMorning([PARKER], at("2026-10-01", 9, 0), [])).toEqual([]);
    expect(stillOpenThisMorning([PARKER], at("2026-10-01", 14, 0), [])).toEqual([]);
  });

  it("says nothing about a note that was ticked off", () => {
    const prep = [
      {
        memberId: "Parker",
        date: "2026-10-01",
        subject: "Library",
        note: null,
        packedAt: "2026-09-30T20:12:00.000Z",
      },
    ];
    expect(stillOpenThisMorning([PARKER], at("2026-10-01", 6, 50), prep)).toEqual([]);
  });

  it("says nothing in the evening, when the horizon is already tomorrow", () => {
    // Tomorrow not being packed yet is not outstanding — it is simply not
    // done yet, and the panel is already asking for it.
    expect(stillOpenThisMorning([PARKER], at("2026-09-30", 20), [])).toEqual([]);
  });

  it("says nothing about a day whose subject needs nothing brought", () => {
    // Monday is Art, and Art asks for nothing.
    expect(stillOpenThisMorning([PARKER], at("2026-10-05", 6, 50), [])).toEqual([]);
  });

  it("says nothing at the weekend", () => {
    expect(stillOpenThisMorning([PARKER], at("2026-10-03", 7, 30), [])).toEqual([]);
  });

  /**
   * `stillOpenThisMorning` also filters on `horizon === "today"`, which
   * today can never be false: the morning window closes at 09:00 and the
   * evening does not begin until 17:00, so everything before the cutoff is
   * already "today". A mutation removing that filter passes every test above,
   * and rather than write a test that cannot fail, this asserts the invariant
   * the redundancy rests on. If the windows move so that the morning window
   * outlasts the afternoon, this fails and that filter starts earning its
   * place.
   */
  it("the morning window closes before the evening begins", () => {
    expect(WINDOW_CLOSES_AT_MINUTE.morning).not.toBeNull();
    expect(WINDOW_CLOSES_AT_MINUTE.morning as number).toBeLessThan(
      WINDOW_CLOSES_AT_MINUTE.after_school as number
    );
  });
});

/**
 * The rule that decides whether the whole feature helps or nags: a tick is
 * filed against the day the note is *for*. In the evening that is tomorrow.
 * Filing it against the day the button was pressed would mean the bag gets
 * packed on Wednesday night and Thursday morning still reports it untouched.
 */
describe("what a tick records", () => {
  it("files an evening tick against tomorrow, not against tonight", () => {
    const note = schoolDayNotes([PARKER], at("2026-09-30", 20, 30))[0]!;
    expect(prepRecordFor(note)).toEqual({
      memberId: "Parker",
      date: "2026-10-01",
      subject: "Library",
      note: "Have your student bring in their library book to return.",
    });
    expect(prepRecordFor(note).date).not.toBe("2026-09-30");
  });

  it("files a morning tick against today", () => {
    const note = schoolDayNotes([PARKER], at("2026-10-01", 6, 50))[0]!;
    expect(prepRecordFor(note).date).toBe("2026-10-01");
  });

  it("carries the school's own wording onto the record", () => {
    const note = schoolDayNotes([PARKER], at("2026-09-29", 20))[0]!;
    expect(prepRecordFor(note).note).toBe("Make sure computers are fulled charged.");
  });
});
