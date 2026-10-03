import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CareSetup from "./CareSetup";
import type { HouseholdMember, Routine } from "../types";

const kimmie: HouseholdMember = {
  memberId: "kimmie",
  displayName: "Kimmie",
  role: "carer",
  note: null,
  daysOfWeek: [2, 3, 4],
  startsAt: "09:00",
  endsAt: "13:00",
};
const paige: HouseholdMember = { memberId: "paige", displayName: "Paige", role: "adult", note: null };
const isla: HouseholdMember = { memberId: "isla", displayName: "Isla", role: "child", note: null };

const routine = (steps: Routine["steps"]): Routine => ({
  routineId: "r-care",
  name: "The care shift",
  kind: "care",
  anchorTime: "09:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  active: true,
  steps,
});

const breakfast = { stepId: "s1", title: "Breakfast", targetMinutes: 20, memberId: null };

describe("CareSetup", () => {
  it("shows the rota, with the hours as agreed", () => {
    render(<CareSetup routine={null} members={[kimmie]} onSave={vi.fn()} />);
    expect(screen.getByText(/Tue, Wed, Thu · 09:00–13:00/)).toBeInTheDocument();
  });

  it("says plainly when nobody is on the rota yet", () => {
    render(<CareSetup routine={null} members={[paige]} onSave={vi.fn()} />);
    expect(screen.getByText(/Nobody is on the rota yet/)).toBeInTheDocument();
  });

  it("builds a shift by tapping, not by typing eleven lines into a wall screen", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CareSetup routine={null} members={[kimmie]} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Set up the shift" }));
    fireEvent.click(screen.getByRole("button", { name: /Getting the day started/ }));
    fireEvent.click(screen.getByRole("button", { name: /\+ Coffee/ }));
    fireEvent.click(screen.getByRole("button", { name: /\+ Shower/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save the shift" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.steps.map((step: { title: string }) => step.title)).toEqual(["Coffee", "Shower"]);
    // Seeds, not measurements. The app replaces them once a step has been
    // timed twice, and says which is which on screen until then.
    expect(saved.steps[0].targetMinutes).toBeGreaterThan(0);
  });

  it("can't add the same step twice", () => {
    render(<CareSetup routine={routine([breakfast])} members={[kimmie]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change the shift" }));
    fireEvent.click(screen.getByRole("button", { name: /Getting the day started/ }));
    expect(screen.getByRole("button", { name: /Breakfast ✓/ })).toBeDisabled();
  });

  it("pauses a step rather than deleting it, keeping the job and its learned time", async () => {
    // Four weeks in a cast is a month, not a change of plan. Deleting the
    // step throws away the job and everything it has learned about how
    // long it takes, and it all has to be rediscovered afterwards.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CareSetup routine={routine([breakfast])} members={[kimmie, paige]} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Change the shift" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause this for a while" }));
    fireEvent.change(screen.getByLabelText(/Why "Breakfast" is paused/), {
      target: { value: "Hand in a cast" },
    });
    fireEvent.change(screen.getByLabelText(/When "Breakfast" comes back/), {
      target: { value: "2026-11-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the shift" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [step] = onSave.mock.calls[0][0].steps;
    expect(step.title).toBe("Breakfast");
    expect(step.pausedUntil).toBe("2026-11-02");
    expect(step.pausedReason).toBe("Hand in a cast");
  });

  it("offers cover from the adults, never from a child", () => {
    render(
      <CareSetup
        routine={routine([{ ...breakfast, pausedUntil: "2026-11-02", pausedReason: "Hand in a cast" }])}
        members={[kimmie, paige, isla]}
        onSave={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change the shift" }));
    const names = within(screen.getByLabelText(/Who is covering "Breakfast"/))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toContain("Paige");
    expect(names).toContain("Kimmie");
    expect(names).not.toContain("Isla");
    // Nobody is the honest default, and it is the state worth seeing.
    expect(names[0]).toBe("Nobody yet");
  });

  it("puts a paused step back on", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CareSetup
        routine={routine([{ ...breakfast, pausedUntil: "2026-11-02", pausedReason: "Hand in a cast", coveredBy: "Paige" }])}
        members={[kimmie, paige]}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change the shift" }));
    fireEvent.click(screen.getByRole("button", { name: "Back on" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the shift" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [step] = onSave.mock.calls[0][0].steps;
    expect(step.pausedUntil).toBeNull();
    expect(step.coveredBy).toBeNull();
  });

  it("refuses to save a shift with nothing in it", async () => {
    const onSave = vi.fn();
    render(<CareSetup routine={null} members={[kimmie]} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up the shift" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the shift" }));
    expect(await screen.findByText(/needs at least one step/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("never says anything about the person the care is for", () => {
    render(<CareSetup routine={routine([breakfast])} members={[kimmie]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change the shift" }));
    for (const group of ["Getting the day started", "Out of the house", "Keeping on top of things", "Later in the shift"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(group) }));
    }
    const banned = /\b(frail|decline|confus|unable|struggl|patient|poor|difficult|incontinen)\b/i;
    expect(document.body.textContent ?? "").not.toMatch(banned);
  });
});
