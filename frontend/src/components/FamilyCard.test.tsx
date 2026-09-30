import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FamilyCard from "./FamilyCard";

describe("FamilyCard", () => {
  it("gives its title a real heading, so the screen has an outline", () => {
    render(<FamilyCard title="Today's tasks">contents</FamilyCard>);

    expect(screen.getByRole("heading", { name: "Today's tasks" })).toBeInTheDocument();
    expect(screen.getByText("contents")).toBeInTheDocument();
  });

  it("uses the olive that white text is actually readable on when accented", () => {
    // olive-600, not olive-500: white on olive-500 is 4.21:1, under the
    // body-text bar. See theme.contrast.test.ts.
    const { container } = render(
      <FamilyCard title="Today's schedule" accent>
        contents
      </FamilyCard>
    );

    expect(container.firstElementChild).toHaveClass("bg-olive-600", "text-white");
  });

  it("stays a plain white card by default", () => {
    const { container } = render(<FamilyCard title="Today's tasks">contents</FamilyCard>);

    expect(container.firstElementChild).toHaveClass("bg-white");
    expect(container.firstElementChild).not.toHaveClass("bg-olive-600");
  });

  it("gives the hero card a louder heading", () => {
    render(
      <FamilyCard title="Today's chores" size="hero">
        contents
      </FamilyCard>
    );
    expect(screen.getByRole("heading", { name: "Today's chores" }).parentElement).toHaveClass("text-2xl");
  });

  it("gives a compact card a quieter one, for the rail", () => {
    render(
      <FamilyCard title="Gem Castle" size="compact">
        contents
      </FamilyCard>
    );
    expect(screen.getByRole("heading", { name: "Gem Castle" }).parentElement).toHaveClass("text-base");
  });

  it("leaves placement to whatever is laying the screen out", () => {
    // The card cannot see the grid it is in. Choosing its own span is what
    // made the old eight-cell layout impossible to restructure.
    const { container } = render(<FamilyCard title="Gem Castle">contents</FamilyCard>);
    expect(container.firstElementChild?.className).not.toMatch(/col-span/);
  });

  it("takes the span it is given", () => {
    const { container } = render(
      <FamilyCard title="Today's chores" className="lg:col-span-7">
        contents
      </FamilyCard>
    );
    expect(container.firstElementChild).toHaveClass("lg:col-span-7");
  });

  it("can carry a count or a state under the heading", () => {
    render(
      <FamilyCard title="Grocery cart" subtitle="6 to buy">
        contents
      </FamilyCard>
    );
    expect(screen.getByText("6 to buy")).toBeInTheDocument();
  });
});
