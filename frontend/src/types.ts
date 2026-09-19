// Mirrors the shapes the backend returns — see backend/models/schema.md.
// Kept as plain interfaces (not shared code) since frontend and backend
// deploy independently; update both sides together when the API changes.

export interface Task {
  taskId: string;
  title: string;
  assignedTo: string | null;
  dueDate: string | null;
  status: "pending" | "in_progress" | "done";
  // Only present on the PUT response for the request that completed it.
  gemsAwarded?: number;
}

export interface MemberStats {
  gems: number;
  tasksCompleted: number;
}

export interface ScheduleEntry {
  scheduleId: string;
  date: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  memberIds: string[];
}

export type GroceryStore = "giant_eagle" | "aldi";
export type CartItemStatus = "needed" | "unavailable";

export interface CartItem {
  itemId: string;
  store: GroceryStore;
  description: string;
  quantity: number;
  status: CartItemStatus;
}

export interface SubstituteSuggestion {
  description: string;
  timesChosen: number;
}
