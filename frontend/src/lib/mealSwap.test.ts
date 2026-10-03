import { describe, it, expect } from "vitest";
import { swapOptions, STANDING_OPTIONS, ingredientsFor } from "./mealSwap";
import type { MealPlanEntry } from "../types";

const dinner = (date: string, mealName: string): MealPlanEntry => ({
  date,
  slot: "dinner",
  mealName,
  ingredients: [],
});

// 2026-10-05 is a Monday. The week on screen is the 5th to the 11th.
const TODAY = "2026-10-05";

describe("swapOptions", () => {
  it("offers meals this family has actually cooked, never an invented one", () => {
    const entries = [
      dinner("2026-09-07", "Chilli"),
      dinner("2026-09-14", "Pasta bake"),
      dinner("2026-09-21", "Stir fry"),
    ];
    const options = swapOptions({ entries, date: "2026-10-08", currentName: null, today: TODAY });
    expect(options.map((option) => option.mealName).sort()).toEqual(["Chilli", "Pasta bake", "Stir fry"]);
  });

  it("puts the longest-ago meal first", () => {
    // Variety people actually want is the rotation moving. A thing you
    // haven't had for a month beats a thing you have never had, and it is
    // also the only honest suggestion — the app has no idea whether you'd
    // like the thing you've never had.
    const entries = [
      dinner("2026-09-28", "Stir fry"),
      dinner("2026-08-10", "Chilli"),
      dinner("2026-09-14", "Pasta bake"),
    ];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    expect(options.map((option) => option.mealName)).toEqual(["Chilli", "Pasta bake", "Stir fry"]);
    expect(options[0]?.because).toMatch(/Not had since Aug 10/);
  });

  it("prefers the meal that belongs to that weekday", () => {
    // Three Thursdays of tacos is what their own records say, not a guess.
    const entries = [
      dinner("2026-09-10", "Tacos"),
      dinner("2026-09-17", "Tacos"),
      dinner("2026-09-24", "Tacos"),
      dinner("2026-08-01", "Chilli"),
    ];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY }); // a Thursday
    expect(options[0]?.mealName).toBe("Tacos");
    expect(options[0]?.because).toBe("Has been dinner on 3 Thursdays.");
  });

  it("won't offer back the thing that's already on that night", () => {
    const entries = [dinner("2026-09-01", "Chilli"), dinner("2026-09-08", "Pasta bake")];
    const options = swapOptions({ entries, date: "2026-10-08", currentName: "Chilli", today: TODAY });
    expect(options.map((option) => option.mealName)).not.toContain("Chilli");
  });

  it("won't put the same dinner twice in four days", () => {
    // Already on Tuesday the 6th, so it can't be Thursday the 8th too.
    const entries = [dinner("2026-08-01", "Chilli"), dinner("2026-10-06", "Chilli"), dinner("2026-08-02", "Pasta bake")];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    expect(options.map((option) => option.mealName)).toEqual(["Pasta bake"]);
  });

  it("looks forwards as well as back", () => {
    // Already down for Saturday the 10th. Putting it on Thursday the 8th
    // too would be the same mistake in the other direction.
    const entries = [dinner("2026-08-01", "Chilli"), dinner("2026-10-10", "Chilli"), dinner("2026-08-02", "Soup")];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    expect(options.map((option) => option.mealName)).toEqual(["Soup"]);
  });

  it("never says a planned meal has already been had", () => {
    // Friday hasn't happened. "Not had since Friday" is the app reading
    // its own notes back as though they were a memory.
    const entries = [dinner("2026-10-30", "Risotto"), dinner("2026-08-02", "Soup")];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    const risotto = options.find((option) => option.mealName === "Risotto");
    expect(risotto?.because).not.toMatch(/Not had since/);
    expect(risotto?.because).toMatch(/Already down for/);
  });

  it("keeps the list short enough to read on a wall", () => {
    const entries = ["Chilli", "Soup", "Pasta", "Curry", "Fish", "Pie"].map((name, index) =>
      dinner(`2026-07-${String(index + 1).padStart(2, "0")}`, name)
    );
    expect(swapOptions({ entries, date: "2026-10-08", today: TODAY })).toHaveLength(3);
    expect(swapOptions({ entries, date: "2026-10-08", today: TODAY, limit: 5 })).toHaveLength(5);
  });

  it("has nothing to offer a family with no history, rather than inventing some", () => {
    expect(swapOptions({ entries: [], date: "2026-10-08", today: TODAY })).toEqual([]);
  });

  it("leaves the standing options to be offered separately, always", () => {
    // Leftovers is always available; it shouldn't take one of the three
    // slots that are meant for the rotation.
    const entries = [dinner("2026-09-01", "Leftovers"), dinner("2026-09-02", "Chilli")];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    expect(options.map((option) => option.mealName)).toEqual(["Chilli"]);
  });

  it("ignores breakfast and lunch — a swap is about dinner", () => {
    const entries: MealPlanEntry[] = [
      { date: "2026-09-01", slot: "lunch", mealName: "Sandwiches", ingredients: [] },
      dinner("2026-09-02", "Chilli"),
    ];
    const options = swapOptions({ entries, date: "2026-10-08", today: TODAY });
    expect(options.map((option) => option.mealName)).toEqual(["Chilli"]);
  });

  it("the subject is always the meal, never the person cooking it", () => {
    const entries = [dinner("2026-08-01", "Chilli"), dinner("2026-09-01", "Soup")];
    const text = swapOptions({ entries, date: "2026-10-08", today: TODAY })
      .map((option) => option.because)
      .join(" ");
    for (const name of ["Paige", "Parker", "Isla", "Sheliah", "Andrew", "you"]) {
      expect(text).not.toContain(name);
    }
  });
});

describe("STANDING_OPTIONS", () => {
  it("gives a night a name without inventing a meal for it", () => {
    // A Sunday plan with two blanks in it is a plan somebody abandons, and
    // the blanks are usually leftovers and going out.
    expect(STANDING_OPTIONS.map((option) => option.mealName)).toEqual(["Leftovers", "Eating out"]);
    for (const option of STANDING_OPTIONS) {
      expect(option.because).toBe("Nothing to shop for.");
    }
  });
});

describe("ingredientsFor", () => {
  const withStuff = (date: string, mealName: string, ingredients: string[]): MealPlanEntry => ({
    date,
    slot: "dinner",
    mealName,
    ingredients,
  });

  it("brings back what the meal needed last time, so nobody retypes it", () => {
    // Picking a meal and then retyping its eight ingredients is the actual
    // work in a Sunday planning session.
    const entries = [
      withStuff("2026-08-01", "Chilli", ["Mince", "Kidney beans"]),
      withStuff("2026-09-01", "Chilli", ["1 kg mince", "2 cans kidney beans", "Chilli powder"]),
    ];
    expect(ingredientsFor(entries, "Chilli")).toEqual(["1 kg mince", "2 cans kidney beans", "Chilli powder"]);
  });

  it("matches however the name was capitalised", () => {
    const entries = [withStuff("2026-09-01", "chilli", ["Mince"])];
    expect(ingredientsFor(entries, "Chilli")).toEqual(["Mince"]);
  });

  it("returns nothing rather than inventing a list", () => {
    expect(ingredientsFor([], "Chilli")).toEqual([]);
    // An empty list is an honest answer about a meal nobody wrote
    // ingredients for. A made-up one is not.
    expect(ingredientsFor([withStuff("2026-09-01", "Chilli", [])], "Chilli")).toEqual([]);
  });

  it("never shops for leftovers or a night out", () => {
    const entries = [withStuff("2026-09-01", "Leftovers", ["Somehow this got typed in"])];
    expect(ingredientsFor(entries, "Leftovers")).toEqual([]);
    expect(ingredientsFor(entries, "Eating out")).toEqual([]);
  });

  it("hands back a copy, so editing the form can't rewrite history", () => {
    const entries = [withStuff("2026-09-01", "Chilli", ["Mince"])];
    ingredientsFor(entries, "Chilli").push("Something nobody asked for");
    expect(entries[0]?.ingredients).toEqual(["Mince"]);
  });
});
