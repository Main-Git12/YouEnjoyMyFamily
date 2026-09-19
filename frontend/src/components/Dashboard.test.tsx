import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    listTasks: vi.fn(),
    listSchedules: vi.fn(),
  },
}));

describe("Dashboard", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders fetched tasks and schedule entries", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending" },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([
      { scheduleId: "s1", date: "2025-01-15", title: "Soccer practice", startTime: null, endTime: null, memberIds: [] },
    ]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    expect(screen.getByText("Soccer practice")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach the backend/i)).not.toBeInTheDocument();
  });

  it("shows an error message when the backend is unreachable", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("Request failed: 500 /families/fam_demo/tasks"));
    vi.mocked(api.listSchedules).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the backend/i)).toBeInTheDocument());
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });
});
