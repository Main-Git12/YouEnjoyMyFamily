import type { FocusBlock } from "../types";

/**
 * Working out what actually works, from blocks that actually ran.
 *
 * The brief was "60 minutes, then the timesheet, then another 60", and
 * that instinct is better for this job than the Pomodoro it resembles.
 * Classic Pomodoro is 25/5, tuned for getting started on work you're
 * avoiding. Sustained legal work is the other problem — 25 minutes barely
 * clears the cost of picking a file back up. The lengths offered here are
 * the ones with something behind them:
 *
 *   25  the classic, for a morning where starting at all is the problem
 *   52  DeskTime's figure from its most productive tenth, 52 on / 17 off
 *   60  the brief's own number, and a clean half of a billable hour
 *   90  one ultradian cycle — the long end of what people sustain
 *
 * And the break is not a break. It is where the time entry gets written
 * while it is still obvious what the last hour was, which is the part
 * that actually saves the hour at the end of the day.
 *
 * What this module will not do: tell her something about herself. "Blocks
 * after three in the afternoon are the ones that most often get cut
 * short" is a fact about blocks and a thing she can act on. "You lose
 * focus in the afternoons" is a label, and a label is no use to anyone.
 * Same rule as lib/insights.ts, and it holds even though she is the only
 * person this feature has.
 */

export const BLOCK_LENGTHS = [25, 52, 60, 90] as const;
export type BlockLength = (typeof BLOCK_LENGTHS)[number];

/** Why a length is being suggested — always shown, never just asserted. */
export interface LengthSuggestion {
  minutes: number;
  because: string;
}

/** Fewer than this and there's nothing to see yet; say so rather than guess. */
const MIN_BLOCKS_TO_SUGGEST = 5;

/** A block that ran at least this share of its plan counts as having held. */
const HELD_FRACTION = 0.9;

function heldTogether(block: FocusBlock): boolean {
  return block.outcome === "completed" || block.actualMinutes >= block.plannedMinutes * HELD_FRACTION;
}

/**
 * The block length with the best record of actually being finished.
 *
 * Deliberately not "the longest she's ever managed" — the question is
 * which length she reliably completes, because a 90-minute block abandoned
 * at minute 12 is worse than a 25-minute one seen through.
 */
export function suggestBlockLength(blocks: FocusBlock[], fallback = 52): LengthSuggestion {
  if (blocks.length < MIN_BLOCKS_TO_SUGGEST) {
    return {
      minutes: fallback,
      because: `starting at ${fallback} minutes — ask again once there are a few blocks to go on`,
    };
  }

  let best: { minutes: number; rate: number; total: number } | null = null;
  for (const length of BLOCK_LENGTHS) {
    const atLength = blocks.filter((block) => block.plannedMinutes === length);
    if (atLength.length < 3) continue;
    const held = atLength.filter(heldTogether).length;
    const rate = held / atLength.length;
    // Ties go to the longer block: same completion rate, more work done.
    if (!best || rate > best.rate || (rate === best.rate && length > best.minutes)) {
      best = { minutes: length, rate, total: atLength.length };
    }
  }

  if (!best) return { minutes: fallback, because: `no one length has been tried enough times yet` };
  return {
    minutes: best.minutes,
    because: `${Math.round(best.rate * 100)}% of your ${best.minutes}-minute blocks ran to the end, over ${best.total} of them`,
  };
}

/** Hours, to the tenth — the unit legal time is actually filed in. */
export function toBillableTenths(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

export interface DayTally {
  /** Everything recorded today, in hours to the tenth. */
  loggedHours: number;
  /** How much of it has a matter against it — the rest can't be filed. */
  attributedHours: number;
  blocks: number;
}

/**
 * What today adds up to.
 *
 * `attributedHours` is the number that matters and the reason the matter
 * field exists: an hour worked with nothing written against it is an hour
 * that gets reconstructed from memory on Friday, or not billed at all.
 */
export function tallyDay(blocks: FocusBlock[], isoDate: string): DayTally {
  const today = blocks.filter((block) => block.date === isoDate);
  const minutes = today.reduce((total, block) => total + block.actualMinutes, 0);
  const attributed = today
    .filter((block) => block.matter && block.matter.trim().length > 0)
    .reduce((total, block) => total + block.actualMinutes, 0);
  return {
    loggedHours: toBillableTenths(minutes),
    attributedHours: toBillableTenths(attributed),
    blocks: today.length,
  };
}

/**
 * The matters worked on most recently, most recent first, for one-tap
 * reuse rather than retyping a matter number each time. A shortcut over
 * her own entries — not a suggestion about what she ought to work on.
 */
export function recentMatters(blocks: FocusBlock[], limit = 6): string[] {
  const seen = new Set<string>();
  const ordered = [...blocks].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const matters: string[] = [];
  for (const block of ordered) {
    const matter = block.matter?.trim();
    if (!matter || seen.has(matter)) continue;
    seen.add(matter);
    matters.push(matter);
    if (matters.length >= limit) break;
  }
  return matters;
}

/** An observation about the work, carrying the evidence it came from. */
export interface FocusNote {
  id: string;
  text: string;
  because: string;
}

/** Enough blocks in an hour band before it's worth saying anything about it. */
const MIN_BLOCKS_PER_BAND = 4;

/**
 * What the record shows about when blocks hold together.
 *
 * Phrased about the blocks, and offered so she can put the hard work
 * where it survives — not so the app can tell her when she is at her best,
 * which it does not know.
 */
export function focusNotes(blocks: FocusBlock[]): FocusNote[] {
  if (blocks.length < MIN_BLOCKS_TO_SUGGEST * 2) return [];
  const notes: FocusNote[] = [];

  const bands = [
    { id: "early", label: "before 11am", from: 0, to: 11 },
    { id: "midday", label: "11am to 3pm", from: 11, to: 15 },
    { id: "late", label: "after 3pm", from: 15, to: 24 },
  ];

  const scored = bands
    .map((band) => {
      const inBand = blocks.filter((block) => {
        const hour = new Date(block.startedAt).getHours();
        return hour >= band.from && hour < band.to;
      });
      return { band, total: inBand.length, held: inBand.filter(heldTogether).length };
    })
    .filter((entry) => entry.total >= MIN_BLOCKS_PER_BAND);

  if (scored.length >= 2) {
    const ranked = [...scored].sort((a, b) => b.held / b.total - a.held / a.total);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    // Only worth saying when the two ends are actually far apart; a 5%
    // difference across a dozen blocks is noise dressed as a finding.
    if (best && worst && best !== worst && best.held / best.total - worst.held / worst.total >= 0.25) {
      notes.push({
        id: "band",
        text: `Blocks ${best.band.label} are the ones that run to the end.`,
        because: `${best.held} of ${best.total} ${best.band.label}, against ${worst.held} of ${worst.total} ${worst.band.label}`,
      });
    }
  }

  const unattributed = blocks.filter((block) => !block.matter || !block.matter.trim()).length;
  if (unattributed > 0 && unattributed / blocks.length >= 0.2) {
    notes.push({
      id: "unattributed",
      text: `${unattributed} blocks have no matter against them.`,
      because: `out of ${blocks.length} recorded — those are the ones that have to be reconstructed later`,
    });
  }

  return notes;
}
