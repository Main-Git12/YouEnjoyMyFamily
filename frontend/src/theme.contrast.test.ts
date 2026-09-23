import { describe, it, expect } from "vitest";
import tailwindConfig from "../tailwind.config.js";

/**
 * This runs on a kitchen screen in daylight, read across the room by
 * children and by adults holding something in both hands. Colour pairs the
 * UI actually puts together have to stay legible, so the palette is checked
 * here rather than left to whoever next reaches for a lighter olive.
 *
 * Thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large text (18.66px
 * bold or 24px plain) and for the non-text edges of a control.
 */

const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, unknown>;

function hexOf(token: string): string {
  if (token === "white") return "#ffffff";
  const [family, shade] = token.split("-");
  const group = colors[family ?? ""];
  if (typeof group === "string") return group;
  const value = (group as Record<string, string> | undefined)?.[shade ?? ""];
  if (!value) throw new Error(`No such colour token: ${token}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(hexOf(foreground)), relativeLuminance(hexOf(background))].sort(
    (a, b) => b - a
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

// Every pair the components actually render, with where it shows up.
const BODY_TEXT_PAIRS: [string, string, string][] = [
  ["bark", "white", "body text on a plain card"],
  ["olive-700", "white", "card headings"],
  ["olive-600", "white", "secondary text on a card"],
  ["olive-700", "olive-50", "task and schedule rows"],
  ["olive-600", "olive-50", "the meta line under a chore"],
  ["clay-700", "olive-50", "the removal action in the cart"],
  ["clay-700", "clay-100", "a slipped chore's row"],
  ["white", "olive-600", "the accent card, and every primary button"],
  ["white", "clay-700", "checkout"],
  ["olive-900", "gem-amber", "a chore's gem-value pill"],
  ["olive-800", "olive-100", "a planned meal"],
  ["olive-600", "olive-50", "an empty meal slot"],
];

// Controls and bars: 3:1 is the bar for something that isn't read as text.
const NON_TEXT_PAIRS: [string, string, string][] = [
  ["olive-600", "olive-200", "the prize progress bar against its track"],
  ["olive-500", "white", "an input's border"],
];

describe("palette contrast", () => {
  it.each(BODY_TEXT_PAIRS)("%s on %s (%s) is readable as body text", (fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s on %s (%s) is distinguishable", (fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("agrees with a known-good and a known-bad pair, so the maths is doing something", () => {
    expect(contrastRatio("white", "olive-900")).toBeGreaterThan(14);
    // The olive that used to sit under white button labels at 4.21:1.
    expect(contrastRatio("white", "olive-500")).toBeLessThan(4.5);
  });
});
