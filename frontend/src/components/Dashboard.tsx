import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Task, TaskCompletion, ScheduleEntry, StatedPreference, StatedPreferenceCategory, MealPlanEntry, MealSlot, CartItem, RewardGoal, GemBalance, DueWindow } from "../types";
import { chooseThreatenedChore, type ThreatenedChore } from "../lib/gemThreats";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import ChoreLibrary, { type NewChore } from "./ChoreLibrary";
import Calendar from "./Calendar";
import Celebration from "./Celebration";
import FamilyFavorites from "./FamilyFavorites";
import GemCastle from "./GemCastle";
import GemThreatAlert from "./GemThreatAlert";
import PrizeGoal from "./PrizeGoal";
import MealPlan from "./MealPlan";
import { toLocalIsoDate, weekFromOffset } from "../lib/dates";
import { knownMembers } from "../lib/members";
import { buildInsights, INSIGHT_WINDOW_DAYS, type Insight } from "../lib/insights";
import Insights from "./Insights";
import RetimeChore from "./RetimeChore";
import DraftWeek from "./DraftWeek";
import { draftWeek, type DraftedMeal } from "../lib/routines";
import { getFamilyId } from "../lib/familyKey";
import GroceryCart from "./GroceryCart";

// Which family this screen belongs to, set once per device (see
// LinkDevice). Read at render rather than module load so a screen linked
// mid-session doesn't need a reload.
const FALLBACK_FAMILY_ID = "fam_demo";

// How often an idle screen re-reads the family's data, so a meal added on a
// phone shows up on the Echo Show (and vice versa) without anyone reloading.
const SYNC_INTERVAL_MS = 30_000;

interface DashboardProps {
  /** Raised when the backend rejects this device's key outright. */
  onSignedOut?: () => void;
}

export default function Dashboard({ onSignedOut }: DashboardProps = {}) {
  const familyId = getFamilyId() ?? FALLBACK_FAMILY_ID;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<TaskCompletion[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [preferences, setPreferences] = useState<StatedPreference[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanEntry[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [celebration, setCelebration] = useState<{ gemsEarned: number } | null>(null);
  const [rewardGoals, setRewardGoals] = useState<RewardGoal[]>([]);
  const [gemBalances, setGemBalances] = useState<GemBalance[]>([]);
  const [familyGems, setFamilyGems] = useState({ earned: 0, spent: 0, balance: 0 });
  const [threatened, setThreatened] = useState<ThreatenedChore | null>(null);
  const [dismissedThreatTaskIds, setDismissedThreatTaskIds] = useState<string[]>([]);
  const [choreBeingRetimed, setChoreBeingRetimed] = useState<string | null>(null);
  // True from the moment "defend" is tapped until the scenario closes
  // itself, so the celebration beat is not yanked off screen the instant
  // the chore goes green.
  const [defending, setDefending] = useState(false);
  // 0 = the coming 7 days; the family can page forward to plan ahead.
  const [weekOffset, setWeekOffset] = useState(0);

  // Recomputed every render rather than memoized, so an always-on kitchen
  // display rolls over to the new day at midnight on its own.
  const weekDays = weekFromOffset(weekOffset);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];
  // The cards show today and the week on screen, but the fetches reach
  // back over the insight window: a rhythm ("Tacos is a Tuesday thing",
  // "Wednesdays are the busy one") isn't visible in a single day's rows.
  // Each card filters back down to what it's meant to show.
  const today = toLocalIsoDate(new Date());
  // How far back the screen reasons over — see lib/insights.ts.
  const insightWindowStart = toLocalIsoDate(
    new Date(Date.now() - INSIGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  );

  // Fetches but deliberately does not apply — the caller decides whether a
  // response that arrived late is still the one it asked for. Paging
  // between weeks quickly would otherwise let a slow earlier request land
  // last and overwrite the week actually on screen.
  const fetchEverything = useCallback(async () => {
    const [taskItems, completionItems, scheduleItems, preferenceItems, mealPlanItems, cartItemsList, rewardGoalItems, gemBalanceItems] = await Promise.all([
      api.listTasks(familyId, today),
      api.listTaskCompletions(familyId, insightWindowStart, today),
      api.listSchedules(familyId, insightWindowStart, weekEnd),
      api.listStatedPreferences(familyId),
      api.listMealPlan(familyId, insightWindowStart, weekEnd),
      api.listCartItems(familyId),
      api.listRewardGoals(familyId),
      api.listGemBalances(familyId),
    ]);
    return { taskItems, completionItems, scheduleItems, preferenceItems, mealPlanItems, cartItemsList, rewardGoalItems, gemBalanceItems };
  }, [familyId, weekEnd, today, insightWindowStart]);

  // Bumped at the start *and* the end of every local write. A sync that
  // overlapped a write is holding a snapshot taken before the server saw it,
  // so applying it would un-tick the chore a child just completed and roll
  // the gem total backwards in front of them. Overlapping syncs are dropped;
  // the next tick reconciles.
  const writeSeq = useRef(0);

  async function guardedWrite<T>(write: () => Promise<T>): Promise<T> {
    writeSeq.current += 1;
    try {
      return await write();
    } finally {
      writeSeq.current += 1;
    }
  }

  const applyEverything = useCallback((data: Awaited<ReturnType<typeof fetchEverything>>) => {
    setTasks(data.taskItems);
    setCompletions(data.completionItems);
    setSchedule(data.scheduleItems);
    setPreferences(data.preferenceItems);
    setMealPlan(data.mealPlanItems);
    setCartItems(data.cartItemsList);
    setRewardGoals(data.rewardGoalItems);
    setGemBalances(data.gemBalanceItems.balances);
    setFamilyGems(data.gemBalanceItems.family);
  }, []);

  // Runs on mount and again whenever the week on screen changes, so paging
  // to next week actually loads next week rather than relabelling this one.
  useEffect(() => {
    let superseded = false;
    const writesAtStart = writeSeq.current;
    fetchEverything()
      .then((data) => {
        if (superseded || writeSeq.current !== writesAtStart) return;
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
      const writesAtStart = writeSeq.current;
      void fetchEverything()
        .then((data) => {
          if (superseded || writeSeq.current !== writesAtStart) return;
          applyEverything(data);
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

  // Raise a scenario when a chore has slipped past the part of the day the
  // family assigned it to. Re-checked whenever the chores change, so it can
  // come back later in the evening rather than firing once and never again.
  // Chores waved away stay waved away, so dismissing one doesn't just bring
  // the next one round in a loop.
  useEffect(() => {
    if (defending) return;
    const candidate = chooseThreatenedChore(tasks.filter((task) => !dismissedThreatTaskIds.includes(task.taskId)));
    setThreatened(candidate);
  }, [tasks, dismissedThreatTaskIds, defending]);

  // What the family has saved *now* — everything earned, minus what's been
  // claimed. The castle reflects the same thing, so taking a prize visibly
  // costs something rather than the total only ever climbing.
  //
  // Reported by the backend rather than added up here: a chore nobody is
  // named on still earns gems for the kingdom, so summing the per-child
  // balances would quietly drop them — and the screen would need every
  // completion row ever written just to do the arithmetic.
  const totalGems = familyGems.balance;

  // Each child's own spendable total, so their prize bar means something.
  const gemsByChild = Object.fromEntries(gemBalances.map((balance) => [balance.memberId, balance.balance]));

  /**
   * What the app has noticed, from the family's own records. Recomputed
   * each render rather than cached: it's arithmetic over data already in
   * hand, and a stale observation is worse than none.
   */
  const insights = buildInsights({ tasks, completions, mealPlan, cartItems, schedule, today });

  /**
   * A proposed set of dinners for the empty days of the week on screen,
   * built only from meals this family has actually cooked.
   */
  const weekDraft = draftWeek(mealPlan, weekDays);

  async function handleAcceptDraft(meals: DraftedMeal[]) {
    // One at a time rather than in parallel: they all write to the same
    // family, and a half-applied week is easier to understand than a
    // scatter of races.
    for (const meal of meals) {
      await handleSaveMealPlanEntry(meal.date, "dinner", { mealName: meal.mealName, ingredients: [] });
    }
  }

  /**
   * Acting on an observation. Each one only ever *proposes* — the family
   * taps, and the change is theirs. Nothing here happens on its own.
   */
  async function handleInsightAction(insight: Insight) {
    if (!insight.action) return;
    if (insight.action.kind === "add_to_list") {
      await handleAddCartItem(insight.action.payload, 1);
      return;
    }
    if (insight.action.kind === "plan_meal") {
      // Offered for the first free dinner slot in the week on screen, so
      // "plan it again" means something concrete rather than opening a form.
      const free = weekDays.find((day) => !mealPlan.some((entry) => entry.date === day && entry.slot === "dinner"));
      if (free) await handleSaveMealPlanEntry(free, "dinner", { mealName: insight.action.payload, ingredients: [] });
      return;
    }
    if (insight.action.kind === "reschedule_chore") {
      // Deliberately does not pick a new time itself. Which part of the day
      // a chore belongs in is a judgement about how this family's evening
      // actually runs, and the app doesn't get to make it — it just opens
      // the chore up so someone can.
      setChoreBeingRetimed(insight.action.payload);
    }
  }

  // Gathered from what the family has already entered, not a registry of
  // children the app keeps on its own.
  const members = knownMembers({ tasks, completions, goals: rewardGoals, balances: gemBalances });

  // Every action funnels its failure here, and a later success clears it —
  // a stale error banner outliving the problem is its own bug.
  function reportError(err: unknown) {
    // A rejected key is the one failure the screen can't retry its way out
    // of, so it goes back to setup instead of looping on a banner.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      onSignedOut?.();
      return;
    }
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

  // Returns whether it landed rather than throwing: the task list fires this
  // without awaiting, and a rejected promise nobody is holding is an
  // unhandled rejection.
  /**
   * Ticks the chore off straight away and reconciles behind it.
   *
   * A child taps a circle and expects the gems, not a pause. Waiting for a
   * round-trip on kitchen wi-fi reads as a dead button, and the usual next
   * move is to tap it again. If the write fails, everything goes back
   * exactly as it was and the banner explains why.
   *
   * Returns whether it landed rather than throwing: the task list fires
   * this without awaiting, and a rejected promise nobody is holding is an
   * unhandled rejection.
   */
  async function handleComplete(task: Task, options: { celebrate?: boolean } = {}): Promise<boolean> {
    const alreadyCounted = completions.some((c) => c.taskId === task.taskId && c.date === task.date);
    const optimistic: Task = { ...task, status: "done", gemsAwarded: task.gemValue };

    setTasks((prev) => prev.map((t) => (t.taskId === task.taskId ? optimistic : t)));
    if (!alreadyCounted) {
      setCompletions((prev) => [
        ...prev,
        {
          taskId: task.taskId,
          date: task.date,
          title: task.title,
          memberId: task.assignedTo,
          gemsAwarded: task.gemValue,
        },
      ]);
      creditGems(task.assignedTo, task.gemValue);
      setFamilyGems((prev) => ({ ...prev, earned: prev.earned + task.gemValue, balance: prev.balance + task.gemValue }));
    }
    // A chore finished from inside a threat scenario has its own
    // celebration in the overlay; two at once is just noise.
    if (options.celebrate !== false) setCelebration({ gemsEarned: task.gemValue });

    try {
      const updated = await guardedWrite(() => api.completeTask(familyId, task.taskId, today));
      // The server is the authority on what was actually awarded — it pays
      // nothing the second time a chore is ticked on the same day.
      setTasks((prev) => prev.map((t) => (t.taskId === updated.taskId ? updated : t)));
      setError(null);
      return true;
    } catch (err) {
      // Put it all back. A chore that silently un-ticks itself later is
      // worse than one that never appeared to tick at all.
      setTasks((prev) => prev.map((t) => (t.taskId === task.taskId ? task : t)));
      if (!alreadyCounted) {
        setCompletions((prev) => prev.filter((c) => !(c.taskId === task.taskId && c.date === task.date)));
        creditGems(task.assignedTo, -task.gemValue);
        setFamilyGems((prev) => ({ ...prev, earned: prev.earned - task.gemValue, balance: prev.balance - task.gemValue }));
      }
      setCelebration(null);
      reportError(err);
      return false;
    }
  }

  async function handleRetimeChore(taskId: string, dueWindow: DueWindow) {
    try {
      const updated = await guardedWrite(() => api.updateTask(familyId, taskId, { dueWindow }));
      setTasks((prev) => prev.map((t) => (t.taskId === updated.taskId ? updated : t)));
      setChoreBeingRetimed(null);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleAddChore(chore: NewChore) {
    try {
      const created = await guardedWrite(() =>
        api.createTask(
          familyId,
          {
            title: chore.title,
            gemValue: chore.gemValue,
            dueWindow: chore.dueWindow,
            assignedTo: chore.assignedTo,
            recurrence: chore.recurrence,
          },
          today
        )
      );
      setTasks((prev) => [...prev, created]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleAddPreference(input: { memberId: string; category: StatedPreferenceCategory; statement: string }) {
    try {
      const created = await guardedWrite(() => api.addStatedPreference(familyId, input));
      setPreferences((prev) => [...prev, created]);
      setError(null);
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  async function handleRemovePreference(preference: StatedPreference) {
    try {
      await guardedWrite(() => api.removeStatedPreference(familyId, preference.preferenceId, preference.memberId));
      setPreferences((prev) => prev.filter((p) => p.preferenceId !== preference.preferenceId));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleDefendGems() {
    if (!threatened) return;
    setDefending(true);
    const saved = await handleComplete(threatened.task, { celebrate: false });
    if (!saved) {
      // Throwing is how the overlay knows to stay open with the button live
      // again; the error banner is already up.
      setDefending(false);
      throw new Error("The chore didn't save");
    }
  }

  function handleDismissThreat() {
    const taskId = threatened?.task.taskId;
    if (taskId) setDismissedThreatTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    setDefending(false);
    setThreatened(null);
  }

  /**
   * Moves a child's balance locally, so the prize bar responds to the tap.
   * Takes a negative to undo itself when an optimistic write is rolled back.
   */
  function creditGems(memberId: string | null, gems: number) {
    if (!memberId || gems === 0) return;
    setGemBalances((prev) => {
      const existing = prev.find((balance) => balance.memberId === memberId);
      if (!existing) {
        return [...prev, { memberId, earned: gems, spent: 0, balance: gems }];
      }
      return prev.map((balance) =>
        balance.memberId === memberId
          ? { ...balance, earned: balance.earned + gems, balance: balance.balance + gems }
          : balance
      );
    });
  }

  async function handleClaimRewardGoal(memberId: string) {
    try {
      const { balance, claim } = await guardedWrite(() => api.claimRewardGoal(familyId, memberId));
      // The prize is taken, so it leaves the board and the gems leave with it.
      setRewardGoals((prev) => prev.filter((goal) => goal.memberId !== memberId));
      setGemBalances((prev) => {
        const seen = prev.some((existing) => existing.memberId === memberId);
        return seen ? prev.map((existing) => (existing.memberId === memberId ? balance : existing)) : [...prev, balance];
      });
      setFamilyGems((prev) => ({ ...prev, spent: prev.spent + claim.gemCost, balance: prev.balance - claim.gemCost }));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleSetRewardGoal(memberId: string, goal: { title: string; gemCost: number }) {
    try {
      const saved = await guardedWrite(() => api.setRewardGoal(familyId, memberId, goal));
      setRewardGoals((prev) => [...prev.filter((g) => g.memberId !== memberId), saved]);
      setError(null);
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  async function handleSaveMealPlanEntry(date: string, slot: MealSlot, input: { mealName: string; ingredients: string[] }) {
    try {
      const saved = await guardedWrite(() => api.upsertMealPlanEntry(familyId, date, slot, input));
      setMealPlan((prev) => [...prev.filter((entry) => !(entry.date === date && entry.slot === slot)), saved]);
      setError(null);
    } catch (err) {
      reportError(err);
      // Rethrown so the editor stays open with the meal still in it.
      throw err;
    }
  }

  async function handleRemoveMealPlanEntry(date: string, slot: MealSlot) {
    try {
      await guardedWrite(() => api.removeMealPlanEntry(familyId, date, slot));
      setMealPlan((prev) => prev.filter((entry) => !(entry.date === date && entry.slot === slot)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleGenerateGroceryList() {
    try {
      const result = await guardedWrite(() => api.generateGroceryListFromMealPlan(familyId, weekStart, weekEnd));
      setCartItems(await api.listCartItems(familyId));
      setError(null);
      return result;
    } catch (err) {
      reportError(err);
      throw err;
    }
  }

  async function handleAddCartItem(description: string, quantity: number) {
    try {
      const created = await guardedWrite(() => api.addCartItem(familyId, { description, quantity }));
      setCartItems((prev) => [...prev, created]);
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRemoveCartItem(item: CartItem) {
    try {
      await guardedWrite(() => api.removeCartItem(familyId, item.itemId));
      setCartItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRestoreCartItem(item: CartItem) {
    try {
      const { item: updated } = await guardedWrite(() => api.restoreCartItem(familyId, item.itemId));
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleMarkCartItemUnavailable(item: CartItem): Promise<string | null> {
    try {
      const { item: updated, suggestedSubstitute } = await guardedWrite(() => api.markCartItemUnavailable(familyId, item.itemId));
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
      const { item: updated } = await guardedWrite(() => api.confirmCartItemSubstitute(familyId, item.itemId, substituteDescription));
      setCartItems((prev) => prev.map((i) => (i.itemId === updated.itemId ? updated : i)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCheckout(): Promise<string> {
    const { productsLinkUrl } = await api.checkoutGroceryCart(familyId);
    return productsLinkUrl;
  }

  return (
    <main className="min-h-screen bg-white p-4 sm:p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-start">
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
            className="text-sm text-olive-600 underline underline-offset-2 py-2 disabled:no-underline disabled:text-olive-600"
          >
            {isSyncing ? "Refreshing…" : "Refresh"}
          </button>
          <p className="font-display text-base sm:text-lg bg-olive-600 text-white rounded-full px-4 sm:px-5 py-2 shadow-[var(--shadow-card)]">
            {totalGems} gems collected
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="md:col-span-2 text-clay-900 bg-clay-100 rounded-card px-4 py-3">
          {error}
        </p>
      )}

      {isLoading && (
        <p role="status" className="md:col-span-2 text-olive-600 italic text-center py-8">
          Loading your family&apos;s day&hellip;
        </p>
      )}

      {!isLoading && (
        <>
          <FamilyCard title="Today's chores" hero>
            <TaskList tasks={tasks} onComplete={handleComplete} />
            <ChoreLibrary onAdd={handleAddChore} members={members} />
          </FamilyCard>

          <FamilyCard title="What we've noticed">
            <Insights insights={insights} onAct={handleInsightAction} />
          </FamilyCard>

          <FamilyCard title="Working toward">
            <PrizeGoal
              goals={rewardGoals}
              gemsByChild={gemsByChild}
              onSetGoal={handleSetRewardGoal}
              onClaim={handleClaimRewardGoal}
              members={members}
            />
          </FamilyCard>

          <FamilyCard title="Today's schedule" accent>
            <Calendar entries={schedule.filter((entry) => entry.date === today)} />
          </FamilyCard>

          <FamilyCard title="Family favorites">
            <FamilyFavorites preferences={preferences} onAdd={handleAddPreference} onRemove={handleRemovePreference} />
          </FamilyCard>

          <FamilyCard title="Gem Castle">
            <GemCastle totalGems={totalGems} />
          </FamilyCard>

          <FamilyCard title="Meal plan">
            <MealPlan
              entries={mealPlan.filter((entry) => weekDays.includes(entry.date))}
              days={weekDays}
              weekOffset={weekOffset}
              onWeekOffsetChange={setWeekOffset}
              onSave={handleSaveMealPlanEntry}
              onRemove={handleRemoveMealPlanEntry}
              onGenerateGroceryList={handleGenerateGroceryList}
            />
            <DraftWeek draft={weekDraft} onAccept={handleAcceptDraft} />
          </FamilyCard>

          <FamilyCard title="Grocery cart">
            <GroceryCart
              items={cartItems}
              onAdd={handleAddCartItem}
              onMarkUnavailable={handleMarkCartItemUnavailable}
              onConfirmSubstitute={handleConfirmCartItemSubstitute}
              onRemove={handleRemoveCartItem}
              onRestore={handleRestoreCartItem}
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

      {choreBeingRetimed && (() => {
        const task = tasks.find((t) => t.taskId === choreBeingRetimed);
        return task ? (
          <RetimeChore
            task={task}
            onChoose={(dueWindow) => handleRetimeChore(task.taskId, dueWindow)}
            onDismiss={() => setChoreBeingRetimed(null)}
          />
        ) : null;
      })()}

      {threatened && (
        <GemThreatAlert threatened={threatened} onDefend={handleDefendGems} onDismiss={handleDismissThreat} />
      )}
    </main>
  );
}
