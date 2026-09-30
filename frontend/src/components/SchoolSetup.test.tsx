import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SchoolSetup from "./SchoolSetup";
import type { SchoolProfile } from "../types";

const VIOLET_MENU = { provider: "myschoolmenus" as const, organizationId: 2230, siteId: 13754, menuId: 117559 };

const PARKER: SchoolProfile = {
  memberId: "Parker",
  schoolName: "Violet Elementary",
  teacher: "Miss Hineline",
  gradeLabel: null,
  specials: [
    { dayOfWeek: 1, subject: "Art", prepNote: null },
    { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
  ],
  menuSource: VIOLET_MENU,
};

/**
 * Typed, so the assertions below read the saved profile as a profile rather
 * than as `any` — an untyped mock let a `.map` over `specials` typecheck
 * against nothing at all.
 */
type SaveFn = (memberId: string, profile: Omit<SchoolProfile, "memberId">) => Promise<void>;
const save = () => vi.fn<SaveFn>().mockResolvedValue(undefined);

describe("SchoolSetup", () => {
  it("fills the form from the sheet already saved", () => {
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={save()} />);
    expect(screen.getByDisplayValue("Violet Elementary")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Miss Hineline")).toBeInTheDocument();
    expect(screen.getByLabelText("Monday special")).toHaveValue("Art");
    expect(screen.getByLabelText("Thursday special")).toHaveValue("Library");
    expect(screen.getByLabelText("Thursday — what to bring")).toHaveValue(
      "Have your student bring in their library book to return."
    );
  });

  it("saves the rotation, keeping the school's own wording", async () => {
    const onSave = save();
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Tuesday special"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByLabelText("Tuesday — what to bring"), {
      target: { value: "Have students wear closed toed shoes or bring in a pair to change into." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the sheet" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [memberId, profile] = onSave.mock.calls[0]!;
    expect(memberId).toBe("Parker");
    expect(profile.specials).toEqual([
      { dayOfWeek: 1, subject: "Art", prepNote: null },
      {
        dayOfWeek: 2,
        subject: "Gym",
        prepNote: "Have students wear closed toed shoes or bring in a pair to change into.",
      },
      { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
    ]);
  });

  /**
   * The one that would go wrong quietly. Saving replaces the whole profile,
   * so a form that rebuilt it from its own fields would switch the lunch
   * menu off the first time anybody corrected a typo — and nothing would
   * say so until somebody noticed lunch had stopped appearing.
   */
  it("carries the lunch menu through a save it does not edit", async () => {
    const onSave = save();
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue("Miss Hineline"), { target: { value: "Mrs Hineline" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the sheet" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![1].menuSource).toEqual(VIOLET_MENU);
    expect(onSave.mock.calls[0]![1].teacher).toBe("Mrs Hineline");
  });

  it("says the menu is already set up, so nobody goes looking for a field for it", () => {
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={save()} />);
    expect(screen.getByText(/Lunch menu already set up for Violet Elementary/)).toBeInTheDocument();
  });

  it("treats a blank day as a day with no special, not as an error", async () => {
    const onSave = save();
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Monday special"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save the sheet" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![1].specials.map((s) => s.dayOfWeek)).toEqual([4]);
  });

  it("stores an empty note as nothing at all, not as an empty line on the wall", async () => {
    const onSave = save();
    render(<SchoolSetup members={["Parker"]} profiles={[PARKER]} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Monday — what to bring"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save the sheet" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![1].specials[0]?.prepNote).toBeNull();
  });

  it("will not save a school with no name", () => {
    const onSave = save();
    render(<SchoolSetup members={["Rowan"]} profiles={[]} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Add this school" })).toBeDisabled();
  });

  it("starts a second child from a blank sheet rather than the first child's", () => {
    render(<SchoolSetup members={["Parker", "Rowan"]} profiles={[PARKER]} onSave={save()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rowan" }));
    expect(screen.getByLabelText("Monday special")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add this school" })).toBeInTheDocument();
  });

  it("switches back to a child who already has one without losing it", () => {
    render(<SchoolSetup members={["Parker", "Rowan"]} profiles={[PARKER]} onSave={save()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rowan" }));
    fireEvent.click(screen.getByRole("button", { name: "Parker" }));
    expect(screen.getByLabelText("Thursday special")).toHaveValue("Library");
  });

  it("says so when there is nobody to set a school up for yet", () => {
    render(<SchoolSetup members={[]} profiles={[]} onSave={save()} />);
    expect(screen.getByText(/Add a chore for someone first/)).toBeInTheDocument();
  });
});
