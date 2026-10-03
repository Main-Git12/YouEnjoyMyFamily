import type { CartItem } from "../types";
import { weekdayName } from "./routines";

/**
 * What a grocery row says about itself beyond its name.
 *
 * The `because` rule (lib/insights.ts) is that nothing the app works out
 * gets shown without the records it came from, so a parent can check the
 * app's working rather than trust it. A merged row is exactly that kind of
 * claim: "1.5 kg Ground beef" is the app's arithmetic over three meals, and
 * standing in a shop is the worst possible moment to start wondering where
 * a number came from. So the row carries the meals that asked for it.
 *
 * The subject is the line, never a person. "Nobody said how much" is about
 * the plan; who typed it is not the screen's business.
 */
export interface GroceryLineNote {
  /** The meals this came from, named and dated. Null for a hand-added row. */
  because: string | null;
  /** Set when no amount could be read, with the words that were used. */
  check: string | null;
}

/** "Tacos (Fri) · Chilli (Sun)" — one entry per meal, in date order. */
function namedMeals(contributions: NonNullable<CartItem["contributions"]>): string {
  const seen = new Set<string>();
  return [...contributions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => `${c.mealName} (${weekdayName(c.date) || c.date})`)
    .filter((label) => {
      // Lunch and dinner can both be "Leftovers" on the same day; saying so
      // twice is noise, not evidence.
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .join(" · ");
}

export function groceryLineNote(item: CartItem): GroceryLineNote {
  const contributions = item.contributions ?? [];
  if (contributions.length === 0) return { because: null, check: null };

  const because = namedMeals(contributions);
  if (!item.needsCheck) return { because, check: null };

  // The family's own words, so the gap is checkable rather than just
  // flagged. Deduped, because three meals that each said "Rice" make the
  // same point once.
  const words = [...new Set(contributions.map((c) => c.raw.trim()).filter(Boolean))];
  const quoted = words.map((word) => `“${word}”`).join(", ");
  return {
    because,
    check: quoted ? `No amount given — ${quoted}` : "No amount given",
  };
}
