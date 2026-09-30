import type { SchoolMenu, SchoolMenuDay, SchoolPrep, SchoolProfile, SchoolSpecial } from "../types";
import { toLocalIsoDate } from "./dates";
import { weekdayOf } from "./routines";
import { WINDOW_CLOSES_AT_MINUTE, minutesIntoDay } from "./timeOfDay";

/**
 * The school day, read off the sheet the school sent home.
 *
 * A specials rotation is mostly inert information. Knowing Friday is Music
 * changes nothing anybody does. What earns a place on a kitchen wall is the
 * small print under two or three of the days — gym shoes, a charged laptop,
 * the library book that has to go back — because each of those is a job for
 * *the night before*, and the cost of missing one is paid at 07:40 by
 * everybody in the house.
 *
 * So the question this module answers is not "what is on today" but "what
 * has to be in a bag before this is a problem", and which day that is
 * depends on what time it is now.
 *
 * The rules the rest of the app is held to apply here unchanged. The
 * subject of every line below is a *day* or a *subject* — "Thursday is
 * Library, the book goes back" — never the child carrying the bag. And
 * every line carries a `because` naming where it came from: a parent should
 * be able to check this against the paper on the fridge rather than take
 * the screen's word for it.
 */

/**
 * When the evening takes over and the question becomes tomorrow's.
 *
 * Deliberately the same boundary the rest of the app already uses for the
 * end of the after-school window, rather than a second cutoff invented
 * here — a house has one evening, not one per feature.
 */
const EVENING_BEGINS_AT_MINUTE = WINDOW_CLOSES_AT_MINUTE.after_school ?? 17 * 60;

export type Horizon = "today" | "tomorrow";

/** Which school day is the one worth preparing for, given the time now. */
export function horizonFor(now: Date = new Date()): { horizon: Horizon; date: string } {
  if (minutesIntoDay(now) < EVENING_BEGINS_AT_MINUTE) {
    return { horizon: "today", date: toLocalIsoDate(now) };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return { horizon: "tomorrow", date: toLocalIsoDate(tomorrow) };
}

/** The rotation entry for one date, or null if that weekday has none. */
export function specialOn(profile: SchoolProfile, isoDate: string): SchoolSpecial | null {
  const weekday = weekdayOf(isoDate);
  return profile.specials.find((special) => special.dayOfWeek === weekday) ?? null;
}

/** One child's specials on one date, with where it came from. */
export interface SchoolCalendarEntry {
  memberId: string;
  schoolName: string;
  date: string;
  subject: string;
  /** Null for a day whose subject needs nothing brought. */
  prepNote: string | null;
  because: string;
}

export interface SchoolDayNote extends SchoolCalendarEntry {
  horizon: Horizon;
  /**
   * When somebody said this was done, or null.
   *
   * Null means *not ticked off*, and that is the only thing it is allowed to
   * mean. The app cannot see inside a schoolbag: the book may well be in
   * there. Every line built on this says "not ticked off", never "forgotten"
   * — the same discipline the awareness engine keeps when it reports what
   * co-occurred and refuses to say why.
   */
  packedAt: string | null;
}

const sheetSource = (profile: SchoolProfile): string =>
  profile.teacher
    ? `From ${profile.teacher}'s specials schedule for ${profile.schoolName}.`
    : `From the specials schedule for ${profile.schoolName}.`;

/**
 * What each child's next school day is, and what it needs brought.
 *
 * Nothing is looked further ahead than tomorrow. On a Friday evening this
 * is empty, which is correct — Monday's gym shoes are not a Friday-night
 * problem, and putting them on screen for the whole weekend is how a screen
 * teaches people to stop reading it.
 */
export function schoolDayNotes(
  profiles: SchoolProfile[],
  now: Date = new Date(),
  prep: SchoolPrep[] = []
): SchoolDayNote[] {
  const { horizon, date } = horizonFor(now);
  const packed = new Map(prep.map((row) => [`${row.date}:${row.memberId}`, row.packedAt]));
  return specialsOn(profiles, date)
    .map((entry) => ({ ...entry, horizon, packedAt: packed.get(`${date}:${entry.memberId}`) ?? null }))
    // Still open first, then anything else that asks for something, then the
    // days that need nothing. A ticked-off Thursday has stopped being a job
    // and should not sit above an untouched one.
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * Every child's specials on one given date, for the calendar.
 *
 * The rotation is deliberately *not* written out as a hundred and eighty
 * calendar rows. It is a rule — "Thursday is Library" — and storing it as
 * events would mean a year of rows to rewrite the day the school changes
 * the rotation, plus a year of rows that disagree with the sheet on the
 * fridge until somebody does. Merging it in here keeps one source of truth,
 * and the calendar marks these as the school's rather than the family's so
 * nobody goes looking for the entry they think they typed.
 */
export function specialsOn(profiles: SchoolProfile[], isoDate: string): SchoolCalendarEntry[] {
  const entries: SchoolCalendarEntry[] = [];
  for (const profile of profiles) {
    const special = specialOn(profile, isoDate);
    if (!special) continue;
    entries.push({
      memberId: profile.memberId,
      schoolName: profile.schoolName,
      date: isoDate,
      subject: special.subject,
      prepNote: special.prepNote,
      because: sheetSource(profile),
    });
  }
  return entries;
}

/**
 * Where a note sits in the list: still open, done, or nothing to do.
 * Written as a function of the note rather than a chain of comparators so
 * the ordering can be read in one line.
 */
const rank = (note: SchoolDayNote): number => {
  if (note.prepNote === null) return 2;
  return note.packedAt === null ? 0 : 1;
};

/**
 * What a tick records.
 *
 * `date` is the day the note is *for*, which in the evening is tomorrow —
 * never the day the button happened to be pressed. Getting that backwards
 * would mean the bag is packed on Wednesday night and Thursday morning still
 * says it was never ticked, which is precisely the nagging this feature
 * exists to stop. It is a named function rather than four inline arguments
 * so that rule has somewhere to be tested.
 */
export const prepRecordFor = (note: SchoolDayNote): { memberId: string; date: string; subject: string; note: string | null } => ({
  memberId: note.memberId,
  date: note.date,
  subject: note.subject,
  note: note.prepNote,
});

/** A note that asks for something and has not been ticked off. */
export const isStillOpen = (note: SchoolDayNote): boolean =>
  note.prepNote !== null && note.packedAt === null;

/** Just the ones that actually ask for something, ticked or not. */
export const packingNotes = (
  profiles: SchoolProfile[],
  now: Date = new Date(),
  prep: SchoolPrep[] = []
): SchoolDayNote[] => schoolDayNotes(profiles, now, prep).filter((note) => note.prepNote !== null);

/**
 * What is still outstanding while there is time left to do something.
 *
 * The evening prompt is the useful one, but it is not the last one. If
 * nobody ticked the library book off last night, the fact is worth
 * something at ten to seven this morning and worth nothing at all at nine —
 * so this answers only before the morning window closes, and only about
 * today. That is the same rule the routine planner works to: a plan is
 * built backwards from the moment it stops being actionable.
 *
 * It returns notes, not accusations. The caller may say "not ticked off".
 * It may not say "forgotten", because nothing here knows that.
 */
export function stillOpenThisMorning(
  profiles: SchoolProfile[],
  now: Date = new Date(),
  prep: SchoolPrep[] = []
): SchoolDayNote[] {
  const closesAt = WINDOW_CLOSES_AT_MINUTE.morning;
  if (closesAt === null || minutesIntoDay(now) >= closesAt) return [];
  const notes = schoolDayNotes(profiles, now, prep);
  // The `horizon` half is belt-and-braces rather than load-bearing: with the
  // app's current windows — morning closes at 09:00, the evening begins at
  // 17:00 — anything this side of the cutoff above is already "today", so
  // that test can never fail. It is kept because it is the condition
  // actually meant (an unpacked *tomorrow* is not outstanding, it is just
  // not done yet), and the invariant it leans on is asserted in
  // schoolDay.test.ts. If those windows ever move, that test says so instead
  // of this silently starting to matter.
  return notes.filter((note) => note.horizon === "today" && isStillOpen(note));
}

/** The published menu for one date, or null when the school published none. */
export function lunchOn(menu: SchoolMenu | null | undefined, isoDate: string): SchoolMenuDay | null {
  return menu?.days.find((day) => day.date === isoDate) ?? null;
}

/**
 * Where a menu came from, and how old it is.
 *
 * `stale` means the app could not reach the provider and is showing the last
 * copy it has. That is usually fine — a menu published a month ahead does
 * not change often — but it is not the same as fresh, and a screen that
 * cannot tell the difference will one day show last month's Tuesday with
 * total confidence.
 */
export function menuSource(menu: SchoolMenu | null | undefined, now: Date = new Date()): string | null {
  if (!menu) return null;
  const base = `${menu.schoolName}'s published lunch menu`;
  if (!menu.fetchedAt) return `${base} — couldn't be loaded.`;
  if (!menu.stale) return `${base}.`;

  const hours = Math.floor((now.getTime() - Date.parse(menu.fetchedAt)) / 3_600_000);
  if (hours < 1) return `${base}, from a copy saved a few minutes ago.`;
  if (hours < 48) return `${base}, from a copy saved ${hours} ${hours === 1 ? "hour" : "hours"} ago.`;
  const days = Math.floor(hours / 24);
  return `${base}, from a copy saved ${days} days ago.`;
}
