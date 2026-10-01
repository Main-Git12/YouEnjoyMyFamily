import type { HouseholdMember, ScheduleEntry, StatedPreference } from "../types";
import { eatsIntoTheEvening } from "./eveningRoom";
import { weekdayOf } from "./routines";

/**
 * The evenings with nothing in them, and the things this family has said
 * they like doing.
 *
 * Everything else in this app is about load: what has to happen, by when,
 * and whether there is room for it. None of it ever says the other thing a
 * planner on a kitchen wall is well placed to say — that Thursday is empty.
 * A family can be perfectly organised and still never notice the free
 * evening, because nothing on the screen is shaped to point at one.
 *
 * The rule the rest of the codebase keeps applies here hardest, because this
 * is where an app is most tempted to start inventing. Nothing is suggested
 * that somebody has not said out loud: the only source is the stated
 * preferences — the entity that exists precisely to hold what a family
 * member explicitly *said*, never what the app inferred from their
 * behaviour. There is no activity database, no recommender, and no "families
 * like yours". If nobody has said they like anything, this says nothing.
 *
 * And it never decides. It names an empty evening and what somebody once
 * said, and stops there. Which of those two facts is worth anything on a
 * given Thursday is not something a screen can know.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface FreeEvening {
  date: string;
  weekdayLabel: string;
}

/**
 * Which of these dates have nothing on them between the end of school and
 * the end of the evening. Today is included — an empty evening is most
 * useful on the day it is empty.
 */
export function freeEvenings(schedule: ScheduleEntry[], dates: string[], today: string): FreeEvening[] {
  const spokenFor = new Set(schedule.filter(eatsIntoTheEvening).map((entry) => entry.date));
  return dates
    .filter((date) => date >= today && !spokenFor.has(date))
    .map((date) => ({ date, weekdayLabel: DAY_NAMES[weekdayOf(date)] ?? "" }));
}

export interface SomethingTogether {
  date: string;
  weekdayLabel: string;
  /** What somebody said, in their words. Never reworded, never invented. */
  statement: string;
  /** Who said it — attribution, so a parent can ask them rather than guess. */
  saidBy: string;
  because: string;
}

/**
 * The first free evening, paired with something somebody said they like.
 *
 * One, not a list. A wall screen that offers five ideas is a screen nobody
 * reads, and the point is not to fill the evening — it is to notice that
 * there is one.
 *
 * Children's preferences are preferred when there are any, because an empty
 * evening is the scarcer thing in a child's week than in an adult's, and
 * because a seven-year-old is far less likely to be the one who says out
 * loud that they would like to do something. That is the only place `role`
 * is read here, and it changes which statement is offered, never whose
 * evening it is.
 */
export function somethingTogether(
  schedule: ScheduleEntry[],
  dates: string[],
  today: string,
  preferences: StatedPreference[],
  members: HouseholdMember[] = []
): SomethingTogether | null {
  const [evening] = freeEvenings(schedule, dates, today);
  if (!evening) return null;

  const activities = preferences.filter(
    (preference) => preference.category === "activity" && preference.statement.trim()
  );
  if (activities.length === 0) return null;

  const childNames = new Set(
    members.filter((member) => member.role === "child").map((member) => member.displayName)
  );
  const fromAChild = activities.filter((preference) => childNames.has(preference.memberId));
  const pool = fromAChild.length > 0 ? fromAChild : activities;

  // Picked by the date rather than at random, so the same empty Thursday
  // does not offer a different thing every time the screen refreshes — a
  // suggestion that reshuffles itself every thirty seconds reads as noise.
  const index = Number(evening.date.replace(/-/g, "")) % pool.length;
  const chosen = pool[index] ?? pool[0];
  if (!chosen) return null;

  return {
    date: evening.date,
    weekdayLabel: evening.weekdayLabel,
    statement: chosen.statement.trim(),
    saidBy: chosen.memberId,
    // Provenance, not a quotation claim: these are typed in by whoever is at
    // the screen, often in the third person ("wants to do more drawing"), so
    // "Parker said this" reads oddly against half of them while promising
    // more than the record supports.
    because: `From ${chosen.memberId}'s list of things they've said they like.`,
  };
}
