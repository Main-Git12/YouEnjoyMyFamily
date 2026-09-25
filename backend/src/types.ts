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
export interface FamilyRecord {
  PK: string;
  SK: "METADATA";
  entityType: "FAMILY";
  familyId: string;
  name: string | null;
  apiKeyHash: string;
  createdAt: string;
}

export interface CalendarTokenRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
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
