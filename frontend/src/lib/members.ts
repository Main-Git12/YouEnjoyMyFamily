import type { Task, TaskCompletion, RewardGoal, GemBalance, HouseholdMember } from "../types";

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

/**
 * Everyone the app can offer when something needs a name against it.
 *
 * The union of the roster and the names already on the records, because the
 * roster is optional and a household that never opens it must keep working
 * exactly as it did. A name that appears in both is one person: the roster's
 * spelling wins, since that is the one somebody typed on purpose.
 */
export function assignableNames(
  roster: { members: HouseholdMember[] },
  inferred: string[]
): string[] {
  const names = new Map<string, string>();
  for (const name of inferred) names.set(name.toLowerCase(), name);
  for (const member of roster.members) names.set(member.displayName.toLowerCase(), member.displayName);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The children, and only the children.
 *
 * Gems, prizes, the castle and the monster game are a motivation system
 * built for a seven-year-old. Offering an adult a way into them is not a
 * harmless extra button — it is the app deciding that a grandmother who
 * drives to appointments and a child who feeds the cat are the same kind of
 * participant, which is exactly the miscasting the roster exists to stop.
 *
 * Falls back to every known name when the roster is empty, so a household
 * that has not filled it in sees what it saw before rather than an app that
 * has quietly removed its children's screens.
 */
export function childrenOnly(roster: { members: HouseholdMember[] }, inferred: string[]): string[] {
  if (roster.members.length === 0) return inferred;
  const children = roster.members.filter((member) => member.role === "child");
  // A roster with adults listed but no children is a real answer — a
  // household with no children in the gem economy — not a reason to fall
  // back to guessing from chore assignments.
  return children.map((member) => member.displayName).sort((a, b) => a.localeCompare(b));
}
