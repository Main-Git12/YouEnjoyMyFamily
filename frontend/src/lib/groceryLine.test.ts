import { describe, it, expect } from "vitest";
import { groceryLineNote } from "./groceryLine";
import type { CartItem } from "../types";

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  itemId: "i1",
  description: "Ground beef",
  quantity: 1,
  status: "pending",
  substituteDescription: null,
  orderedAt: null,
  source: "meal_plan",
  ...overrides,
});

// 2025-01-17 is a Friday, 2025-01-19 a Sunday, 2025-01-14 a Tuesday.

describe("groceryLineNote", () => {
  it("names the meals a merged row came from, in date order", () => {
    const note = groceryLineNote(
      item({
        description: "1.5 kg Ground beef",
        amount: 1.5,
        unit: "kg",
        contributions: [
          { date: "2025-01-19", slot: "dinner", mealName: "Chilli", raw: "500 g ground beef" },
          { date: "2025-01-17", slot: "dinner", mealName: "Tacos", raw: "1 kg ground beef" },
        ],
      })
    );
    expect(note.because).toBe("Tacos (Friday) · Chilli (Sunday)");
    expect(note.check).toBeNull();
  });

  it("says nothing at all about a row somebody typed in themselves", () => {
    expect(groceryLineNote(item({ source: "manual", description: "Milk" }))).toEqual({
      because: null,
      check: null,
    });
  });

  it("shows the family's own words when no amount could be read", () => {
    const note = groceryLineNote(
      item({
        description: "Rice",
        amount: null,
        needsCheck: true,
        contributions: [
          { date: "2025-01-14", slot: "dinner", mealName: "Stir fry", raw: "some rice" },
          { date: "2025-01-17", slot: "dinner", mealName: "Tacos", raw: "Rice" },
        ],
      })
    );
    expect(note.because).toBe("Stir fry (Tuesday) · Tacos (Friday)");
    // Checkable, not merely flagged: the gap is in the plan, and these are
    // the words that left it there.
    expect(note.check).toBe("No amount given — “some rice”, “Rice”");
  });

  it("makes the same point once when several meals used the same words", () => {
    const note = groceryLineNote(
      item({
        needsCheck: true,
        contributions: [
          { date: "2025-01-14", slot: "dinner", mealName: "Stir fry", raw: "Rice" },
          { date: "2025-01-17", slot: "dinner", mealName: "Tacos", raw: "Rice" },
        ],
      })
    );
    expect(note.check).toBe("No amount given — “Rice”");
  });

  it("doesn't name the same meal on the same day twice", () => {
    const note = groceryLineNote(
      item({
        contributions: [
          { date: "2025-01-17", slot: "lunch", mealName: "Leftovers", raw: "rice" },
          { date: "2025-01-17", slot: "dinner", mealName: "Leftovers", raw: "rice" },
        ],
      })
    );
    expect(note.because).toBe("Leftovers (Friday)");
  });

  it("never names a person, only meals", () => {
    const note = groceryLineNote(
      item({
        needsCheck: true,
        contributions: [{ date: "2025-01-17", slot: "dinner", mealName: "Tacos", raw: "rice" }],
      })
    );
    for (const name of ["Paige", "Parker", "Isla", "Sheliah", "Andrew"]) {
      expect(`${note.because} ${note.check}`).not.toContain(name);
    }
  });
});
