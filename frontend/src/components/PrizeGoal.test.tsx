import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PrizeGoal from "./PrizeGoal";
import type { RewardGoal } from "../types";

const goal = (overrides: Partial<RewardGoal> = {}): RewardGoal => ({
  memberId: "Parker",
  title: "LEGO set",
  gemCost: 50,
  note: null,
  ...overrides,
});

describe("PrizeGoal", () => {
  it("invites the family to pick a prize when nobody has one yet", () => {
    render(<PrizeGoal goals={[]} gemsByChild={{}} onSetGoal={vi.fn()} />);
    expect(screen.getByText(/no prizes set yet/i)).toBeInTheDocument();
  });

  it("counts down the gems still to go", () => {
    render(<PrizeGoal goals={[goal()]} gemsByChild={{ Parker: 30 }} onSetGoal={vi.fn()} />);

    expect(screen.getByText("LEGO set")).toBeInTheDocument();
    expect(screen.getByText("20 more gems to go!")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("says gem, not gems, when only one is left", () => {
    render(<PrizeGoal goals={[goal()]} gemsByChild={{ Parker: 49 }} onSetGoal={vi.fn()} />);
    expect(screen.getByText("1 more gem to go!")).toBeInTheDocument();
  });

  it("shows nothing owing, and never a negative, once the prize is earned", () => {
    render(<PrizeGoal goals={[goal()]} gemsByChild={{ Parker: 80 }} onSetGoal={vi.fn()} />);

    expect(screen.getByText(/Earned it! Parker can claim LEGO set\./)).toBeInTheDocument();
    expect(screen.queryByText(/more gem/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("starts a child with no gems yet at zero rather than blank", () => {
    render(<PrizeGoal goals={[goal({ memberId: "Isla", title: "Roller skates", gemCost: 40 })]} gemsByChild={{}} onSetGoal={vi.fn()} />);

    expect(screen.getByText("40 more gems to go!")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("saves a new prize and clears the form", async () => {
    const onSetGoal = vi.fn().mockResolvedValue(undefined);
    render(<PrizeGoal goals={[]} gemsByChild={{}} onSetGoal={onSetGoal} />);

    fireEvent.change(screen.getByLabelText("Whose prize"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByLabelText("The prize"), { target: { value: "Roller skates" } });
    fireEvent.change(screen.getByLabelText("Gems needed"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /set prize/i }));

    await waitFor(() => expect(onSetGoal).toHaveBeenCalledWith("Isla", { title: "Roller skates", gemCost: 120 }));
    await waitFor(() => expect(screen.getByLabelText("The prize")).toHaveValue(""));
  });

  it("does not save a prize with no gem cost", () => {
    const onSetGoal = vi.fn();
    render(<PrizeGoal goals={[]} gemsByChild={{}} onSetGoal={onSetGoal} />);

    fireEvent.change(screen.getByLabelText("Whose prize"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByLabelText("The prize"), { target: { value: "Roller skates" } });
    fireEvent.click(screen.getByRole("button", { name: /set prize/i }));

    expect(onSetGoal).not.toHaveBeenCalled();
  });

  it("keeps what was typed when saving fails, so nothing has to be retyped", async () => {
    const onSetGoal = vi.fn().mockRejectedValue(new Error("offline"));
    render(<PrizeGoal goals={[]} gemsByChild={{}} onSetGoal={onSetGoal} />);

    fireEvent.change(screen.getByLabelText("Whose prize"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByLabelText("The prize"), { target: { value: "Roller skates" } });
    fireEvent.change(screen.getByLabelText("Gems needed"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /set prize/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /set prize/i })).toBeEnabled());
    expect(screen.getByLabelText("The prize")).toHaveValue("Roller skates");
  });
});
