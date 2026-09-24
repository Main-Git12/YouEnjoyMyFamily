import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RetimeChore from "./RetimeChore";
import type { Task } from "../types";

const task: Task = {
  taskId: "t1",
  title: "Wipe Table",
  assignedTo: "Parker",
  dueDate: null,
  date: "2026-09-23",
  status: "pending",
  gemValue: 10,
  dueWindow: "bedtime",
  recurrence: "daily",
  completedOn: null,
  gemsAwarded: 0,
};

describe("RetimeChore", () => {
  it("asks the question without answering it", () => {
    render(<RetimeChore task={task} onChoose={vi.fn()} onDismiss={vi.fn()} />);

    // Every window is on offer. The app has no basis for choosing one —
    // when bath happens isn't in any completion record.
    expect(screen.getByText("When should Wipe Table happen?")).toBeInTheDocument();
    for (const label of ["Morning", "After school", "After dinner", "Anytime"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
  });

  it("marks where the chore sits now, and won't re-pick it", () => {
    render(<RetimeChore task={task} onChoose={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Bedtime — where it is now/ })).toBeDisabled();
  });

  it("moves the chore to the chosen part of the day", async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined);
    render(<RetimeChore task={task} onChoose={onChoose} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "After dinner" }));

    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("after_dinner"));
  });

  it("lets the family decline, which is a real answer", () => {
    const onDismiss = vi.fn();
    render(<RetimeChore task={task} onChoose={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /leave it where it is/i }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it("closes on Escape, like any other dialog", () => {
    const onDismiss = vi.fn();
    render(<RetimeChore task={task} onChoose={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalled();
  });
});
