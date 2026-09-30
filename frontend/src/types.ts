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
export type RoutineKind = "morning" | "bedtime" | "custom";

export interface RoutineStep {
  stepId: string;
  title: string;
  /** What the family reckons it takes. Only ever a seed — see lib/routinePlan.ts. */
  targetMinutes: number;
  memberId: string | null;
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
