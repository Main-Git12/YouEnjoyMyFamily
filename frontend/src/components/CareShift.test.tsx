import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CareShift from "./CareShift";
import type { CarePlan } from "../lib/carePlan";

const at = (hour: number, minute = 0) => new Date(2026, 9, 6, hour, minute);

const plan = (overrides: Partial<CarePlan> = {}): CarePlan => ({
  carer: { memberId: "kimmie", displayName: "Kimmie", role: "carer", note: null, daysOfWeek: [2, 3, 4], startsAt: "09:00", endsAt: "13:00" },
  shiftStart: at(9),
  shiftEnd: at(13),
  steps: [
    { stepId: "shower", title: "Shower", expectedMinutes: 36, basis: { kind: "learned", samples: 3 }, startsAt: at(9), memberId: null },
    { stepId: "walk", title: "A walk", expectedMinutes: 30, basis: { kind: "estimate" }, startsAt: at(9, 36), memberId: null },
  ],
  paused: [],
  totalExpectedMinutes: 66,
  roomMinutes: 174,
  measuredSteps: 1,
  ...overrides,
});

describe("CareShift", () => {
  it("says who is on and what hours they keep", () => {
    render(<CareShift plan={plan()} overlap={null} />);

    expect(screen.getByText(/Kimmie/)).toBeInTheDocument();
    expect(screen.getByText(/9:00.*1:00/)).toBeInTheDocument();
  });

  it("lays the steps out with the time each one starts", () => {
    render(<CareShift plan={plan()} overlap={null} />);

    expect(screen.getByText("Shower")).toBeInTheDocument();
    expect(screen.getByText(/9:36/)).toBeInTheDocument();
  });

  it("says where each duration came from, every time", () => {
    // Handed to somebody who wasn't in the room when it was written. A plan
    // nobody can check is a plan that can only be obeyed.
    render(<CareShift plan={plan()} overlap={null} />);

    expect(screen.getByText(/timed 3 times/)).toBeInTheDocument();
    expect(screen.getByText(/still an estimate/)).toBeInTheDocument();
  });

  it("says how much room is left in the shift", () => {
    render(<CareShift plan={plan()} overlap={null} />);
    expect(screen.getByText(/174 min spare/)).toBeInTheDocument();
  });

  it("says plainly when more was written down than the hours hold", () => {
    render(<CareShift plan={plan({ roomMinutes: -25 })} overlap={null} />);

    expect(screen.getByText(/25 min more than the shift holds/)).toBeInTheDocument();
  });

  it("keeps a paused step on the screen, with who has it and when it's back", () => {
    render(
      <CareShift
        plan={plan({
          paused: [{ stepId: "lunch", title: "Make lunch", until: "2026-10-30", reason: "hand cast", coveredBy: "Andrew" }],
        })}
        overlap={null}
      />
    );

    expect(screen.getByText("Make lunch")).toBeInTheDocument();
    expect(screen.getByText(/Back 2026-10-30.*hand cast.*Andrew has it/)).toBeInTheDocument();
  });

  it("marks out a paused step nobody has picked up", () => {
    render(
      <CareShift
        plan={plan({ paused: [{ stepId: "lunch", title: "Make lunch", until: "2026-10-30", reason: null, coveredBy: null }] })}
        overlap={null}
      />
    );

    expect(screen.getByText(/nobody has picked it up/)).toBeInTheDocument();
  });

  it("says when the shift and the school morning don't collide", () => {
    render(
      <CareShift plan={plan()} overlap={{ minutes: 0, because: "The school morning is finished before the shift starts — they don't run into each other." }} />
    );

    expect(screen.getByText(/don't run into each other/)).toBeInTheDocument();
  });

  it("is honest about a day with nobody down to come", () => {
    render(<CareShift plan={null} overlap={null} />);
    expect(screen.getByText(/Nobody is down to come in today/)).toBeInTheDocument();
  });

  it("never says anything about how anybody is doing", () => {
    // Read by the carer, by the family, and by Sheliah, who is the subject
    // of all of it. That last one sets the tone.
    const { container } = render(
      <CareShift
        plan={plan({ paused: [{ stepId: "lunch", title: "Make lunch", until: "2026-10-30", reason: "hand cast", coveredBy: null }] })}
        overlap={{ minutes: 0, because: "They don't run into each other." }}
      />
    );

    expect(container.textContent).not.toMatch(
      /\b(can't|cannot|unable|struggl|declin|frail|slow|unreliable|lazy|failed|behind|poor|needs help with)\b/i
    );
  });
});
