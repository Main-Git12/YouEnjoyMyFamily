import { useEffect, useRef, useState } from "react";
import { BLOCK_LENGTHS, recentMatters, toBillableTenths, type LengthSuggestion } from "../lib/focusRhythm";
import type { FocusBlock, FocusOutcome } from "../types";
import { useDismissableOverlay } from "../lib/useDismissableOverlay";

interface FocusSessionProps {
  memberId: string;
  suggestion: LengthSuggestion;
  /** Past blocks, for the matter shortcuts. */
  history: FocusBlock[];
  onRecord: (block: {
    startedAt: string;
    endedAt: string;
    plannedMinutes: number;
    outcome: FocusOutcome;
    matter: string | null;
    note: string | null;
  }) => Promise<void>;
  onClose: () => void;
}

type Phase = "choosing" | "running" | "logging";

function mmss(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A block of work, and the time entry that closes it.
 *
 * The shape came from the brief — an hour of work, then the timesheet,
 * then another hour — and the important part is the order. The entry is
 * not admin that happens later; it is the gate on the end of the block,
 * written while it is still obvious what the last hour was. Reconstructing
 * a day from memory on Friday afternoon is the actual cost this is trying
 * to remove, and it is much larger than the timer.
 *
 * Nothing here is enforced. The timer can be stopped early, the entry can
 * be left blank, and the block is still recorded — a tool that punishes
 * you for a bad morning is a tool you stop opening.
 */
export default function FocusSession({ memberId, suggestion, history, onRecord, onClose }: FocusSessionProps) {
  const [phase, setPhase] = useState<Phase>("choosing");
  const [plannedMinutes, setPlannedMinutes] = useState(suggestion.minutes);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(plannedMinutes * 60);
  const [matter, setMatter] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useDismissableOverlay<HTMLDivElement>(onClose, phase !== "running");

  // The wall clock, not a decrementing counter: a background tab is
  // throttled to roughly once a minute, and a counter that ticks only when
  // the browser feels like it would quietly under-report every block.
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const left = Math.round((deadline - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        setEndedAt(new Date().toISOString());
        setPhase("logging");
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  function start() {
    const now = new Date();
    deadlineRef.current = now.getTime() + plannedMinutes * 60_000;
    setStartedAt(now.toISOString());
    setEndedAt(null);
    setRemaining(plannedMinutes * 60);
    setError(null);
    setPhase("running");
  }

  function stopEarly() {
    setEndedAt(new Date().toISOString());
    setPhase("logging");
  }

  const ranMinutes =
    startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000)) : 0;
  // "Completed" is about whether the block held, which is what the length
  // suggestion learns from — so a block stopped one minute early is not
  // filed as an abandonment.
  const outcome: FocusOutcome = ranMinutes >= plannedMinutes * 0.9 ? "completed" : ranMinutes < 5 ? "abandoned" : "cut_short";

  async function saveEntry() {
    if (!startedAt || !endedAt) return;
    setSaving(true);
    setError(null);
    try {
      await onRecord({
        startedAt,
        endedAt,
        plannedMinutes,
        outcome,
        matter: matter.trim() || null,
        note: note.trim() || null,
      });
      setMatter("");
      setNote("");
      setStartedAt(null);
      setEndedAt(null);
      setPhase("choosing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const matters = recentMatters(history);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus block"
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 bg-sand-50 flex flex-col items-center justify-center p-4 sm:p-8"
    >
      {phase === "choosing" && (
        <div className="w-full max-w-lg text-center">
          <p className="font-body text-olive-700">How long, {memberId}?</p>
          <div className="flex justify-center gap-2 sm:gap-3 mt-3 flex-wrap">
            {BLOCK_LENGTHS.map((length) => (
              <button
                key={length}
                type="button"
                aria-pressed={plannedMinutes === length}
                onClick={() => setPlannedMinutes(length)}
                className={`font-display text-xl sm:text-2xl rounded-full px-5 sm:px-7 py-3 ${
                  plannedMinutes === length
                    ? "bg-olive-600 text-white"
                    : "bg-white text-olive-700 border-2 border-olive-100"
                }`}
              >
                {length}
              </button>
            ))}
          </div>
          {/* The suggestion says where it came from. A number with no
              reasoning behind it is just a number someone made up. */}
          <p className="font-body text-olive-600 text-sm mt-3">{suggestion.because}</p>
          <button
            type="button"
            onClick={start}
            className="mt-6 font-display text-2xl sm:text-3xl bg-olive-600 text-white rounded-full px-12 sm:px-16 py-4 sm:py-5 shadow-[var(--shadow-card)] hover:bg-olive-700 active:scale-95 transition"
          >
            Start
          </button>
          <div>
            <button type="button" onClick={onClose} className="mt-4 text-sm text-olive-600 underline py-2">
              Close
            </button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <div className="text-center">
          <p
            aria-live="off"
            className="font-display text-7xl sm:text-9xl text-olive-800 tabular-nums leading-none"
          >
            {mmss(remaining)}
          </p>
          <p className="font-body text-olive-700 mt-2">
            {plannedMinutes}-minute block{matter.trim() ? ` · ${matter.trim()}` : ""}
          </p>
          <button
            type="button"
            onClick={stopEarly}
            className="mt-8 font-display text-xl bg-white text-olive-700 border-2 border-olive-100 rounded-full px-8 py-3"
          >
            Stop and log it
          </button>
        </div>
      )}

      {phase === "logging" && (
        <div className="w-full max-w-lg">
          <p className="font-display text-3xl sm:text-4xl text-olive-800 text-center">
            {ranMinutes} min · {toBillableTenths(ranMinutes)} hr
          </p>
          <p className="font-body text-olive-600 text-center text-sm mt-1">
            While it's still fresh — this is the bit that saves Friday.
          </p>

          {matters.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {matters.map((recent) => (
                <button
                  key={recent}
                  type="button"
                  onClick={() => setMatter(recent)}
                  className={`rounded-full px-4 py-2 font-body border ${
                    matter === recent ? "bg-olive-600 text-white border-olive-600" : "bg-white text-olive-700 border-olive-500"
                  }`}
                >
                  {recent}
                </button>
              ))}
            </div>
          )}

          <label className="block mt-3">
            <span className="font-body text-olive-700">Matter</span>
            <input
              type="text"
              value={matter}
              onChange={(event) => setMatter(event.target.value)}
              placeholder="A number or short code"
              className="mt-1 block w-full rounded-card border-2 border-olive-100 px-3 py-2 font-body"
            />
          </label>

          <label className="block mt-3">
            <span className="font-body text-olive-700">What you did</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-card border-2 border-olive-100 px-3 py-2 font-body"
            />
          </label>

          {error && (
            <p role="alert" className="text-clay-900 bg-clay-100 rounded-card px-3 py-2 mt-3">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              type="button"
              onClick={saveEntry}
              disabled={saving}
              className="font-display bg-olive-600 text-white rounded-full px-6 py-3 disabled:bg-olive-300"
            >
              {saving ? "Saving…" : "Log it"}
            </button>
            {/* Recorded either way. A tool that punishes a bad morning by
                losing the time is a tool you stop opening. */}
            <button
              type="button"
              onClick={saveEntry}
              disabled={saving}
              className="font-body text-olive-600 underline py-2"
            >
              Log without a matter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
