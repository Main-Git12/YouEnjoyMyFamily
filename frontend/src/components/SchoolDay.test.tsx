import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SchoolDay from "./SchoolDay";
import type { SchoolMenu, SchoolPrep, SchoolProfile } from "../types";

const PARKER: SchoolProfile = {
  memberId: "Parker",
  schoolName: "Maple Street Elementary",
  teacher: "Mr Alder",
  gradeLabel: null,
  specials: [
    { dayOfWeek: 1, subject: "Art", prepNote: null },
    { dayOfWeek: 3, subject: "Technology", prepNote: "Make sure computers are fulled charged." },
    { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
  ],
  menuSource: { provider: "myschoolmenus", organizationId: 40000, siteId: 40001, menuId: 40002 },
};

const MENU: SchoolMenu = {
  memberId: "Parker",
  schoolName: "Maple Street Elementary",
  menuId: 40002,
  days: [
    {
      date: "2026-10-01",
      groups: [
        { heading: "Lunch Entree", items: ["Breaded Chicken Patty w/ Bun", "Grilled Cheese Sandwich"] },
        { heading: "Fruit", items: ["Fresh Apple", "Pineapple Tidbits"] },
        { heading: "Milk", items: ["1% White Milk - Borden"] },
      ],
    },
  ],
  stale: false,
  fetchedAt: "2026-10-01T06:00:00.000Z",
  missingMonths: [],
};

// 2026-09-30 is a Wednesday, 2026-10-01 a Thursday.
const at = (isoDate: string, hour: number, minute = 0): Date =>
  new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)), hour, minute);

describe("SchoolDay", () => {
  const packed: SchoolPrep = {
    memberId: "Parker",
    date: "2026-10-01",
    subject: "Library",
    note: "Have your student bring in their library book to return.",
    packedAt: "2026-09-30T20:12:00.000Z",
  };

  it("shows tomorrow's subject and what it needs, on a school night", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-09-30", 20)} />);
    expect(screen.getByText(/Tomorrow for Parker/)).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(
      screen.getByText("Have your student bring in their library book to return.")
    ).toBeInTheDocument();
  });

  it("shows today's in the morning, while there is still time to do it", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-09-30", 7)} />);
    expect(screen.getByText(/Today for Parker/)).toBeInTheDocument();
    expect(screen.getByText("Technology")).toBeInTheDocument();
  });

  it("says where it came from, every time", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-09-30", 20)} />);
    expect(
      screen.getByText("From Mr Alder's specials schedule for Maple Street Elementary.")
    ).toBeInTheDocument();
  });

  it("says plainly when a day needs nothing brought", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-04", 19)} />);
    expect(screen.getByText("Art")).toBeInTheDocument();
    expect(screen.getByText("Nothing to bring.")).toBeInTheDocument();
  });

  it("has an honest empty state at the weekend rather than a stale weekday", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-03", 10)} />);
    expect(screen.getByText(/No school day coming up/)).toBeInTheDocument();
  });

  it("leads the lunch with the entrées and keeps the rest of the tray quieter", () => {
    render(<SchoolDay profiles={[PARKER]} menus={{ Parker: MENU }} now={at("2026-09-30", 20)} />);
    expect(screen.getByText("Breaded Chicken Patty w/ Bun · Grilled Cheese Sandwich")).toBeInTheDocument();
    expect(screen.getByText("Fruit: Fresh Apple, Pineapple Tidbits")).toBeInTheDocument();
    expect(screen.getByText("Milk: 1% White Milk - Borden")).toBeInTheDocument();
  });

  /**
   * A menu an hour old is fine. A menu the app could not refresh is also
   * usually fine — but it is not the same thing, and a screen that shows
   * them identically will one day show last month's Tuesday with total
   * confidence.
   */
  it("says when the lunch menu is a saved copy rather than a fresh one", () => {
    const stale = { ...MENU, stale: true, fetchedAt: "2026-09-29T20:00:00.000Z" };
    render(<SchoolDay profiles={[PARKER]} menus={{ Parker: stale }} now={new Date("2026-10-01T00:00:00.000Z")} />);
    expect(screen.getByText(/from a copy saved \d+ hours ago/)).toBeInTheDocument();
  });

  it("says so when the school published no lunch for that day", () => {
    const empty = { ...MENU, days: [] };
    render(<SchoolDay profiles={[PARKER]} menus={{ Parker: empty }} now={at("2026-09-30", 20)} />);
    expect(screen.getByText("No lunch published for this day.")).toBeInTheDocument();
  });

  it("shows the specials for a child whose school publishes no menu at all", () => {
    const noMenu = { ...PARKER, memberId: "Rowan", menuSource: null };
    render(<SchoolDay profiles={[noMenu]} menus={{}} now={at("2026-09-30", 20)} />);
    expect(screen.getByText(/Tomorrow for Rowan/)).toBeInTheDocument();
    expect(screen.queryByText(/lunch menu/i)).not.toBeInTheDocument();
  });

  /** The rule the whole app is held to: the subject is the day, never the child. */
  it("never characterises the child", () => {
    const { container } = render(
      <SchoolDay profiles={[PARKER]} menus={{ Parker: MENU }} now={at("2026-09-30", 20)} />
    );
    const text = container.textContent ?? "";
    for (const banned of [/\bkeeps? forgetting\b/i, /\balways\b/i, /\bnever remembers\b/i, /\bstruggles?\b/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  describe("ticking it off", () => {
    it("offers a Packed button while there is something outstanding", () => {
      render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-09-30", 20)} />);
      expect(screen.getByRole("button", { name: "Packed" })).toBeInTheDocument();
    });

    it("reports the tick, with the time it was made, and offers to take it back", () => {
      render(<SchoolDay profiles={[PARKER]} menus={{}} prep={[packed]} now={at("2026-09-30", 20)} />);
      expect(screen.getByText(/Ticked off at/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Packed" })).not.toBeInTheDocument();
    });

    it("offers nothing to tick on a day that asks for nothing", () => {
      render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-04", 19)} />);
      expect(screen.getByText("Nothing to bring.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Packed" })).not.toBeInTheDocument();
    });

    it("hands the caller the note it was ticked for", async () => {
      const onPacked = vi.fn().mockResolvedValue(undefined);
      render(<SchoolDay profiles={[PARKER]} menus={{}} onPacked={onPacked} now={at("2026-09-30", 20)} />);
      fireEvent.click(screen.getByRole("button", { name: "Packed" }));
      await waitFor(() => expect(onPacked).toHaveBeenCalledTimes(1));
      expect(onPacked.mock.calls[0]?.[0]).toMatchObject({ memberId: "Parker", date: "2026-10-01", subject: "Library" });
    });

    it("hands Undo back the same note", async () => {
      const onUnpacked = vi.fn().mockResolvedValue(undefined);
      render(
        <SchoolDay profiles={[PARKER]} menus={{}} prep={[packed]} onUnpacked={onUnpacked} now={at("2026-09-30", 20)} />
      );
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(onUnpacked).toHaveBeenCalledTimes(1));
      expect(onUnpacked.mock.calls[0]?.[0]).toMatchObject({ memberId: "Parker", date: "2026-10-01" });
    });
  });

  /**
   * The morning is the last moment an unticked library book can still be
   * dealt with. What the screen says about it has to stay a statement about
   * the records, because the app cannot see inside a schoolbag and the child
   * it would be about can read the wall.
   */
  describe("the morning, while there is still time", () => {
    it("says what is still not ticked off", () => {
      render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-01", 6, 50)} />);
      expect(screen.getByText("Still not ticked off.")).toBeInTheDocument();
    });

    it("says nothing of the sort once it has been ticked", () => {
      const done: SchoolPrep = { ...packed, packedAt: "2026-09-30T20:12:00.000Z" };
      render(<SchoolDay profiles={[PARKER]} menus={{}} prep={[done]} now={at("2026-10-01", 6, 50)} />);
      expect(screen.queryByText("Still not ticked off.")).not.toBeInTheDocument();
    });

    it("says nothing of the sort once the morning has gone", () => {
      render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-01", 10, 0)} />);
      expect(screen.queryByText("Still not ticked off.")).not.toBeInTheDocument();
    });

    it("never says it was forgotten, or anything else about the child", () => {
      const { container } = render(<SchoolDay profiles={[PARKER]} menus={{}} now={at("2026-10-01", 6, 50)} />);
      const text = container.textContent ?? "";
      for (const banned of [/forgot/i, /\bfailed\b/i, /\bagain\b/i, /\balways\b/i, /\bnever remembers\b/i]) {
        expect(text).not.toMatch(banned);
      }
    });
  });
});
