import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TomorrowBriefing from "./TomorrowBriefing";
import type { TomorrowBrief } from "../lib/tomorrow";

const BRIEF: TomorrowBrief = {
  date: "2026-10-01",
  weekdayLabel: "Thursday",
  signals: [
    {
      id: "morning",
      kind: "morning",
      headline: "Thursday mornings have been tight.",
      because: "The last 3 Thursday mornings, finishing about 2 minutes after 07:52.",
      question: { label: "Look at the steps", panel: "morning" },
    },
    {
      id: "school:Parker",
      kind: "school",
      headline: "Library for Parker — bring the library book back.",
      because: "From Mr Alder's specials schedule for Maple Street Elementary.",
      question: { label: "Tick it off", panel: "school" },
    },
  ],
  outlook: { tightness: "tight", because: "1 calendar entry, Thursday mornings finishing with little to spare over 3 of them" },
};

describe("TomorrowBriefing", () => {
  it("has an honest empty state rather than inventing something to say", () => {
    render(<TomorrowBriefing brief={null} />);
    expect(screen.getByText(/Nothing standing out about tomorrow/)).toBeInTheDocument();
  });

  it("shows each signal with its evidence", () => {
    render(<TomorrowBriefing brief={BRIEF} />);
    expect(screen.getByText("Thursday mornings have been tight.")).toBeInTheDocument();
    expect(
      screen.getByText("The last 3 Thursday mornings, finishing about 2 minutes after 07:52.")
    ).toBeInTheDocument();
  });

  /**
   * "Looks tight" on its own is a mood. The reasons have to be on screen
   * beside it or a parent has nothing to disagree with.
   */
  it("never shows the verdict without the reasons behind it", () => {
    render(<TomorrowBriefing brief={BRIEF} />);
    expect(screen.getByText("Looks tight")).toBeInTheDocument();
    expect(screen.getByText(/1 calendar entry, Thursday mornings finishing with little to spare/)).toBeInTheDocument();
  });

  it("opens the panel a question points at, rather than acting on it", () => {
    const onOpen = vi.fn();
    render(<TomorrowBriefing brief={BRIEF} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Look at the steps" }));
    expect(onOpen).toHaveBeenCalledWith("morning");
    fireEvent.click(screen.getByRole("button", { name: "Tick it off" }));
    expect(onOpen).toHaveBeenCalledWith("school");
  });

  it("renders a brief with no outlook without falling over", () => {
    render(<TomorrowBriefing brief={{ ...BRIEF, outlook: null }} />);
    expect(screen.queryByText(/Looks /)).not.toBeInTheDocument();
    expect(screen.getByText("Thursday mornings have been tight.")).toBeInTheDocument();
  });

  it("renders a signal with no question without an empty button", () => {
    const plain = { ...BRIEF, signals: [{ ...BRIEF.signals[0]!, question: undefined }] };
    render(<TomorrowBriefing brief={plain} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
