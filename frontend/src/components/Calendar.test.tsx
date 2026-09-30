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

/**
 * The school's specials rotation is merged in at render rather than stored
 * as calendar rows — see lib/schoolDay.ts. These assert the two things that
 * makes it the family's job to trust: it is visibly not one of their own
 * entries, and it says where it came from.
 */
describe("Calendar — the school's specials", () => {
  const LIBRARY = {
    memberId: "Parker",
    schoolName: "Violet Elementary",
    date: "2026-10-01",
    subject: "Library",
    prepNote: "Have your student bring in their library book to return.",
    because: "From Miss Hineline's specials schedule for Violet Elementary.",
  };

  it("shows the subject, whose it is, and what has to be brought", () => {
    render(<Calendar entries={[]} school={[LIBRARY]} />);
    expect(screen.getByText("Library — Parker")).toBeInTheDocument();
    expect(
      screen.getByText("Have your student bring in their library book to return.")
    ).toBeInTheDocument();
  });

  it("names the sheet it came from, so nobody thinks they typed it", () => {
    render(<Calendar entries={[]} school={[LIBRARY]} />);
    expect(
      screen.getByText("From Miss Hineline's specials schedule for Violet Elementary.")
    ).toBeInTheDocument();
  });

  it("is not called 'nothing scheduled' when the only thing on is school", () => {
    render(<Calendar entries={[]} school={[LIBRARY]} />);
    expect(screen.queryByText(/nothing scheduled/i)).not.toBeInTheDocument();
  });

  it("still says nothing is scheduled when there is genuinely nothing", () => {
    render(<Calendar entries={[]} school={[]} />);
    expect(screen.getByText(/nothing scheduled/i)).toBeInTheDocument();
  });

  it("puts the family's own timed entries above the school's rotation", () => {
    const entries = [
      { scheduleId: "s1", date: "2026-10-01", title: "Dentist", startTime: "09:00", endTime: null, memberIds: [] },
    ];
    render(<Calendar entries={entries} school={[LIBRARY]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Dentist");
    expect(rows[1]).toHaveTextContent("Library — Parker");
  });

  it("shows a day that needs nothing brought without an empty line under it", () => {
    render(<Calendar entries={[]} school={[{ ...LIBRARY, subject: "Music", prepNote: null }]} />);
    expect(screen.getByText("Music — Parker")).toBeInTheDocument();
    const row = screen.getByRole("listitem");
    expect(row).not.toHaveTextContent("library book");
  });
});
