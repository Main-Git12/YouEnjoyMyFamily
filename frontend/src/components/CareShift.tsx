import type { CarePlan, Overlap } from "../lib/carePlan";

interface CareShiftProps {
  plan: CarePlan | null;
  /** Whether today's shift lands on the school morning. Null when there's nothing to compare. */
  overlap: Overlap | null;
}

const clock = (date: Date): string =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * Today's care shift, on the wall.
 *
 * Read by three different people for three different reasons: the carer,
 * who wants to know what the morning holds; the family, who want to know
 * it's in hand without asking; and Sheliah, who is the subject of all of
 * it and can read the screen too. That last one sets the tone. Every line
 * here is about a step or a shift — what happens, when, how long it
 * usually takes. Nothing on this panel is about how anybody is doing.
 *
 * The durations carry their own provenance, the same as the morning
 * routine's: "timed 3 times" or "estimate". A plan nobody can check is a
 * plan that can only be obeyed, and this one is handed to somebody who
 * wasn't in the room when it was written.
 */
export default function CareShift({ plan, overlap }: CareShiftProps) {
  if (!plan) return <p className="text-olive-700 italic">Nobody is down to come in today.</p>;

  const { carer, shiftStart, shiftEnd, steps, paused, roomMinutes, totalExpectedMinutes } = plan;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-xl text-olive-900">
          {carer ? carer.displayName : "Today"}
          {shiftStart && shiftEnd ? (
            <span className="text-olive-700 font-body text-base">
              {" "}
              · {clock(shiftStart)}–{clock(shiftEnd)}
            </span>
          ) : null}
        </p>
        {carer?.note && <p className="text-xs text-olive-600">{carer.note}</p>}
      </div>

      {steps.length > 0 ? (
        <ul className="space-y-1">
          {steps.map((step) => (
            <li key={step.stepId} className="flex items-baseline gap-3 rounded-lg bg-olive-50 px-3 py-2">
              <span className="font-display tabular-nums text-olive-800 w-16 shrink-0">{clock(step.startsAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-olive-900">{step.title}</span>
                <span className="block text-xs text-olive-600">
                  {step.expectedMinutes} min ·{" "}
                  {step.basis.kind === "learned"
                    ? `timed ${step.basis.samples} time${step.basis.samples === 1 ? "" : "s"}`
                    : "still an estimate"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-olive-700 italic">No steps written down yet.</p>
      )}

      {/* The one number worth reading, and the same shape as the morning's
          slack: positive is room, negative means more was written down than
          the agreed hours hold. That is a fact about the plan — too much was
          scheduled — never about whoever is working it. */}
      {roomMinutes !== null && (
        <p className={roomMinutes < 0 ? "text-clay-700" : "text-olive-800"}>
          {roomMinutes >= 0
            ? `${roomMinutes} min spare in the shift.`
            : `${Math.abs(roomMinutes)} min more than the shift holds.`}
          <span className="block text-xs text-olive-600">
            {totalExpectedMinutes} minutes of steps against the hours agreed.
          </span>
        </p>
      )}

      {paused.length > 0 && (
        <section>
          <h4 className="text-xs uppercase tracking-wide text-olive-600 mb-1">Not this month</h4>
          <ul className="space-y-1">
            {paused.map((step) => (
              <li
                key={step.stepId}
                // Clay rather than olive for the ones nobody has: an
                // unclaimed job is the only row here asking for something.
                className={`rounded-lg px-3 py-2 ${step.coveredBy ? "bg-olive-50" : "bg-clay-100"}`}
              >
                <span className="text-olive-900">{step.title}</span>
                <span className="block text-xs text-olive-600">
                  Back {step.until}
                  {step.reason ? ` · ${step.reason}` : ""} ·{" "}
                  {step.coveredBy ? `${step.coveredBy} has it` : "nobody has picked it up"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shown whichever way it comes out. "They don't run into each other"
          is the more useful answer and the one nobody expects. */}
      {overlap && <p className="text-xs text-olive-600">{overlap.because}</p>}
    </div>
  );
}
