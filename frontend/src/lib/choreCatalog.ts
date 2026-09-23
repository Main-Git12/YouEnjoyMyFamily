import type { DueWindow, Recurrence } from "../types";

/**
 * The chores this family already runs on, with the gem values the children
 * are used to. This is a starting library to tap from when setting chores
 * up — not a fixed menu. Anything here can be edited or re-priced, and a
 * chore typed in from scratch works exactly the same way.
 *
 * `window` is the part of the day the chore belongs to. It's what lets the
 * app know a chore has been missed (see gemThreats.ts) without ever
 * watching a child: it compares the clock to a window someone chose.
 */
export interface CatalogChore {
  title: string;
  gemValue: number;
  window: DueWindow;
  /** How often it comes back. School-linked chores are weekdays only. */
  recurrence: Recurrence;
}

export const CHORE_CATALOG: CatalogChore[] = [
  { title: "Eat my Breakfast", gemValue: 5, window: "morning", recurrence: "daily" },
  { title: "Get Dressed", gemValue: 5, window: "morning", recurrence: "daily" },
  { title: "Brush Teeth", gemValue: 5, window: "morning", recurrence: "daily" },
  { title: "Brush Hair", gemValue: 5, window: "morning", recurrence: "daily" },
  { title: "Fill my water bottle", gemValue: 5, window: "morning", recurrence: "weekdays" },
  { title: "Put on my shoes", gemValue: 5, window: "morning", recurrence: "daily" },
  { title: "Pack my bookbag", gemValue: 5, window: "morning", recurrence: "weekdays" },
  { title: "Put my school things away and take out trash", gemValue: 5, window: "after_school", recurrence: "weekdays" },
  { title: "Charge Chromebook", gemValue: 5, window: "after_school", recurrence: "weekdays" },
  { title: "Homework", gemValue: 10, window: "after_school", recurrence: "weekdays" },
  { title: "Read 2 Chapters or Books", gemValue: 10, window: "after_school", recurrence: "daily" },
  { title: "Let dogs out", gemValue: 5, window: "anytime", recurrence: "daily" },
  { title: "Wipe myself after potty", gemValue: 10, window: "anytime", recurrence: "daily" },
  { title: "Pick up toys", gemValue: 10, window: "after_dinner", recurrence: "daily" },
  { title: "Eat my Dinner", gemValue: 10, window: "after_dinner", recurrence: "daily" },
  { title: "Clean up plate", gemValue: 5, window: "after_dinner", recurrence: "daily" },
  { title: "Wipe Table", gemValue: 10, window: "after_dinner", recurrence: "daily" },
  { title: "Help Put Away Clean Dishes", gemValue: 10, window: "after_dinner", recurrence: "daily" },
  { title: "Help Put Away My Laundry", gemValue: 10, window: "after_dinner", recurrence: "daily" },
  { title: "Take a bath", gemValue: 5, window: "bedtime", recurrence: "daily" },
  { title: "Dirty clothes in my hamper", gemValue: 5, window: "bedtime", recurrence: "daily" },
  { title: "Floss and Brush Teeth", gemValue: 10, window: "bedtime", recurrence: "daily" },
  { title: "Put on pajamas", gemValue: 5, window: "bedtime", recurrence: "daily" },
  { title: "Sleep in my own bed", gemValue: 20, window: "bedtime", recurrence: "daily" },
];

export const DUE_WINDOW_LABELS: Record<DueWindow, string> = {
  morning: "Morning",
  after_school: "After school",
  after_dinner: "After dinner",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

/** Catalog order, grouped by the part of the day each chore belongs to. */
export const DUE_WINDOW_ORDER: DueWindow[] = ["morning", "after_school", "after_dinner", "bedtime", "anytime"];

export function choresByWindow(): { window: DueWindow; chores: CatalogChore[] }[] {
  return DUE_WINDOW_ORDER.map((window) => ({
    window,
    chores: CHORE_CATALOG.filter((chore) => chore.window === window),
  })).filter((group) => group.chores.length > 0);
}
