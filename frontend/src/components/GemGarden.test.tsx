import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GemGarden from "./GemGarden";

describe("GemGarden", () => {
  it("shows the current stage name, gem total, and progress toward the next stage", () => {
    render(<GemGarden totalGems={10} />);

    expect(screen.getByText("Tiny Seed")).toBeInTheDocument();
    expect(screen.getByText("10 gems in the garden")).toBeInTheDocument();
    expect(screen.getByText(/15 more gems to reach Sprout/)).toBeInTheDocument();

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("uses singular phrasing when exactly one gem remains", () => {
    render(<GemGarden totalGems={24} />);
    expect(screen.getByText(/1 more gem to reach Sprout/)).toBeInTheDocument();
  });

  it("shows a full-bloom message with no progress bar at the top stage", () => {
    render(<GemGarden totalGems={500} />);

    expect(screen.getByText("Magical Grove")).toBeInTheDocument();
    expect(screen.getByText(/full bloom/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
