import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Celebration from "./Celebration";

describe("Celebration", () => {
  it("shows the gems earned and running total", () => {
    render(<Celebration gemsEarned={10} totalGems={40} onDismiss={vi.fn()} />);

    expect(screen.getByText("+10 gems")).toBeInTheDocument();
    expect(screen.getByText("40 gems collected so far")).toBeInTheDocument();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<Celebration gemsEarned={10} totalGems={40} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /nice/i }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it("auto-dismisses after a few seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Celebration gemsEarned={10} totalGems={40} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(3300);

    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
