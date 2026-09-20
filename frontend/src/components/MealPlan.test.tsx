import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MealPlan from "./MealPlan";
import { toLocalIsoDate, weekFromOffset } from "../lib/dates";
import type { MealPlanEntry } from "../types";

const THIS_WEEK = weekFromOffset(0);
const TODAY = THIS_WEEK[0] as string;

type MealPlanProps = Parameters<typeof MealPlan>[0];

function mealPlanProps(overrides: Partial<MealPlanProps> = {}): MealPlanProps {
  return {
    entries: [],
    days: THIS_WEEK,
    weekOffset: 0,
    onWeekOffsetChange: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    onGenerateGroceryList: vi.fn(),
    ...overrides,
  };
}

function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

describe("weekFromOffset", () => {
  it("starts today for the current week and jumps a week at a time", () => {
    expect(THIS_WEEK).toHaveLength(7);
    expect(TODAY).toBe(toLocalIsoDate(new Date()));

    const nextWeek = weekFromOffset(1);
    const expectedStart = new Date();
    expectedStart.setDate(expectedStart.getDate() + 7);
    expect(nextWeek[0]).toBe(toLocalIsoDate(expectedStart));
  });
});

describe("MealPlan", () => {
  it("shows a planned meal's name and an add prompt for an empty slot", () => {
    const entries: MealPlanEntry[] = [{ date: TODAY, slot: "dinner", mealName: "Tacos", ingredients: ["Tortillas"] }];

    render(<MealPlan {...mealPlanProps({ entries })} />);

    // The chip shows the meal plus how many ingredients it has, so you can
    // see at a glance which meals still need their ingredients filled in.
    expect(screen.getByText("Tacos (1)")).toBeInTheDocument();
    expect(screen.getAllByText("+ Breakfast").length).toBeGreaterThan(0);
  });

  it("opens the edit form for a slot and saves a new meal", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MealPlan {...mealPlanProps({ onSave })} />);

    fireEvent.click(screen.getAllByText("+ Dinner")[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Meal name"), { target: { value: "Tacos" } });
    fireEvent.change(screen.getByLabelText("Ingredients, comma separated"), {
      target: { value: "Tortillas, Ground beef" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(TODAY, "dinner", { mealName: "Tacos", ingredients: ["Tortillas", "Ground beef"] })
    );
  });

  it("does not save when the meal name is blank", () => {
    const onSave = vi.fn();
    render(<MealPlan {...mealPlanProps({ onSave })} />);

    fireEvent.click(screen.getAllByText("+ Lunch")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears an existing meal", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const entries: MealPlanEntry[] = [{ date: TODAY, slot: "dinner", mealName: "Tacos", ingredients: [] }];

    render(<MealPlan {...mealPlanProps({ entries, onRemove })} />);

    fireEvent.click(screen.getByText("Tacos"));
    fireEvent.click(screen.getByRole("button", { name: /clear this meal/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(TODAY, "dinner"));
  });

  it("shows the result after generating a grocery list", async () => {
    const onGenerateGroceryList = vi.fn().mockResolvedValue({ added: 3, skipped: 1 });
    render(<MealPlan {...mealPlanProps({ onGenerateGroceryList })} />);

    fireEvent.click(screen.getByRole("button", { name: /generate grocery list/i }));

    await waitFor(() => expect(screen.getByText(/Added 3 ingredients/)).toBeInTheDocument());
    expect(screen.getByText(/1 already on it/)).toBeInTheDocument();
  });

  it("keeps the meal and its ingredients on screen when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    render(<MealPlan {...mealPlanProps({ onSave })} />);

    fireEvent.click(screen.getAllByText("+ Dinner")[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Meal name"), { target: { value: "Shepherd's pie" } });
    fireEvent.change(screen.getByLabelText("Ingredients, comma separated"), {
      target: { value: "Lamb mince, Potatoes, Carrots" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Nobody should have to retype all of that because the network blipped.
    expect(screen.getByLabelText("Meal name")).toHaveValue("Shepherd's pie");
    expect(screen.getByLabelText("Ingredients, comma separated")).toHaveValue("Lamb mince, Potatoes, Carrots");
  });

  it("says so when building the grocery list fails, rather than doing nothing visible", async () => {
    const onGenerateGroceryList = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    render(<MealPlan {...mealPlanProps({ onGenerateGroceryList })} />);

    fireEvent.click(screen.getByRole("button", { name: /generate grocery list/i }));

    await waitFor(() => expect(screen.getByText(/couldn't build the grocery list/i)).toBeInTheDocument());
  });

  it("lets the family page forward to plan a future week and back again", () => {
    const onWeekOffsetChange = vi.fn();
    render(<MealPlan {...mealPlanProps({ onWeekOffsetChange })} />);

    expect(screen.getByText("This week")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show the next week/i }));
    expect(onWeekOffsetChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: /show the previous week/i }));
    expect(onWeekOffsetChange).toHaveBeenCalledWith(-1);
  });

  it("labels a non-current week by its starting date rather than calling it 'this week'", () => {
    const nextWeek = weekFromOffset(1);
    render(<MealPlan {...mealPlanProps({ days: nextWeek, weekOffset: 1 })} />);

    expect(screen.queryByText("This week")).not.toBeInTheDocument();
    expect(screen.getByText(/^Week of /)).toBeInTheDocument();
    // It renders the dates it was handed, not a window of its own choosing.
    expect(screen.getByText(formatDayLabel(nextWeek[0] as string))).toBeInTheDocument();
  });
});

// Sanity check that the test file's own date formatting matches the
// component's — guards against the two silently drifting apart.
describe("formatDayLabel parity", () => {
  it("matches what the component renders for today", () => {
    render(<MealPlan {...mealPlanProps()} />);
    expect(screen.getByText(formatDayLabel(TODAY))).toBeInTheDocument();
  });
});
