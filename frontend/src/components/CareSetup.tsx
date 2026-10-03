import { useState } from "react";
import type { HouseholdMember, Routine, RoutineStep } from "../types";
import { CARE_CATALOG, describeRota } from "../lib/careCatalog";

type DraftStep = Omit<RoutineStep, "stepId">;

interface CareSetupProps {
  routine: Routine | null;
  /** The rota, so the hours on screen are the ones that were agreed. */
  members: HouseholdMember[];
  onSave: (input: {
    name: string;
    anchorTime: string;
    daysOfWeek: number[];
    steps: DraftStep[];
  }) => Promise<void>;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Setting up a care shift, and parking the parts of it that can't happen
 * this month.
 *
 * Two things this is careful about.
 *
 * The steps come from a catalog you tap rather than a form you fill in.
 * Eleven steps and eleven durations typed onto a wall-mounted screen is
 * the setup cost that means a feature gets built and never used once.
 *
 * And a step that can't be done right now is *paused*, never deleted.
 * Somebody in a cast for four weeks is a month, not a change of plan:
 * deleting the step throws away both the job and everything it has learned
 * about how long it takes, and then it has to be rediscovered from scratch
 * when the cast comes off. A paused step keeps its place, says when it is
 * due back, and shows plainly whether anyone has picked it up — because
 * the failure here is not that a step is paused, it is that a paused step
 * quietly belongs to nobody.
 *
 * Every word on this screen is about a step. A hand in a cast is a reason
 * written against a job, not a note about a person.
 */
export default function CareSetup({ routine, members, onSave }: CareSetupProps) {
  const [editing, setEditing] = useState(false);
  const [anchorTime, setAnchorTime] = useState(routine?.anchorTime ?? "09:00");
  const [days, setDays] = useState<number[]>(routine?.daysOfWeek ?? WEEKDAYS);
  const [steps, setSteps] = useState<DraftStep[]>(() => draftFrom(routine));
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [pausing, setPausing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carers = members.filter((member) => member.role === "carer");
  const coverCandidates = members.filter((member) => member.role !== "child");

  function beginEditing() {
    setAnchorTime(routine?.anchorTime ?? "09:00");
    setDays(routine?.daysOfWeek ?? WEEKDAYS);
    setSteps(draftFrom(routine));
    setPausing(null);
    setError(null);
    setEditing(true);
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  }

  async function handleSave() {
    const cleaned = steps
      .map((step) => ({ ...step, title: step.title.trim() }))
      .filter((step) => step.title.length > 0);
    if (cleaned.length === 0) {
      setError("A shift needs at least one step.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: routine?.name ?? "The care shift", anchorTime, daysOfWeek: days, steps: cleaned });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-olive-700">
          The shape of the shift: what happens, in what order, and roughly how long each part takes. The
          minutes are only a starting point — once a step has been timed twice, the app uses what actually
          happened instead.
        </p>

        {carers.length > 0 ? (
          <ul className="space-y-1">
            {carers.map((carer) => (
              <li key={carer.memberId} className="text-olive-900">
                {carer.displayName}
                <span className="text-xs text-olive-600"> · {describeRota(carer) ?? "no hours set"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-olive-700 italic">
            Nobody is on the rota yet — add them under Setup, with the days and hours as agreed.
          </p>
        )}

        {routine && routine.steps.length > 0 && (
          <p className="text-sm text-olive-700">
            {routine.steps.length} step{routine.steps.length === 1 ? "" : "s"} written down
            {routine.steps.some((step) => step.pausedUntil) && ", some paused"}.
          </p>
        )}

        <button type="button" onClick={beginEditing} className="min-h-11 rounded-lg bg-olive-600 px-4 text-white">
          {routine ? "Change the shift" : "Set up the shift"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="font-body text-olive-700">Usually starts at</span>
        <span className="block text-xs text-olive-600">
          Only used on a day nobody is rostered. A carer's own agreed hours always win over this.
        </span>
        <input
          type="time"
          value={anchorTime}
          onChange={(event) => setAnchorTime(event.target.value)}
          className="mt-1 block w-full rounded-card border-2 border-olive-100 px-3 py-2 font-display text-2xl text-olive-800"
        />
      </label>

      <fieldset>
        <legend className="font-body text-olive-700">On these days</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAY_LABELS.map((label, day) => {
            const on = days.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((prev) => (on ? prev.filter((d) => d !== day) : [...prev, day].sort()))}
                className={`min-h-11 rounded-full px-4 font-body ${
                  on ? "bg-olive-600 text-white" : "border border-olive-100 bg-olive-50 text-olive-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <p className="font-body text-olive-700">The steps, in order</p>
        {steps.length === 0 && <p className="text-olive-700 italic">Nothing yet — pick from the lists below.</p>}

        {steps.map((step, index) => (
          <div
            key={index}
            className={`rounded-card border-2 p-3 space-y-2 ${
              step.pausedUntil ? "border-clay-200 bg-clay-100" : "border-olive-100"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Step ${index + 1}`}
                value={step.title}
                onChange={(event) => updateStep(index, { title: event.target.value })}
                className="min-h-11 flex-1 min-w-[10rem] rounded-lg border border-olive-300 px-3"
              />
              <label className="text-sm text-olive-700">
                <span className="sr-only">Minutes for {step.title}</span>
                <input
                  type="number"
                  min={1}
                  aria-label={`Minutes for ${step.title}`}
                  value={step.targetMinutes}
                  onChange={(event) => updateStep(index, { targetMinutes: Math.max(1, Number(event.target.value) || 1) })}
                  className="min-h-11 w-20 rounded-lg border border-olive-300 px-2"
                />
              </label>
              <button
                type="button"
                onClick={() => setSteps((prev) => prev.filter((_, at) => at !== index))}
                className="min-h-11 rounded-lg px-2 text-sm text-olive-700 underline"
              >
                Remove
              </button>
            </div>

            {step.pausedUntil ? (
              <div className="space-y-2">
                <p className="text-sm text-olive-900">
                  Paused until {step.pausedUntil}
                  {step.pausedReason ? ` · ${step.pausedReason}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm text-olive-700">
                    Who has it meanwhile
                    <select
                      aria-label={`Who is covering "${step.title}"`}
                      value={step.coveredBy ?? ""}
                      onChange={(event) => updateStep(index, { coveredBy: event.target.value || null })}
                      className="mt-1 block min-h-11 rounded-lg border border-olive-300 px-2 text-sm"
                    >
                      <option value="">Nobody yet</option>
                      {coverCandidates.map((member) => (
                        <option key={member.memberId} value={member.displayName}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => updateStep(index, { pausedUntil: null, pausedReason: null, coveredBy: null })}
                    className="min-h-11 rounded-lg px-2 text-sm text-olive-700 underline"
                  >
                    Back on
                  </button>
                </div>
              </div>
            ) : pausing === index ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-olive-700">
                  Back on
                  <input
                    type="date"
                    aria-label={`When "${step.title}" comes back`}
                    onChange={(event) => {
                      updateStep(index, { pausedUntil: event.target.value || null });
                      if (event.target.value) setPausing(null);
                    }}
                    className="mt-1 block min-h-11 rounded-lg border border-olive-300 px-2"
                  />
                </label>
                <label className="flex-1 min-w-[10rem] text-sm text-olive-700">
                  Why
                  <input
                    aria-label={`Why "${step.title}" is paused`}
                    placeholder="Hand in a cast"
                    value={step.pausedReason ?? ""}
                    onChange={(event) => updateStep(index, { pausedReason: event.target.value || null })}
                    className="mt-1 block w-full min-h-11 rounded-lg border border-olive-300 px-3"
                  />
                </label>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPausing(index)}
                className="min-h-11 rounded-lg text-sm text-olive-700 underline"
              >
                Pause this for a while
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Tapped, not typed. Eleven steps and eleven durations entered by
          hand on a kitchen screen is a feature nobody sets up twice. */}
      <div className="space-y-2">
        <p className="font-body text-olive-700">Add a step</p>
        {CARE_CATALOG.map((group) => {
          const open = openGroup === group.heading;
          const already = new Set(steps.map((step) => step.title.toLowerCase()));
          return (
            <div key={group.heading} className="rounded-lg border border-olive-200">
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : group.heading)}
                className="w-full min-h-11 px-3 py-2 text-left"
              >
                <span className="font-display text-olive-800">{group.heading}</span>
                <span className="block text-xs text-olive-600">{group.blurb}</span>
              </button>
              {open && (
                <ul className="flex flex-wrap gap-2 px-3 pb-3">
                  {group.steps.map((suggestion) => {
                    const on = already.has(suggestion.title.toLowerCase());
                    return (
                      <li key={suggestion.title}>
                        <button
                          type="button"
                          disabled={on}
                          onClick={() =>
                            setSteps((prev) => [
                              ...prev,
                              {
                                title: suggestion.title,
                                targetMinutes: suggestion.targetMinutes,
                                memberId: null,
                                pausedUntil: null,
                                pausedReason: null,
                                coveredBy: null,
                              },
                            ])
                          }
                          className="min-h-11 rounded-full border border-olive-300 px-3 text-sm text-olive-800 disabled:opacity-50"
                        >
                          {on ? `${suggestion.title} ✓` : `+ ${suggestion.title}`}
                          <span className="text-olive-600"> · {suggestion.targetMinutes}m</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-clay-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="min-h-11 rounded-lg bg-olive-600 px-4 text-white disabled:opacity-60"
        >
          Save the shift
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="min-h-11 rounded-lg px-4 text-olive-700 underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function draftFrom(routine: Routine | null): DraftStep[] {
  return (
    routine?.steps.map(({ title, targetMinutes, memberId, pausedUntil, pausedReason, coveredBy }) => ({
      title,
      targetMinutes,
      memberId,
      pausedUntil: pausedUntil ?? null,
      pausedReason: pausedReason ?? null,
      coveredBy: coveredBy ?? null,
    })) ?? []
  );
}
