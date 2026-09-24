import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Insights from "./Insights";
import type { Insight } from "../lib/insights";

const insight = (overrides: Partial<Insight> = {}): Insight => ({
  id: "i1",
  kind: "slipping",
  title: "Wipe Table is the one that keeps getting left.",
  because: "Done 2 of the last 28 days it was set for after dinner.",
  action: { label: "Try a different time of day", kind: "reschedule_chore", payload: "t1" },
  ...overrides,
});

describe("Insights", () => {
  it("says so plainly when there's nothing worth noting yet", () => {
    render(<Insights insights={[]} onAct={vi.fn()} />);
    expect(screen.getByText(/nothing to note yet/i)).toBeInTheDocument();
  });

  it("always shows its working under the observation", () => {
    render(<Insights insights={[insight()]} onAct={vi.fn()} />);

    // The evidence is the point: a family should be able to check the app's
    // reasoning rather than take its word for it.
    expect(screen.getByText("Wipe Table is the one that keeps getting left.")).toBeInTheDocument();
    expect(screen.getByText("Done 2 of the last 28 days it was set for after dinner.")).toBeInTheDocument();
  });

  it("offers the action, and only acts when it's tapped", async () => {
    const onAct = vi.fn().mockResolvedValue(undefined);
    const only = insight();
    render(<Insights insights={[only]} onAct={onAct} />);

    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try a different time of day" }));

    await waitFor(() => expect(onAct).toHaveBeenCalledWith(only));
  });

  it("shows an observation that has no action, without a dangling button", () => {
    render(<Insights insights={[insight({ kind: "streak", title: "Parker has done Wipe Table 5 days running.", action: undefined })]} onAct={vi.fn()} />);

    expect(screen.getByText(/5 days running/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the decorative marks away from screen readers", () => {
    const { container } = render(<Insights insights={[insight()]} onAct={vi.fn()} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
