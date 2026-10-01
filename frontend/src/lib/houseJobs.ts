import type { HouseholdJob, HouseholdMember, JobKind } from "../types";

/**
 * The running of the house, written down.
 *
 * The most useful thing known about household labour is that the heavy half
 * is not the doing, it is the noticing and arranging — realising the
 * prescription is nearly out, that the form is due Friday, that somebody has
 * to be at the school at two. It is invisible precisely because it leaves no
 * trace when it goes right, and it is undercounted by everyone, including by
 * the person carrying it. Asked who does more, almost everybody honestly
 * answers "me", because people notice what they do and cannot see what they
 * don't.
 *
 * An app on a kitchen wall cannot measure that. Nobody logs in, so it cannot
 * tell who typed what, and a number invented for something this charged
 * would be worse than saying nothing. What it can do is the thing that
 * actually helps: put the whole list where everyone can see it, name the
 * jobs nobody has taken, and let the family decide rather than default.
 *
 * So nothing in this file infers anything. Every job is one somebody typed
 * in, every owner is one somebody chose, and the app's whole contribution is
 * to keep the list visible and to count it out loud.
 */

export interface JobSuggestion {
  title: string;
  kind: JobKind;
  /** Why it is on the list, shown when the family is picking. */
  note?: string;
}

export interface JobGroup {
  heading: string;
  blurb: string;
  jobs: JobSuggestion[];
}

/**
 * A starting list, not a prescription. Deliberately heavier on "arranging"
 * than any household would write unprompted — that asymmetry is the point.
 * Asked to list the jobs, people reliably produce the visible ones and stop,
 * and the half that goes missing is the half that costs the most.
 */
export const JOB_CATALOG: JobGroup[] = [
  {
    heading: "Noticing and remembering",
    blurb: "The work nobody sees until it doesn't happen. Usually the longest list, and usually the one nobody has written down.",
    jobs: [
      { title: "Noticing when we're running out of something", kind: "arranging" },
      { title: "Knowing what still fits and what's been outgrown", kind: "arranging" },
      { title: "Remembering birthdays, and sorting the present", kind: "arranging" },
      { title: "Keeping an eye on the school emails", kind: "arranging" },
      { title: "Remembering what's due back at school and when", kind: "arranging", note: "Library books, forms, reading records." },
      { title: "Knowing where things live", kind: "arranging" },
      { title: "Replying to invitations", kind: "arranging" },
    ],
  },
  {
    heading: "Booking and arranging",
    blurb: "Phone calls and forms. Each one is twenty minutes nobody counts.",
    jobs: [
      { title: "Booking the doctor, dentist and optician", kind: "arranging" },
      { title: "Prescriptions and repeat refills", kind: "arranging" },
      { title: "Arranging cover when school is shut", kind: "arranging" },
      { title: "Sorting lifts to clubs and parties", kind: "arranging" },
      { title: "Keeping the calendar straight", kind: "arranging" },
      { title: "Insurance, renewals and anything with a deadline", kind: "arranging" },
    ],
  },
  {
    heading: "Food",
    blurb: "Planning it is a separate job from cooking it, and they are often not the same person.",
    jobs: [
      { title: "Deciding what we're eating this week", kind: "arranging" },
      { title: "The food shop", kind: "doing" },
      { title: "Cooking on weeknights", kind: "doing" },
      { title: "Cooking at the weekend", kind: "doing" },
      { title: "Packed lunches", kind: "doing" },
      { title: "Keeping track of what everyone will actually eat", kind: "arranging" },
    ],
  },
  {
    heading: "The house itself",
    blurb: "The visible half. Worth listing anyway — it's half the picture.",
    jobs: [
      { title: "Laundry, start to folded", kind: "doing" },
      { title: "Bins and recycling", kind: "doing" },
      { title: "Dishes and the kitchen at night", kind: "doing" },
      { title: "Bathrooms", kind: "doing" },
      { title: "The yard", kind: "doing" },
      { title: "Fixing what breaks, or finding who can", kind: "arranging" },
    ],
  },
  {
    heading: "Looking after each other",
    blurb:
      "Written both ways round on purpose. In a house with three generations, help runs in both directions, and it is rarely the same person giving it as the one everybody assumes.",
    jobs: [
      { title: "The school run", kind: "doing" },
      { title: "Being there after school", kind: "doing" },
      { title: "Bedtime", kind: "doing" },
      { title: "Driving to appointments", kind: "doing" },
      { title: "Keeping track of someone's medical history", kind: "arranging" },
      { title: "Sitting in on appointments and remembering what was said", kind: "arranging" },
      { title: "Checking in on whoever's had a hard week", kind: "doing" },
    ],
  },
];

export interface JobShare {
  ownerId: string;
  displayName: string;
  doing: number;
  arranging: number;
  total: number;
}

export interface JobTally {
  shares: JobShare[];
  unclaimed: HouseholdJob[];
  doingTotal: number;
  arrangingTotal: number;
}

const nameFor = (members: HouseholdMember[], ownerId: string): string =>
  members.find((member) => member.memberId === ownerId || member.displayName === ownerId)?.displayName ?? ownerId;

/** Who holds what, counted. No inference: these are the rows as they stand. */
export function tallyJobs(jobs: HouseholdJob[], members: HouseholdMember[]): JobTally {
  const byOwner = new Map<string, JobShare>();
  const unclaimed: HouseholdJob[] = [];

  for (const job of jobs) {
    if (!job.ownerId) {
      unclaimed.push(job);
      continue;
    }
    const share = byOwner.get(job.ownerId) ?? {
      ownerId: job.ownerId,
      displayName: nameFor(members, job.ownerId),
      doing: 0,
      arranging: 0,
      total: 0,
    };
    if (job.kind === "arranging") share.arranging += 1;
    else share.doing += 1;
    share.total += 1;
    byOwner.set(job.ownerId, share);
  }

  const shares = [...byOwner.values()].sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));
  return {
    shares,
    unclaimed,
    doingTotal: shares.reduce((sum, share) => sum + share.doing, 0),
    arrangingTotal: shares.reduce((sum, share) => sum + share.arranging, 0),
  };
}

/**
 * Below this there is no pattern to point at, only a short list. Six is the
 * smallest number where "most of them" means anything at all.
 */
const ENOUGH_TO_COUNT = 6;

export interface LoadObservation {
  id: string;
  title: string;
  /** The records it came from, so it can be checked rather than believed. */
  because: string;
  /** Always a question. The app counts; the family decides. */
  question: string;
}

/**
 * What the list says, said plainly.
 *
 * Every line is a count of rows the family typed in themselves, and reads as
 * a fact about the list rather than about a person: "eleven of the fourteen
 * arranging jobs are down to Paige" is arithmetic anyone can check against
 * the rows above it. It never says what that means, whether it is fair, or
 * what anyone is like — it cannot know, and the one thing worse than an
 * unshared load is a wall screen with an opinion about it.
 *
 * Children are left out of the count entirely. A seven-year-old is not a
 * party to how the adults split the house, and putting him in the tally
 * would make the only number that matters wrong.
 */
export function readTheLoad(
  jobs: HouseholdJob[],
  members: HouseholdMember[],
  tally: JobTally = tallyJobs(jobs, members)
): LoadObservation[] {
  const observations: LoadObservation[] = [];
  const adults = new Set(
    members.filter((member) => member.role === "adult").flatMap((member) => [member.memberId, member.displayName])
  );
  const adultShares = tally.shares.filter((share) => adults.has(share.ownerId));

  if (tally.unclaimed.length > 0) {
    const first = tally.unclaimed[0];
    observations.push({
      id: "unclaimed",
      title:
        tally.unclaimed.length === 1
          ? `One job on the list is nobody's: ${first?.title}.`
          : `${tally.unclaimed.length} jobs on the list are nobody's.`,
      because: "Listed with no name against them.",
      question: tally.unclaimed.length === 1 ? "Whose is it?" : "Worth going through them together?",
    });
  }

  // Needs at least two adults before a split is even a question.
  if (adultShares.length >= 2) {
    for (const kind of ["arranging", "doing"] as const) {
      const total = kind === "arranging" ? tally.arrangingTotal : tally.doingTotal;
      if (total < ENOUGH_TO_COUNT) continue;
      const ranked = [...adultShares].sort((a, b) => b[kind] - a[kind]);
      const top = ranked[0];
      if (!top || top[kind] * 2 <= total) continue;

      observations.push({
        id: `load:${kind}`,
        title:
          kind === "arranging"
            ? `${top.arranging} of the ${total} noticing-and-booking jobs are down to ${top.displayName}.`
            : `${top.doing} of the ${total} hands-on jobs are down to ${top.displayName}.`,
        because: `Counted from the ${total} job${total === 1 ? "" : "s"} on this list with a name against them.`,
        question: "Is that how you'd want it?",
      });
    }
  }

  return observations;
}
