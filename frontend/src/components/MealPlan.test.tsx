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
    today: TODAY,
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

describe("swapping a dinner", () => {
  const history: MealPlanEntry[] = [
    { date: "2026-08-03", slot: "dinner", mealName: "Chilli", ingredients: ["1 kg mince", "2 cans kidney beans"] },
    { date: "2026-09-07", slot: "dinner", mealName: "Pasta bake", ingredients: ["Penne", "Passata"] },
  ];
  const days = ["2026-10-07", "2026-10-08"];
  const swapProps = (overrides: Partial<MealPlanProps> = {}): MealPlanProps => ({
    entries: [],
    days,
    weekOffset: 0,
    onWeekOffsetChange: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    onGenerateGroceryList: vi.fn(),
    history,
    today: "2026-10-07",
    ...overrides,
  });

  const openDinnerOn = (label: string) =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Dinner on ${label}`) }));

  it("offers meals from the family's own history, with the reason", () => {
    render(<MealPlan {...swapProps()} />);
    openDinnerOn("Wed, Oct 7");

    expect(screen.getByRole("button", { name: /Chilli/ })).toBeInTheDocument();
    expect(screen.getByText("Not had since Aug 3.")).toBeInTheDocument();
  });

  it("brings the ingredients back with the meal, so nobody retypes them", async () => {
    // This is the actual work in a Sunday planning session, and the app
    // has the list from last time.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MealPlan {...swapProps({ onSave })} />);
    openDinnerOn("Wed, Oct 7");

    fireEvent.click(screen.getByRole("button", { name: /Chilli/ }));
    expect(screen.getByLabelText(/Ingredients/)).toHaveValue("1 kg mince, 2 cans kidney beans");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("2026-10-07", "dinner", {
      mealName: "Chilli",
      ingredients: ["1 kg mince", "2 cans kidney beans"],
    });
  });

  it("can name a night without inventing a meal, and shops for nothing", async () => {
    // A Sunday plan with two blanks in it is a plan somebody abandons,
    // and the blanks are usually leftovers and going out.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MealPlan {...swapProps({ onSave })} />);
    openDinnerOn("Wed, Oct 7");

    fireEvent.click(screen.getByRole("button", { name: /Leftovers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("2026-10-07", "dinner", { mealName: "Leftovers", ingredients: [] });
  });

  it("doesn't offer swaps for breakfast or lunch", () => {
    render(<MealPlan {...swapProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Breakfast on Wed, Oct 7/ }));
    expect(screen.queryByText("Or one of these")).not.toBeInTheDocument();
  });

  it("won't offer back what's already on that night", () => {
    render(
      <MealPlan
        {...swapProps({
          entries: [{ date: "2026-10-07", slot: "dinner", mealName: "Chilli", ingredients: [] }],
          history: [...history, { date: "2026-10-07", slot: "dinner", mealName: "Chilli", ingredients: [] }],
        })}
      />
    );
    openDinnerOn("Wed, Oct 7");
    // Pasta bake is the only thing left to offer.
    expect(screen.getByText("Not had since Sep 7.")).toBeInTheDocument();
    expect(screen.queryByText(/Not had since Aug 3/)).not.toBeInTheDocument();
  });
});

describe("what the evening already has on it", () => {
  const days = ["2026-10-07", "2026-10-08"];
  const baseProps = {
    entries: [],
    days,
    weekOffset: 0,
    onWeekOffsetChange: () => {},
    onSave: async () => {},
    onRemove: async () => {},
    onGenerateGroceryList: async () => ({ added: 0, skipped: 0 }),
    today: "2026-10-07",
  };

  it("shows the calendar's own words beside the day being planned", () => {
    // The meal is rarely what went wrong on a Wednesday. The evening was,
    // and it was already on the calendar when the plan was made.
    render(
      <MealPlan
        {...baseProps}
        eveningRoom={[
          { date: "2026-10-07", inTheWay: [], because: "Swim at 16:45, Soccer at 17:30" },
          { date: "2026-10-08", inTheWay: [], because: null },
        ]}
      />
    );

    expect(screen.getByText("Swim at 16:45, Soccer at 17:30")).toBeInTheDocument();
  });

  it("says nothing at all about a day with room in it", () => {
    const { container } = render(
      <MealPlan {...baseProps} eveningRoom={[{ date: "2026-10-08", inTheWay: [], because: null }]} />
    );

    expect(container.textContent).not.toMatch(/busy|no time|tight|rushed|can't cook/i);
  });

  it("offers back what this family itself reached for, with the count", () => {
    render(
      <MealPlan
        {...baseProps}
        standbys={[
          { mealName: "Pasta bake", times: 4, because: "Planned on 4 evenings that already had something on." },
        ]}
      />
    );

    expect(screen.getByText("Pasta bake")).toBeInTheDocument();
    expect(screen.getByText(/4×/)).toBeInTheDocument();
  });

  it("never calls a meal quick, or an evening a problem", () => {
    const { container } = render(
      <MealPlan
        {...baseProps}
        eveningRoom={[{ date: "2026-10-07", inTheWay: [], because: "Soccer at 17:30" }]}
        standbys={[{ mealName: "Pasta bake", times: 4, because: "Planned on 4 evenings." }]}
      />
    );

    // The app has no idea how long anything takes to make in this kitchen.
    // Word boundaries on purpose — "Breakfast" contains "fast", and a
    // banned-phrasing guard that fires on its own slot labels is a guard
    // somebody deletes rather than fixes.
    expect(container.textContent).not.toMatch(/\b(quick|easy|fast|simple|speedy)\b|\b\d+ min/i);
  });

  it("works for a household with nothing on the calendar at all", () => {
    render(<MealPlan {...baseProps} />);
    expect(screen.getAllByText(/Breakfast/).length).toBeGreaterThan(0);
  });
});
