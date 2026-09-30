import { tallyDay, focusNotes, type LengthSuggestion } from "../lib/focusRhythm";
import type { FocusBlock } from "../types";

interface FocusDayProps {
  blocks: FocusBlock[];
  today: string;
  suggestion: LengthSuggestion;
  onStart: () => void;
}

function hours(value: number): string {
  return value.toFixed(1);
}

/**
 * The day's work, as it stands, and the way into the next block.
 *
 * The number that leads is attributed hours, not hours worked, because
 * that is the one with consequences: time logged against nothing is time
 * that gets reconstructed from memory later, or not billed at all.
 */
export default function FocusDay({ blocks, today, suggestion, onStart }: FocusDayProps) {
  const tally = tallyDay(blocks, today);
  const notes = focusNotes(blocks);
  const todaysBlocks = blocks.filter((block) => block.date === today);
  const unattributed = Math.round((tally.loggedHours - tally.attributedHours) * 10) / 10;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <p className="font-display text-3xl text-olive-800">{hours(tally.attributedHours)} hr</p>
        <p className="font-body text-olive-700">
          filed today
          {unattributed > 0 && (
            <span className="text-clay-700"> · {hours(unattributed)} hr with no matter on it</span>
          )}
        </p>
      </div>

      {todaysBlocks.length > 0 && (
        <ol className="space-y-1">
          {todaysBlocks
            .slice()
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
            .map((block) => (
              <li key={block.blockId} className="font-body text-olive-700 flex justify-between gap-3 text-sm">
                <span className="truncate">
                  {block.matter ? (
                    <span className="text-clay-700">{block.matter}</span>
                  ) : (
                    <span className="text-olive-600 italic">no matter</span>
                  )}
                  {block.note ? ` · ${block.note}` : ""}
                </span>
                <span className="shrink-0 text-olive-600">{block.actualMinutes}m</span>
              </li>
            ))}
        </ol>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((note) => (
            <li key={note.id} className="font-body text-olive-700 text-sm">
              {note.text}{" "}
              {/* The evidence, always. A claim you can't check is one you
                  can only take on faith, and this one is about her work. */}
              <span className="text-olive-600">({note.because})</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onStart}
        className="font-display bg-olive-600 text-white rounded-full px-6 py-3"
      >
        Start a {suggestion.minutes}-minute block
      </button>
    </div>
  );
}
