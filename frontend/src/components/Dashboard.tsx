import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import type { Task, TaskCompletion, ScheduleEntry, StatedPreference, StatedPreferenceCategory, MealPlanEntry, MealSlot, CartItem, RewardGoal, GemBalance, DueWindow, Routine, RoutineRun, RoutineStep, FocusBlock } from "../types";
import { chooseThreatenedChore, type ThreatenedChore } from "../lib/gemThreats";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import ChoreLibrary, { type NewChore } from "./ChoreLibrary";
import Calendar from "./Calendar";
import Celebration from "./Celebration";
import FamilyFavorites from "./FamilyFavorites";
import GemThreatAlert from "./GemThreatAlert";
import PrizeGoal from "./PrizeGoal";
import MealPlan from "./MealPlan";
import { toLocalIsoDate, weekFromOffset } from "../lib/dates";
import { knownMembers } from "../lib/members";
import { greeting } from "../lib/timeOfDay";
import { buildInsights, INSIGHT_WINDOW_DAYS, type Insight } from "../lib/insights";
import Insights from "./Insights";
import RetimeChore from "./RetimeChore";
import DraftWeek from "./DraftWeek";
import { draftWeek, type DraftedMeal } from "../lib/routines";
import { getFamilyId } from "../lib/familyKey";
import GroceryCart from "./GroceryCart";
import Kitchen from "./Kitchen";
import CastleOverlay from "./CastleOverlay";
import { planPanels, drawerLabel, type PanelId } from "../lib/dashboardLayout";
import type { CardSize } from "./FamilyCard";
import { currentWindow } from "../lib/timeOfDay";

/**
 * How each window reads in a sentence. "1 left before after school" is
 * what you get from pasting a label into a template; a person says "one
 * to go after school".
 */
const WHEN_IT_IS: Record<Exclude<DueWindow, "anytime">, string> = {
  morning: "this morning",
  after_school: "after school",
  after_dinner: "after dinner",
  bedtime: "before bed",
};
import MorningRoutine from "./MorningRoutine";
import MorningLaunch from "./MorningLaunch";
import { planRoutine, appliesOn, isRoutineDue, type PlannedStep } from "../lib/routinePlan";
import FocusDay from "./FocusDay";
import FocusSession from "./FocusSession";
import { suggestBlockLength } from "../lib/focusRhythm";

// Which family this screen belongs to, set once per device (see
// LinkDevice). Read at render rather than module load so a screen linked
// mid-session doesn't need a reload.
const FALLBACK_FAMILY_ID = "fam_demo";

// How often an idle screen re-reads the family's data, so a meal added on a
// phone shows up on the Echo Show (and vice versa) without anyone reloading.
const SYNC_INTERVAL_MS = 30_000;

// How often the morning countdown re-reads the clock. Fast enough that
// "6 min spare" doesn't sit there lying while the minute turns over, slow
// enough that it isn't re-rendering the screen for its own sake.
const CLOCK_TICK_MS = 15_000;

// How far back the routine engine looks to learn how long each step
// actually takes. Four weeks is about twenty school mornings — enough for
// a median to mean something, recent enough to still describe this term.
const ROUTINE_HISTORY_DAYS = 28;

// How long the launch screen stays up after the last step is ticked.
// `isRoutineDue` goes false the instant the routine is finished, so without
// this the screen would vanish under the hand that just finished it — and
// "out the door, with 12 minutes to spare" is the whole payoff of the
// thing. It is the reason anyone plays along again tomorrow.
const MORNING_CELEBRATION_MS = 90_000;

/**
 * Has this routine only just finished?
 *
 * `isRoutineDue` goes false the instant the last step is ticked, so
 * without this the launch screen would vanish under the hand that
 * finished it — and "out the door, with 12 minutes to spare" is the whole
 * payoff, and the reason anyone plays along again tomorrow.
 *
 * Read off the run's own `finishedAt` rather than held in state, so it
 * survives a re-render, a background sync, or another screen in the house
 * writing the same row.
 */
function justFinishedRecently(run: RoutineRun | null, now: Date): boolean {
  if (!run?.finishedAt) return false;
  return now.getTime() - Date.parse(run.finishedAt) < MORNING_CELEBRATION_MS;
}

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
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineRuns, setRoutineRuns] = useState<RoutineRun[]>([]);
  // Set when someone taps "back to the dashboard", so the launch screen
  // doesn't immediately reassert itself over whatever they wanted to look
  // at. Cleared when the routine next finishes or the day rolls over.
  const [launchDismissedFor, setLaunchDismissedFor] = useState<string | null>(null);
  // Which routine "Start now" opened, if any — an id rather than a flag,
  // so tapping it on the morning card can't open bedtime's plan.
  const [launchForced, setLaunchForced] = useState<string | null>(null);
  // Re-read on a timer so the countdown is live. Held in state rather than
  // read at render because nothing else would re-render the screen between
  // syncs, and a stalled countdown is worse than no countdown.
  const [clock, setClock] = useState(() => new Date());
  const [focusBlocks, setFocusBlocks] = useState<FocusBlock[]>([]);
  const [focusOpen, setFocusOpen] = useState(false);
  const [castleOpen, setCastleOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  /**
   * Routines, and the recent runs of the morning one.
   *
   * Deliberately not folded into `fetchEverything`: that is a single
   * `Promise.all` of independent calls, and this is a dependent pair — the
   * runs can't be asked for until the routine list says which routine to
   * ask about.
   */
  const fetchRoutines = useCallback(async () => {
    const routineItems = await api.listRoutines(familyId);
    if (routineItems.length === 0) return { routineItems, runItems: [] as RoutineRun[] };
    const historyStart = toLocalIsoDate(new Date(Date.now() - ROUTINE_HISTORY_DAYS * 24 * 60 * 60 * 1000));
    // One call per routine. A household has two or three, so this stays
    // cheaper than adding an index to fetch them together would be.
    const perRoutine = await Promise.all(
      routineItems.map((routine) => api.listRoutineRuns(familyId, routine.routineId, historyStart, today))
    );
    return { routineItems, runItems: perRoutine.flat() };
  }, [familyId, today]);

  /**
   * Blocks of focused work. The same four weeks as the routine history:
   * enough for "which block length actually holds" to mean something,
   * recent enough to still describe how this month is going.
   */
  const fetchFocusBlocks = useCallback(async () => {
    const start = toLocalIsoDate(new Date(Date.now() - ROUTINE_HISTORY_DAYS * 24 * 60 * 60 * 1000));
    return api.listFocusBlocks(familyId, start, today);
  }, [familyId, today]);

  // Bumped at the start *and* the end of every local write. A sync that
  // overlapped a write is holding a snapshot taken before the server saw it,
  // so applying it would un-tick the chore a child just completed and roll
  // the gem total backwards in front of them. Overlapping syncs are dropped;
  // the next tick reconciles.
  const writeSeq = useRef(0);

  /**
   * When the routine on screen actually began, as `<routineId>:<date>`.
   *
   * Without this the first step of every morning was recorded as taking no
   * time at all: on the first tick there is no previous step to start from
   * and no run row yet, so the start fell back to the moment it finished.
   * Two mornings of that and the plan believed getting dressed was free,
   * and told a family they had fourteen minutes spare while they were
   * twelve minutes late — the exact failure the whole feature exists to
   * prevent.
   */
  const routineOpenedAt = useRef<{ key: string; at: string } | null>(null);

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

  // Loaded alongside the main fetch. A failure here is quiet: a screen
  // that can't reach the routine still shows the day perfectly well, and
  // an error banner over the whole dashboard because the morning list
  // didn't load would be out of proportion.
  useEffect(() => {
    let superseded = false;
    void fetchRoutines()
      .then(({ routineItems, runItems }) => {
        if (superseded) return;
        setRoutines(routineItems);
        setRoutineRuns(runItems);
      })
      .catch(() => undefined);
    void fetchFocusBlocks()
      .then((blocks) => {
        if (!superseded) setFocusBlocks(blocks);
      })
      .catch(() => undefined);
    return () => {
      superseded = true;
    };
  }, [fetchRoutines, fetchFocusBlocks]);

  /**
   * The countdown's own clock.
   *
   * Only runs while a morning routine exists, so a household that has
   * never set one up isn't re-rendering its dashboard four times a minute
   * for a feature it doesn't use.
   */
  useEffect(() => {
    if (!routines.some((routine) => routine.active)) return;
    const interval = setInterval(() => setClock(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [routines]);

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
   * The morning, as it stands right now.
   *
   * Recomputed each render off `clock` rather than memoized: it is
   * arithmetic over rows already in hand, and a countdown that has
   * quietly stopped updating is worse than no countdown at all.
   */
  /**
   * Every routine that runs today, each with its own plan.
   *
   * Not just the morning one: the same engine drives bedtime, and the
   * screen should follow whichever is actually happening. Runs are kept in
   * one list and filtered per routine, so a step ticked in one can't be
   * read as belonging to the other.
   */
  function planFor(routine: Routine) {
    const history = routineRuns.filter((run) => run.routineId === routine.routineId);
    const todayRun = history.find((run) => run.date === today) ?? null;
    return {
      routine,
      todayRun,
      plan: planRoutine({ routine, history, today: todayRun, isoDate: today, now: clock }),
    };
  }

  const routinesToday = routines.filter((routine) => appliesOn(routine, clock)).map(planFor);

  // The one to actually put on screen. `isRoutineDue` is a narrow window
  // around each routine's own anchor, so in practice at most one qualifies;
  // if two ever overlap, the nearer deadline is the more urgent.
  const dueRoutine =
    [...routinesToday]
      .filter((entry) => isRoutineDue(entry.plan, clock) || justFinishedRecently(entry.todayRun, clock))
      .sort((a, b) => a.plan.anchorAt.getTime() - b.plan.anchorAt.getTime())[0] ?? null;

  // A forced start is planned even when the routine isn't set to run
  // today — someone tapping "Start now" on a Saturday means it, and
  // refusing on the grounds that it's the weekend would just be obtuse.
  const forcedRoutine = launchForced
    ? (() => {
        const routine = routines.find((candidate) => candidate.routineId === launchForced);
        return routine ? planFor(routine) : null;
      })()
    : null;
  const activeRoutine = forcedRoutine ?? dueRoutine;
  const routineOfKind = (kind: Routine["kind"]) => routines.find((routine) => routine.kind === kind) ?? null;
  const planOfKind = (kind: Routine["kind"]) =>
    routinesToday.find((entry) => entry.routine.kind === kind)?.plan ?? null;
  const morningRoutine = routineOfKind("morning");
  const morningPlan = planOfKind("morning");
  const bedtimeRoutine = routineOfKind("bedtime");
  const bedtimePlan = planOfKind("bedtime");
  // The launch screen takes over when the morning is actually due — or
  // when someone asked for it. Dismissal is per-day, so waving it away to
  // check the calendar doesn't switch the feature off for good.
  const showRoutineLaunch = activeRoutine !== null && launchDismissedFor !== today;

  // Stamped during render rather than in an effect, because the very first
  // tick can land before an effect has run — and that tick is precisely
  // the one that was being recorded as instantaneous.
  if (showRoutineLaunch && activeRoutine) {
    const key = `${activeRoutine.routine.routineId}:${today}`;
    if (routineOpenedAt.current?.key !== key) {
      routineOpenedAt.current = { key, at: activeRoutine.todayRun?.startedAt ?? new Date().toISOString() };
    }
  }

  /**
   * Writes the whole of today's run, every time.
   *
   * The endpoint is a PUT keyed on the family's own date, so this is
   * idempotent by construction — which is what makes it safe to fire on
   * every tick of a morning where the wi-fi is patchy and someone is
   * tapping quickly.
   */
  async function saveRun(routineId: string, steps: RoutineRun["steps"], finished: boolean) {
    const startedAt = steps[0]?.startedAt ?? new Date().toISOString();
    const run: Omit<RoutineRun, "routineId"> = {
      date: today,
      startedAt,
      finishedAt: finished ? new Date().toISOString() : null,
      steps,
    };
    // Applied locally first: a child taps "Done" and the next step has to
    // appear now, not after a round-trip on kitchen wi-fi.
    setRoutineRuns((prev) => [
      // Keyed on routine *and* date: with more than one routine a day,
      // filtering on date alone would drop this morning's run when
      // bedtime's first step was ticked.
      ...prev.filter((existing) => !(existing.date === today && existing.routineId === routineId)),
      { routineId, ...run },
    ]);
    try {
      await guardedWrite(() => api.saveRoutineRun(familyId, routineId, run));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  /**
   * Ticking a step off. The step's own start time is when the one before
   * it finished — or now, for the first — so the durations this learns
   * from are the real elapsed time rather than a stopwatch someone had to
   * remember to press.
   */
  function handleFinishStep(step: PlannedStep) {
    if (!activeRoutine) return;
    const existing = activeRoutine.todayRun?.steps ?? [];
    const finishedAt = new Date().toISOString();
    const previous = existing[existing.length - 1];
    // A step starts when the one before it finished; the first one starts
    // when the routine did. Falling through to `finishedAt` would record
    // it as instantaneous, so it is the last resort and not the usual path.
    const openedAt =
      routineOpenedAt.current?.key === `${activeRoutine.routine.routineId}:${today}`
        ? routineOpenedAt.current.at
        : undefined;
    const startedAt = previous?.finishedAt ?? activeRoutine.todayRun?.startedAt ?? openedAt ?? finishedAt;
    const already = existing.find((entry) => entry.stepId === step.stepId);
    const steps: RoutineRun["steps"] = already
      ? existing.map((entry) => (entry.stepId === step.stepId ? { ...entry, finishedAt } : entry))
      : [...existing, { stepId: step.stepId, title: step.title, startedAt, finishedAt }];
    const finished = activeRoutine.routine.steps.every((defined) =>
      steps.some((entry) => entry.stepId === defined.stepId && entry.finishedAt)
    );
    void saveRun(activeRoutine.routine.routineId, steps, finished);
  }

  /** A mis-tap on a wall screen at seven in the morning is routine. */
  function handleUndoStep(step: PlannedStep) {
    if (!activeRoutine) return;
    const steps = (activeRoutine.todayRun?.steps ?? []).filter((entry) => entry.stepId !== step.stepId);
    void saveRun(activeRoutine.routine.routineId, steps, false);
  }

  async function handleSaveRoutine(
    input: { name: string; anchorTime: string; daysOfWeek: number[]; steps: Omit<RoutineStep, "stepId">[] },
    kind: Routine["kind"]
  ) {
    const existing = routineOfKind(kind);
    const saved = existing
      ? await guardedWrite(() => api.updateRoutine(familyId, existing.routineId, input))
      : await guardedWrite(() => api.createRoutine(familyId, { ...input, kind }));
    setRoutines((prev) => [...prev.filter((routine) => routine.routineId !== saved.routineId), saved]);
  }

  async function handleSetRoutineActive(active: boolean, kind: Routine["kind"]) {
    const existing = routineOfKind(kind);
    if (!existing) return;
    try {
      const saved = await guardedWrite(() => api.updateRoutine(familyId, existing.routineId, { active }));
      setRoutines((prev) => prev.map((routine) => (routine.routineId === saved.routineId ? saved : routine)));
      setError(null);
    } catch (err) {
      reportError(err);
    }
  }

  const focusSuggestion = suggestBlockLength(focusBlocks);

  /**
   * Whose focus blocks these are — taken from the most recent one, so it
   * settles on a name after the first block and stays there.
   *
   * Deliberately *not* defaulted to the first name in `members`: those are
   * gathered from chores and prizes, and filing an adult's working day
   * against a child because theirs happened to sort first would be worse
   * than a generic label. So the fallback is generic.
   */
  const focusMember =
    [...focusBlocks].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.memberId ?? "Me";

  /**
   * A block is only ever written once it has ended, so there is exactly
   * one write per block and nothing to reconcile mid-timer.
   */
  async function handleRecordFocusBlock(block: {
    startedAt: string;
    endedAt: string;
    plannedMinutes: number;
    outcome: FocusBlock["outcome"];
    matter: string | null;
    note: string | null;
  }) {
    const saved = await guardedWrite(() =>
      api.recordFocusBlock(familyId, { ...block, memberId: focusMember, date: today })
    );
    setFocusBlocks((prev) => [...prev, saved]);
    setError(null);
  }

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

  const choresLeftToday = tasks.filter((task) => task.status !== "done").length;

  // Lines still to buy — an ordered item is last week's shop, not a
  // standing line. Same rule the backend's checkout uses.
  const outstandingCartCount = cartItems.filter(
    (item) => item.status !== "ordered" && item.status !== "unavailable"
  ).length;

  /**
   * The header's status line, said against the deadline rather than the
   * day. At twenty past eight "5 still to do" counts four morning chores
   * nobody can do anything about; "2 left before bedtime" is the number a
   * person can act on. Phrased about the chores, never about who they
   * were assigned to.
   */
  const headerStatus = (() => {
    const here = currentWindow(clock);
    if (here === null || here === "anytime") {
      return choresLeftToday === 0
        ? "the day's done"
        : `the day's done — ${choresLeftToday} didn't get to it today`;
    }
    const leftInWindow = tasks.filter(
      (task) => task.status !== "done" && (task.dueWindow === here || task.dueWindow === "anytime")
    ).length;
    if (leftInWindow === 0) return choresLeftToday === 0 ? "everything's done" : "nothing left right now";
    return `${leftInWindow} to go ${WHEN_IT_IS[here]}`;
  })();

  /**
   * Which panels are on screen and how loudly — see lib/dashboardLayout.ts.
   *
   * Recomputed every render, like everything else time-aware here. What
   * makes that safe is the render below: every panel but the lead lives in
   * one list with a stable key, so a panel moving between the rail and the
   * drawer is a reorder rather than an unmount. React carries its state
   * across — the tab someone is on, the "added 2 ingredients" they are
   * reading — which an earlier version of this lost by rendering the two
   * groups as separate lists.
   */
  const panelSignals = {
    now: clock,
    choresLeft: choresLeftToday,
    outstandingCartItems: outstandingCartCount,
    insightCount: insights.length,
    scheduleEntriesToday: schedule.filter((entry) => entry.date === today).length,
    hasMorningRoutine: morningRoutine !== null,
    hasBedtimeRoutine: bedtimeRoutine !== null,
    focusBlocksToday: focusBlocks.filter((block) => block.date === today).length,
    statedPreferenceCount: preferences.length,
  };
  const panelPlan = planPanels(panelSignals);

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

  /**
   * Every panel the dashboard can show, keyed by id, so the layout plan
   * can place them without the render knowing what's in any of them.
   */
  const PANELS: Record<PanelId, { title: string; subtitle?: string; body: ReactNode }> = {
    chores: {
      title: "Today's chores",
      subtitle: choresLeftToday === 0 ? "all done" : `${choresLeftToday} to go`,
      body: (
        <>
          <TaskList tasks={tasks} onComplete={handleComplete} />
          <ChoreLibrary onAdd={handleAddChore} members={members} />
        </>
      ),
    },
    schedule: {
      title: "Today's schedule",
      body: <Calendar entries={schedule.filter((entry) => entry.date === today)} />,
    },
    insights: {
      title: "What we've noticed",
      body: <Insights insights={insights} onAct={handleInsightAction} />,
    },
    prize: {
      title: "Working toward",
      body: (
        <PrizeGoal
          goals={rewardGoals}
          gemsByChild={gemsByChild}
          onSetGoal={handleSetRewardGoal}
          onClaim={handleClaimRewardGoal}
          members={members}
        />
      ),
    },
    kitchen: {
      title: "Kitchen",
      subtitle: outstandingCartCount > 0 ? `${outstandingCartCount} to buy` : undefined,
      body: (
        <Kitchen
          outstandingCount={outstandingCartCount}
          mealPlan={
            <>
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
            </>
          }
          groceries={
            <GroceryCart
              items={cartItems}
              onAdd={handleAddCartItem}
              onMarkUnavailable={handleMarkCartItemUnavailable}
              onConfirmSubstitute={handleConfirmCartItemSubstitute}
              onRemove={handleRemoveCartItem}
              onRestore={handleRestoreCartItem}
              onCheckout={handleCheckout}
            />
          }
        />
      ),
    },
    favorites: {
      title: "Family favorites",
      body: (
        <FamilyFavorites preferences={preferences} onAdd={handleAddPreference} onRemove={handleRemovePreference} />
      ),
    },
    morning: {
      title: "The morning",
      subtitle: morningRoutine ? `out by ${morningRoutine.anchorTime}` : undefined,
      body: (
        <MorningRoutine
          routine={morningRoutine}
          plan={morningPlan}
          tasks={tasks}
          members={members}
          kind="morning"
          onSave={(input) => handleSaveRoutine(input, "morning")}
          onSetActive={(active) => handleSetRoutineActive(active, "morning")}
          onStartNow={() => {
            if (!morningRoutine) return;
            setLaunchDismissedFor(null);
            setLaunchForced(morningRoutine.routineId);
          }}
        />
      ),
    },
    bedtime: {
      title: "Bedtime",
      subtitle: bedtimeRoutine ? `lights out ${bedtimeRoutine.anchorTime}` : undefined,
      body: (
        <MorningRoutine
          routine={bedtimeRoutine}
          plan={bedtimePlan}
          tasks={tasks}
          members={members}
          kind="bedtime"
          onSave={(input) => handleSaveRoutine(input, "bedtime")}
          onSetActive={(active) => handleSetRoutineActive(active, "bedtime")}
          onStartNow={() => {
            if (!bedtimeRoutine) return;
            setLaunchDismissedFor(null);
            setLaunchForced(bedtimeRoutine.routineId);
          }}
        />
      ),
    },
    focus: {
      title: "Focused work",
      body: (
        <FocusDay
          blocks={focusBlocks}
          today={today}
          suggestion={focusSuggestion}
          onStart={() => setFocusOpen(true)}
        />
      ),
    },
  };

  const renderPanel = (id: PanelId, size: CardSize, className?: string) => {
    const panel = PANELS[id];
    return (
      <FamilyCard key={id} title={panel.title} subtitle={panel.subtitle} size={size} className={className}>
        {panel.body}
      </FamilyCard>
    );
  };

  // On a wall display the page itself is exactly one screen, with each
  // column scrolling inside itself — a kitchen display you have to scroll
  // as a whole is one nobody scrolls. Phones keep ordinary document flow.
  return (
    <main className="min-h-screen lg:h-screen lg:overflow-hidden bg-white flex flex-col">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/brand-mark.png" alt="" className="h-12 w-12 sm:h-14 sm:w-14 short:h-10 short:w-10 shrink-0 rounded-full ring-4 ring-olive-100" />
          <div className="min-w-0">
            {/* The day leads, not the brand. Someone walking past a kitchen
                screen wants to know what today is and what's left of it —
                they already know whose house they're in. */}
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl short:text-2xl text-olive-800 truncate">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </h1>
            <p className="text-olive-700 font-body">
              {greeting()} — {headerStatus}
            </p>
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
          {/* The castle lives behind this rather than in a cell of its own:
              the number was already printed here, two inches above it. */}
          <button
            type="button"
            onClick={() => setCastleOpen(true)}
            aria-label={`Visit the Gem Castle — ${totalGems} gems`}
            className="font-display text-base sm:text-lg bg-olive-600 text-white rounded-full px-4 sm:px-5 py-2 shadow-[var(--shadow-card)] hover:bg-olive-700 active:scale-95 transition"
          >
            {totalGems} gems
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mx-4 sm:mx-6 lg:mx-8 text-clay-900 bg-clay-100 rounded-card px-4 py-3">
          {error}
        </p>
      )}

      {isLoading && (
        <p role="status" className="text-olive-600 italic text-center py-8">
          Loading your family&apos;s day&hellip;
        </p>
      )}

      {!isLoading && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 px-4 sm:px-6 lg:px-8 pb-6 items-start lg:items-stretch">
          {/* The one thing the screen is for. */}
          {renderPanel(panelPlan.lead, "hero", "lg:col-span-7 xl:col-span-8 lg:min-h-0 lg:overflow-y-auto")}

          {/* Alongside it: what this hour actually needs, quieter. */}
          <aside
            aria-label="Alongside"
            className="lg:col-span-5 xl:col-span-4 lg:min-h-0 lg:overflow-y-auto flex flex-col gap-4 sm:gap-6 show:grid show:grid-cols-2 lg:flex lg:flex-col"
          >
            {/* One list, stable keys. The drawer's panels are hidden
                rather than unmounted, so a panel that moves between the
                rail and the drawer keeps whatever state it had — and so
                the drawer opens instantly rather than rebuilding itself. */}
            {[...panelPlan.rail, ...panelPlan.drawer].map((id, index) =>
              renderPanel(
                id,
                "compact",
                index >= panelPlan.rail.length && !drawerOpen ? "hidden" : undefined
              )
            )}

            {/* Everything else. One tap, never lost — the point is that the
                screen commits to a few things at a time, not that it hides
                anything. */}
            {panelPlan.drawer.length > 0 && (
              <button
                type="button"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
                className="w-full font-body text-olive-700 bg-olive-50 border border-olive-100 rounded-card px-4 py-3"
              >
                {drawerOpen ? "Show less" : `Everything else · ${drawerLabel(panelPlan)}`}
              </button>
            )}
          </aside>
        </div>
      )}

      {castleOpen && <CastleOverlay totalGems={totalGems} onDismiss={() => setCastleOpen(false)} />}

      {/* Rendered before the other overlays on purpose. At ten to eight
          getting out of the door outranks a chore scenario, and two
          full-screen boxes competing would be worse than either. */}
      {showRoutineLaunch && activeRoutine && (
        <MorningLaunch
          plan={activeRoutine.plan}
          anchorLabel={activeRoutine.routine.name}
          onFinishStep={handleFinishStep}
          onUndoStep={handleUndoStep}
          onDismiss={() => {
            setLaunchForced(null);
            setLaunchDismissedFor(today);
          }}
        />
      )}

      {focusOpen && (
        <FocusSession
          memberId={focusMember}
          suggestion={focusSuggestion}
          history={focusBlocks}
          onRecord={handleRecordFocusBlock}
          onClose={() => setFocusOpen(false)}
        />
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

      {threatened && !showRoutineLaunch && (
        <GemThreatAlert threatened={threatened} onDefend={handleDefendGems} onDismiss={handleDismissThreat} />
      )}
    </main>
  );
}
