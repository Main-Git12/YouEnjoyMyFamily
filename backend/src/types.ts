import { z } from "zod";

// Single source of truth for entity shapes — see models/schema.md for the
// key-design rationale. Handlers validate incoming bodies against the
// `*Input` schemas and persist the corresponding `*Item` shape.

// The part of the day a chore belongs to. A family picks this once when they
// set the chore up ("wipe the table — after dinner"), which is what lets the
// app know a chore is overdue without ever watching or profiling a child:
// it compares the clock to a window someone typed in, nothing more.
export const DUE_WINDOWS = ["morning", "after_school", "after_dinner", "bedtime", "anytime"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

// What each window means on a clock, as 24h minutes-from-midnight. A chore is
// "overdue" only once its window has closed.
export const DUE_WINDOW_ENDS_AT_MINUTE: Record<DueWindow, number | null> = {
  morning: 9 * 60,
  after_school: 17 * 60,
  after_dinner: 19 * 60 + 30,
  bedtime: 20 * 60 + 30,
  anytime: null,
};

// Chores are worth different amounts — sleeping in your own bed is not the
// same ask as filling a water bottle — so the value rides on the chore
// itself rather than a single flat number.
export const DEFAULT_GEM_VALUE = 5;

/**
 * A family member's name, as typed. Trimmed at the boundary because a
 * trailing space is invisible and would split a child in two: "Parker" and
 * "Parker " are different keys everywhere gems are counted, so Parker would
 * silently end up with two half-totals and two prize bars.
 *
 * Case is deliberately left alone — it's the family's own name for their
 * own child, and the app has no business re-spelling it. The screen offers
 * the names already in use as one-tap chips, which is what actually stops
 * variants being typed in the first place.
 */
export const MemberName = z.string().trim().min(1).max(60);

// How often a chore comes back. Most of this family's chores are daily;
// homework and the bookbag are weekday-only. A "none" chore is a one-off.
//
// A recurring chore is NOT re-created each morning by a scheduled job. The
// task row is a *definition* that simply applies on the days it applies to,
// and whether it got done on a given day is a separate COMPLETION row (see
// TaskCompletionItem). That means no cron to fall over, no guessing which
// timezone a family woke up in, no race between a rollover and a child
// ticking something off — and last Tuesday stays answerable.
export const RECURRENCES = ["none", "daily", "weekdays", "weekends"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const TaskInput = z.object({
  title: z.string().min(1).max(200),
  assignedTo: MemberName.nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  gemValue: z.number().int().min(0).max(1000).optional(),
  dueWindow: z.enum(DUE_WINDOWS).optional(),
  recurrence: z.enum(RECURRENCES).optional(),
});
export type TaskInput = z.infer<typeof TaskInput>;

/**
 * A real calendar date, YYYY-MM-DD — "2026-02-31" is refused, not read as
 * March 3rd. For the `?date=` a chore request is about, which arrives in
 * the query string rather than through a body schema.
 */
export const IsoDate = z.string().date();

export const TaskPatch = TaskInput.partial().extend({
  status: z.enum(["pending", "in_progress", "done"]).optional(),
  // Which day a status change belongs to. Ticking off "wipe the table" is
  // always a statement about a particular day, and the caller knows its own
  // local date — the server must not infer one from a UTC clock.
  date: z.string().date().optional(),
});
export type TaskPatch = z.infer<typeof TaskPatch>;

/**
 * The stored chore *definition*. Deliberately carries no `status` or
 * `gemsAwarded`: a chore isn't done or undone in the abstract, only on a
 * given day. Those live on the completion row and are merged in per day by
 * `TaskForDay`.
 */
export interface TaskItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "TASK";
  familyId: string;
  taskId: string;
  title: string;
  assignedTo: string | null;
  dueDate: string | null;
  gemValue: number;
  dueWindow: DueWindow;
  recurrence: Recurrence;
  /**
   * Denormalized from the completion row, for one-off chores only. It's what
   * lets "does this chore apply today?" be answered without a second query:
   * an undone one-off keeps showing up every day until someone does it, and
   * then stops. Written in the same operation as the completion row.
   */
  completedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A chore definition as it stands on one particular day. */
export interface TaskForDay extends Omit<TaskItem, "PK" | "SK" | "GSI1PK" | "GSI1SK"> {
  date: string;
  status: "pending" | "done";
  gemsAwarded: number;
}

/**
 * "This chore was done on this day, for this many gems." The record of what
 * actually happened — the thing gem balances and streaks are built from.
 * One per chore per day, so ticking the same chore twice is a no-op.
 */
export interface TaskCompletionItem {
  PK: string;
  SK: string;
  entityType: "TASK_COMPLETION";
  familyId: string;
  taskId: string;
  date: string;
  title: string;
  memberId: string | null;
  gemsAwarded: number;
  completedAt: string;
}

// What a child is actually saving up for. One live goal per child, set by
// whoever sets it up with them — the app never invents or infers a prize.
export const RewardGoalInput = z.object({
  title: z.string().min(1).max(120),
  gemCost: z.number().int().positive().max(100000),
  note: z.string().max(200).nullable().optional(),
});
export type RewardGoalInput = z.infer<typeof RewardGoalInput>;

export interface RewardGoalItem {
  PK: string;
  SK: string;
  entityType: "REWARD_GOAL";
  familyId: string;
  memberId: string;
  title: string;
  gemCost: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A prize a child has actually claimed, and the gems it cost them.
 *
 * This is the other half of the gem economy: without a record of what was
 * spent, a total can only ever go up, and "Earned it!" stays on the board
 * for good. Balance is earned (completions) minus spent (claims), so it
 * goes down when a prize is taken and the saving starts again.
 */
export interface RewardClaimItem {
  PK: string;
  SK: string;
  entityType: "REWARD_CLAIM";
  familyId: string;
  claimId: string;
  memberId: string;
  title: string;
  gemCost: number;
  claimedAt: string;
}

/**
 * A per-child version counter, and nothing else. Balances are still derived
 * from completions minus claims; this row exists only so that the two
 * operations that take gems *away* — claiming a prize and un-ticking a chore
 * — can't both pass their "is there enough?" check against the same
 * balance and together drive it below zero. Each reads `version` before
 * reading the balance and bumps it, conditioned on it being unchanged, in
 * the same transaction as its own write; the loser of a race is cancelled.
 */
export interface GemLedgerItem {
  PK: string;
  SK: string;
  entityType: "GEM_LEDGER";
  familyId: string;
  memberId: string;
  version: number;
  updatedAt: string;
}

export const ScheduleInput = z.object({
  date: z.string().date(),
  title: z.string().min(1).max(200),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  memberIds: z.array(z.string()).optional(),
});
export type ScheduleInput = z.infer<typeof ScheduleInput>;

// Every field optional: a PUT that only moves the start time should not
// have to resend the title and the guest list to keep them.
export const SchedulePatch = ScheduleInput.partial();
export type SchedulePatch = z.infer<typeof SchedulePatch>;

export interface ScheduleItem {
  PK: string;
  SK: string;
  entityType: "SCHEDULE";
  familyId: string;
  scheduleId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const PreferencesInput = z.object({
  theme: z.string().optional(),
  notificationsEnabled: z.boolean().optional(),
  quietHours: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
});
export type PreferencesInput = z.infer<typeof PreferencesInput>;

export interface PreferencesItem {
  PK: string;
  SK: string;
  entityType: "PREFERENCES";
  familyId: string;
  memberId: string;
  theme: string;
  notificationsEnabled: boolean;
  quietHours: { start: string; end: string };
  updatedAt: string;
}

// Explicit, family-stated preferences only — e.g. "Isla picked penne over
// spaghetti" or "Parker prefers soccer over baseball", entered when a family
// member actually says so. Never populated from passive tracking/inference;
// see backend/models/schema.md.
export const STATED_PREFERENCE_CATEGORIES = ["meal", "activity", "chore"] as const;

export const StatedPreferenceInput = z.object({
  memberId: MemberName,
  category: z.enum(STATED_PREFERENCE_CATEGORIES),
  statement: z.string().min(1).max(200),
});
export type StatedPreferenceInput = z.infer<typeof StatedPreferenceInput>;

export interface StatedPreferenceItem {
  PK: string;
  SK: string;
  entityType: "STATED_PREFERENCE";
  familyId: string;
  preferenceId: string;
  memberId: string;
  category: (typeof STATED_PREFERENCE_CATEGORIES)[number];
  statement: string;
  createdAt: string;
}

export const CartItemInput = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().int().positive().optional(),
  addedBy: z.string().min(1).nullable().optional(),
});
export type CartItemInput = z.infer<typeof CartItemInput>;

// "unavailable" is set when a family member can't find the item while
// shopping; "substituted" plus substituteDescription is set only when they
// then explicitly say what they picked instead — never inferred. See
// LearnedSubstitutionItem below, which is the only thing derived from that.
// "ordered" is stamped by checkout once the Instacart link has been handed
// over; it's what keeps last week's shop from blocking next week's list.
// Setting an ordered item back to "pending" puts it on the list again.
export const CART_ITEM_STATUSES = ["pending", "unavailable", "substituted", "ordered"] as const;
export type CartItemStatus = (typeof CART_ITEM_STATUSES)[number];

export const CartItemPatch = z.object({
  status: z.enum(CART_ITEM_STATUSES).optional(),
  substituteDescription: z.string().min(1).max(300).optional(),
});
export type CartItemPatch = z.infer<typeof CartItemPatch>;

export interface CartItem {
  PK: string;
  SK: string;
  entityType: "CART_ITEM";
  familyId: string;
  itemId: string;
  description: string;
  quantity: number;
  status: CartItemStatus;
  substituteDescription: string | null;
  /** When checkout handed this item over to Instacart; null until then. */
  orderedAt: string | null;
  addedBy: string | null;
  // "meal_plan" items are generated from a family's own meal plan
  // ingredients (see mealPlans.ts) rather than typed in directly; a
  // "manual" item's mealPlanSourceKey is always null.
  source: "manual" | "meal_plan";
  mealPlanSourceKey: string | null;
  /**
   * The meal-plan dates (YYYY-MM-DD) a "meal_plan" item was generated to
   * cover, sorted, one entry per date. Once the item has been ordered (or
   * marked unavailable) it still counts as covering those dates, so a later
   * generation over an overlapping range only adds what's needed for dates
   * nobody has shopped for yet. Absent on manual items and on items written
   * before this field existed — those cover no particular date.
   */
  mealPlanDates?: string[];
  addedAt: string;
  updatedAt: string;
}

// A suggestion for next time, built only from substitutions a family member
// has explicitly confirmed for this exact item before — never a guess, and
// always offered as a suggestion the family can accept or ignore, not
// applied automatically. One item per family per original item description.
export interface LearnedSubstitutionItem {
  PK: string;
  SK: string;
  entityType: "LEARNED_SUBSTITUTION";
  familyId: string;
  originalDescription: string;
  substituteDescription: string;
  timesConfirmed: number;
  updatedAt: string;
}

export const CreateFamilyInput = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type CreateFamilyInput = z.infer<typeof CreateFamilyInput>;

// The only item every other entity's PK depends on, and the only thing that
// makes a familyId a real, authenticated tenant rather than an arbitrary
// caller-supplied string — see POST /families (families.ts) for how one gets
// created, and lib/auth.ts for how apiKeyHash is checked on every other
// route. The raw API key is never stored, only its SHA-256 hash.
/**
 * Where the household is, and which clock it keeps.
 *
 * Stored once for the family rather than per member, because a household
 * leaves from one front door. The coordinate is rounded before it is ever
 * sent anywhere (see `roundCoordinate` in lib/weather.ts) — about a
 * kilometre, enough for a forecast and not enough to point at a house.
 *
 * `timeZone` earns its place beyond the weather: the Alexa skill currently
 * carries the family's zone as an environment variable on its Lambda, which
 * is a second copy of a fact that belongs here.
 */
export const HouseholdLocationInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** An IANA zone, e.g. `America/New_York`. */
  timeZone: z.string().min(1).max(64),
  /** What to call it on screen. Never sent to any third party. */
  label: z.string().max(80).nullable().optional(),
});
export type HouseholdLocationInput = z.infer<typeof HouseholdLocationInput>;

export const FamilyPatch = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  location: HouseholdLocationInput.nullable().optional(),
});
export type FamilyPatch = z.infer<typeof FamilyPatch>;

export interface HouseholdLocation {
  latitude: number;
  longitude: number;
  timeZone: string;
  label: string | null;
}

export interface FamilyRecord {
  PK: string;
  SK: "METADATA";
  entityType: "FAMILY";
  familyId: string;
  name: string | null;
  apiKeyHash: string;
  createdAt: string;
  /** Null until a parent says where the house is. */
  location?: HouseholdLocation | null;
  /** When the API key was last replaced; absent on a family still using its first. */
  keyRotatedAt?: string;
}

/**
 * A family's stored OAuth tokens for a calendar provider.
 *
 * Nothing writes one yet — the Google OAuth callback that would is not
 * built, which is why the 15-minute sync job finds no families and reports
 * success over an empty list. The `entityType` is declared here anyway,
 * because schema.md's first rule is that every item carries one, and the
 * place to hold that line is the type, not the handler that eventually
 * writes the row.
 */
export interface CalendarTokenRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "CALENDAR_TOKEN";
  familyId: string;
  provider: "google";
  accessToken: string;
  refreshToken: string;
}

export interface CalendarEventItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "CALENDAR_EVENT";
  familyId: string;
  externalId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  syncedAt: string;
}

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

// A meal a family member has planned for a specific day + slot, along with
// the ingredients it takes — always typed in by a family member, never an
// AI-invented recipe. This is the only input the grocery list generation in
// mealPlans.ts reads from; see backend/models/schema.md.
export const MealPlanEntryInput = z.object({
  mealName: z.string().min(1).max(200),
  ingredients: z.array(z.string().min(1).max(200)).max(50).optional(),
});
export type MealPlanEntryInput = z.infer<typeof MealPlanEntryInput>;

export interface MealPlanEntryItem {
  PK: string;
  SK: string;
  entityType: "MEAL_PLAN_ENTRY";
  familyId: string;
  date: string;
  slot: MealSlot;
  mealName: string;
  ingredients: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Routines — a sequence of steps run against a deadline
// ---------------------------------------------------------------------------

/**
 * What a routine is anchored to. Every routine here is defined by the
 * moment it has to be *finished*, not the moment it starts — the bus
 * leaves at 07:52 whether or not anyone is dressed. Planning backwards
 * from that time is the whole point: it turns "hurry up" into a number
 * that is either positive or negative, and a number is something a
 * six-year-old can argue with and a parent doesn't have to keep saying.
 */
export const ROUTINE_KINDS = ["morning", "bedtime", "custom"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

/** `HH:MM`, 24-hour. The one clock format stored anywhere in this API. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");

export const RoutineStepInput = z.object({
  title: z.string().min(1).max(120),
  /**
   * How long the family thinks this takes. Only ever a seed: once there
   * are finished runs to look at, the plan uses the median of what the
   * step has *actually* taken. Someone has to put a first number in, and
   * a parent's guess is a better starting point than a default.
   */
  targetMinutes: z.number().int().min(1).max(120),
  /** Whose step it is. Null means whoever's nearest. */
  memberId: MemberName.nullable().optional(),
});
export type RoutineStepInput = z.infer<typeof RoutineStepInput>;

export const RoutineInput = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(ROUTINE_KINDS),
  /** The deadline the whole routine is planned backwards from. */
  anchorTime: ClockTime,
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  steps: z.array(RoutineStepInput).min(1).max(20),
  active: z.boolean().optional(),
});
export type RoutineInput = z.infer<typeof RoutineInput>;

export const RoutinePatch = RoutineInput.partial();
export type RoutinePatch = z.infer<typeof RoutinePatch>;

/**
 * A step as stored. `stepId` is stable only within the current definition —
 * replacing the step list issues new ids. Anything that needs to compare a
 * step against its own history (how long it usually takes) keys on the
 * normalized `title` instead, because that is what the family actually
 * means by "the same step", and it survives reordering and re-adding.
 */
export interface RoutineStep {
  stepId: string;
  title: string;
  targetMinutes: number;
  memberId: string | null;
}

export interface RoutineItem {
  PK: string;
  SK: string;
  entityType: "ROUTINE";
  familyId: string;
  routineId: string;
  name: string;
  kind: RoutineKind;
  anchorTime: string;
  daysOfWeek: number[];
  steps: RoutineStep[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One step of one morning: when it was started and when it was finished.
 * `finishedAt` stays null for a step that was begun and never ticked —
 * which is a real outcome and must not be counted as a duration.
 */
export interface RoutineRunStep {
  stepId: string;
  /** Copied so a run reads on its own, the same way a completion row does. */
  title: string;
  startedAt: string;
  finishedAt: string | null;
}

export const RoutineRunStepInput = z.object({
  stepId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});

/**
 * What actually happened on one date — the substrate everything the app
 * "learns" about a routine is computed from. Written as one row per day
 * per routine and replaced wholesale, because a morning is short, the
 * whole of it fits in one item, and a single writer (the screen in the
 * kitchen) is doing the writing.
 */
export const RoutineRunInput = z.object({
  /** The caller's own local date. The server never infers one. */
  date: z.string().date(),
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  steps: z.array(RoutineRunStepInput).max(20),
});
export type RoutineRunInput = z.infer<typeof RoutineRunInput>;

export interface RoutineRunItem {
  PK: string;
  SK: string;
  entityType: "ROUTINE_RUN";
  familyId: string;
  routineId: string;
  date: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: RoutineRunStep[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Focus blocks — structured work, and the timesheet line that comes with it
// ---------------------------------------------------------------------------

/**
 * How a block of work ended. The distinction is the whole basis of what
 * this learns: a block that ran to the bell is evidence that its length
 * works, and one abandoned after four minutes is evidence that it doesn't.
 * Collapsing them into "did some work" would throw that away.
 */
export const FOCUS_OUTCOMES = ["completed", "cut_short", "abandoned"] as const;
export type FocusOutcome = (typeof FOCUS_OUTCOMES)[number];

/**
 * A block of focused work and, inseparably, its timesheet line.
 *
 * They are one record on purpose. The expensive part of billable work is
 * not the timer — it is reconstructing at six in the evening what the
 * morning was spent on. Capturing the line at the moment the block ends,
 * while it is still obvious, is the part that actually saves the hour.
 */
export const FocusBlockInput = z.object({
  memberId: MemberName,
  /** The caller's own local date — the server never infers one. */
  date: z.string().date(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  plannedMinutes: z.number().int().min(1).max(240),
  outcome: z.enum(FOCUS_OUTCOMES),
  /**
   * Whatever she files time against — a matter number, a short code, a
   * case name. Free text, because this app has no business prescribing
   * another organisation's matter taxonomy, and a short code is the
   * sensible thing to type where the full client name is privileged.
   */
  matter: z.string().trim().max(120).nullable().optional(),
  /** What was done, in her words. Becomes the narrative on the line. */
  note: z.string().trim().max(500).nullable().optional(),
});
export type FocusBlockInput = z.infer<typeof FocusBlockInput>;

export interface FocusBlockItem {
  PK: string;
  SK: string;
  entityType: "FOCUS_BLOCK";
  familyId: string;
  blockId: string;
  memberId: string;
  date: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  /** What it actually ran for. The learning is built from this, not the plan. */
  actualMinutes: number;
  outcome: FocusOutcome;
  matter: string | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// School: the specials rotation, and where lunch comes from

/**
 * A child's school week, and the part of it that lands on a parent.
 *
 * A specials rotation is the sort of thing a school sends home once on a
 * decorated sheet of paper that then lives on the fridge until it goes soft.
 * Most of it is only mildly useful — knowing Friday is Music changes nothing.
 * The useful part is the small print under two or three of the days: gym
 * shoes, a charged laptop, the library book that has to go back. Those are
 * not facts about the school day, they are jobs for the night before, and
 * missing one is how a Tuesday morning turns into a search of the whole
 * house at 07:40.
 *
 * So `prepNote` is the reason this entity exists, and it is stored verbatim
 * as the school wrote it rather than reworded, because a parent reading
 * "bring in a pair to change into" should recognise the sentence from the
 * sheet on the fridge.
 */
export const SchoolSpecialInput = z.object({
  /** 0 = Sunday, matching `Date.prototype.getDay` and `RoutineInput.daysOfWeek`. */
  dayOfWeek: z.number().int().min(0).max(6),
  subject: z.string().min(1).max(60),
  /** What has to happen the night before, in the school's own words. */
  prepNote: z.string().max(240).nullable().optional(),
});
export type SchoolSpecialInput = z.infer<typeof SchoolSpecialInput>;

/**
 * Where a school's published lunch menu can be read from.
 *
 * Only one provider so far. It is spelled out as a closed list rather than a
 * free URL on purpose: a stored URL is something a Lambda can be told to
 * fetch, and "fetch whatever this row says" is a request-forgery hole with a
 * database row for a front door. These three numbers name a menu inside a
 * provider whose base URL lives in the code.
 */
export const MENU_PROVIDERS = ["myschoolmenus"] as const;
export type MenuProvider = (typeof MENU_PROVIDERS)[number];

export const SchoolMenuSourceInput = z.object({
  provider: z.enum(MENU_PROVIDERS),
  organizationId: z.number().int().positive(),
  siteId: z.number().int().positive(),
  menuId: z.number().int().positive(),
});
export type SchoolMenuSourceInput = z.infer<typeof SchoolMenuSourceInput>;

export const SchoolProfileInput = z.object({
  schoolName: z.string().min(1).max(120),
  /** Whose classroom it is. Shown so a parent knows which sheet this came from. */
  teacher: z.string().max(120).nullable().optional(),
  gradeLabel: z.string().max(40).nullable().optional(),
  specials: z.array(SchoolSpecialInput).max(7),
  /** Null for a school whose menu is not published anywhere this app can read. */
  menuSource: SchoolMenuSourceInput.nullable().optional(),
});
export type SchoolProfileInput = z.infer<typeof SchoolProfileInput>;

export interface SchoolSpecial {
  dayOfWeek: number;
  subject: string;
  prepNote: string | null;
}

export interface SchoolProfileItem {
  PK: string;
  SK: string;
  entityType: "SCHOOL_PROFILE";
  familyId: string;
  memberId: string;
  schoolName: string;
  teacher: string | null;
  gradeLabel: string | null;
  specials: SchoolSpecial[];
  menuSource: SchoolMenuSourceInput | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One published day of a lunch menu, as the school grouped it.
 *
 * `groups` keeps the school's own headings and ordering — Lunch Entree,
 * Vegetables, Fruit, Milk, Condiments — rather than flattening to "lunch is
 * chicken nuggets". A child who will only eat the fruit has a different
 * question about Thursday than a parent deciding whether to pack something,
 * and the published menu answers both if it is not thrown away first.
 *
 * `heading` is nullable because a provider may list items before any
 * heading. That is a real shape in the data and it is not this app's place
 * to invent a category name for it.
 */
export interface SchoolMenuGroup {
  heading: string | null;
  items: string[];
}

export interface SchoolMenuDay {
  date: string;
  groups: SchoolMenuGroup[];
}

/**
 * A month of a menu, cached whole.
 *
 * One row per menu-month rather than per day, because that is the shape the
 * provider publishes in and because a month of lunches is about thirteen
 * kilobytes — far inside a DynamoDB item, and one read instead of twenty-two.
 *
 * Keyed by `menuId` rather than by member: a district publishes one
 * elementary menu, so two children at two different schools in the same
 * district share these rows instead of each keeping their own copy of the
 * same thing.
 */
export interface SchoolMenuMonthItem {
  PK: string;
  SK: string;
  entityType: "SCHOOL_MENU_MONTH";
  familyId: string;
  menuId: number;
  /** `YYYY-MM`. */
  month: string;
  days: SchoolMenuDay[];
  /** When this was last read from the provider — what staleness is judged on. */
  fetchedAt: string;
}

/**
 * A record that what the school asked for on one day was actually dealt with.
 *
 * The specials sheet alone is information: it says Thursday is Library. The
 * app already puts that on the wall the night before. What it could not do
 * is tell the difference between a note somebody read and a book that is in
 * the bag — so the note came back identical every Wednesday evening, and a
 * prompt that cannot be answered is one people learn to walk past.
 *
 * Note carefully what this records and what it does not. Ticking it means
 * *somebody said they had done it*, nothing more. The app has no way of
 * knowing whether the book is really in the bag, so nothing built on this
 * may claim that it is. The honest reading of an unticked Thursday is "this
 * was not ticked off", never "the book was forgotten" — the same rule the
 * awareness engine follows when it reports what co-occurred and refuses to
 * say why.
 *
 * `subject` and `note` are copied onto the row rather than looked up, the
 * same way a task completion copies its title. A rotation that changes in
 * January must not silently rewrite what December's ticks were about.
 */
export const SchoolPrepInput = z.object({
  /** Copied from the rotation so the record reads on its own. */
  subject: z.string().min(1).max(60),
  note: z.string().max(240).nullable().optional(),
});
export type SchoolPrepInput = z.infer<typeof SchoolPrepInput>;

export interface SchoolPrepItem {
  PK: string;
  SK: string;
  entityType: "SCHOOL_PREP";
  familyId: string;
  memberId: string;
  date: string;
  subject: string;
  note: string | null;
  /** When somebody said it was done. The only fact this row actually holds. */
  packedAt: string;
}

/**
 * One cached hour of weather.
 *
 * `weather` is nullable and that null is meaningful: it records that the
 * provider had no row for that hour — a date past the forecast horizon,
 * usually — so the app does not ask again every thirty seconds for
 * something that does not exist yet.
 */
export interface WeatherHourItem {
  PK: string;
  SK: string;
  entityType: "WEATHER_HOUR";
  familyId: string;
  date: string;
  atTime: string;
  weather: import("./lib/weather").WeatherAt | null;
  fetchedAt: string;
}
