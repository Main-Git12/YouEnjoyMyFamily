import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TheHousehold from "./TheHousehold";
import type { Household } from "../types";

const noop = async () => {};

const base = (overrides: Partial<Household> = {}): Household => ({
  members: [
    { memberId: "andrew", displayName: "Andrew", role: "adult", note: null },
    { memberId: "paige", displayName: "Paige", role: "adult", note: null },
    { memberId: "sheliah", displayName: "Sheliah", role: "adult", note: "Picks Parker up on Tuesdays" },
    { memberId: "parker", displayName: "Parker", role: "child", note: null },
  ],
  jobs: [],
  ...overrides,
});

const props = {
  onSaveMember: noop,
  onRemoveMember: noop,
  onSaveJob: noop,
  onRemoveJob: noop,
};

describe("TheHousehold", () => {
  it("shows an adult as an adult, with whatever the family wanted noted", () => {
    render(<TheHousehold household={base()} {...props} />);

    expect(screen.getByText("Sheliah")).toBeInTheDocument();
    expect(screen.getByText(/Picks Parker up on Tuesdays/)).toBeInTheDocument();
  });

  it("says plainly what choosing adult or child actually changes", () => {
    // Otherwise it reads as a label about a person rather than a switch for
    // one feature, and someone will wonder why the grandmother has no gems.
    render(<TheHousehold household={base()} {...props} />);

    expect(screen.getByText(/Gems, prizes and the castle are for the children/i)).toBeInTheDocument();
  });

  it("adds somebody with the role that was picked", async () => {
    const onSaveMember = vi.fn(noop);
    render(<TheHousehold household={base({ members: [] })} {...props} onSaveMember={onSaveMember} />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Sheliah" } });
    fireEvent.change(screen.getByLabelText(/In the house as/), { target: { value: "adult" } });
    fireEvent.change(screen.getByLabelText(/Anything worth noting/), {
      target: { value: "Picks Parker up on Tuesdays" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to the house" }));

    await waitFor(() =>
      expect(onSaveMember).toHaveBeenCalledWith("sheliah", {
        displayName: "Sheliah",
        role: "adult",
        note: "Picks Parker up on Tuesdays",
      })
    );
  });

  it("marks out a job nobody has taken", () => {
    const household = base({
      jobs: [{ jobId: "j1", title: "Booking the dentist", kind: "arranging", ownerId: null, note: null }],
    });
    render(<TheHousehold household={household} {...props} />);

    expect(screen.getByText(/One job on the list is nobody's: Booking the dentist/)).toBeInTheDocument();
    expect(screen.getByText(/Whose is it\?/)).toBeInTheDocument();
  });

  it("hands a job back to nobody explicitly, rather than leaving the field out", async () => {
    // An omitted owner means "leave it alone" to the API. Handing a job back
    // is a decision and has to be sent as one.
    const onSaveJob = vi.fn(noop);
    const household = base({
      jobs: [{ jobId: "j1", title: "Booking the dentist", kind: "arranging", ownerId: "Paige", note: null }],
    });
    render(<TheHousehold household={household} {...props} onSaveJob={onSaveJob} />);

    fireEvent.change(screen.getByLabelText('Who has "Booking the dentist"'), { target: { value: "" } });

    await waitFor(() =>
      expect(onSaveJob).toHaveBeenCalledWith("j1", {
        title: "Booking the dentist",
        kind: "arranging",
        ownerId: null,
        note: null,
      })
    );
  });

  it("counts a lopsided list and asks rather than rules", () => {
    const jobs = [
      ...Array.from({ length: 5 }, (_, i) => ({
        jobId: `a${i}`,
        title: `Arranging ${i}`,
        kind: "arranging" as const,
        ownerId: "Paige",
        note: null,
      })),
      { jobId: "a9", title: "Arranging 9", kind: "arranging" as const, ownerId: "Andrew", note: null },
      { jobId: "a8", title: "Arranging 8", kind: "arranging" as const, ownerId: "Sheliah", note: null },
    ];
    render(<TheHousehold household={base({ jobs })} {...props} />);

    expect(screen.getByText("5 of the 7 noticing-and-booking jobs are down to Paige.")).toBeInTheDocument();
    expect(screen.getByText(/Counted from the 7 jobs/)).toBeInTheDocument();
    expect(screen.getByText("Is that how you'd want it?")).toBeInTheDocument();
  });

  it("never tells the family what their split means", () => {
    const jobs = Array.from({ length: 7 }, (_, i) => ({
      jobId: `a${i}`,
      title: `Arranging ${i}`,
      kind: "arranging" as const,
      ownerId: i === 6 ? "Andrew" : "Paige",
      note: null,
    }));
    const { container } = render(<TheHousehold household={base({ jobs })} {...props} />);

    expect(container.textContent).not.toMatch(/unfair|too much|should be|needs to|isn't doing|lazy/i);
  });

  it("offers the jobs most families never write down", async () => {
    const onSaveJob = vi.fn(noop);
    render(<TheHousehold household={base()} {...props} onSaveJob={onSaveJob} />);

    fireEvent.click(screen.getByRole("button", { name: /Noticing and remembering/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Noticing when we're running out of something/ }));

    await waitFor(() =>
      expect(onSaveJob).toHaveBeenCalledWith("noticing-when-we-re-running-out-of-something", {
        title: "Noticing when we're running out of something",
        kind: "arranging",
        ownerId: null,
        note: null,
      })
    );
  });

  it("won't offer a job that's already on the list twice", () => {
    const household = base({
      jobs: [
        {
          jobId: "x",
          title: "Noticing when we're running out of something",
          kind: "arranging",
          ownerId: null,
          note: null,
        },
      ],
    });
    render(<TheHousehold household={household} {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /Noticing and remembering/ }));
    const chip = screen.getByRole("button", { name: /Noticing when we're running out of something ✓/ });
    expect(chip).toBeDisabled();
  });

  it("offers caring jobs in both directions, not only one", () => {
    // In a house with three generations the help runs both ways, and it is
    // rarely the person everybody assumes.
    render(<TheHousehold household={base()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Looking after each other/ }));

    const group = screen.getByRole("button", { name: /Looking after each other/ }).parentElement;
    const text = group?.textContent ?? "";
    expect(text).toMatch(/Driving to appointments/);
    expect(text).toMatch(/Being there after school/);
  });

  it("shows each person's count split into the two kinds", () => {
    const jobs = [
      { jobId: "j1", title: "Cooking", kind: "doing" as const, ownerId: "Paige", note: null },
      { jobId: "j2", title: "Booking", kind: "arranging" as const, ownerId: "Paige", note: null },
    ];
    render(<TheHousehold household={base({ jobs })} {...props} />);

    expect(screen.getByText(/Paige · 2 \(1 noticing, 1 hands-on\)/)).toBeInTheDocument();
  });

  it("lets a job be handed to anyone in the house, including the children", () => {
    const household = base({
      jobs: [{ jobId: "j1", title: "Bins", kind: "doing", ownerId: null, note: null }],
    });
    render(<TheHousehold household={household} {...props} />);

    const picker = screen.getByLabelText('Who has "Bins"');
    const options = within(picker).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Nobody yet", "Andrew", "Paige", "Sheliah", "Parker"]);
  });
});
