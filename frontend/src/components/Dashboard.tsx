import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Task, ScheduleEntry, StatedPreference, StatedPreferenceCategory, MealPlanEntry, MealSlot, CartItem } from "../types";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import Calendar from "./Calendar";
import Celebration from "./Celebration";
import FamilyFavorites from "./FamilyFavorites";
import GemCastle from "./GemCastle";
import CastleAlert from "./CastleAlert";
import MealPlan, { nextSevenDays } from "./MealPlan";
import GroceryCart from "./GroceryCart";

// Placeholder until family selection / auth is wired up.
const DEMO_FAMILY_ID = "fam_demo";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [preferences, setPreferences] = useState<StatedPreference[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanEntry[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ gemsEarned: number } | null>(null);
  const [castleAlertTask, setCastleAlertTask] = useState<Task | null>(null);
  const [hasTriggeredCastleAlert, setHasTriggeredCastleAlert] = useState(false);

  const weekDays = nextSevenDays();
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];

  useEffect(() => {
    Promise.all([
      api.listTasks(DEMO_FAMILY_ID),
      api.listSchedules(DEMO_FAMILY_ID),
      api.listStatedPreferences(DEMO_FAMILY_ID),
      api.listMealPlan(DEMO_FAMILY_ID, weekStart, weekEnd),
      api.listCartItems(DEMO_FAMILY_ID),
    ])
      .then(([taskItems, scheduleItems, preferenceItems, mealPlanItems, cartItemsList]) => {
        setTasks(taskItems);
        setSchedule(scheduleItems);
        setPreferences(preferenceItems);
        setMealPlan(mealPlanItems);
        setCartItems(cartItemsList);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleComplete(task: Task) {
    try {
      const updated = await api.completeTask(DEMO_FAMILY_ID, task.taskId);
      setTasks((prev) => prev.map((t) => (t.taskId === updated.taskId ? updated : t)));
      setCelebration({ gemsEarned: updated.gemsAwarded - task.gemsAwarded });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddPreference(input: { memberId: string; category: StatedPreferenceCategory; statement: string }) {
    try {
      const created = await api.addStatedPreference(DEMO_FAMILY_ID, input);
      setPreferences((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function handleRemovePreference(preference: StatedPreference) {
    try {
      await api.removeStatedPreference(DEMO_FAMILY_ID, preference.preferenceId, preference.memberId);
      setPreferences((prev) => prev.filter((p) => p.preferenceId !== preference.preferenceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveMealPlanEntry(date: string, slot: MealSlot) {
    try {
      await api.removeMealPlanEntry(DEMO_FAMILY_ID, date, slot);
      setMealPlan((prev) => prev.filter((entry) => !(entry.date === date && entry.slot === slot)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleGenerateGroceryList() {
    const result = await api.generateGroceryListFromMealPlan(DEMO_FAMILY_ID, weekStart, weekEnd);
    const refreshed = await api.listCartItems(DEMO_FAMILY_ID);
    setCartItems(refreshed);
    return result;
  }

  async function handleAddCartItem(description: string) {
    try {
      const created = await api.addCartItem(DEMO_FAMILY_ID, { description });
      setCartItems((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMarkCartItemUnavailable(item: CartItem): Promise<string | null> {
    try {
      const { item: updated, suggestedSubstitute } = await api.markCartItemUnavailable(DEMO_FAMILY_ID, item.itemId);
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
      return suggestedSubstitute;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function handleConfirmCartItemSubstitute(item: CartItem, substituteDescription: string) {
    try {
      const { item: updated } = await api.confirmCartItemSubstitute(DEMO_FAMILY_ID, item.itemId, substituteDescription);
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCheckout(): Promise<string> {
    const { productsLinkUrl } = await api.checkoutGroceryCart(DEMO_FAMILY_ID);
    return productsLinkUrl;
  }

  return (
    <main className="min-h-screen bg-white p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      <header className="md:col-span-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/brand-mark.png" alt="" className="h-14 w-14 rounded-full ring-4 ring-olive-100" />
          <div>
            <h1 className="font-display text-3xl text-olive-700">YouEnjoyMyFamily</h1>
            <p className="text-olive-600 font-body">Today at a glance</p>
          </div>
        </div>
        <p className="font-display text-lg bg-olive-500 text-white rounded-full px-5 py-2 shadow-[var(--shadow-card)]">
          {totalGems} gems collected
        </p>
      </header>

      {error && (
        <p className="md:col-span-2 text-clay-700 bg-clay-100 rounded-card px-4 py-3">
          Couldn&apos;t reach the backend: {error}
        </p>
      )}

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

      <FamilyCard title="Meal plan" accent>
        <MealPlan
          entries={mealPlan}
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
          onCheckout={handleCheckout}
        />
      </FamilyCard>

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
