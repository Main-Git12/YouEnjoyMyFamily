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
    expect(screen.getByText(/nothing on the list/i)).toBeInTheDocument();
  });

  it("renders each task's title", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: "2026-09-23", gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Buy milk", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    // A chore due on the day being shown says nothing about its date: it
    // would be on every row and tell nobody anything.
    expect(screen.queryByText(/2026-09-23/)).not.toBeInTheDocument();
    expect(screen.queryByText(/due/i)).not.toBeInTheDocument();
  });

  it("says which day a carried-over chore came from, in words rather than an ISO date", () => {
    // A one-off nobody got to stays on the list instead of vanishing, so the
    // row has to be honest about how old it is.
    const tasks: Task[] = [
      { taskId: "t1", title: "Return library book", assignedTo: "Parker", dueDate: "2026-09-21", gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "none", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText(/was due Monday/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-21/)).not.toBeInTheDocument();
  });

  it("drops the overdue line once the chore is done", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Return library book", assignedTo: "Parker", dueDate: "2026-09-21", gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "none", completedOn: "2026-09-23", status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("Return library book")).toBeInTheDocument();
    expect(screen.queryByText(/was due/)).not.toBeInTheDocument();
  });

  it("calls onComplete when a pending task's mark-done button is clicked", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    expect(onComplete).toHaveBeenCalledWith(tasks[0]);
  });

  it("hides the mark-done button and shows a strikethrough for a completed task", () => {
    const onComplete = vi.fn();
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} onComplete={onComplete} />);

    expect(screen.queryByLabelText('Mark "Pack soccer bag" done')).not.toBeInTheDocument();
    expect(screen.getByText("Pack soccer bag")).toHaveClass("line-through");
  });

  it("shows what each chore pays, and what it actually paid once it's done", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Sleep in my own bed", assignedTo: "Parker", dueDate: null, gemValue: 20, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 5 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("20", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("+5", { exact: false })).toBeInTheDocument();
  });

  it("groups the day by part of day, with a heading for each", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} now={new Date(2026, 8, 23, 7, 0)} />);

    expect(screen.getByRole("heading", { name: "Morning" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After dinner" })).toBeInTheDocument();
    // Each chore still says whose it is.
    expect(screen.getByText("Parker")).toBeInTheDocument();
    expect(screen.getByText("Isla")).toBeInTheDocument();
  });

  it("puts the part of the day you're in at the top, and marks it", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Put on pajamas", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    // Half eight in the evening: morning is history, bedtime is the thing.
    render(<TaskList tasks={tasks} now={new Date(2026, 8, 23, 20, 0)} />);

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings[0]).toBe("Bedtime");
    expect(headings[1]).toBe("Morning");
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("says how much of each part of the day is left", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 5 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Brush Teeth", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} now={new Date(2026, 8, 23, 7, 0)} />);

    expect(screen.getByText("1 to go")).toBeInTheDocument();
  });

  it("says so when a part of the day is finished", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Get Dressed", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 5 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} now={new Date(2026, 8, 23, 7, 0)} />);

    expect(screen.getByText("all done")).toBeInTheDocument();
  });

  it("marks a chore as still to do once its part of the day has passed", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 21, 30) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText(/still to do/)).toBeInTheDocument();
  });

  it("does not nag about a chore whose part of the day is still open", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 18, 45) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.queryByText(/still to do/)).not.toBeInTheDocument();
  });

  it("never calls a finished chore late, however late it is", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 23, 23, 59) });
    const tasks: Task[] = [
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"},
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.queryByText(/still to do/)).not.toBeInTheDocument();
  });
});
