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
});
