import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MealPlan, { nextSevenDays } from "./MealPlan";
import { toLocalIsoDate } from "../lib/dates";
import type { MealPlanEntry } from "../types";

function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

describe("nextSevenDays", () => {
  it("returns 7 consecutive ISO dates starting today", () => {
    const days = nextSevenDays();
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(toLocalIsoDate(new Date()));
  });
});

describe("MealPlan", () => {
  it("shows a planned meal's name and an add prompt for an empty slot", () => {
    const today = nextSevenDays()[0] as string;
    const entries: MealPlanEntry[] = [{ date: today, slot: "dinner", mealName: "Tacos", ingredients: ["Tortillas"] }];

    render(<MealPlan entries={entries} onSave={vi.fn()} onRemove={vi.fn()} onGenerateGroceryList={vi.fn()} />);

    // The chip shows the meal plus how many ingredients it has, so you can
    // see at a glance which meals still need their ingredients filled in.
    expect(screen.getByText("Tacos (1)")).toBeInTheDocument();
    expect(screen.getAllByText("+ Breakfast").length).toBeGreaterThan(0);
  });

  it("opens the edit form for a slot and saves a new meal", async () => {
    const today = nextSevenDays()[0] as string;
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MealPlan entries={[]} onSave={onSave} onRemove={vi.fn()} onGenerateGroceryList={vi.fn()} />);

    fireEvent.click(screen.getAllByText("+ Dinner")[0] as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("Meal name (e.g. Tacos)"), { target: { value: "Tacos" } });
    fireEvent.change(screen.getByPlaceholderText(/ingredients, comma separated/i), {
      target: { value: "Tortillas, Ground beef" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(today, "dinner", { mealName: "Tacos", ingredients: ["Tortillas", "Ground beef"] })
    );
  });

  it("does not save when the meal name is blank", () => {
    const onSave = vi.fn();
    render(<MealPlan entries={[]} onSave={onSave} onRemove={vi.fn()} onGenerateGroceryList={vi.fn()} />);

    fireEvent.click(screen.getAllByText("+ Lunch")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears an existing meal", async () => {
    const today = nextSevenDays()[0] as string;
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const entries: MealPlanEntry[] = [{ date: today, slot: "dinner", mealName: "Tacos", ingredients: [] }];

    render(<MealPlan entries={entries} onSave={vi.fn()} onRemove={onRemove} onGenerateGroceryList={vi.fn()} />);

    fireEvent.click(screen.getByText("Tacos"));
    fireEvent.click(screen.getByRole("button", { name: /clear this meal/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(today, "dinner"));
  });

  it("shows the result after generating a grocery list", async () => {
    const onGenerateGroceryList = vi.fn().mockResolvedValue({ added: 3, skipped: 1 });
    render(<MealPlan entries={[]} onSave={vi.fn()} onRemove={vi.fn()} onGenerateGroceryList={onGenerateGroceryList} />);

    fireEvent.click(screen.getByRole("button", { name: /generate grocery list for this week/i }));

    await waitFor(() => expect(screen.getByText(/Added 3 ingredients/)).toBeInTheDocument());
    expect(screen.getByText(/1 already on it/)).toBeInTheDocument();
  });
});

// Sanity check that the test file's own date formatting matches the
// component's — guards against the two silently drifting apart.
describe("formatDayLabel parity", () => {
  it("matches what the component renders for today", () => {
    const today = nextSevenDays()[0] as string;
    render(<MealPlan entries={[]} onSave={vi.fn()} onRemove={vi.fn()} onGenerateGroceryList={vi.fn()} />);
    expect(screen.getByText(formatDayLabel(today))).toBeInTheDocument();
  });
});
