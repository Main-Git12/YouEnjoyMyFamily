import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DraftWeek from "./DraftWeek";
import type { DraftedMeal } from "../lib/routines";

const draft: DraftedMeal[] = [
  { date: "2026-09-29", mealName: "Tacos", because: "Tacos has been dinner on 3 Tuesdays." },
  { date: "2026-09-30", mealName: "Chilli", because: "Not had since 2026-09-10." },
];

describe("DraftWeek", () => {
  it("stays out of the way for a family with nothing to draft from", () => {
    const { container } = render(<DraftWeek draft={[]} onAccept={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("promises nothing invented, and shows why each meal landed where it did", () => {
    render(<DraftWeek draft={draft} onAccept={vi.fn()} />);

    expect(screen.getByText(/nothing invented/i)).toBeInTheDocument();
    expect(screen.getByText("Tacos has been dinner on 3 Tuesdays.")).toBeInTheDocument();
    expect(screen.getByText("Not had since 2026-09-10.")).toBeInTheDocument();
  });

  it("saves nothing until someone says so", () => {
    const onAccept = vi.fn();
    render(<DraftWeek draft={draft} onAccept={onAccept} />);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("pencils in what's left after dropping one", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(<DraftWeek draft={draft} onAccept={onAccept} />);

    fireEvent.click(screen.getByLabelText("Drop Tacos"));
    fireEvent.click(screen.getByRole("button", { name: /pencil in 1 dinner/i }));

    await waitFor(() => expect(onAccept).toHaveBeenCalledWith([draft[1]]));
  });

  it("lets a dropped meal be put back", () => {
    render(<DraftWeek draft={draft} onAccept={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Drop Tacos"));
    expect(screen.getByRole("button", { name: /pencil in 1 dinner/i })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Put Tacos back"));
    expect(screen.getByRole("button", { name: /pencil in 2 dinners/i })).toBeInTheDocument();
  });

  it("won't save an empty week", () => {
    render(<DraftWeek draft={draft} onAccept={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Drop Tacos"));
    fireEvent.click(screen.getByLabelText("Drop Chilli"));

    expect(screen.getByRole("button", { name: /nothing selected/i })).toBeDisabled();
  });
});
