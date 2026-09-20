import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Task, ScheduleEntry, StatedPreference, StatedPreferenceCategory, MealPlanEntry, MealSlot, CartItem } from "../types";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import Calendar from "./Calendar";
import Celebration from "./Celebration";
import FamilyFavorites from "./FamilyFavorites";
import GemCastle from "./GemCastle";
import CastleAlert from "./CastleAlert";
import MealPlan from "./MealPlan";
import { weekFromOffset } from "../lib/dates";
import GroceryCart from "./GroceryCart";

// Placeholder until family selection / auth is wired up.
const DEMO_FAMILY_ID = "fam_demo";

// How often an idle screen re-reads the family's data, so a meal added on a
// phone shows up on the Echo Show (and vice versa) without anyone reloading.
const SYNC_INTERVAL_MS = 30_000;

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [preferences, setPreferences] = useState<StatedPreference[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanEntry[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [celebration, setCelebration] = useState<{ gemsEarned: number } | null>(null);
  const [castleAlertTask, setCastleAlertTask] = useState<Task | null>(null);
  const [hasTriggeredCastleAlert, setHasTriggeredCastleAlert] = useState(false);
  // 0 = the coming 7 days; the family can page forward to plan ahead.
  const [weekOffset, setWeekOffset] = useState(0);

  // Recomputed every render rather than memoized, so an always-on kitchen
  // display rolls over to the new day at midnight on its own.
  const weekDays = weekFromOffset(weekOffset);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];

  // Fetches but deliberately does not apply — the caller decides whether a
  // response that arrived late is still the one it asked for. Paging
  // between weeks quickly would otherwise let a slow earlier request land
  // last and overwrite the week actually on screen.
  const fetchEverything = useCallback(async () => {
    const [taskItems, scheduleItems, preferenceItems, mealPlanItems, cartItemsList] = await Promise.all([
      api.listTasks(DEMO_FAMILY_ID),
      api.listSchedules(DEMO_FAMILY_ID),
      api.listStatedPreferences(DEMO_FAMILY_ID),
      api.listMealPlan(DEMO_FAMILY_ID, weekStart, weekEnd),
      api.listCartItems(DEMO_FAMILY_ID),
    ]);
    return { taskItems, scheduleItems, preferenceItems, mealPlanItems, cartItemsList };
  }, [weekStart, weekEnd]);

  const applyEverything = useCallback((data: Awaited<ReturnType<typeof fetchEverything>>) => {
    setTasks(data.taskItems);
    setSchedule(data.scheduleItems);
    setPreferences(data.preferenceItems);
    setMealPlan(data.mealPlanItems);
    setCartItems(data.cartItemsList);
  }, []);

  // Runs on mount and again whenever the week on screen changes, so paging
  // to next week actually loads next week rather than relabelling this one.
  useEffect(() => {
    let superseded = false;
    fetchEverything()
      .then((data) => {
        if (superseded) return;
        applyEverything(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!superseded) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!superseded) setIsLoading(false);
      });
    return () => {
      superseded = true;
    };
  }, [fetchEverything, applyEverything]);

  // Keeps every screen in the house on the same page — a meal or grocery
  // item edited on someone's phone appears here on the next tick, and a
  // phone that's just been unlocked re-reads immediately rather than
  // showing whatever was on screen when it went to sleep. A failed
  // background sync stays silent: the last good data is better company
  // than an error banner over a screen nobody is even looking at.
  useEffect(() => {
    let superseded = false;
    const sync = () => {
      void fetchEverything()
        .then((data) => {
          if (!superseded) applyEverything(data);
        })
        .catch(() => undefined);
    };
    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") sync();
    };

    const interval = setInterval(sync, SYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      superseded = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [fetchEverything, applyEverything]);

  // Trigger the castle-attack event once per dashboard session, off data the
  // family already explicitly entered (a pending task's own assignee) —
  // never any inference about a child's behavior.
  useEffect(() => {
    if (hasTriggeredCastleAlert || tasks.length === 0) return;
    const candidates = tasks.filter((task) => task.status === "pending" && task.assignedTo);
    if (candidates.length === 0) return;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (!chosen) return;
    setCastleAlertTask(chosen);
    setHasTriggeredCastleAlert(true);
  }, [tasks, hasTriggeredCastleAlert]);

  const totalGems = tasks.reduce((sum, task) => sum + task.gemsAwarded, 0);

  // Every action funnels its failure here, and a later success clears it —
  // a stale error banner outliving the problem is its own bug.
  function reportError(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  // Unlike the silent background sync, a refresh someone actually asked for
  // owes them an answer when it fails.
  async function handleManualRefresh() {
    setIsSyncing(true);
    try {
      applyEverything(await fetchEverything());
      setError(null);
    } catch (err) {
      reportError(err);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleComplete(task: Task) {
    try {
      const updated = await api.completeTask(DEMO_FAMILY_ID, task.taskId);
      setTasks((prev) => prev.map((t) => (t.taskId === updated.taskId ? updated : t)));
      setCelebration({ gemsEarned: updated.gemsAwarded - task.gemsAwarded });
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleAddPreference(input: { memberId: string; category: StatedPreferenceCategory; statement: string }) {
    try {
      const created = await api.addStatedPreference(DEMO_FAMILY_ID, input);
      setPreferences((prev) => [...prev, created]);
      setError(null);
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  async function handleRemovePreference(preference: StatedPreference) {
    try {
      await api.removeStatedPreference(DEMO_FAMILY_ID, preference.preferenceId, preference.memberId);
      setPreferences((prev) => prev.filter((p) => p.preferenceId !== preference.preferenceId));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  function handleDefendCastle(task: Task) {
    setCastleAlertTask(null);
    void handleComplete(task);
  }

  async function handleSaveMealPlanEntry(date: string, slot: MealSlot, input: { mealName: string; ingredients: string[] }) {
    try {
      const saved = await api.upsertMealPlanEntry(DEMO_FAMILY_ID, date, slot, input);
      setMealPlan((prev) => [...prev.filter((entry) => !(entry.date === date && entry.slot === slot)), saved]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRemoveMealPlanEntry(date: string, slot: MealSlot) {
    try {
      await api.removeMealPlanEntry(DEMO_FAMILY_ID, date, slot);
      setMealPlan((prev) => prev.filter((entry) => !(entry.date === date && entry.slot === slot)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleGenerateGroceryList() {
    const result = await api.generateGroceryListFromMealPlan(DEMO_FAMILY_ID, weekStart, weekEnd);
    const refreshed = await api.listCartItems(DEMO_FAMILY_ID);
    setCartItems(refreshed);
    return result;
  }

  async function handleAddCartItem(description: string, quantity: number) {
    try {
      const created = await api.addCartItem(DEMO_FAMILY_ID, { description, quantity });
      setCartItems((prev) => [...prev, created]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRemoveCartItem(item: CartItem) {
    try {
      await api.removeCartItem(DEMO_FAMILY_ID, item.itemId);
      setCartItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleMarkCartItemUnavailable(item: CartItem): Promise<string | null> {
    try {
      const { item: updated, suggestedSubstitute } = await api.markCartItemUnavailable(DEMO_FAMILY_ID, item.itemId);
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
      setError(null);
      return suggestedSubstitute;
    } catch (err) {
      reportError(err);
      return null;
    }
  }

  async function handleConfirmCartItemSubstitute(item: CartItem, substituteDescription: string) {
    try {
      const { item: updated } = await api.confirmCartItemSubstitute(DEMO_FAMILY_ID, item.itemId, substituteDescription);
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCheckout(): Promise<string> {
    const { productsLinkUrl } = await api.checkoutGroceryCart(DEMO_FAMILY_ID);
    return productsLinkUrl;
  }

  return (
    <main className="min-h-screen bg-white p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      <header className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/brand-mark.png" alt="" className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-full ring-4 ring-olive-100" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl text-olive-700 truncate">YouEnjoyMyFamily</h1>
            <p className="text-olive-600 font-body">Today at a glance</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isSyncing}
            aria-label="Refresh from the family's other devices"
            className="text-sm text-olive-600 underline underline-offset-2 py-2 disabled:no-underline disabled:text-olive-400"
          >
            {isSyncing ? "Refreshing…" : "Refresh"}
          </button>
          <p className="font-display text-base sm:text-lg bg-olive-500 text-white rounded-full px-4 sm:px-5 py-2 shadow-[var(--shadow-card)]">
            {totalGems} gems collected
          </p>
        </div>
      </header>

      {error && (
        <p className="md:col-span-2 text-clay-700 bg-clay-100 rounded-card px-4 py-3">
          Couldn&apos;t reach the backend: {error}
        </p>
      )}

      {isLoading && (
        <p role="status" className="md:col-span-2 text-olive-600 italic text-center py-8">
          Loading your family&apos;s day&hellip;
        </p>
      )}

      {!isLoading && (
        <>
          <FamilyCard title="Today's tasks">
            <TaskList tasks={tasks} onComplete={handleComplete} />
          </FamilyCard>

          <FamilyCard title="Today's schedule" accent>
            <Calendar entries={schedule} />
          </FamilyCard>

          <FamilyCard title="Family favorites">
            <FamilyFavorites preferences={preferences} onAdd={handleAddPreference} onRemove={handleRemovePreference} />
          </FamilyCard>

          <FamilyCard title="Gem Castle">
            <GemCastle totalGems={totalGems} />
          </FamilyCard>

          <FamilyCard title="Meal plan">
            <MealPlan
              entries={mealPlan}
              days={weekDays}
              weekOffset={weekOffset}
              onWeekOffsetChange={setWeekOffset}
              onSave={handleSaveMealPlanEntry}
              onRemove={handleRemoveMealPlanEntry}
              onGenerateGroceryList={handleGenerateGroceryList}
            />
          </FamilyCard>

          <FamilyCard title="Grocery cart">
            <GroceryCart
              items={cartItems}
              onAdd={handleAddCartItem}
              onMarkUnavailable={handleMarkCartItemUnavailable}
              onConfirmSubstitute={handleConfirmCartItemSubstitute}
              onRemove={handleRemoveCartItem}
              onCheckout={handleCheckout}
            />
          </FamilyCard>
        </>
      )}

      {celebration && (
        <Celebration
          gemsEarned={celebration.gemsEarned}
          totalGems={totalGems}
          onDismiss={() => setCelebration(null)}
        />
      )}

      {castleAlertTask && (
        <CastleAlert task={castleAlertTask} onDefend={handleDefendCastle} onDismiss={() => setCastleAlertTask(null)} />
      )}
    </main>
  );
}
