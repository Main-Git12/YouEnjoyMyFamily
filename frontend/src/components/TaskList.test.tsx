import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskList from "./TaskList";
import type { Task } from "../types";

describe("TaskList", () => {
  it("shows a calm empty state when there are no tasks", () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("renders each task's title and due date", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: "2025-01-15", status: "pending", gemsAwarded: 0 },
      { taskId: "t2", title: "Buy milk", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.getByText("2025-01-15")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });

  it("calls onComplete when a pending task's mark-done button is clicked", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    expect(onComplete).toHaveBeenCalledWith(tasks[0]);
  });

  it("hides the mark-done button and shows a strikethrough for a completed task", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "done", gemsAwarded: 10 },
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);

    expect(screen.queryByLabelText('Mark "Pack soccer bag" done')).not.toBeInTheDocument();
    expect(screen.getByText("Pack soccer bag")).toHaveClass("line-through");
  });
});
