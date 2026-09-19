import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FamilyFavorites from "./FamilyFavorites";
import type { StatedPreference } from "../types";

describe("FamilyFavorites", () => {
  it("shows a calm empty state when nothing has been recorded", () => {
    render(<FamilyFavorites preferences={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/nothing remembered yet/i)).toBeInTheDocument();
  });

  it("renders each stated preference's member, category, and statement", () => {
    const preferences: StatedPreference[] = [
      { preferenceId: "p1", memberId: "Isla", category: "meal", statement: "prefers penne over spaghetti" },
      { preferenceId: "p2", memberId: "Parker", category: "activity", statement: "wants to try soccer" },
    ];

    render(<FamilyFavorites preferences={preferences} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText(/prefers penne over spaghetti/)).toBeInTheDocument();
    expect(screen.getByText(/wants to try soccer/)).toBeInTheDocument();
    expect(screen.getByText("Isla", { exact: false })).toBeInTheDocument();
  });

  it("calls onAdd with the entered member, category, and statement, then clears the form", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<FamilyFavorites preferences={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Who said it?"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByPlaceholderText(/what did they say/i), { target: { value: "loves tacos" } });
    fireEvent.click(screen.getByRole("button", { name: /remember this/i }));

    expect(onAdd).toHaveBeenCalledWith({ memberId: "Isla", category: "meal", statement: "loves tacos" });
    await waitFor(() => expect(screen.getByPlaceholderText("Who said it?")).toHaveValue(""));
    expect(screen.getByPlaceholderText(/what did they say/i)).toHaveValue("");
  });

  it("does not call onAdd when the member or statement is blank", () => {
    const onAdd = vi.fn();
    render(<FamilyFavorites preferences={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /remember this/i }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("keeps what was typed when saving fails, so nothing has to be retyped", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("network error"));
    render(<FamilyFavorites preferences={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Who said it?"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByPlaceholderText(/what did they say/i), { target: { value: "loves tacos" } });
    fireEvent.click(screen.getByRole("button", { name: /remember this/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Who said it?")).toHaveValue("Isla");
    expect(screen.getByPlaceholderText(/what did they say/i)).toHaveValue("loves tacos");
  });

  it("calls onRemove with the clicked preference", () => {
    const onRemove = vi.fn();
    const preferences: StatedPreference[] = [
      { preferenceId: "p1", memberId: "Isla", category: "meal", statement: "prefers penne over spaghetti" },
    ];

    render(<FamilyFavorites preferences={preferences} onAdd={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Forget "prefers penne over spaghetti"'));

    expect(onRemove).toHaveBeenCalledWith(preferences[0]);
  });
});
