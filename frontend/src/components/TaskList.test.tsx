import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskList from "./TaskList";
import type { Task } from "../types";

describe("TaskList", () => {
  it("shows a calm empty state when there are no tasks", () => {
    render(<TaskList tasks={[]} onComplete={() => {}} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("renders each task's title and due date", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: "2025-01-15", status: "pending" },
      { taskId: "t2", title: "Buy milk", assignedTo: null, dueDate: null, status: "pending" },
    ];

    render(<TaskList tasks={tasks} onComplete={() => {}} />);

    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.getByText("2025-01-15")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });

  it("calls onComplete with the task id when its mark-done control is clicked", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending" },
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText(/mark pack soccer bag complete/i));

    expect(onComplete).toHaveBeenCalledWith("t1");
  });

  it("does not call onComplete for a task that is already done", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [{ taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "done" }];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText(/pack soccer bag complete/i));

    expect(onComplete).not.toHaveBeenCalled();
  });
});
