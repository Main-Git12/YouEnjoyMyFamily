import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChoreLibrary from "./ChoreLibrary";
import { CHORE_CATALOG } from "../lib/choreCatalog";

describe("ChoreLibrary", () => {
  it("stays out of the way until someone wants to add a chore", () => {
    render(<ChoreLibrary onAdd={vi.fn()} members={[]} />);

    expect(screen.getByRole("button", { name: /add a chore/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Wipe Table/ })).not.toBeInTheDocument();
  });

  it("offers the whole library once opened", () => {
    render(<ChoreLibrary onAdd={vi.fn()} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    for (const chore of CHORE_CATALOG) {
      const chip = screen.getByRole("button", { name: new RegExp(`^${chore.title}\\b`) });
      expect(chip).toHaveTextContent(String(chore.gemValue));
    }
  });

  it("flags the chores that only happen on school days", () => {
    render(<ChoreLibrary onAdd={vi.fn()} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    // Homework is a weekdays chore; wiping the table is every day, and
    // shouldn't be cluttered with a label saying so.
    expect(screen.getByRole("button", { name: /^Homework/ })).toHaveTextContent("School days");
    expect(screen.getByRole("button", { name: /^Wipe Table/ })).not.toHaveTextContent("Every day");
  });

  it("adds a library chore at its own gem value, time of day and rhythm", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.change(screen.getByPlaceholderText(/leave blank for anyone/i), { target: { value: "Parker" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sleep in my own bed/ }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        title: "Sleep in my own bed",
        gemValue: 20,
        dueWindow: "bedtime",
        recurrence: "daily",
        assignedTo: "Parker",
      })
    );
  });

  it("leaves a chore unassigned when nobody is named", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Let dogs out/ }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: null })));
  });

  it("adds a chore that isn't in the library at all", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.change(screen.getByLabelText("New chore"), { target: { value: "Water the tomatoes" } });
    fireEvent.change(screen.getByLabelText("Gems it pays"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("When it's due"), { target: { value: "after_school" } });
    fireEvent.change(screen.getByLabelText("How often"), { target: { value: "weekends" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        title: "Water the tomatoes",
        gemValue: 15,
        dueWindow: "after_school",
        recurrence: "weekends",
        assignedTo: null,
      })
    );
    await waitFor(() => expect(screen.getByLabelText("New chore")).toHaveValue(""));
  });

  it("does not add a chore with no name", () => {
    const onAdd = vi.fn();
    render(<ChoreLibrary onAdd={onAdd} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers the names already in use, so nobody retypes a variant", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<ChoreLibrary onAdd={onAdd} members={["Isla", "Parker"]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.click(screen.getByRole("button", { name: "Parker" }));
    fireEvent.click(screen.getByRole("button", { name: /^Wipe Table/ }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: "Parker" })));
  });

  it("can still hand a chore to nobody in particular", () => {
    render(<ChoreLibrary onAdd={vi.fn()} members={["Parker"]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));

    fireEvent.click(screen.getByRole("button", { name: "Parker" }));
    expect(screen.getByRole("button", { name: "Parker" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Anyone" }));
    expect(screen.getByRole("button", { name: "Anyone" })).toHaveAttribute("aria-pressed", "true");
  });
});
