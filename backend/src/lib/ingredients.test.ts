import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIngredient, singularise, foodKey, mergeIngredients, toMeasurements } from "./ingredients";

test("reads a plain amount, a unit and a food", () => {
  const parsed = parseIngredient("2 lb mince");
  assert.equal(parsed.quantity, 2);
  assert.equal(parsed.unit, "lb");
  assert.equal(parsed.dimension, "mass");
  assert.equal(parsed.food, "mince");
});

test("reads the ways a person actually writes an amount", () => {
  assert.equal(parseIngredient("1.5 kg potatoes").quantity, 1.5);
  assert.equal(parseIngredient("1/2 cup rice").quantity, 0.5);
  assert.equal(parseIngredient("1 1/2 cups flour").quantity, 1.5);
  // A range takes its upper bound: standing in a shop an onion short is
  // the more expensive of the two mistakes.
  assert.equal(parseIngredient("2-3 onions").quantity, 3);
});

test("a bare food has no amount, and is not given one", () => {
  const parsed = parseIngredient("onions");
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.unit, null);
  assert.equal(parsed.food, "onion");
});

test("keeps the family's own words whatever happens", () => {
  assert.equal(parseIngredient("  a good glug of olive oil ").raw, "a good glug of olive oil");
});

test("an amount with no food is not turned into a product called 'lb'", () => {
  const parsed = parseIngredient("2 lb");
  assert.equal(parsed.foodLabel, "2 lb");
  assert.equal(parsed.quantity, null);
});

test("reads the longest unit spelling, so 'fl oz' is not 'fl' then 'oz'", () => {
  const parsed = parseIngredient("8 fl oz cream");
  assert.equal(parsed.unit, "fl oz");
  assert.equal(parsed.food, "cream");
});

test("drops a connecting 'of'", () => {
  assert.equal(parseIngredient("2 cups of rice").food, "rice");
});

test("singularises the endings a kitchen actually produces", () => {
  assert.equal(singularise("onions"), "onion");
  assert.equal(singularise("tomatoes"), "tomato");
  assert.equal(singularise("berries"), "berry");
  assert.equal(singularise("loaves"), "loaf");
  assert.equal(singularise("boxes"), "box");
});

test("leaves alone the words a stemmer would ruin", () => {
  // The reason this is a short list and not Porter2: "molasses" stems to
  // "molass", and a shopping list cannot afford that.
  for (const word of ["molasses", "hummus", "couscous", "asparagus"]) {
    assert.equal(singularise(word), word);
  }
});

test("the merge key ignores case and punctuation", () => {
  assert.equal(foodKey("Spring Onions,"), foodKey("spring onion"));
});

const meal = (date: string, mealName: string, ingredients: string[]) => ({ date, slot: "dinner", mealName, ingredients });

test("two meals needing onions produce one onion row", () => {
  // The whole point. Three onion lines on one list is the most-cited
  // reason people decide a planner made them a new chore.
  const [line] = mergeIngredients([
    meal("2026-10-06", "Chilli", ["2 onions"]),
    meal("2026-10-08", "Soup", ["1 onion"]),
  ]);

  assert.equal(line?.food, "onion");
  assert.equal(line?.quantity, 3);
  assert.equal(line?.contributions.length, 2);
});

test("a merged row can be opened up to see which meal asked for what", () => {
  // The `because` rule, as a data structure.
  const [line] = mergeIngredients([
    meal("2026-10-06", "Chilli", ["2 onions"]),
    meal("2026-10-08", "Soup", ["1 onion"]),
  ]);

  assert.deepEqual(
    line?.contributions.map((c) => `${c.raw} — ${c.mealName}`),
    ["2 onions — Chilli", "1 onion — Soup"]
  );
});

test("adds up within a dimension and converts as it goes", () => {
  const [line] = mergeIngredients([meal("2026-10-06", "A", ["500 g mince"]), meal("2026-10-07", "B", ["1 kg mince"])]);
  assert.equal(line?.quantity, 1.5);
  assert.equal(line?.unit, "kg");
});

test("refuses to invent a conversion between dimensions", () => {
  // There is no honest number of grams in a pack. Two rows, not a guess.
  const lines = mergeIngredients([
    meal("2026-10-06", "A", ["300 g beef"]),
    meal("2026-10-07", "B", ["2 packs beef"]),
  ]);

  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.unit).sort(), ["g", "package"]);
});

test("rounds a count up to something you can put in a trolley", () => {
  const [line] = mergeIngredients([
    meal("2026-10-06", "A", ["1/2 onion"]),
    meal("2026-10-07", "B", ["1/2 onion"]),
    meal("2026-10-08", "C", ["1/4 onion"]),
  ]);
  // 1.25 onions is not a thing you can buy.
  assert.equal(line?.quantity, 2);
});

test("does not round a weight — 1.2 kg is an ordinary thing to ask for", () => {
  const [line] = mergeIngredients([meal("2026-10-06", "A", ["1.2 kg potatoes"])]);
  assert.equal(line?.quantity, 1.2);
});

test("flags a row where an amount could not be read, rather than guessing one", () => {
  const [line] = mergeIngredients([
    meal("2026-10-06", "Chilli", ["2 onions"]),
    meal("2026-10-08", "Soup", ["some onions"]),
  ]);

  assert.equal(line?.needsCheck, true);
  // And the two it could read are still counted.
  assert.equal(line?.quantity, 2);
});

test("a row nobody gave an amount for has no amount, not a one", () => {
  const [line] = mergeIngredients([meal("2026-10-06", "A", ["salt"])]);
  assert.equal(line?.quantity, null);
  assert.equal(line?.needsCheck, true);
});

test("records every date a line covers, de-duplicated and sorted", () => {
  const [line] = mergeIngredients([
    meal("2026-10-08", "B", ["1 onion"]),
    meal("2026-10-06", "A", ["1 onion"]),
    meal("2026-10-06", "C", ["1 onion"]),
  ]);
  assert.deepEqual(line?.dates, ["2026-10-06", "2026-10-08"]);
});

test("Instacart is sent a measurement array, not the field they deprecated", () => {
  // They deprecated LineItem.quantity/unit in March 2026. A bare count with
  // no unit makes "2 lb mince" arrive as two of something.
  assert.deepEqual(toMeasurements({ quantity: 1.5, unit: "kg" }), [{ quantity: 1.5, unit: "kg" }]);
  assert.deepEqual(toMeasurements({ quantity: 3, unit: null }), [{ quantity: 3, unit: "each" }]);
});

test("a line with no readable amount still goes over as one of something", () => {
  assert.deepEqual(toMeasurements({ quantity: null, unit: null }), [{ quantity: 1, unit: "each" }]);
});

test("every unit sent to Instacart is one from their closed vocabulary", () => {
  // An unrecognised unit makes their quantity matching fail silently.
  const INSTACART_UNITS = new Set([
    "each", "package", "packet", "bunch", "can", "head", "large", "medium", "small",
    "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon",
  ]);
  const samples = ["2 lb mince", "500 g rice", "1 cup milk", "3 cans tomatoes", "2 bunches kale", "4 onions", "1 gallon water"];
  for (const sample of samples) {
    const [line] = mergeIngredients([meal("2026-10-06", "A", [sample])]);
    for (const measurement of toMeasurements(line as never)) {
      assert.ok(INSTACART_UNITS.has(measurement.unit), `${measurement.unit} is not an Instacart unit (from "${sample}")`);
    }
  }
});

test("'some onions' lands on the same row as '2 onions'", () => {
  // They are the same food. A list that separates them is back to three
  // onion lines, which is the thing this exists to stop.
  const lines = mergeIngredients([
    meal("2026-10-06", "Chilli", ["2 onions"]),
    meal("2026-10-08", "Soup", ["a few onions"]),
  ]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.needsCheck, true, "and it still says somebody should look at it");
});

test("stripping a vague amount is not the same as reading one", () => {
  const parsed = parseIngredient("a handful of spinach");
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.food, "spinach");
});

test("a multi-word vague amount is stripped whole, not just its first word", () => {
  // Regex alternation is first-match-wins. With `a` listed before `a few`,
  // "a few onions" becomes a food called "few onion" and quietly stops
  // merging with "onion".
  for (const phrase of ["a few onions", "a handful of onions", "a couple of onions", "a bit of onion"]) {
    assert.equal(parseIngredient(phrase).food, "onion", `"${phrase}" should reduce to onion`);
  }
});
