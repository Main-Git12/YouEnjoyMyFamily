import type { HouseholdMember, RoutineRun } from "../types";

/**
 * What the shifts actually came to, against what was agreed.
 *
 * This exists because of a specific, ordinary, awkward problem: a shift is
 * booked ten until twelve and keeps finishing early, and the only way to
 * know is for somebody to be standing there noticing — which is itself a
 * job, and lands on whoever is already carrying the most invisible work in
 * the house. Nobody wants to have that conversation from memory, and
 * "I feel like you've been leaving early" is a terrible way to start one.
 *
 * So the shift signs itself in and out, the arithmetic is written down, and
 * the record is open to everyone — the carer included. That last part is
 * deliberate. A timeclock everybody can read is fair; one person quietly
 * keeping score is not, and the same record that shows a short shift shows
 * a long one. It is a timesheet, which is an ordinary part of paid work.
 *
 * Two rules carry over from the rest of this codebase, and both matter more
 * here than anywhere else:
 *
 * The subject of every sentence is a *shift*. "Three of the last four
 * shifts finished before the hours agreed" is a fact about shifts. The app
 * does not get to say what kind of person that makes anybody.
 *
 * And it opens the question rather than answering it. A run of short shifts
 * has two honest readings — the hours aren't being worked, or the hours
 * were never right — and the app has no way to tell which. It says what it
 * counted and lets the family and the carer settle it.
 */

export interface ShiftRecord {
  date: string;
  /** When the shift was signed in and out. Null where it wasn't. */
  startedAt: Date | null;
  finishedAt: Date | null;
  /** The hours agreed for that day, from the rota. Null if none is set. */
  agreedMinutes: number | null;
  /** Null until the shift has been signed out — an open shift is not a short one. */
  recordedMinutes: number | null;
  /** Recorded minus agreed. Negative is short, positive is over. */
  differenceMinutes: number | null;
}

export interface ShiftLog {
  carer: HouseholdMember;
  records: ShiftRecord[];
  /** Shifts with both ends recorded. The only ones the totals can use. */
  countedShifts: number;
  agreedMinutes: number;
  recordedMinutes: number;
  /** The records this was worked out from, so it can be checked. */
  because: string;
  /** Opened, never answered. Null when there isn't enough to ask about. */
  question: string | null;
}

/**
 * Enough shifts to be worth mentioning. Two is an anecdote — the same
 * threshold the routine engine uses before it will call a duration learned.
 */
const ENOUGH_SHIFTS = 3;

/**
 * How short the average shift has to run before the arithmetic is worth
 * putting in front of anybody. Ten minutes either side of a two-hour
 * booking is a bus, a kettle, and a conversation on the way out.
 */
const WORTH_MENTIONING_MINUTES = 10;

const minutesOfClock = (clock: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
};

const agreedMinutesFor = (carer: HouseholdMember): number | null => {
  if (!carer.startsAt || !carer.endsAt) return null;
  const from = minutesOfClock(carer.startsAt);
  const to = minutesOfClock(carer.endsAt);
  if (from === null || to === null || to <= from) return null;
  return to - from;
};

const parse = (value: string | null): Date | null => {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** "1h 10m", "45m" — short enough to read on a wall at a glance. */
export function describeMinutes(minutes: number): string {
  const whole = Math.round(Math.abs(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * One carer's shifts over whatever runs were loaded, newest first.
 *
 * A shift that hasn't been signed out counts for nothing: it is open, not
 * short, and treating the two the same would put a fair worker in front of
 * an unfair number on the day the wi-fi dropped.
 */
export function readShiftLog(input: {
  carer: HouseholdMember;
  runs: RoutineRun[];
  /** Only days this carer is rostered for; another carer's shift isn't theirs. */
  today: string;
}): ShiftLog {
  const { carer, runs, today } = input;
  const agreed = agreedMinutesFor(carer);
  const onRota = new Set(carer.daysOfWeek ?? []);

  const records: ShiftRecord[] = runs
    .filter((run) => run.date < today)
    .filter((run) => {
      // Runs are stored per routine, not per carer, and one care routine is
      // shared across the rota on purpose (how long a shower takes is a fact
      // about the person being helped, not about who is helping). So a run
      // belongs to whoever was rostered that weekday.
      const [year, month, day] = run.date.split("-").map(Number);
      if (!year || !month || !day) return false;
      return onRota.has(new Date(year, month - 1, day).getDay());
    })
    .map((run) => {
      const startedAt = parse(run.startedAt);
      const finishedAt = parse(run.finishedAt);
      const recordedMinutes =
        startedAt && finishedAt ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 60000) : null;
      return {
        date: run.date,
        startedAt,
        finishedAt,
        agreedMinutes: agreed,
        recordedMinutes,
        differenceMinutes: recordedMinutes !== null && agreed !== null ? recordedMinutes - agreed : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const counted = records.filter((record) => record.differenceMinutes !== null);
  const recordedMinutes = counted.reduce((sum, record) => sum + (record.recordedMinutes ?? 0), 0);
  const agreedTotal = counted.reduce((sum, record) => sum + (record.agreedMinutes ?? 0), 0);

  // The shifts that weren't signed out are named whether or not any were,
  // because a timeclock nobody is using is the more useful thing to know
  // than a total of nothing — and it is the honest reason the number below
  // is small.
  const open = records.length - counted.length;
  const openPart = open > 0 ? `${open} shift${open === 1 ? "" : "s"} weren't signed out at both ends.` : "";
  const because = counted.length
    ? [`${counted.length} shift${counted.length === 1 ? "" : "s"} signed in and out.`, openPart]
        .filter(Boolean)
        .join(" ")
    : openPart || "No shifts signed in and out yet.";

  return {
    carer,
    records,
    countedShifts: counted.length,
    agreedMinutes: agreedTotal,
    recordedMinutes,
    because,
    question: askAbout(counted),
  };
}

/**
 * The question, if there is one.
 *
 * Both readings are offered because the app genuinely cannot tell them
 * apart, and the one it would reach for on its own — that somebody isn't
 * working their hours — is the one that costs a person their job if it is
 * wrong. A two-hour booking for ninety minutes of work is just as likely,
 * and is the family's mistake to fix.
 */
function askAbout(counted: ShiftRecord[]): string | null {
  if (counted.length < ENOUGH_SHIFTS) return null;

  const total = counted.reduce((sum, record) => sum + (record.differenceMinutes ?? 0), 0);
  const perShift = total / counted.length;
  if (Math.abs(perShift) < WORTH_MENTIONING_MINUTES) return null;

  const short = counted.filter((record) => (record.differenceMinutes ?? 0) < 0).length;
  const over = counted.filter((record) => (record.differenceMinutes ?? 0) > 0).length;

  if (perShift < 0) {
    return (
      `${short} of the last ${counted.length} shifts finished before the hours agreed, ` +
      `${describeMinutes(Math.abs(total))} short in all. ` +
      `Is it worth a word about the hours — or are the hours themselves wrong?`
    );
  }
  return (
    `${over} of the last ${counted.length} shifts ran past the hours agreed, ` +
    `${describeMinutes(total)} over in all. ` +
    `Is there more in the shift than the hours hold?`
  );
}
