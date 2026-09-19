import { z } from "zod";

// Single source of truth for entity shapes — see models/schema.md for the
// key-design rationale. Handlers validate incoming bodies against the
// `*Input` schemas and persist the corresponding `*Item` shape.

export const TaskInput = z.object({
  title: z.string().min(1).max(200),
  assignedTo: z.string().min(1).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
});
export type TaskInput = z.infer<typeof TaskInput>;

export const TaskPatch = TaskInput.partial().extend({
  status: z.enum(["pending", "in_progress", "done"]).optional(),
});
export type TaskPatch = z.infer<typeof TaskPatch>;

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
  status: "pending" | "in_progress" | "done";
  createdAt: string;
  updatedAt: string;
}

// Awarded when a task transitions into "done" — see tasks.ts. Not a zod
// input schema since nothing external ever sets this directly.
export interface MemberStatsItem {
  PK: string;
  SK: string;
  entityType: "MEMBER_STATS";
  familyId: string;
  memberId: string;
  gems: number;
  tasksCompleted: number;
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

export const GroceryStore = z.enum(["giant_eagle", "aldi"]);
export type GroceryStore = z.infer<typeof GroceryStore>;

export const CartItemStatus = z.enum(["needed", "unavailable"]);
export type CartItemStatus = z.infer<typeof CartItemStatus>;

export const CartItemInput = z.object({
  store: GroceryStore,
  description: z.string().min(1).max(300),
  quantity: z.number().int().positive().optional(),
  addedBy: z.string().min(1).nullable().optional(),
});
export type CartItemInput = z.infer<typeof CartItemInput>;

// PATCH /grocery-cart/items/{itemId}: the two moves in the "out of stock"
// flow — flag an item so the family sees suggestions, then log whichever
// substitute they actually went with (this is what the suggestions learn from).
export const CartItemPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_unavailable") }),
  z.object({ action: z.literal("substitute"), description: z.string().min(1).max(300) }),
]);
export type CartItemPatch = z.infer<typeof CartItemPatch>;

export interface CartItem {
  PK: string;
  SK: string;
  entityType: "CART_ITEM";
  familyId: string;
  itemId: string;
  store: GroceryStore;
  description: string;
  quantity: number;
  status: CartItemStatus;
  addedBy: string | null;
  addedAt: string;
  updatedAt: string;
}

// Keyed by (store, original description) so a suggestion for one store never
// bleeds into the other's catalog. Counts only grow from substitutions a
// family member actually chose — never inferred from any external stock feed.
export interface SubstitutionLogItem {
  PK: string;
  SK: string;
  entityType: "SUBSTITUTION_LOG";
  familyId: string;
  store: GroceryStore;
  originalDescription: string;
  substituteDescription: string;
  timesChosen: number;
  lastChosenAt: string;
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
