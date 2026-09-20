import type { Task, ScheduleEntry, CartItem, StatedPreference, MealPlanEntry, MealSlot } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Read fresh (not cached at module scope) so tests can stub it per case.
  const familyApiKey = import.meta.env.VITE_FAMILY_API_KEY;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(familyApiKey ? { Authorization: `Bearer ${familyApiKey}` } : {}),
    },
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
  completeTask: (familyId: string, taskId: string) =>
    request<Task>(`/families/${familyId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done" }),
    }),
  listSchedules: (familyId: string, start?: string, end?: string) =>
    request<ScheduleEntry[]>(`/families/${familyId}/schedules?start=${start ?? ""}&end=${end ?? ""}`),
  listCartItems: (familyId: string) => request<CartItem[]>(`/families/${familyId}/grocery-cart`),
  addCartItem: (familyId: string, item: { description: string; quantity?: number }) =>
    request<CartItem>(`/families/${familyId}/grocery-cart/items`, { method: "POST", body: JSON.stringify(item) }),
  markCartItemUnavailable: (familyId: string, itemId: string) =>
    request<{ item: CartItem; suggestedSubstitute: string | null }>(
      `/families/${familyId}/grocery-cart/items/${itemId}`,
      { method: "PUT", body: JSON.stringify({ status: "unavailable" }) }
    ),
  confirmCartItemSubstitute: (familyId: string, itemId: string, substituteDescription: string) =>
    request<{ item: CartItem; suggestedSubstitute: string | null }>(
      `/families/${familyId}/grocery-cart/items/${itemId}`,
      { method: "PUT", body: JSON.stringify({ status: "substituted", substituteDescription }) }
    ),
  removeCartItem: (familyId: string, itemId: string) =>
    request<{ deleted: string }>(`/families/${familyId}/grocery-cart/items/${itemId}`, { method: "DELETE" }),
  checkoutGroceryCart: (familyId: string) =>
    request<{ productsLinkUrl: string }>(`/families/${familyId}/grocery-cart/checkout`, { method: "POST" }),
  listMealPlan: (familyId: string, start?: string, end?: string) =>
    request<MealPlanEntry[]>(`/families/${familyId}/meal-plan?start=${start ?? ""}&end=${end ?? ""}`),
  upsertMealPlanEntry: (familyId: string, date: string, slot: MealSlot, entry: { mealName: string; ingredients?: string[] }) =>
    request<MealPlanEntry>(`/families/${familyId}/meal-plan/${date}/${slot}`, {
      method: "PUT",
      body: JSON.stringify(entry),
    }),
  removeMealPlanEntry: (familyId: string, date: string, slot: MealSlot) =>
    request<{ deleted: string }>(`/families/${familyId}/meal-plan/${date}/${slot}`, { method: "DELETE" }),
  generateGroceryListFromMealPlan: (familyId: string, start?: string, end?: string) =>
    request<{ added: number; skipped: number }>(
      `/families/${familyId}/meal-plan/generate-grocery-list?start=${start ?? ""}&end=${end ?? ""}`,
      { method: "POST" }
    ),
  listStatedPreferences: (familyId: string) => request<StatedPreference[]>(`/families/${familyId}/stated-preferences`),
  addStatedPreference: (familyId: string, preference: Omit<StatedPreference, "preferenceId">) =>
    request<StatedPreference>(`/families/${familyId}/stated-preferences`, {
      method: "POST",
      body: JSON.stringify(preference),
    }),
  removeStatedPreference: (familyId: string, preferenceId: string, memberId: string) =>
    request<{ deleted: string }>(
      `/families/${familyId}/stated-preferences/${preferenceId}?memberId=${encodeURIComponent(memberId)}`,
      { method: "DELETE" }
    ),
};
