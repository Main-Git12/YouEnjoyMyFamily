import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MorningLaunch from "./MorningLaunch";
import { planRoutine, anchorMomentOn } from "../lib/routinePlan";
import type { Routine, RoutineRun } from "../types";

const ROUTINE: Routine = {
  routineId: "r1",
  name: "The bus",
  kind: "morning",
  anchorTime: "07:52",
  daysOfWeek: [1, 2, 3, 4, 5],
  active: true,
  steps: [
    { stepId: "s1", title: "Get dressed", targetMinutes: 10, memberId: "Parker" },
    { stepId: "s2", title: "Breakfast", targetMinutes: 15, memberId: null },
    { stepId: "s3", title: "Shoes and coat", targetMinutes: 5, memberId: null },
  ],
};
const TODAY = "2026-09-25";
const at = (time: string) => anchorMomentOn(TODAY, time);

function planAt(time: string, today: RoutineRun | null = null, history: RoutineRun[] = []) {
  return planRoutine({ routine: ROUTINE, history, today, isoDate: TODAY, now: at(time) });
}

function renderAt(time: string, overrides: Partial<Parameters<typeof MorningLaunch>[0]> = {}) {
  const props = {
    plan: planAt(time),
    anchorLabel: "The bus",
    onFinishStep: vi.fn(),
    onUndoStep: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<MorningLaunch {...props} />);
  return props;
}

describe("MorningLaunch", () => {
  it("shows one step at a time, with whose it is", () => {
    renderAt("07:05");
    expect(screen.getByRole("heading", { name: "Get dressed" })).toBeTruthy();
    expect(screen.getByText("Parker")).toBeTruthy();
    // The steps still to come are present but not headings — they're
    // reassurance, not a second to-do list competing for attention.
    expect(screen.queryByRole("heading", { name: "Breakfast" })).toBeNull();
  });

  it("leads with the deadline, because that's the thing nobody can argue with", () => {
    renderAt("07:05");
    expect(screen.getByText("The bus")).toBeTruthy();
    expect(screen.getByLabelText(/The bus at/)).toBeTruthy();
  });

  it("says how much slack is left while there is some", () => {
    renderAt("07:05");
    // 47 minutes to the bus, 30 minutes of routine.
    expect(screen.getByText("17 min spare")).toBeTruthy();
  });

  it("says how far behind, once behind", () => {
    renderAt("07:30");
    expect(screen.getByText("8 min behind")).toBeTruthy();
  });

  it("warns that it's tight before it's actually late", () => {
    renderAt("07:19");
    expect(screen.getByText("Cutting it fine")).toBeTruthy();
  });

  it("talks about the morning, never about the child", () => {
    const { container } = render(
      <MorningLaunch
        plan={planAt("07:30")}
        anchorLabel="The bus"
        onFinishStep={vi.fn()}
        onUndoStep={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const text = (container.textContent ?? "").toLowerCase();
    // "8 min behind" is a fact about a clock everybody in the room shares.
    // "Parker is behind" would be a verdict on a child, on a screen that
    // child is standing in front of.
    for (const banned of ["slow", "hurry", "lazy", "always late", "again"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("says whether a duration was measured or is still a guess", () => {
    renderAt("07:05");
    expect(screen.getByText(/your estimate, not measured yet/)).toBeTruthy();
  });

  it("says how many mornings a learned duration came from", () => {
    const history: RoutineRun[] = ["2026-09-23", "2026-09-24"].map((date) => ({
      routineId: "r1",
      date,
      startedAt: null,
      finishedAt: null,
      steps: [
        {
          stepId: "s1",
          title: "Get dressed",
          startedAt: anchorMomentOn(date, "07:10").toISOString(),
          finishedAt: anchorMomentOn(date, "07:18").toISOString(),
        },
      ],
    }));
    render(
      <MorningLaunch
        plan={planAt("07:05", null, history)}
        anchorLabel="The bus"
        onFinishStep={vi.fn()}
        onUndoStep={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText(/usually 8 min/)).toBeTruthy();
    expect(screen.getByText(/from the last 2 mornings/)).toBeTruthy();
  });

  it("ticks the current step off", () => {
    const props = renderAt("07:05");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onFinishStep).toHaveBeenCalledOnce();
    expect(vi.mocked(props.onFinishStep).mock.calls[0]?.[0]?.title).toBe("Get dressed");
  });

  it("offers an undo, because a mis-tap at seven in the morning is routine", () => {
    const today: RoutineRun = {
      routineId: "r1",
      date: TODAY,
      startedAt: anchorMomentOn(TODAY, "07:00").toISOString(),
      finishedAt: null,
      steps: [
        {
          stepId: "s1",
          title: "Get dressed",
          startedAt: anchorMomentOn(TODAY, "07:00").toISOString(),
          finishedAt: anchorMomentOn(TODAY, "07:09").toISOString(),
        },
      ],
    };
    const props = renderAt("07:09", { plan: planAt("07:09", today) });
    fireEvent.click(screen.getByRole("button", { name: /undo get dressed/i }));
    expect(props.onUndoStep).toHaveBeenCalledOnce();
  });

  it("celebrates rather than nags once everyone is ready", () => {
    const steps = ROUTINE.steps.map((step, index) => ({
      stepId: step.stepId,
      title: step.title,
      startedAt: anchorMomentOn(TODAY, `07:0${index}`).toISOString(),
      finishedAt: anchorMomentOn(TODAY, `07:0${index + 1}`).toISOString(),
    }));
    const today: RoutineRun = { routineId: "r1", date: TODAY, startedAt: null, finishedAt: null, steps };
    renderAt("07:10", { plan: planAt("07:10", today) });
    expect(screen.getByText("Out the door")).toBeTruthy();
    expect(screen.getByText(/42 minutes to spare/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("can be put away so the dashboard is reachable", () => {
    const props = renderAt("07:05");
    fireEvent.click(screen.getByRole("button", { name: /back to the dashboard/i }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });
  it("closes on Escape, like every other overlay here", () => {
    const props = renderAt("07:05");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("holds the page still underneath, and lets it go again", () => {
    const { unmount } = render(
      <MorningLaunch
        plan={planAt("07:05")}
        anchorLabel="The bus"
        onFinishStep={vi.fn()}
        onUndoStep={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    // The dashboard behind is seven screens tall; a stray swipe would
    // otherwise leave the family halfway down the meal plan at ten to eight.
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("puts keyboard focus on the thing to act on", () => {
    renderAt("07:05");
    expect(document.activeElement?.textContent).toBe("Done");
  });
});
