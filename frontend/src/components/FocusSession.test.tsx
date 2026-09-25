import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import FocusSession from "./FocusSession";
import type { FocusBlock } from "../types";

const SUGGESTION = { minutes: 52, because: "80% of your 52-minute blocks ran to the end, over 10 of them" };

function block(overrides: Partial<FocusBlock> = {}): FocusBlock {
  return {
    blockId: "b1",
    memberId: "Paige",
    date: "2026-09-25",
    startedAt: "2026-09-25T09:00:00.000Z",
    endedAt: "2026-09-25T09:52:00.000Z",
    plannedMinutes: 52,
    actualMinutes: 52,
    outcome: "completed",
    matter: "DR-1042",
    note: null,
    ...overrides,
  };
}

function setup(history: FocusBlock[] = []) {
  const onRecord = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <FocusSession memberId="Paige" suggestion={SUGGESTION} history={history} onRecord={onRecord} onClose={onClose} />
  );
  return { onRecord, onClose };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FocusSession", () => {
  it("offers the lengths with something behind them, and says why it suggests one", () => {
    setup();
    for (const length of ["25", "52", "60", "90"]) {
      expect(screen.getByRole("button", { name: length })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "52" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/80% of your 52-minute blocks ran to the end/)).toBeTruthy();
  });

  it("counts down from the length chosen", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "60" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("60:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByText("58:30")).toBeTruthy();
  });

  it("reads the wall clock, so a throttled background tab doesn't under-count", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "25" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // Ten real minutes pass while the tab is asleep and almost no
    // intervals fire. A decrementing counter would still read 24:59.
    act(() => {
      // advanceTimersByTime moves the mocked clock too, so stop a second
      // short and let it carry us onto the boundary.
      vi.setSystemTime(new Date("2026-09-25T13:09:59Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("15:00")).toBeTruthy();
  });

  it("goes to the timesheet by itself when the block runs out", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "25" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:25:00Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/25 min · 0.4 hr/)).toBeTruthy();
    expect(screen.getByLabelText("Matter")).toBeTruthy();
  });

  it("can be stopped early, and logs what it actually ran for", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    const { onRecord } = setup();
    fireEvent.click(screen.getByRole("button", { name: "60" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:18:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));

    expect(screen.getByText(/18 min · 0.3 hr/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Matter"), { target: { value: "DR-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    const recorded = onRecord.mock.calls[0]?.[0];
    expect(recorded.plannedMinutes).toBe(60);
    expect(recorded.matter).toBe("DR-77");
    // 18 of a planned 60 — real work, but the length didn't hold, and the
    // suggestion engine has to be able to tell the difference.
    expect(recorded.outcome).toBe("cut_short");
  });

  it("counts a block stopped a minute early as having held", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    const { onRecord } = setup();
    fireEvent.click(screen.getByRole("button", { name: "60" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:57:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    expect(onRecord.mock.calls[0]?.[0].outcome).toBe("completed");
  });

  it("files a block barely begun as abandoned", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    const { onRecord } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:02:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    expect(onRecord.mock.calls[0]?.[0].outcome).toBe("abandoned");
  });

  it("offers recent matters for one tap rather than retyping a number", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    setup([block({ matter: "DR-1042" }), block({ blockId: "b2", matter: "DR-77", startedAt: "2026-09-25T11:00:00.000Z" })]);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:30:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));
    fireEvent.click(screen.getByRole("button", { name: "DR-77" }));
    expect((screen.getByLabelText("Matter") as HTMLInputElement).value).toBe("DR-77");
  });

  it("still records the time when there's no matter to put against it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    const { onRecord } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:30:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));
    // A tool that loses your time because you couldn't face the form is a
    // tool you stop opening.
    fireEvent.click(screen.getByRole("button", { name: "Log without a matter" }));
    await waitFor(() => expect(onRecord).toHaveBeenCalledOnce());
    expect(onRecord.mock.calls[0]?.[0].matter).toBeNull();
  });

  it("comes back ready for the next block once one is logged", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => {
      vi.setSystemTime(new Date("2026-09-25T13:30:00Z"));
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop and log it" }));
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeTruthy());
  });

  it("does not let Escape throw away a block that's still running", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-25T13:00:00Z") });
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
