import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SchoolDay from "./SchoolDay";
import type { SchoolMenu, SchoolProfile } from "../types";

const PARKER: SchoolProfile = {
  memberId: "Parker",
  schoolName: "Violet Elementary",
  teacher: "Miss Hineline",
  gradeLabel: null,
  specials: [
    { dayOfWeek: 1, subject: "Art", prepNote: null },
    { dayOfWeek: 3, subject: "Technology", prepNote: "Make sure computers are fulled charged." },
    { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
  ],
  menuSource: { provider: "myschoolmenus", organizationId: 2230, siteId: 13754, menuId: 117559 },
};

const MENU: SchoolMenu = {
  memberId: "Parker",
  schoolName: "Violet Elementary",
  menuId: 117559,
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
const at = (isoDate: string, hour: number): Date =>
  new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)), hour, 0);

describe("SchoolDay", () => {
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
      screen.getByText("From Miss Hineline's specials schedule for Violet Elementary.")
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
});
