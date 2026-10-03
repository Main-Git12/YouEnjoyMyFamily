/**
 * Turning what a family typed into a shopping list that adds up.
 *
 * The old behaviour keyed the list on the whole trimmed, lowercased string,
 * so "2 onions" on Tuesday and "1 onion" on Thursday were two different
 * things and arrived as two separate rows. Three onion lines on one list is
 * the single most-cited reason people decide a planner has made them a new
 * chore rather than removed one, and it was also quietly wrong: the
 * quantity sent on each row was the number of *dates* the ingredient
 * appeared on, not how much of it anybody needed.
 *
 * Everything here is deterministic and rule-based. No model, no stemmer, no
 * ingredient corpus. A stemmer was the obvious shortcut and is the wrong
 * one: Porter2 turns "molasses" into "molass" and "tomatoes" and "tomato
 * paste" into neighbours, which is lossy in exactly the place a shopping
 * list cannot afford it.
 *
 * The rule the rest of this codebase keeps applies hardest to the quantity:
 * when an amount cannot be read, it is never guessed. The line keeps the
 * family's own words and is marked as needing a look.
 */

/**
 * Instacart's unit vocabulary, which is a closed list — an unrecognised
 * unit makes their quantity matching fail silently, so the app's own
 * vocabulary is deliberately a subset of theirs rather than a superset.
 *
 * `dimension` is what makes merging safe: amounts are only ever added
 * together within one dimension. `base` converts to that dimension's
 * canonical unit so 500 g and 1 lb can be summed without either being
 * rendered in the other's units until the very end.
 *
 * `discrete` says whether a half of one can be bought. You cannot buy 1.2
 * cans, so a count rounds up; 1.2 kg is a perfectly ordinary thing to ask
 * for and is left alone.
 */
export type UnitDimension = "mass" | "volume" | "count";

interface UnitSpec {
  canonical: string;
  dimension: UnitDimension;
  /** How many canonical base units one of these is. */
  base: number;
  discrete: boolean;
}

const GRAMS_PER_OZ = 28.349523125;
const ML_PER_FL_OZ = 29.5735295625;

/** Every spelling the family might type, mapped to one canonical unit. */
const UNITS: Record<string, UnitSpec> = {};

function defineUnit(canonical: string, dimension: UnitDimension, base: number, discrete: boolean, spellings: string[]) {
  for (const spelling of [canonical, ...spellings]) {
    UNITS[spelling] = { canonical, dimension, base, discrete };
  }
}

// Mass — canonical base is the gram.
defineUnit("g", "mass", 1, false, ["gram", "grams", "gm", "gs"]);
defineUnit("kg", "mass", 1000, false, ["kilo", "kilos", "kilogram", "kilograms"]);
defineUnit("oz", "mass", GRAMS_PER_OZ, false, ["ounce", "ounces"]);
defineUnit("lb", "mass", GRAMS_PER_OZ * 16, false, ["lbs", "pound", "pounds"]);

// Volume — canonical base is the millilitre.
defineUnit("ml", "volume", 1, false, ["millilitre", "millilitres", "milliliter", "milliliters"]);
defineUnit("l", "volume", 1000, false, ["litre", "litres", "liter", "liters"]);
defineUnit("tsp", "volume", 4.92892159375, false, ["teaspoon", "teaspoons"]);
defineUnit("tbsp", "volume", 14.78676478125, false, ["tablespoon", "tablespoons", "tbs"]);
defineUnit("fl oz", "volume", ML_PER_FL_OZ, false, ["floz", "fluid ounce", "fluid ounces"]);
defineUnit("cup", "volume", 236.5882365, false, ["cups"]);
defineUnit("pint", "volume", 473.176473, false, ["pints", "pt"]);
defineUnit("quart", "volume", 946.352946, false, ["quarts", "qt"]);
defineUnit("gallon", "volume", 3785.411784, false, ["gallons", "gal"]);

// Countable — canonical base is one of the thing. All discrete: you cannot
// buy two thirds of a tin.
for (const [canonical, spellings] of Object.entries({
  each: ["ea"],
  package: ["packages", "pack", "packs", "pkg"],
  packet: ["packets"],
  bunch: ["bunches"],
  can: ["cans", "tin", "tins"],
  head: ["heads"],
  large: [],
  medium: [],
  small: [],
})) {
  defineUnit(canonical, "count", 1, true, spellings);
}

export interface ParsedIngredient {
  /** Exactly what the family typed, kept whatever else happens. */
  raw: string;
  /** Null when no amount could be read — never guessed at. */
  quantity: number | null;
  /** Canonical unit, or null for a bare count ("2 onions") or no amount. */
  unit: string | null;
  dimension: UnitDimension;
  /** What to merge on: the food, lowercased and singularised. */
  food: string;
  /** The food as the family wrote it, for display. */
  foodLabel: string;
}

/**
 * A leading amount: "2", "1.5", "1/2", "1 1/2", "2-3".
 *
 * A range takes its upper bound. The list exists to stop somebody standing
 * in a shop short of an onion, and buying the extra one is the cheaper of
 * the two mistakes by a wide margin.
 */
function readAmount(text: string): { quantity: number; rest: string } | null {
  const match = /^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?(?:\s+(\d+)\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?\s*(.*)$/.exec(
    text.trim()
  );
  if (!match) return null;

  const [, first, upper, mixedNum, mixedDen, simpleDen, rest = ""] = match;
  let quantity = Number(first);
  if (upper) quantity = Number(upper);
  else if (mixedNum && mixedDen) quantity += Number(mixedNum) / Number(mixedDen);
  else if (simpleDen) quantity = Number(first) / Number(simpleDen);

  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, rest };
}

/**
 * Singular form, from a short list of real English endings.
 *
 * Deliberately not a stemmer. "Molasses" must stay molasses, and the
 * irregulars a kitchen actually produces are few enough to write down.
 */
const NEVER_SINGULARISE = new Set(["molasses", "hummus", "couscous", "asparagus", "swiss", "cress", "watercress"]);

export function singularise(word: string): string {
  const lower = word.toLowerCase();
  if (NEVER_SINGULARISE.has(lower) || lower.length <= 3) return lower;
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ves")) return `${lower.slice(0, -3)}f`;
  if (/(ch|sh|ss|x|z)es$/.test(lower)) return lower.slice(0, -2);
  if (lower.endsWith("oes")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us")) return lower.slice(0, -1);
  return lower;
}

/** The merge key: the food, singularised word by word, punctuation dropped. */
export function foodKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularise)
    .join(" ");
}

/**
 * Words that mean "an amount, unspecified". Stripped so that "some onions"
 * and "2 onions" land on the same row — they are the same food, and a list
 * that separates them is back to three onion lines. Stripping them is not
 * the same as reading them: the row still has no number and is still
 * flagged for a look.
 */
// Longest alternatives first. Regex alternation is first-match-wins, so
// with `a` at the front "a few onions" loses only the "a" and becomes a
// food called "few onion" — which then fails to merge with "onion", which
// is the exact bug this whole module exists to prevent.
const VAGUE_AMOUNT =
  /^(?:a handful of|a couple of|a bit of|plenty of|lots of|a few|several|some|an|a)\s+/i;

/** Reads one free-text ingredient. Never throws, never invents an amount. */
export function parseIngredient(raw: string): ParsedIngredient {
  const trimmed = raw.trim();
  const amount = readAmount(trimmed);

  if (!amount) {
    const vague = VAGUE_AMOUNT.exec(trimmed);
    if (vague) {
      const label = trimmed.slice(vague[0].length).trim();
      if (label) {
        return {
          raw: trimmed,
          quantity: null,
          unit: null,
          dimension: "count",
          food: foodKey(label),
          foodLabel: label,
        };
      }
    }

    // No leading number at all — "onions", "salt to taste". A bare food is
    // a perfectly ordinary list entry; it just has no amount to add up.
    return {
      raw: trimmed,
      quantity: null,
      unit: null,
      dimension: "count",
      food: foodKey(trimmed),
      foodLabel: trimmed,
    };
  }

  // Longest unit spelling first, so "fl oz" is not read as "fl" then "oz".
  const rest = amount.rest.trim();
  const lowerRest = rest.toLowerCase();
  let unit: UnitSpec | null = null;
  let label = rest;

  for (const spelling of Object.keys(UNITS).sort((a, b) => b.length - a.length)) {
    if (lowerRest === spelling || lowerRest.startsWith(`${spelling} `)) {
      unit = UNITS[spelling] as UnitSpec;
      label = rest.slice(spelling.length).trim();
      break;
    }
  }

  // "2 lb" with nothing after it is an amount of nothing; treat the whole
  // original as the food rather than inventing a product called "lb".
  if (unit && !label) {
    return { raw: trimmed, quantity: null, unit: null, dimension: "count", food: foodKey(trimmed), foodLabel: trimmed };
  }

  const of = /^of\s+/i.exec(label);
  if (of) label = label.slice(of[0].length);

  return {
    raw: trimmed,
    quantity: amount.quantity,
    unit: unit ? unit.canonical : null,
    dimension: unit ? unit.dimension : "count",
    food: foodKey(label || rest),
    foodLabel: label || rest,
  };
}

export interface Contribution {
  date: string;
  slot: string;
  mealName: string;
  /** The family's own words for this one, so a merged row can be opened up. */
  raw: string;
}

export interface MergedLine {
  /** The merge key — food plus dimension. */
  key: string;
  food: string;
  foodLabel: string;
  /** Null when no contribution carried a readable amount. */
  quantity: number | null;
  unit: string | null;
  /** True when at least one contribution's amount could not be read. */
  needsCheck: boolean;
  /** Every meal that asked for this, with what it asked for. */
  contributions: Contribution[];
  /** The dates this line covers, for the idempotent-regeneration logic. */
  dates: string[];
}

/** How a merged total is written back out: the largest sensible whole unit. */
function render(totalBase: number, dimension: UnitDimension, unit: string | null): { quantity: number; unit: string | null } {
  if (dimension === "count") {
    // Discrete: you cannot buy 1.2 cans.
    return { quantity: Math.ceil(totalBase - 1e-9), unit };
  }
  if (dimension === "mass") {
    if (totalBase >= 1000) return { quantity: round(totalBase / 1000), unit: "kg" };
    return { quantity: round(totalBase), unit: "g" };
  }
  if (totalBase >= 1000) return { quantity: round(totalBase / 1000), unit: "l" };
  return { quantity: round(totalBase), unit: "ml" };
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * One row per food per dimension.
 *
 * Amounts are summed only inside a dimension. 300 g of beef and 2 packs of
 * beef are both beef, but there is no honest number of grams in a pack, so
 * they stay as two rows rather than the app inventing a conversion. That is
 * the same refusal the rest of the codebase makes everywhere else.
 */
export function mergeIngredients(
  entries: { date: string; slot: string; mealName: string; ingredients: string[] }[]
): MergedLine[] {
  const lines = new Map<string, MergedLine & { totalBase: number; anyAmount: boolean }>();

  for (const entry of entries) {
    for (const ingredient of entry.ingredients) {
      const parsed = parseIngredient(ingredient);
      if (!parsed.food) continue;

      const key = `${parsed.food}::${parsed.dimension}`;
      const line = lines.get(key) ?? {
        key,
        food: parsed.food,
        foodLabel: parsed.foodLabel,
        quantity: null,
        unit: null,
        needsCheck: false,
        contributions: [],
        dates: [],
        totalBase: 0,
        anyAmount: false,
      };

      line.contributions.push({ date: entry.date, slot: entry.slot, mealName: entry.mealName, raw: parsed.raw });
      line.dates.push(entry.date);

      if (parsed.quantity === null) {
        // No amount here. "Onions" alongside "2 onions" means at least the
        // two, plus however many "onions" meant — so the row is flagged
        // rather than silently treated as one more.
        line.needsCheck = true;
      } else {
        const spec = parsed.unit ? UNITS[parsed.unit] : null;
        line.totalBase += parsed.quantity * (spec ? spec.base : 1);
        line.anyAmount = true;
        if (parsed.unit && !line.unit) line.unit = parsed.unit;
      }

      lines.set(key, line);
    }
  }

  return [...lines.values()].map((line) => {
    const dimension = line.key.endsWith("::mass") ? "mass" : line.key.endsWith("::volume") ? "volume" : "count";
    const rendered = line.anyAmount ? render(line.totalBase, dimension, line.unit) : { quantity: null, unit: null };
    return {
      key: line.key,
      food: line.food,
      foodLabel: line.foodLabel,
      quantity: rendered.quantity,
      unit: dimension === "count" && !line.unit ? null : rendered.unit,
      needsCheck: line.needsCheck,
      contributions: line.contributions,
      dates: [...new Set(line.dates)].sort(),
    };
  });
}

/** What Instacart is told. See groceryCart.ts for why the shape matters. */
export interface InstacartMeasurement {
  quantity: number;
  unit: string;
}

/**
 * Instacart deprecated `LineItem.quantity`/`unit` in March 2026 in favour of
 * a `line_item_measurements` array, and picks whichever measurement best
 * fits real inventory. A bare count with no unit — which is what this app
 * was sending for everything — makes "2 lb mince" arrive as two of
 * something.
 */
export function toMeasurements(line: { quantity: number | null; unit: string | null }): InstacartMeasurement[] {
  if (line.quantity === null) return [{ quantity: 1, unit: "each" }];
  return [{ quantity: line.quantity, unit: line.unit ?? "each" }];
}
