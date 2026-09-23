import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GemThreatAlert from "./GemThreatAlert";
import { threatForChore, type ThreatenedChore } from "../lib/gemThreats";

const threatened: ThreatenedChore = {
  task: {
    taskId: "t1",
    title: "Wipe Table",
    assignedTo: "Parker",
    dueDate: null,
    gemValue: 10,
    dueWindow: "after_dinner",
    status: "pending",
    gemsAwarded: 0,
  },
  threat: threatForChore("Wipe Table"),
  assignee: "Parker",
};

describe("GemThreatAlert", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the child, the chore and what's at stake", () => {
    render(<GemThreatAlert threatened={threatened} onDefend={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Your gems are in danger!")).toBeInTheDocument();
    const taunt = screen.getByText(/Parker/);
    expect(taunt).toHaveTextContent("Wipe Table");
    expect(taunt).toHaveTextContent("10");
  });

  it("celebrates with the gems won before closing itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDefend = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    render(<GemThreatAlert threatened={threatened} onDefend={onDefend} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: threatened.threat.callToAction }));

    await waitFor(() => expect(screen.getByText("Gems saved!")).toBeInTheDocument());
    expect(screen.getByText("+10 gems")).toBeInTheDocument();
    // The victory stays up long enough to be watched.
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("stays open with the button live again when the chore doesn't save", async () => {
    const onDefend = vi.fn().mockRejectedValue(new Error("offline"));
    render(<GemThreatAlert threatened={threatened} onDefend={onDefend} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: threatened.threat.callToAction }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: threatened.threat.callToAction })).toBeEnabled()
    );
    expect(screen.queryByText("Gems saved!")).not.toBeInTheDocument();
  });

  it("can be waved away without completing the chore", () => {
    const onDefend = vi.fn();
    const onDismiss = vi.fn();
    render(<GemThreatAlert threatened={threatened} onDefend={onDefend} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onDefend).not.toHaveBeenCalled();
  });

  it("closes on Escape, the way any other dialog would", () => {
    const onDismiss = vi.fn();
    render(<GemThreatAlert threatened={threatened} onDefend={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalled();
  });

  it("puts focus on the action, rather than leaving it behind the overlay", () => {
    render(<GemThreatAlert threatened={threatened} onDefend={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: threatened.threat.callToAction })).toHaveFocus();
  });
});
