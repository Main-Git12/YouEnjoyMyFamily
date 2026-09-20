import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CastleAlert from "./CastleAlert";
import type { Task } from "../types";

const TASK: Task = {
  taskId: "t1",
  title: "wipe the table",
  assignedTo: "Parker",
  dueDate: null,
  status: "pending",
  gemsAwarded: 0,
};

describe("CastleAlert", () => {
  it("shows a threat line naming the assignee and the task", () => {
    render(<CastleAlert task={TASK} onDefend={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Castle Under Attack!")).toBeInTheDocument();
    expect(screen.getByText(/Parker/)).toBeInTheDocument();
    expect(screen.getByText(/wipe the table/)).toBeInTheDocument();
  });

  it("falls back to a generic name when no assignee is set", () => {
    render(<CastleAlert task={{ ...TASK, assignedTo: null }} onDefend={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(/Someone/)).toBeInTheDocument();
  });

  it("calls onDefend with the task when defending the castle", () => {
    const onDefend = vi.fn();
    render(<CastleAlert task={TASK} onDefend={onDefend} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /defend the castle/i }));

    expect(onDefend).toHaveBeenCalledWith(TASK);
  });

  it("calls onDismiss when dismissed", () => {
    const onDismiss = vi.fn();
    render(<CastleAlert task={TASK} onDefend={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    expect(onDismiss).toHaveBeenCalled();
  });
});
