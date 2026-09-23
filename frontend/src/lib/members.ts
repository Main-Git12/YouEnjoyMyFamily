import type { Task, TaskCompletion, RewardGoal, GemBalance } from "../types";

/**
 * The names this family actually uses, gathered from what they've already
 * entered — who chores are assigned to, whose prizes are on the board, who
 * has gems. There is no separate member registry, and deliberately so: the
 * app shouldn't hold a list of children beyond the names a person typed in
 * for a chore.
 *
 * Offering these as one-tap chips is what stops "Parker", "parker" and
 * "Parker " becoming three children with a third of the gems each — far
 * more effective than any amount of normalising after the fact, and it's
 * faster than typing on a wall-mounted screen anyway.
 */
export function knownMembers(sources: {
  tasks?: Task[];
  completions?: TaskCompletion[];
  goals?: RewardGoal[];
  balances?: GemBalance[];
}): string[] {
  const names = new Set<string>();
  for (const task of sources.tasks ?? []) if (task.assignedTo) names.add(task.assignedTo);
  for (const completion of sources.completions ?? []) if (completion.memberId) names.add(completion.memberId);
  for (const goal of sources.goals ?? []) names.add(goal.memberId);
  for (const balance of sources.balances ?? []) names.add(balance.memberId);
  return [...names].sort((a, b) => a.localeCompare(b));
}
