import type { Task, TaskCompletion, RewardGoal, GemBalance } from "../types";
import { currentStreak } from "./insights";

/**
 * One child's own corner of the app.
 *
 * The hazard this module exists to contain is comparison. A screen about
 * one child, on a wall the whole family walks past, is the most tempting
 * place in the product to put a leaderboard — and a leaderboard is how a
 * seven-year-old learns that their brother is better at being good. So:
 *
 *   **Nothing here knows about anybody else.** The function takes one
 *   member's name and returns only rows belonging to them. Other
 *   children's gem totals, chore counts, prizes and streaks are filtered
 *   out before the view is built, rather than hidden while rendering —
 *   so a later change to the markup cannot leak them back.
 *
 * Two of those filters are belt-and-braces rather than load-bearing:
 * `currentStreak` already narrows to one member itself, so removing the
 * filter on completions here changes nothing today. It is kept because
 * the next thing to read `theirCompletions` may not filter, and because
 * the invariant worth holding is "this view never holds another child's
 * rows", not "the current call happens to be safe". The test that does
 * the real work is the one asserting no other child appears anywhere in
 * the built view.
 *
 * The other rule carries over from lib/insights.ts: an observation's
 * subject is a chore, not a person — except a streak, which is praise
 * they earned by doing the thing and asked for by keeping it up.
 */

export interface ChildChore {
  taskId: string;
  title: string;
  gemValue: number;
  done: boolean;
  /** How many days running, when it's worth saying. Zero means don't. */
  streak: number;
}

export interface ChildProgress {
  /** What they're saving for, and how far along. Null when nothing is set. */
  goal: { title: string; gemCost: number; gemsSoFar: number; fraction: number } | null;
}

export interface ChildView {
  memberId: string;
  /** Their spendable gems — earned minus what they've claimed. */
  balance: number;
  /** Today's chores, theirs only. */
  chores: ChildChore[];
  choresLeft: number;
  gemsStillToEarnToday: number;
  progress: ChildProgress;
  /** The longest run going, if any — the one thing here that names them. */
  bestStreak: { title: string; days: number } | null;
}

/** A streak worth putting on a wall. Two days is a coincidence. */
const STREAK_WORTH_SAYING = 3;

export function buildChildView(input: {
  memberId: string;
  tasks: Task[];
  completions: TaskCompletion[];
  goals: RewardGoal[];
  balances: GemBalance[];
  today: string;
}): ChildView {
  const { memberId, tasks, completions, goals, balances, today } = input;

  // Everything below is narrowed to this child first, so nothing
  // downstream has to remember to. See the note above.
  const theirTasks = tasks.filter((task) => task.assignedTo === memberId);
  const theirCompletions = completions.filter((completion) => completion.memberId === memberId);
  const balance = balances.find((entry) => entry.memberId === memberId)?.balance ?? 0;
  const goal = goals.find((entry) => entry.memberId === memberId) ?? null;

  const chores: ChildChore[] = theirTasks.map((task) => ({
    taskId: task.taskId,
    title: task.title,
    gemValue: task.gemValue,
    done: task.status === "done",
    streak: currentStreak(theirCompletions, task.taskId, memberId, today),
  }));

  const outstanding = chores.filter((chore) => !chore.done);

  const best = chores
    .filter((chore) => chore.streak >= STREAK_WORTH_SAYING)
    .sort((a, b) => b.streak - a.streak)[0];

  return {
    memberId,
    balance,
    chores,
    choresLeft: outstanding.length,
    gemsStillToEarnToday: outstanding.reduce((total, chore) => total + chore.gemValue, 0),
    progress: {
      goal: goal
        ? {
            title: goal.title,
            gemCost: goal.gemCost,
            gemsSoFar: Math.min(balance, goal.gemCost),
            // Clamped so a child who has already saved enough sees a full
            // bar rather than an over-full one, and a zero-cost prize
            // can't divide by nothing.
            fraction: goal.gemCost > 0 ? Math.min(1, balance / goal.gemCost) : 1,
          }
        : null,
    },
    bestStreak: best ? { title: best.title, days: best.streak } : null,
  };
}
