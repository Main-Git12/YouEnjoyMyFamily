import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GemCastle from "./GemCastle";

describe("GemCastle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the current stage name, gem total, and progress toward the next stage", () => {
    render(<GemCastle totalGems={10} />);

    expect(screen.getByText("Watchtower")).toBeInTheDocument();
    expect(screen.getByText("10 gems in the kingdom")).toBeInTheDocument();
    expect(screen.getByText(/15 more gems to reach Knight's Keep/)).toBeInTheDocument();

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("uses singular phrasing when exactly one gem remains", () => {
    render(<GemCastle totalGems={24} />);
    expect(screen.getByText(/1 more gem to reach Knight's Keep/)).toBeInTheDocument();
  });

  it("shows a completion message with no progress bar at the top stage", () => {
    render(<GemCastle totalGems={500} />);

    expect(screen.getByText("Kingdom of Gems")).toBeInTheDocument();
    expect(screen.getByText(/every hero has come home/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a flavor line from a current resident when the castle is tapped", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<GemCastle totalGems={30} />);

    expect(screen.queryByText(/Sir Olive/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /visit the castle/i }));

    expect(screen.getByText(/Sir Olive: Onward, brave gem collector!/)).toBeInTheDocument();
  });

  it("gives a gentle nudge when nobody lives there yet", () => {
    render(<GemCastle totalGems={0} />);

    fireEvent.click(screen.getByRole("button", { name: /visit the castle/i }));

    expect(screen.getByText(/finish a few more chores/i)).toBeInTheDocument();
  });
});
