import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    listTasks: vi.fn(),
    listSchedules: vi.fn(),
    completeTask: vi.fn(),
    listStatedPreferences: vi.fn(),
    addStatedPreference: vi.fn(),
    removeStatedPreference: vi.fn(),
  },
}));

describe("Dashboard", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders fetched tasks and schedule entries", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([
      { scheduleId: "s1", date: "2025-01-15", title: "Soccer practice", startTime: null, endTime: null, memberIds: [] },
    ]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    expect(screen.getByText("Soccer practice")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach the backend/i)).not.toBeInTheDocument();
  });

  it("shows an error message when the backend is unreachable", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("Request failed: 500 /families/fam_demo/tasks"));
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the backend/i)).toBeInTheDocument());
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("shows the gem celebration and updated total after completing a task", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1",
      title: "Pack soccer bag",
      assignedTo: null,
      dueDate: null,
      status: "done",
      gemsAwarded: 10,
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    await waitFor(() => expect(screen.getByText("+10 gems")).toBeInTheDocument());
    expect(screen.getByText("10 gems collected")).toBeInTheDocument();
  });

  it("adds a stated preference a family member says out loud", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.addStatedPreference).mockResolvedValue({
      preferenceId: "p1",
      memberId: "Isla",
      category: "meal",
      statement: "prefers penne over spaghetti",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Nothing remembered yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Who said it?"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByPlaceholderText(/what did they say/i), {
      target: { value: "prefers penne over spaghetti" },
    });
    fireEvent.click(screen.getByRole("button", { name: /remember this/i }));

    await waitFor(() => expect(screen.getByText(/prefers penne over spaghetti/)).toBeInTheDocument());
    expect(api.addStatedPreference).toHaveBeenCalledWith("fam_demo", {
      memberId: "Isla",
      category: "meal",
      statement: "prefers penne over spaghetti",
    });
  });
});
