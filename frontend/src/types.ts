// Mirrors the shapes the backend returns — see backend/models/schema.md.
// Kept as plain interfaces (not shared code) since frontend and backend
// deploy independently; update both sides together when the API changes.

// The part of the day a chore belongs to — chosen by the family when they
// set the chore up, which is what lets the app tell a chore has slipped
// without ever watching or profiling a child.
export type DueWindow = "morning" | "after_school" | "after_dinner" | "bedtime" | "anytime";

export interface Task {
  taskId: string;
  title: string;
  assignedTo: string | null;
  dueDate: string | null;
  status: "pending" | "in_progress" | "done";
  /** What this chore pays out — not every chore is worth the same. */
  gemValue: number;
  dueWindow: DueWindow;
  gemsAwarded: number;
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
