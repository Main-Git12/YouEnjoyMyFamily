import type { SchoolMenu, SchoolMenuDay, SchoolProfile, SchoolSpecial } from "../types";
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
export function schoolDayNotes(profiles: SchoolProfile[], now: Date = new Date()): SchoolDayNote[] {
  const { horizon, date } = horizonFor(now);
  return specialsOn(profiles, date)
    .map((entry) => ({ ...entry, horizon }))
    // The ones with something to bring first: a day that needs nothing is
    // worth a glance, and a day that needs the library book is worth acting on.
    .sort((a, b) => Number(Boolean(b.prepNote)) - Number(Boolean(a.prepNote)));
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

/** Just the ones that actually ask for something. */
export const packingNotes = (profiles: SchoolProfile[], now: Date = new Date()): SchoolDayNote[] =>
  schoolDayNotes(profiles, now).filter((note) => note.prepNote !== null);

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
