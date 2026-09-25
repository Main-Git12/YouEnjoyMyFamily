import { useEffect, useRef, useState } from "react";
import type { RoutinePlan, PlannedStep } from "../lib/routinePlan";
import { canSpeak, speak, stopSpeaking } from "../lib/speak";
import { useDismissableOverlay } from "../lib/useDismissableOverlay";

interface MorningLaunchProps {
  plan: RoutinePlan;
  /** What the deadline is called out loud and on screen — "the bus", "school". */
  anchorLabel: string;
  onFinishStep: (step: PlannedStep) => void;
  onUndoStep: (step: PlannedStep) => void;
  onDismiss: () => void;
}

/** 07:52, in the family's own locale rather than a hardcoded format. */
function clock(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * How the standing reads to someone glancing from the other side of the
 * kitchen. Deliberately about the morning, never about a person: "4 minutes
 * behind" is a fact about a clock that everyone in the room shares, and
 * nobody in particular is being told off by it.
 */
function standingLine(plan: RoutinePlan): string {
  if (plan.standing === "done") return "Everyone's ready";
  if (plan.standing === "behind") return `${Math.abs(plan.slackMinutes)} min behind`;
  if (plan.standing === "tight") return "Cutting it fine";
  return `${plan.slackMinutes} min spare`;
}

const STANDING_STYLES: Record<RoutinePlan["standing"], string> = {
  ahead: "bg-olive-600 text-white",
  tight: "bg-clay-300 text-clay-900",
  behind: "bg-clay-700 text-white",
  done: "bg-olive-600 text-white",
};

/**
 * The morning, one step at a time, on the whole screen.
 *
 * Everything here follows from a single decision: show *one* thing. A list
 * of six jobs is a list to be argued with and negotiated over; one job with
 * a name on it and a number beside it is just the next thing. The rest of
 * the routine stays visible as a thin strip, so nobody feels ambushed by
 * what's coming, but it is deliberately small.
 *
 * The screen is the one doing the asking. That is the whole design: the
 * countdown, the name, and — where the browser allows it — the voice all
 * belong to the kitchen display, not to whichever adult is nearest.
 */
export default function MorningLaunch({ plan, anchorLabel, onFinishStep, onUndoStep, onDismiss }: MorningLaunchProps) {
  const [voiceOn, setVoiceOn] = useState(false);
  const current = plan.current;
  // Same Escape-and-focus behaviour as every other overlay here: a
  // full-screen box that leaves keyboard focus on the dashboard behind it
  // is unusable for anyone not touching the screen.
  const containerRef = useDismissableOverlay<HTMLDivElement>(onDismiss);
  // What was last said out loud, so a re-render (the clock ticks every
  // few seconds) doesn't re-announce the step the family is already on.
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!voiceOn) return;
    const line = plan.finished
      ? "That's everyone ready."
      : current
        ? `${current.memberId ? `${current.memberId}. ` : ""}${current.title}. ${current.expectedMinutes} minutes.`
        : null;
    if (!line || lastSpokenRef.current === line) return;
    lastSpokenRef.current = line;
    speak(line);
  }, [voiceOn, current, plan.finished]);

  // Nothing should still be talking once the screen is gone.
  useEffect(() => () => stopSpeaking(), []);

  /**
   * Hold the page still underneath.
   *
   * The dashboard behind this is seven screens tall, and on a touch
   * display a stray swipe scrolls it while the overlay stays put — so
   * putting the overlay away lands the family somewhere they never
   * navigated to, halfway down the meal plan, at ten to eight.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const done = plan.steps.filter((step) => step.state === "done");
  const upcoming = plan.steps.filter((step) => step.state === "upcoming");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${anchorLabel} at ${clock(plan.anchorAt)}`}
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 bg-sand-50 flex flex-col"
    >
      {/* The deadline and the standing, always on screen. The two numbers
          that matter are the only things at this size. */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-8 pt-4 sm:pt-6">
        <div className="min-w-0">
          <p className="font-display text-3xl sm:text-5xl text-olive-800 leading-none">{clock(plan.anchorAt)}</p>
          <p className="text-olive-700 font-body text-sm sm:text-lg truncate">{anchorLabel}</p>
        </div>
        <p
          aria-live="polite"
          className={`font-display text-xl sm:text-3xl rounded-full px-4 sm:px-7 py-2 sm:py-3 shadow-[var(--shadow-card)] ${STANDING_STYLES[plan.standing]}`}
        >
          {standingLine(plan)}
        </p>
      </header>

      {/* The one thing. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-8 text-center">
        {plan.finished ? (
          <>
            <p className="font-display text-4xl sm:text-6xl text-olive-700">Out the door</p>
            <p className="text-olive-700 font-body mt-3 text-lg">
              {plan.minutesToAnchor >= 0
                ? `With ${plan.minutesToAnchor} minutes to spare.`
                : "Everything's ticked off."}
            </p>
          </>
        ) : current ? (
          <>
            {current.memberId && (
              <p className="font-display text-2xl sm:text-4xl text-clay-700 uppercase tracking-wide">
                {current.memberId}
              </p>
            )}
            <h2 className="font-display text-4xl sm:text-6xl lg:text-7xl text-olive-800 mt-1 leading-tight">
              {current.title}
            </h2>
            {/* Where the number came from, in the open. A plan you can't
                check is a plan you can only obey. */}
            <p className="text-olive-700 font-body mt-3 text-base sm:text-xl">
              usually {current.expectedMinutes} min
              {current.basis.kind === "learned"
                ? ` · from the last ${current.basis.samples} mornings`
                : " · your estimate, not measured yet"}
            </p>
            <p className="text-olive-600 font-body mt-1 text-sm sm:text-base">
              start by {clock(current.startBy)}
            </p>
            <button
              type="button"
              onClick={() => onFinishStep(current)}
              className="mt-6 sm:mt-8 font-display text-2xl sm:text-4xl bg-olive-600 text-white rounded-full px-10 sm:px-16 py-4 sm:py-6 shadow-[var(--shadow-card)] hover:bg-olive-700 active:scale-95 transition"
            >
              Done
            </button>
          </>
        ) : null}
      </div>

      {/* What's left, small on purpose — reassurance, not a to-do list. */}
      <div className="shrink-0 px-4 sm:px-8 pb-3">
        {upcoming.length > 0 && (
          <ol className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
            {upcoming.map((step) => (
              <li
                key={step.stepId}
                className="text-olive-700 font-body text-xs sm:text-sm bg-white border border-olive-100 rounded-full px-3 py-1"
              >
                {step.memberId ? `${step.memberId} · ` : ""}
                {step.title}
                <span className="text-olive-600"> {step.expectedMinutes}m</span>
              </li>
            ))}
          </ol>
        )}
        {done.length > 0 && (
          <p className="text-center text-olive-600 font-body text-xs sm:text-sm mt-2">
            {done.length} done
            {/* Undo, because a mis-tap on a wall screen at 7am is routine
                and having to live with it for the rest of the morning is not. */}
            {done.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => {
                    const last = done[done.length - 1];
                    if (last) onUndoStep(last);
                  }}
                  className="underline underline-offset-2 py-1"
                >
                  undo {done[done.length - 1]?.title.toLowerCase()}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <footer className="shrink-0 flex items-center justify-center gap-4 sm:gap-6 pb-3 sm:pb-4">
        {canSpeak() && (
          <button
            type="button"
            aria-pressed={voiceOn}
            onClick={() => {
              if (voiceOn) stopSpeaking();
              // Cleared so switching the voice back on re-announces where
              // the family actually is, rather than staying silent until
              // the next step.
              lastSpokenRef.current = null;
              setVoiceOn((on) => !on);
            }}
            className="text-sm text-olive-700 underline underline-offset-2 py-2"
          >
            {voiceOn ? "Voice on" : "Say the steps out loud"}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="text-sm text-olive-600 underline underline-offset-2 py-2">
          Back to the dashboard
        </button>
      </footer>
    </div>
  );
}
