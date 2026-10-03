import type { MealPlanEntry } from "../types";
import { mealRhythms, weekdayOf, weekdayName } from "./routines";

/**
 * "Not that — what else?"
 *
 * Swapping a planned dinner meant deleting it and typing another one,
 * which is the moment a Sunday plan stops being worth making. This offers
 * the alternatives, and every one of them is a meal this family has
 * actually cooked. Nothing here invents a recipe, and nothing here is
 * saved until somebody taps it.
 *
 * The ordering is the one the week-drafter already uses, for the same
 * reasons: a meal that belongs to that weekday first, then whatever
 * hasn't come round for longest. Variety people actually want is the
 * rotation moving, not novelty — a thing you haven't had for a month is a
 * better suggestion than a thing you have never had, and it is also the
 * only honest one, because the app has no idea whether you would like the
 * thing you have never had.
 *
 * The subject is the meal. "Not had since 12 September" is a fact about a
 * dinner; nobody is being told what sort of cook they are.
 */

/** Nobody wants the same dinner twice in four days. Same floor as the drafter. */
const NO_REPEAT_WITHIN_DAYS = 4;

export interface SwapOption {
  mealName: string;
  /** Why it's being offered, from the records. */
  because: string;
}

/**
 * Nights that don't need a meal invented for them.
 *
 * A Sunday plan with two blanks in it is a plan somebody abandons, and the
 * blanks are usually not "we haven't decided" — they are leftovers and
 * going out. Writing those down is not a cop-out; it is the difference
 * between a plan with a hole in it and a plan. Neither carries ingredients,
 * so neither puts anything on the shopping list.
 */
export const STANDING_OPTIONS: SwapOption[] = [
  { mealName: "Leftovers", because: "Nothing to shop for." },
  { mealName: "Eating out", because: "Nothing to shop for." },
];

const shortDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const daysApart = (from: string, to: string): number =>
  Math.abs(Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000));

/**
 * What else could go on this night.
 *
 * `entries` is everything the family has planned or eaten, the week on
 * screen included — a swap has to know what is already on Thursday as
 * well as what was eaten last Thursday, or it will cheerfully offer the
 * dinner that is already two nights away.
 */
export function swapOptions(input: {
  entries: MealPlanEntry[];
  /** The night being swapped. */
  date: string;
  /** What's on it now, so it isn't offered back. */
  currentName?: string | null;
  /** Today, so a rhythm is read from what happened rather than what's planned. */
  today: string;
  limit?: number;
}): SwapOption[] {
  const { entries, date, currentName, today, limit = 3 } = input;

  const dinners = entries.filter((entry) => entry.slot === "dinner" && entry.mealName.trim());
  const standing = new Set(STANDING_OPTIONS.map((option) => option.mealName.toLowerCase()));

  // When each meal was last on the table — or is next due to be. Both
  // matter: a swap mustn't land Thursday's dinner two nights after
  // Tuesday's, and mustn't land it two nights *before* Saturday's either.
  const nearestUse = new Map<string, { name: string; when: string; gap: number }>();
  const lastSeen = new Map<string, { name: string; when: string }>();
  for (const entry of dinners) {
    const name = entry.mealName.trim();
    const key = name.toLowerCase();
    if (entry.date === date) continue;

    const gap = daysApart(entry.date, date);
    const nearest = nearestUse.get(key);
    if (!nearest || gap < nearest.gap) nearestUse.set(key, { name, when: entry.date, gap });

    // "Last had" is only ever about the past. A meal planned for Friday
    // has not been had, and saying "not had since Friday" about a day
    // that hasn't happened is the app reading its own notes back.
    if (entry.date < today) {
      const seen = lastSeen.get(key);
      if (!seen || entry.date > seen.when) lastSeen.set(key, { name, when: entry.date });
    }
  }

  const tooClose = (key: string): boolean => (nearestUse.get(key)?.gap ?? Infinity) < NO_REPEAT_WITHIN_DAYS;
  const current = currentName?.trim().toLowerCase() ?? "";

  const eligible = [...nearestUse.values()].filter((meal) => {
    const key = meal.name.toLowerCase();
    if (key === current) return false;
    if (standing.has(key)) return false; // offered separately, always
    return !tooClose(key);
  });

  // A meal that belongs to this weekday, then whatever hasn't come round
  // for longest. Same preference order as the week-drafter.
  const weekday = weekdayOf(date);
  const rhythm = mealRhythms(dinners, today).find(
    (entry) => entry.weekday === weekday && entry.mealName.toLowerCase() !== current && !tooClose(entry.mealName.toLowerCase())
  );

  const options: SwapOption[] = [];
  if (rhythm) {
    options.push({
      mealName: rhythm.mealName,
      because: `Has been dinner on ${rhythm.timesOnThisDay} ${rhythm.weekdayLabel}s.`,
    });
  }

  const byLongestAgo = eligible
    .filter((meal) => meal.name.toLowerCase() !== rhythm?.mealName.toLowerCase())
    .sort((a, b) => {
      const aSeen = lastSeen.get(a.name.toLowerCase())?.when ?? "";
      const bSeen = lastSeen.get(b.name.toLowerCase())?.when ?? "";
      return aSeen.localeCompare(bSeen) || a.name.localeCompare(b.name);
    });

  for (const meal of byLongestAgo) {
    if (options.length >= limit) break;
    const seen = lastSeen.get(meal.name.toLowerCase());
    options.push({
      mealName: meal.name,
      because: seen ? `Not had since ${shortDate(seen.when)}.` : `Already down for ${weekdayName(meal.when)}.`,
    });
  }

  return options.slice(0, limit);
}

/**
 * What this meal needed the last time it was made.
 *
 * Picking a meal and then retyping its eight ingredients is the actual
 * work in a Sunday planning session, and it is work the app has no excuse
 * for: it has the list from last time. These are still the family's own
 * words from their own record — nothing is added to them and nothing is
 * inferred about what a dish "should" contain.
 *
 * The most recent version wins, because an ingredient list people have
 * edited is them correcting it. A meal that was last cooked with no
 * ingredients written down comes back with none: an empty list is an
 * honest answer and a made-up one is not.
 */
export function ingredientsFor(entries: MealPlanEntry[], mealName: string): string[] {
  const wanted = mealName.trim().toLowerCase();
  if (!wanted) return [];
  if (STANDING_OPTIONS.some((option) => option.mealName.toLowerCase() === wanted)) return [];

  const match = entries
    .filter((entry) => entry.slot === "dinner" && entry.mealName.trim().toLowerCase() === wanted)
    .filter((entry) => entry.ingredients.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return match ? [...match.ingredients] : [];
}
