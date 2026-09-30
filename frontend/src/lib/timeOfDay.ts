import type { DueWindow } from "../types";

/**
 * Which part of the day it is, right now, on this device.
 *
 * The screen reorganises itself around this. At seven in the morning the
 * morning chores belong at the top; at half eight in the evening they are
 * history and bedtime is the only thing that matters. A kitchen display
 * that shows the same thing at breakfast and at bathtime is a poster, not
 * an assistant — and someone walking past has about two seconds to find
 * what they need.
 *
 * Windows are the same ones the family assigns chores to, so this is a
 * reading of the clock against their own choices, not a schedule the app
 * invented.
 */

/** When each window closes, as minutes past midnight. */
export const WINDOW_CLOSES_AT_MINUTE: Record<DueWindow, number | null> = {
  morning: 9 * 60,
  after_school: 17 * 60,
  after_dinner: 19 * 60 + 30,
  bedtime: 20 * 60 + 30,
  anytime: null,
};

/** In the order a day actually runs. "Anytime" sits outside the sequence. */
export const WINDOWS_IN_ORDER: DueWindow[] = ["morning", "after_school", "after_dinner", "bedtime"];

export function minutesIntoDay(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * The window we're in now: the first one that hasn't closed yet. After the
 * last one closes the day is done, and nothing is "current".
 */
export function currentWindow(now: Date = new Date()): DueWindow | null {
  const minutes = minutesIntoDay(now);
  return WINDOWS_IN_ORDER.find((window) => minutes < (WINDOW_CLOSES_AT_MINUTE[window] ?? 0)) ?? null;
}

export function isWindowPast(window: DueWindow, now: Date = new Date()): boolean {
  const closesAt = WINDOW_CLOSES_AT_MINUTE[window];
  if (closesAt === null) return false;
  return minutesIntoDay(now) >= closesAt;
}

/**
 * How the day should be stacked right now: the window in play first, then
 * what's still ahead, then anytime, with what's already gone at the bottom.
 */
export function windowOrderFor(now: Date = new Date()): DueWindow[] {
  const past = WINDOWS_IN_ORDER.filter((window) => isWindowPast(window, now));
  const ahead = WINDOWS_IN_ORDER.filter((window) => !isWindowPast(window, now));
  return [...ahead, "anytime", ...past];
}

/** How to greet whoever just walked up to the screen. */
export function greeting(now: Date = new Date()): string {
  const minutes = minutesIntoDay(now);
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 17 * 60) return "Good afternoon";
  return "Good evening";
}
