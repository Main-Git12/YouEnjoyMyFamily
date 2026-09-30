/**
 * The family's *local* calendar date as `YYYY-MM-DD`.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first,
 * so anywhere west of UTC it rolls over to tomorrow in the evening — exactly
 * when someone asks "what's for dinner". At 9:30pm in Ohio, UTC is already
 * the next day, and the dashboard would show tomorrow's meals as today's.
 */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The next `count` local calendar dates, starting with today. */
export function localDaysFromToday(count: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(from);
    day.setDate(from.getDate() + i);
    days.push(toLocalIsoDate(day));
  }
  return days;
}

/**
 * A 7-day window, `offsetWeeks` weeks from today — 0 is the coming week,
 * 1 is the week after, -1 the one just gone. Anchored on today rather than
 * on a calendar Sunday, so "this week" always starts with today's meals
 * rather than burying them behind days that have already happened.
 */
export function weekFromOffset(offsetWeeks: number, from: Date = new Date()): string[] {
  const start = new Date(from);
  start.setDate(from.getDate() + offsetWeeks * 7);
  return localDaysFromToday(7, start);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Parsed as UTC deliberately. These strings are calendar dates, not moments:
 * `new Date("2026-09-25")` is already UTC midnight, but `new Date(2026, 8, 25)`
 * is local midnight, and mixing the two puts the two dates a few hours apart
 * and rounds the difference between them to the wrong number of days.
 */
function utcDays(isoDate: string): number | null {
  const [year, month, day] = isoDate.split("-");
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(stamp)) return null;
  return Math.round(stamp / 86_400_000);
}

/** How far into the past a day still has a name worth using rather than a date. */
const NAMEABLE_DAYS = 6;

/**
 * How a chore's due date should read on the list for `onDate`.
 *
 * Returns null on the day it is due: a chore on today's list is due today by
 * definition, and printing that on every row is the kind of noise that makes
 * a wall screen unreadable. What earns space is a date that has *gone* —
 * since one-offs now carry forward instead of vanishing (see the backend's
 * `appliesOn`), a chore on the list may be days old, and "was due Friday" is
 * the difference between a stale list and an honest one.
 *
 * The subject is the chore throughout. "Was due Friday" is a fact about the
 * job; who didn't do it is not the screen's business.
 */
export function describeDueDate(dueDate: string | null, onDate: string): string | null {
  if (!dueDate) return null;
  const due = utcDays(dueDate);
  const on = utcDays(onDate);
  if (due === null || on === null) return null;

  const daysLate = on - due;
  if (daysLate === 0) return null;
  if (daysLate === 1) return "was due yesterday";
  if (daysLate > 1 && daysLate <= NAMEABLE_DAYS) return `was due ${weekdayName(dueDate)}`;
  if (daysLate > NAMEABLE_DAYS) return `was due ${shortDate(dueDate)}`;
  if (daysLate === -1) return "due tomorrow";
  if (daysLate >= -NAMEABLE_DAYS) return `due ${weekdayName(dueDate)}`;
  return `due ${shortDate(dueDate)}`;
}

function weekdayName(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  const index = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return WEEKDAY_NAMES[index] ?? isoDate;
}

function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  if (!name || !day || !year) return isoDate;
  return `${Number(day)} ${name}`;
}
