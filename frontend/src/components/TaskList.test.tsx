import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TaskList from "./TaskList";
import type { Task } from "../types";

describe("TaskList", () => {
  it("shows a calm empty state when there are no tasks", () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("renders each task's title and due date", () => {
    const tasks: Task[] = [
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: "2025-01-15", status: "pending" },
      { taskId: "t2", title: "Buy milk", assignedTo: null, dueDate: null, status: "pending" },
    ];

    render(<TaskList tasks={tasks} />);

    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.getByText("2025-01-15")).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });
});
