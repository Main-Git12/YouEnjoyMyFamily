import type { Task, ScheduleEntry, CartItem, StatedPreference } from "../types";

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
