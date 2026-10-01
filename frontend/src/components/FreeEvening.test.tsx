import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FreeEvening from "./FreeEvening";

const idea = {
  date: "2026-10-08",
  weekdayLabel: "Thursday",
  statement: "I like going to the skate park",
  saidBy: "Parker",
  because: "From Parker's list of things they've said they like.",
};

describe("FreeEvening", () => {
  it("names the evening and quotes the person", () => {
    render(<FreeEvening idea={idea} />);

    expect(screen.getByText(/Thursday evening/)).toBeInTheDocument();
    expect(screen.getByText(/I like going to the skate park/)).toBeInTheDocument();
    expect(screen.getByText(/From Parker's list/)).toBeInTheDocument();
  });

  it("shows nothing at all rather than a placeholder", () => {
    // A box reading "no ideas right now" is worse than no box: it takes
    // space on a wall screen to report an absence.
    const { container } = render(<FreeEvening idea={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("doesn't dress a quote up as the app's own recommendation", () => {
    const { container } = render(<FreeEvening idea={idea} />);
    expect(container.textContent).not.toMatch(/we suggest|recommend|you should|why not|how about|try/i);
  });
});
