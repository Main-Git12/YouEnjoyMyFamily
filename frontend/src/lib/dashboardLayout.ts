import { currentWindow } from "./timeOfDay";

/**
 * Which panels are on screen, and how loudly.
 *
 * The dashboard had grown to nine cards in a flat two-column grid, every
 * one the same weight — measured at seven screens tall on an Echo Show 8.
 * On a wall display that someone glances at for two seconds while walking
 * past, that is not a dashboard, it is a filing cabinet. The loudest
 * complaint parents make about every rival product is the same thing:
 * feature bloat, "we use ten percent of it".
 *
 * Nothing is removed. Everything stays one tap away. What changes is that
 * at any given moment the screen commits to a small number of things,
 * chosen by two questions:
 *
 *   1. What time is it? Bedtime steps matter at half seven in the evening
 *      and are noise at eight in the morning.
 *   2. Is there anything in it? A panel with nothing in it has earned its
 *      place at the bottom, not a cell in the middle of the screen.
 *
 * Both are facts about the clock and about rows the family entered. The
 * screen is not guessing what they want; it is declining to show them
 * nine equal boxes when two of them are empty.
 */

export type PanelId =
  | "chores"
  | "schedule"
  | "insights"
  | "prize"
  | "kitchen"
  | "favorites"
  | "morning"
  | "bedtime"
  | "focus";

/** Every panel there is, in the order they fall back to when nothing else decides. */
export const ALL_PANELS: PanelId[] = [
  "chores",
  "schedule",
  "insights",
  "prize",
  "kitchen",
  "morning",
  "bedtime",
  "focus",
  "favorites",
];

export interface PanelPlan {
  /** The one panel that gets the width and the big heading. */
  lead: PanelId;
  /** Alongside it, in this order. Visible without a tap. */
  rail: PanelId[];
  /** Still reachable, behind one tap. Never dropped. */
  drawer: PanelId[];
}

/** How many panels sit alongside the lead. Three fits an Echo Show without scrolling. */
const RAIL_SIZE = 3;

export interface PanelSignals {
  now?: Date;
  /** Chores still to do today. */
  choresLeft: number;
  /** Lines on the shopping list that haven't been ordered. */
  outstandingCartItems: number;
  insightCount: number;
  scheduleEntriesToday: number;
  /** Whether a routine of each kind exists at all. */
  hasMorningRoutine: boolean;
  hasBedtimeRoutine: boolean;
  /** Blocks of focused work recorded today. */
  focusBlocksToday: number;
  statedPreferenceCount: number;
}

/** Does this panel have anything in it right now? */
function hasContent(panel: PanelId, signals: PanelSignals): boolean {
  switch (panel) {
    case "chores":
      return true;
    case "schedule":
      return signals.scheduleEntriesToday > 0;
    case "insights":
      return signals.insightCount > 0;
    case "kitchen":
      return signals.outstandingCartItems > 0;
    case "favorites":
      return signals.statedPreferenceCount > 0;
    case "morning":
      return signals.hasMorningRoutine;
    case "bedtime":
      return signals.hasBedtimeRoutine;
    case "focus":
      return signals.focusBlocksToday > 0;
    // The prize board is the one panel that is *more* useful when empty,
    // because an empty one is an invitation to set a goal.
    case "prize":
      return true;
  }
}

/**
 * What each part of the day wants nearest to hand.
 *
 * These are the orderings a person would give if asked; there is nothing
 * derived about them, and they are written out rather than computed so
 * they can be argued with.
 */
const PREFERENCE_BY_WINDOW: Record<string, PanelId[]> = {
  // Before nine: getting out of the door, and what today holds.
  morning: ["morning", "schedule", "insights", "kitchen", "prize", "focus", "favorites", "bedtime"],
  // The working day, for whoever is at a desk; then the afternoon's plan.
  after_school: ["schedule", "focus", "kitchen", "insights", "prize", "favorites", "morning", "bedtime"],
  // Dinner, the shop, and what's left of the chores.
  after_dinner: ["kitchen", "schedule", "insights", "prize", "bedtime", "favorites", "focus", "morning"],
  // Wind-down.
  bedtime: ["bedtime", "insights", "prize", "kitchen", "schedule", "favorites", "morning", "focus"],
  // After the last window closes: tomorrow is the only thing worth showing.
  done: ["bedtime", "morning", "schedule", "kitchen", "insights", "prize", "favorites", "focus"],
};

/**
 * The panels, arranged for right now.
 *
 * Chores always lead. It is what the screen is for, and a display whose
 * main subject moves around is one nobody learns to read.
 */
export function planPanels(signals: PanelSignals): PanelPlan {
  const window = currentWindow(signals.now ?? new Date());
  const preference = PREFERENCE_BY_WINDOW[window ?? "done"] ?? ALL_PANELS;

  const candidates = ALL_PANELS.filter((panel) => panel !== "chores");
  const ordered = [...candidates].sort((a, b) => {
    // Something beats nothing, whatever the hour: an empty panel in the
    // rail is a cell of the screen spent saying "nothing here".
    const filled = Number(hasContent(b, signals)) - Number(hasContent(a, signals));
    if (filled !== 0) return filled;
    const rank = (panel: PanelId) => {
      const at = preference.indexOf(panel);
      return at === -1 ? preference.length : at;
    };
    return rank(a) - rank(b);
  });

  return {
    lead: "chores",
    rail: ordered.slice(0, RAIL_SIZE),
    drawer: ordered.slice(RAIL_SIZE),
  };
}

/** A short, honest label for the drawer's button. */
export function drawerLabel(plan: PanelPlan): string {
  return plan.drawer.length === 1 ? "1 more" : `${plan.drawer.length} more`;
}
