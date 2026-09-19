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
  gemsAwarded: number;
  createdAt: string;
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

// Explicit, family-stated preferences only — e.g. "Isla picked penne over
// spaghetti" or "Parker prefers soccer over baseball", entered when a family
// member actually says so. Never populated from passive tracking/inference;
// see backend/models/schema.md.
export const STATED_PREFERENCE_CATEGORIES = ["meal", "activity", "chore"] as const;

export const StatedPreferenceInput = z.object({
  memberId: z.string().min(1),
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
export const CartItemPatch = z.object({
  status: z.enum(["pending", "unavailable", "substituted"]).optional(),
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
  status: "pending" | "unavailable" | "substituted";
  substituteDescription: string | null;
  addedBy: string | null;
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
