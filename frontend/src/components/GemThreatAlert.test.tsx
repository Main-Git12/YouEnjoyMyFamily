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
    dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null,
    status: "pending",
    gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
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

/**
 * The always-on case. This is a wall display: the scenario can appear with
 * nobody in the room, and it used to hold the whole screen — tomorrow's
 * library book, the bedtime list, everything — behind a raccoon until
 * somebody walked past and tapped.
 */
describe("GemThreatAlert on an empty kitchen", () => {
  it("stands down on its own when nobody answers it", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <GemThreatAlert threatened={threatened} onDefend={async () => {}} onDismiss={onDismiss} standDownAfterMs={90_000} />
      );
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(89_000); });
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Proved with a stand-down shorter than the celebration, because with the
   * default 90 seconds against a 2.6-second victory beat the guard can
   * never fire and a test of it cannot fail. This is the case it exists
   * for: whatever the two timings are relative to each other, answering the
   * scenario cancels the stand-down.
   */
  it("keeps the victory on screen even when the stand-down is shorter than it", async () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <GemThreatAlert threatened={threatened} onDefend={async () => {}} onDismiss={onDismiss} standDownAfterMs={1_000} />
      );
      fireEvent.click(screen.getByRole("button", { name: /Chase him off/ }));
      await act(async () => { await Promise.resolve(); });
      // Past the stand-down, still inside the celebration.
      act(() => { vi.advanceTimersByTime(1_500); });
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1_500); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cut the celebration short once somebody has answered it", async () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <GemThreatAlert
          threatened={threatened}
          onDefend={async () => {}}
          onDismiss={onDismiss}
          standDownAfterMs={90_000}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Chase him off/ }));
      await act(async () => { await Promise.resolve(); });
      // The stand-down timer is gone; only the victory beat's own 2.6s runs.
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
