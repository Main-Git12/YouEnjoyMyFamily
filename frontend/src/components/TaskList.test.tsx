import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskList from "./TaskList";
import type { Task } from "../types";

describe("TaskList", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a calm empty state when there are no tasks", () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("renders each task's title and due date", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: "2025-01-15", gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
      { taskId: "t2", title: "Buy milk", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.getByText("2025-01-15")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });

  it("calls onComplete when a pending task's mark-done button is clicked", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    expect(onComplete).toHaveBeenCalledWith(tasks[0]);
  });

  it("hides the mark-done button and shows a strikethrough for a completed task", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 },
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);

    expect(screen.queryByLabelText('Mark "Pack soccer bag" done')).not.toBeInTheDocument();
    expect(screen.getByText("Pack soccer bag")).toHaveClass("line-through");
  });

  it("shows what each chore pays, and what it actually paid once it's done", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Sleep in my own bed", assignedTo: "Parker", dueDate: null, gemValue: 20, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
      { taskId: "t2", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 5 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("20", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("+5", { exact: false })).toBeInTheDocument();
  });

  it("says who a chore belongs to and which part of the day it's for", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText(/Parker/)).toHaveTextContent("After dinner");
  });

  it("marks a chore as still to do once its part of the day has passed", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 21, 30) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText(/still to do/)).toBeInTheDocument();
  });

  it("does not nag about a chore whose part of the day is still open", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 18, 45) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.queryByText(/still to do/)).not.toBeInTheDocument();
  });

  it("never calls a finished chore late, however late it is", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 23, 59) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.queryByText(/still to do/)).not.toBeInTheDocument();
  });
});
