import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChoreLibrary from "./ChoreLibrary";
import { CHORE_CATALOG } from "../lib/choreCatalog";

describe("ChoreLibrary", () => {
  it("stays out of the way until someone wants to add a chore", () => {
    render(<ChoreLibrary onAdd={vi.fn()} />);

    expect(screen.getByRole("button", { name: /add a chore/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Wipe Table/ })).not.toBeInTheDocument();
  });

  it("offers the whole library once opened", () => {
    render(<ChoreLibrary onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    for (const chore of CHORE_CATALOG) {
      expect(screen.getByRole("button", { name: new RegExp(`^${chore.title} ${chore.gemValue}$`) })).toBeInTheDocument();
    }
  });

  it("adds a library chore at its own gem value and time of day", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.change(screen.getByPlaceholderText(/leave blank for anyone/i), { target: { value: "Parker" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sleep in my own bed/ }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        title: "Sleep in my own bed",
        gemValue: 20,
        dueWindow: "bedtime",
        assignedTo: "Parker",
      })
    );
  });

  it("leaves a chore unassigned when nobody is named", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Let dogs out/ }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: null })));
  });

  it("adds a chore that isn't in the library at all", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.change(screen.getByLabelText("New chore"), { target: { value: "Water the tomatoes" } });
    fireEvent.change(screen.getByLabelText("Gems it pays"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("When it's due"), { target: { value: "after_school" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        title: "Water the tomatoes",
        gemValue: 15,
        dueWindow: "after_school",
        assignedTo: null,
      })
    );
    await waitFor(() => expect(screen.getByLabelText("New chore")).toHaveValue(""));
  });

  it("does not add a chore with no name", () => {
    const onAdd = vi.fn();
    render(<ChoreLibrary onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(onAdd).not.toHaveBeenCalled();
  });
});
