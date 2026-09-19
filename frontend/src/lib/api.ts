import type { Task, ScheduleEntry, CartItem, GroceryStore, SubstituteSuggestion, MemberStats } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  listTasks: (familyId: string) => request<Task[]>(`/families/${familyId}/tasks`),
  createTask: (familyId: string, task: Pick<Task, "title"> & Partial<Task>) =>
    request<Task>(`/families/${familyId}/tasks`, { method: "POST", body: JSON.stringify(task) }),
  updateTask: (familyId: string, taskId: string, patch: Partial<Pick<Task, "title" | "assignedTo" | "dueDate" | "status">>) =>
    request<Task>(`/families/${familyId}/tasks/${taskId}`, { method: "PUT", body: JSON.stringify(patch) }),
  getMemberStats: (familyId: string, memberId: string) =>
    request<MemberStats>(`/families/${familyId}/members/${memberId}/stats`),
  listSchedules: (familyId: string, start?: string, end?: string) =>
    request<ScheduleEntry[]>(`/families/${familyId}/schedules?start=${start ?? ""}&end=${end ?? ""}`),
  listCartItems: (familyId: string) => request<CartItem[]>(`/families/${familyId}/grocery-cart`),
  addCartItem: (familyId: string, item: { store: GroceryStore; description: string; quantity?: number; addedBy?: string | null }) =>
    request<CartItem>(`/families/${familyId}/grocery-cart/items`, { method: "POST", body: JSON.stringify(item) }),
  markCartItemUnavailable: (familyId: string, itemId: string) =>
    request<{ item: CartItem; suggestions: SubstituteSuggestion[] }>(
      `/families/${familyId}/grocery-cart/items/${itemId}`,
      { method: "PATCH", body: JSON.stringify({ action: "mark_unavailable" }) }
    ),
  substituteCartItem: (familyId: string, itemId: string, description: string) =>
    request<{ item: CartItem }>(`/families/${familyId}/grocery-cart/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "substitute", description }),
    }),
};
