import type { DueWindow, Task } from "../types";

/**
 * Something is after the kingdom's gems, and the only way to stop it is to
 * finish the chore it's circling.
 *
 * Every threat here is raised from data the family typed in themselves — a
 * chore, who it belongs to, what it pays, and the part of the day they said
 * it belongs to. The app never watches a child, guesses at habits, or
 * builds a profile; "Parker hasn't wiped the table" means only "a chore
 * someone assigned to Parker, marked as an after-dinner job, is still
 * ticked off as not done, and it's past half seven".
 */

export type ThreatId = "raccoon" | "bandit" | "dragon" | "wizard" | "giant";

export interface GemThreat {
  id: ThreatId;
  /** The character's name, as the children will hear it. */
  name: string;
  /** Shown while the chore is still undone. */
  taunt: (assignee: string, choreTitle: string, gemsAtStake: number) => string;
  /** Shown the moment the chore is ticked off. */
  defeated: (assignee: string) => string;
  /** What the button to go and do the chore says. */
  callToAction: string;
}

const RACCOON: GemThreat = {
  id: "raccoon",
  name: "Rascal the Raccoon",
  taunt: (assignee, choreTitle, gems) =>
    `Rascal the Raccoon has his paws on the gem chest! He'll make off with ${gems} gems unless ${assignee} finishes "${choreTitle}" first!`,
  defeated: (assignee) => `${assignee} sent Rascal scampering back over the wall — the gems are safe!`,
  callToAction: "Chase him off!",
};

const BANDIT: GemThreat = {
  id: "bandit",
  name: "the Gem Bandit",
  taunt: (assignee, choreTitle, gems) =>
    `A masked Gem Bandit is creeping toward the vault with a sack for ${gems} gems! Only ${assignee} can stop them — finish "${choreTitle}"!`,
  defeated: (assignee) => `The Bandit dropped the sack and fled. ${assignee} saved every last gem!`,
  callToAction: "Stop the Bandit!",
};

const DRAGON: GemThreat = {
  id: "dragon",
  name: "a wild dragon",
  taunt: (assignee, choreTitle, gems) =>
    `A wild dragon is circling the towers, eyeing ${gems} gems! ${assignee} can drive it off by finishing "${choreTitle}"!`,
  defeated: (assignee) => `The dragon wheeled away into the clouds. Well flown, ${assignee}!`,
  callToAction: "Drive it off!",
};

const WIZARD: GemThreat = {
  id: "wizard",
  name: "an evil wizard",
  taunt: (assignee, choreTitle, gems) =>
    `An evil wizard is casting a spell to turn ${gems} gems into dust! ${assignee} can break it by finishing "${choreTitle}"!`,
  defeated: (assignee) => `The spell fizzled out. ${assignee} broke it just in time!`,
  callToAction: "Break the spell!",
};

const GIANT: GemThreat = {
  id: "giant",
  name: "a rumbling giant",
  taunt: (assignee, choreTitle, gems) =>
    `A giant is shaking the walls and ${gems} gems are rattling loose! ${assignee} can send him off by finishing "${choreTitle}"!`,
  defeated: (assignee) => `The giant lumbered away grumbling. ${assignee} held the walls!`,
  callToAction: "Send him packing!",
};

export const GEM_THREATS: GemThreat[] = [RACCOON, BANDIT, DRAGON, WIZARD, GIANT];

/**
 * Picks a threat from the chore itself rather than at random, so the same
 * chore always brings the same character. Children get to know Rascal as
 * the one who turns up when the table hasn't been wiped, which is far more
 * fun than a different monster every time.
 */
export function threatForChore(choreTitle: string): GemThreat {
  let hash = 0;
  for (const char of choreTitle) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  const index = hash % GEM_THREATS.length;
  return GEM_THREATS[index] ?? RACCOON;
}

/** Minutes past midnight, in the viewer's own timezone. */
function minutesIntoDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

// When each part of the day is over. A chore only counts as slipping once
// its window has closed — "anytime" never does.
const WINDOW_CLOSES_AT_MINUTE: Record<DueWindow, number | null> = {
  morning: 9 * 60,
  after_school: 17 * 60,
  after_dinner: 19 * 60 + 30,
  bedtime: 20 * 60 + 30,
  anytime: null,
};

export function isPastWindow(window: DueWindow, now: Date = new Date()): boolean {
  const closesAt = WINDOW_CLOSES_AT_MINUTE[window];
  if (closesAt === null) return false;
  return minutesIntoDay(now) >= closesAt;
}

export interface ThreatenedChore {
  task: Task;
  threat: GemThreat;
  assignee: string;
}

/**
 * The chore a threat should be raised over, if any: still not done, belongs
 * to someone in particular, and its part of the day has already passed.
 * Returns the one furthest past its window, so the most overdue chore is
 * the one that gets rescued first.
 */
export function chooseThreatenedChore(tasks: Task[], now: Date = new Date()): ThreatenedChore | null {
  const overdue = tasks.filter(
    (task) => task.status !== "done" && task.assignedTo && isPastWindow(task.dueWindow, now)
  );
  if (overdue.length === 0) return null;

  const byUrgency = [...overdue].sort((a, b) => {
    const aCloses = WINDOW_CLOSES_AT_MINUTE[a.dueWindow] ?? Number.MAX_SAFE_INTEGER;
    const bCloses = WINDOW_CLOSES_AT_MINUTE[b.dueWindow] ?? Number.MAX_SAFE_INTEGER;
    return aCloses - bCloses;
  });

  const task = byUrgency[0];
  if (!task || !task.assignedTo) return null;
  return { task, threat: threatForChore(task.title), assignee: task.assignedTo };
}
