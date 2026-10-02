// Mirrors the shapes the backend returns — see backend/models/schema.md.
// Kept as plain interfaces (not shared code) since frontend and backend
// deploy independently; update both sides together when the API changes.

// The part of the day a chore belongs to — chosen by the family when they
// set the chore up, which is what lets the app tell a chore has slipped
// without ever watching or profiling a child.
export type DueWindow = "morning" | "after_school" | "after_dinner" | "bedtime" | "anytime";

// How often a chore comes back. A recurring chore is one stored definition,
// not a row re-created every morning — see backend/models/schema.md.
export type Recurrence = "none" | "daily" | "weekdays" | "weekends";

/**
 * A chore as it stands on one particular day. `status` and `gemsAwarded`
 * are that day's state, merged in by the backend from the day's completion
 * record — the same chore is "pending" again tomorrow.
 */
export interface Task {
  taskId: string;
  title: string;
  assignedTo: string | null;
  dueDate: string | null;
  /** The day this view of the chore is about. */
  date: string;
  status: "pending" | "done";
  /** What this chore pays out — not every chore is worth the same. */
  gemValue: number;
  dueWindow: DueWindow;
  recurrence: Recurrence;
  completedOn: string | null;
  gemsAwarded: number;
  /**
   * When the chore was created. The API has always sent this; the type
   * simply never declared it, and nothing on this side could therefore ask
   * the one question that stops the app inventing a history — whether the
   * chore even existed on the days it is being judged against.
   */
  createdAt: string;
}

/**
 * "This chore was done on this day, for this many gems." Gem totals are
 * summed from these rather than from the chore list, because a chore that
 * recurs is one row that pays out again every day it's done.
 */
export interface TaskCompletion {
  taskId: string;
  date: string;
  title: string;
  memberId: string | null;
  gemsAwarded: number;
}

/**
 * What a child has right now: everything earned, minus everything claimed.
 * A total that can only go up isn't a reward economy — claiming the prize
 * spends the gems and the saving starts again.
 */
export interface GemBalance {
  memberId: string;
  earned: number;
  spent: number;
  balance: number;
}

/** Per child, plus the kingdom's own running total. */
export interface GemBalanceReport {
  balances: GemBalance[];
  family: { earned: number; spent: number; balance: number };
}

/** The big prize a child is saving up for. One live goal each. */
export interface RewardGoal {
  memberId: string;
  title: string;
  gemCost: number;
  note: string | null;
}

export interface ScheduleEntry {
  scheduleId: string;
  date: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  memberIds: string[];
}

export interface CartItem {
  itemId: string;
  description: string;
  quantity: number;
  // "ordered" is stamped by checkout once the Instacart link exists — it's
  // last week's shop, not a line still to buy. Putting one back on the list
  // sets it to "pending" again.
  status: "pending" | "unavailable" | "substituted" | "ordered";
  substituteDescription: string | null;
  orderedAt: string | null;
  // "meal_plan" items came from generateGroceryListFromMealPlan (see
  // backend/models/schema.md), never typed in directly.
  source: "manual" | "meal_plan";
}

export type MealSlot = "breakfast" | "lunch" | "dinner";

// A meal a family member has explicitly planned for one day + slot, along
// with the ingredients it takes — never an AI-invented recipe.
export interface MealPlanEntry {
  date: string;
  slot: MealSlot;
  mealName: string;
  ingredients: string[];
}

export type StatedPreferenceCategory = "meal" | "activity" | "chore";

// Something a family member explicitly said (a chosen meal, a stated
// activity preference, a chore they picked) — never inferred or passively
// tracked. See backend/models/schema.md.
export interface StatedPreference {
  preferenceId: string;
  memberId: string;
  category: StatedPreferenceCategory;
  statement: string;
}

/**
 * A routine — an ordered set of steps planned backwards from the moment it
 * has to be finished. See backend/models/schema.md; the anchor is the point.
 */
/**
 * `care` is the one kind anchored to when it *starts* rather than when it
 * has to be finished — a carer's shift begins when they arrive, and there
 * is no bus. It is laid out by lib/carePlan.ts, not by planRoutine, and
 * shares only the half that matters: durations learned from finished runs.
 */
export type RoutineKind = "morning" | "bedtime" | "custom" | "care";

export interface RoutineStep {
  stepId: string;
  title: string;
  /** What the family reckons it takes. Only ever a seed — see lib/routinePlan.ts. */
  targetMinutes: number;
  memberId: string | null;
  /**
   * Set while the usual person can't do this one — somebody in a cast for a
   * month, say. The step still matters, so it is paused rather than deleted:
   * deleting loses the job and its learned duration. The subject is the
   * step, never the person.
   */
  pausedUntil?: string | null;
  pausedReason?: string | null;
  /** Who is doing it in the meantime. Null means nobody has picked it up. */
  coveredBy?: string | null;
}

export interface Routine {
  routineId: string;
  name: string;
  kind: RoutineKind;
  /** `HH:MM`, 24-hour, local. The deadline everything is planned back from. */
  anchorTime: string;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  daysOfWeek: number[];
  steps: RoutineStep[];
  active: boolean;
}

/**
 * One step of one morning. `finishedAt` stays null for a step that was
 * begun and never ticked — a real outcome, and never to be filled in with
 * a guess, because a step nobody finished has no duration.
 */
export interface RoutineRunStep {
  stepId: string;
  title: string;
  startedAt: string;
  finishedAt: string | null;
}

/** What actually happened on one date — everything learned is computed from these. */
export interface RoutineRun {
  routineId: string;
  date: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: RoutineRunStep[];
}

/** How a block of focused work ended — see backend/models/schema.md. */
export type FocusOutcome = "completed" | "cut_short" | "abandoned";

/**
 * A block of focused work, and inseparably its timesheet line. One record,
 * because the expensive part of billable work isn't the timer — it's
 * reconstructing at six in the evening what the morning went on.
 */
export interface FocusBlock {
  blockId: string;
  memberId: string;
  date: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  /** What it actually ran for. Everything is learned from this, not the plan. */
  actualMinutes: number;
  outcome: FocusOutcome;
  matter: string | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// School — see backend/models/schema.md

/** One day of the weekly specials rotation. 0 = Sunday, as `Date.getDay()`. */
export interface SchoolSpecial {
  dayOfWeek: number;
  subject: string;
  /**
   * What has to happen the night before, in the school's own words. This is
   * the part that matters: knowing Friday is Music changes nothing, but the
   * library book has to be in the bag before anyone is awake enough to
   * remember it.
   */
  prepNote: string | null;
}

export interface SchoolMenuSource {
  provider: "myschoolmenus";
  organizationId: number;
  siteId: number;
  menuId: number;
}

export interface SchoolProfile {
  memberId: string;
  schoolName: string;
  teacher: string | null;
  gradeLabel: string | null;
  specials: SchoolSpecial[];
  menuSource: SchoolMenuSource | null;
}

/** A heading of null means the school listed these items under none. */
export interface SchoolMenuGroup {
  heading: string | null;
  items: string[];
}

export interface SchoolMenuDay {
  date: string;
  groups: SchoolMenuGroup[];
}

export interface SchoolMenu {
  memberId: string;
  schoolName: string;
  menuId: number;
  /** School days only. A day the school was closed is simply absent. */
  days: SchoolMenuDay[];
  /** True when this came from the cache because the provider was unreachable. */
  stale: boolean;
  fetchedAt: string | null;
  missingMonths: string[];
}

/**
 * A record that what the school asked for on one day was ticked off.
 *
 * It records that *somebody said they had done it* — nothing more. The app
 * cannot see inside a schoolbag, so an absent row means "this was not ticked
 * off", never "the book was forgotten". Everything built on it inherits that
 * limit, the same way the awareness engine reports what co-occurred and
 * refuses to say why.
 */
export interface SchoolPrep {
  memberId: string;
  date: string;
  subject: string;
  note: string | null;
  packedAt: string;
}

/** Where the household is. The coordinate is stored already rounded. */
export interface HouseholdLocation {
  latitude: number;
  longitude: number;
  timeZone: string;
  label: string | null;
}

export interface FamilySettings {
  familyId: string;
  name: string | null;
  location: HouseholdLocation | null;
  createdAt: string;
}

/** The weather at one hour — the hour the family actually leaves. */
export interface WeatherAtHour {
  time: string;
  temperatureF: number;
  feelsLikeF: number;
  chanceOfRain: number;
  conditions: string;
  beforeSunrise: boolean;
  sunrise: string;
}

export interface WeatherReading {
  date: string;
  atTime: string;
  /** Null when the forecast does not reach that far, or could not be read. */
  weather: WeatherAtHour | null;
  stale: boolean;
  fetchedAt: string | null;
  label: string | null;
}

// --- The household: who is in it, and who carries what ---------------------

export type HouseholdRole = "adult" | "child" | "carer";

/**
 * One person in the house.
 *
 * `role` decides exactly one thing and decides it everywhere: gems, prizes,
 * the castle and the monster game are a children's motivation system, and an
 * adult is not in it. An adult can own any number of chores; none of them
 * pay. Before this existed the only way to add a grandparent was to type her
 * name onto a chore, which handed her a gem balance and a place in a game
 * built for a seven-year-old.
 */
export interface HouseholdMember {
  memberId: string;
  displayName: string;
  role: HouseholdRole;
  note: string | null;
  /** The days somebody on a rota is here. 0 = Sunday. Null for anyone who lives here. */
  daysOfWeek?: number[] | null;
  /** The shift's hours, `HH:MM`. Both ends: the end is the half worth comparing against. */
  startsAt?: string | null;
  endsAt?: string | null;
}

/**
 * "doing" is work that is visible while it happens — cooking, driving,
 * laundry. "arranging" is work that is only visible when it *doesn't*
 * happen: booking, remembering, noticing, chasing. They are kept apart
 * because a roster that looks even on the doing is often badly lopsided on
 * the arranging, and that is the half families report as the one that
 * actually causes resentment.
 */
export type JobKind = "doing" | "arranging";

export interface HouseholdJob {
  jobId: string;
  title: string;
  kind: JobKind;
  /** Null means nobody has taken it — which is worth saying out loud. */
  ownerId: string | null;
  note: string | null;
}

export interface Household {
  members: HouseholdMember[];
  jobs: HouseholdJob[];
}
