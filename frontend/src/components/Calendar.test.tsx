import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Calendar from "./Calendar";
import type { ScheduleEntry } from "../types";

describe("Calendar", () => {
  it("shows a placeholder when nothing is scheduled", () => {
    render(<Calendar entries={[]} />);
    expect(screen.getByText(/nothing scheduled/i)).toBeInTheDocument();
  });

  it("falls back to 'All day' when an entry has no start time", () => {
    const entries: ScheduleEntry[] = [
      { scheduleId: "s1", date: "2025-01-15", title: "Soccer practice", startTime: null, endTime: null, memberIds: [] },
    ];

    render(<Calendar entries={entries} />);

    expect(screen.getByText("Soccer practice")).toBeInTheDocument();
    expect(screen.getByText("All day")).toBeInTheDocument();
  });

  it("shows the start time when one is set", () => {
    const entries: ScheduleEntry[] = [
      {
        scheduleId: "s1",
        date: "2025-01-15",
        title: "Dentist",
        startTime: "09:00",
        endTime: "10:00",
        memberIds: [],
      },
    ];

    render(<Calendar entries={entries} />);
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });
});
