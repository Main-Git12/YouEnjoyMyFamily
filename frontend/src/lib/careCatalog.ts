import type { HouseholdMember } from "../types";

/**
 * The shape of a care shift, offered rather than imposed.
 *
 * Typing eleven steps into a phone is how a good idea dies on the first
 * evening, so the steps a household has actually named are here to tap.
 * Nothing in this file is applied on its own: the family picks, and the
 * minutes below are seeds that the first two finished runs replace with
 * the measured median (see lib/routinePlan.ts). Every one is marked as an
 * estimate on screen until that happens.
 *
 * The order is the order these things have to happen in — you cannot lay
 * clothes out after the shower you laid them out for — not a ranking of
 * importance.
 *
 * Every title is the name of a task. None of them says anything about the
 * person the task is for. That rule is strictest here: this routine is
 * about an older adult and is read off a wall by a paid worker, and the
 * difference between "Shower" and anything describing how she managed it
 * is the difference between a plan and a file on somebody.
 */
export interface CareStepSuggestion {
  title: string;
  /** A seed, replaced by the measured median after two finished runs. */
  targetMinutes: number;
  /** Why it sits where it does, for the person setting the shift up. */
  note?: string;
  /**
   * Set when a step needs two usable hands. A carer working one-handed can
   * hand these over without the step — or its learned duration — being lost.
   */
  needsTwoHands?: boolean;
}

export interface CareStepGroup {
  heading: string;
  blurb: string;
  steps: CareStepSuggestion[];
}

export const CARE_CATALOG: CareStepGroup[] = [
  {
    heading: "Getting the day started",
    blurb: "The first hour, in the order it has to happen.",
    steps: [
      { title: "Coffee", targetMinutes: 5 },
      { title: "Breakfast", targetMinutes: 20, needsTwoHands: true },
      { title: "Medication", targetMinutes: 5, note: "Only if the family has asked for it to be on the list." },
      { title: "Lay out clothes for after the shower", targetMinutes: 5, note: "Before the shower, so it isn't a wait in a towel." },
      { title: "Shower", targetMinutes: 30 },
      { title: "Hygiene and hair", targetMinutes: 15 },
    ],
  },
  {
    heading: "Out of the house",
    blurb: "The part of the day that doesn't happen unless it's written down.",
    steps: [
      { title: "A walk", targetMinutes: 25, note: "Worth its own line — it is the step that gets dropped when a shift runs late." },
      { title: "Appointment", targetMinutes: 60, note: "Add it on the days there is one." },
      { title: "Sit outside", targetMinutes: 20 },
    ],
  },
  {
    heading: "Keeping on top of things",
    blurb: "The quiet half. Nobody notices it until it stops.",
    steps: [
      { title: "Laundry on", targetMinutes: 10 },
      { title: "Laundry folded and away", targetMinutes: 20, needsTwoHands: true },
      { title: "Put the dishes away", targetMinutes: 10, needsTwoHands: true },
      { title: "Tidy the kitchen", targetMinutes: 15 },
      { title: "Change the bed", targetMinutes: 20, needsTwoHands: true },
    ],
  },
  {
    heading: "Later in the shift",
    blurb: "What the end of the shift is for.",
    steps: [
      { title: "Lunch", targetMinutes: 30, needsTwoHands: true },
      { title: "Something to do together", targetMinutes: 30, note: "Cards, a programme, the garden — whatever it is that day." },
      { title: "Write down how it went", targetMinutes: 5, note: "For the family, so nobody has to ask at handover." },
    ],
  },
];

/** Every suggestion, flattened — for lookups by title. */
export const ALL_CARE_STEPS: CareStepSuggestion[] = CARE_CATALOG.flatMap((group) => group.steps);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A carer's rota in a line: "Mon, Fri · 10:00–12:00".
 *
 * Returns null for anyone who lives here, because a rota is a thing you
 * agree with somebody who comes in, and printing "every day, all day"
 * against a member of the family would be both true and insulting.
 */
export function describeRota(member: HouseholdMember): string | null {
  if (member.role !== "carer") return null;

  const days = (member.daysOfWeek ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b)
    .map((day) => DAY_NAMES[day])
    .filter(Boolean);

  const hours = member.startsAt && member.endsAt ? `${member.startsAt}–${member.endsAt}` : member.startsAt ?? null;

  if (days.length === 0 && !hours) return null;
  if (days.length === 0) return hours;
  if (!hours) return days.join(", ");
  return `${days.join(", ")} · ${hours}`;
}
