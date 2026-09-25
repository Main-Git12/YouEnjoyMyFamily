import type { Task, TaskCompletion, ScheduleEntry, CartItem, StatedPreference, MealPlanEntry, MealSlot, RewardGoal, GemBalance, GemBalanceReport, Routine, RoutineRun, RoutineStep } from "../types";

import { getFamilyApiKey } from "./familyKey";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

// Long enough for a slow phone on a weak signal, short enough that a card
// doesn't sit there spinning for good. Without it a hung request never
// settles and the screen waits forever.
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * An API failure with something a family can actually read.
 *
 * The raw form — "Request failed: 401 /families/fam_demo/tasks" — is both
 * wrong and useless on a kitchen wall: a 401 means the backend answered
 * and turned us away, not that it couldn't be reached. `status` is kept so
 * callers can still tell the cases apart.
 */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function friendlyMessage(status: number): string {
  if (status === 401 || status === 403) return "This screen isn't signed in to the family account any more.";
  if (status === 404) return "That isn't there any more — someone may have removed it on another device.";
  if (status === 409) return "That was just changed on another screen. Have a look and try again.";
  if (status === 429) return "The family account is being asked for too much at once. Try again in a moment.";
  if (status >= 500) return "The family account is having a moment. It usually sorts itself out shortly.";
  return "Something about that request wasn't right.";
}

/** A blip is worth one quiet retry; a refusal is not. */
function isWorthRetrying(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === null || error.status >= 500;
  return true;
}

async function attempt<T>(path: string, options: RequestInit): Promise<T> {
  // Read fresh (not cached at module scope) so a device linked mid-session
  // starts authenticating without a reload, and so tests can stub it.
  const familyApiKey = getFamilyApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(familyApiKey ? { Authorization: `Bearer ${familyApiKey}` } : {}),
      },
      ...options,
    });

    if (!response.ok) throw new ApiError(friendlyMessage(response.status), response.status);
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("The family account took too long to answer.", null);
    }
    throw new ApiError("Can't reach the family account — check the wi-fi.", null);
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    return await attempt<T>(path, options);
  } catch (err) {
    // One retry, and only for the failures a retry can actually fix. A 401
    // or a 404 will say exactly the same thing the second time. Reads only:
    // a timed-out POST may already have landed on the server, so repeating
    // it would add the task twice or claim the same prize twice.
    const isRead = (options.method ?? "GET").toUpperCase() === "GET";
    if (!isRead || !isWorthRetrying(err)) throw err;
    return attempt<T>(path, options);
  }
}

export const api = {
  // `date` is always the caller's own local date. The server can't work it
  // out — a kitchen screen in Ohio asking at 9pm means *its* today, not
  // UTC's tomorrow.
  listTasks: (familyId: string, date: string) =>
    request<Task[]>(`/families/${familyId}/tasks?date=${date}`),
  createTask: (familyId: string, task: Pick<Task, "title"> & Partial<Task>, date: string) =>
    request<Task>(`/families/${familyId}/tasks?date=${date}`, { method: "POST", body: JSON.stringify(task) }),
  completeTask: (familyId: string, taskId: string, date: string) =>
    request<Task>(`/families/${familyId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done", date }),
    }),
  // What got done over a range. Bounded on purpose: the screen only needs
  // recent history to reason about streaks and habits, and the running gem
  // totals come from the balances endpoint rather than by adding up every
  // row ever written.
  listTaskCompletions: (familyId: string, start: string, end: string) =>
    request<TaskCompletion[]>(`/families/${familyId}/task-completions?start=${start}&end=${end}`),
  updateTask: (familyId: string, taskId: string, patch: Partial<Pick<Task, "title" | "gemValue" | "dueWindow" | "recurrence" | "assignedTo">>) =>
    request<Task>(`/families/${familyId}/tasks/${taskId}`, { method: "PUT", body: JSON.stringify(patch) }),
  reopenTask: (familyId: string, taskId: string, date: string) =>
    request<Task>(`/families/${familyId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "pending", date }),
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
  restoreCartItem: (familyId: string, itemId: string) =>
    request<{ item: CartItem; suggestedSubstitute: string | null }>(
      `/families/${familyId}/grocery-cart/items/${itemId}`,
      { method: "PUT", body: JSON.stringify({ status: "pending" }) }
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
  listRewardGoals: (familyId: string) => request<RewardGoal[]>(`/families/${familyId}/reward-goals`),
  setRewardGoal: (familyId: string, memberId: string, goal: { title: string; gemCost: number }) =>
    request<RewardGoal>(`/families/${familyId}/reward-goals/${encodeURIComponent(memberId)}`, {
      method: "PUT",
      body: JSON.stringify(goal),
    }),
  listGemBalances: (familyId: string) => request<GemBalanceReport>(`/families/${familyId}/gem-balances`),
  claimRewardGoal: (familyId: string, memberId: string) =>
    request<{ claim: { title: string; gemCost: number }; balance: GemBalance }>(
      `/families/${familyId}/reward-goals/${encodeURIComponent(memberId)}/claim`,
      { method: "POST" }
    ),
  clearRewardGoal: (familyId: string, memberId: string) =>
    request<{ deleted: string }>(`/families/${familyId}/reward-goals/${encodeURIComponent(memberId)}`, {
      method: "DELETE",
    }),
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
  listRoutines: (familyId: string) => request<Routine[]>(`/families/${familyId}/routines`),
  createRoutine: (
    familyId: string,
    routine: Omit<Routine, "routineId" | "steps" | "active"> & { steps: Omit<RoutineStep, "stepId">[]; active?: boolean }
  ) => request<Routine>(`/families/${familyId}/routines`, { method: "POST", body: JSON.stringify(routine) }),
  updateRoutine: (
    familyId: string,
    routineId: string,
    patch: Partial<Omit<Routine, "routineId" | "steps">> & { steps?: Omit<RoutineStep, "stepId">[] }
  ) => request<Routine>(`/families/${familyId}/routines/${routineId}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteRoutine: (familyId: string, routineId: string) =>
    request<{ deleted: string }>(`/families/${familyId}/routines/${routineId}`, { method: "DELETE" }),
  listRoutineRuns: (familyId: string, routineId: string, start: string, end: string) =>
    request<RoutineRun[]>(`/families/${familyId}/routines/${routineId}/runs?start=${start}&end=${end}`),
  /**
   * Writes the whole of today's run, every time. It is a PUT to a key built
   * from the caller's own date, so it is idempotent by construction — which
   * is what lets the one write this screen does happen on every tick of the
   * morning without the retry in `request` being a hazard.
   */
  saveRoutineRun: (familyId: string, routineId: string, run: Omit<RoutineRun, "routineId">) =>
    request<RoutineRun>(`/families/${familyId}/routines/${routineId}/runs`, {
      method: "PUT",
      body: JSON.stringify(run),
    }),
};
