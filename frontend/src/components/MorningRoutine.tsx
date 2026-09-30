import { useState } from "react";
import type { Routine, RoutineKind, RoutineStep, Task } from "../types";
import type { RoutinePlan } from "../lib/routinePlan";
import { suggestMorningSteps } from "../lib/routinePlan";
import MemberPicker from "./MemberPicker";

type DraftStep = Omit<RoutineStep, "stepId">;

interface MorningRoutineProps {
  routine: Routine | null;
  /** Today's plan, when the routine runs today — for the "usually" figures. */
  plan: RoutinePlan | null;
  /** The family's own chores, used to seed a first draft rather than an empty form. */
  tasks: Task[];
  members: string[];
  /** Which routine this card is for — the copy and the defaults follow it. */
  kind: RoutineKind;
  onSave: (routine: { name: string; anchorTime: string; daysOfWeek: number[]; steps: DraftStep[] }) => Promise<void>;
  onSetActive: (active: boolean) => Promise<void>;
  onStartNow: () => void;
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Both routines are the same engine pointed at a different deadline —
 * lights out is as real a fixed time as the bus, and a bedtime that slips
 * is where a lot of bad mornings actually start. Only the words differ.
 */
const COPY: Record<RoutineKind, { name: string; deadline: string; setUp: string; blurb: string; defaultTime: string; seedFromChores: boolean }> = {
  morning: {
    name: "School morning",
    deadline: "Has to be out the door by",
    setUp: "Set up the school morning",
    blurb: "Set the time you have to be out of the door, and the app will work backwards from it — showing one step at a time and how many minutes are spare.",
    defaultTime: "07:50",
    seedFromChores: true,
  },
  bedtime: {
    name: "Bedtime",
    deadline: "Lights out at",
    setUp: "Set up bedtime",
    blurb: "Set lights-out and the app works backwards from it, one step at a time — the same way it does the morning, and for the same reason.",
    defaultTime: "20:00",
    seedFromChores: false,
  },
  custom: {
    name: "Routine",
    deadline: "Finished by",
    setUp: "Set up a routine",
    blurb: "Set the time it has to be finished by, and the app will work backwards from it.",
    defaultTime: "18:00",
    seedFromChores: false,
  },
};

/**
 * Setting up and checking the morning.
 *
 * The editor is seeded from the chores this family already keeps in the
 * morning window, because the alternative is typing six steps and six
 * durations onto a wall-mounted screen — which is exactly the kind of
 * setup cost that means a feature is never used once. The app already
 * knows what their mornings contain; this hands it back as a draft to
 * correct, and saves nothing until someone says so.
 */
export default function MorningRoutine({
  routine,
  plan,
  tasks,
  members,
  kind,
  onSave,
  onSetActive,
  onStartNow,
}: MorningRoutineProps) {
  const copy = COPY[kind];
  const [editing, setEditing] = useState(false);
  const [anchorTime, setAnchorTime] = useState(routine?.anchorTime ?? copy.defaultTime);
  const [days, setDays] = useState<number[]>(routine?.daysOfWeek ?? WEEKDAYS);
  const [steps, setSteps] = useState<DraftStep[]>(
    routine?.steps.map(({ title, targetMinutes, memberId }) => ({ title, targetMinutes, memberId })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEditing() {
    setAnchorTime(routine?.anchorTime ?? copy.defaultTime);
    setDays(routine?.daysOfWeek ?? WEEKDAYS);
    setSteps(
      routine
        ? routine.steps.map(({ title, targetMinutes, memberId }) => ({ title, targetMinutes, memberId }))
        : copy.seedFromChores
          ? suggestMorningSteps(tasks)
          : []
    );
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
      setError("A routine needs at least one step.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: routine?.name ?? copy.name, anchorTime, daysOfWeek: days, steps: cleaned });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <label className="block">
          <span className="font-body text-olive-700">{copy.deadline}</span>
          <input
            type="time"
            value={anchorTime}
            onChange={(event) => setAnchorTime(event.target.value)}
            className="mt-1 block w-full rounded-card border-2 border-olive-100 px-3 py-2 font-display text-2xl text-olive-800"
          />
        </label>

        <fieldset>
          <legend className="font-body text-olive-700">On these days</legend>
          <div className="flex flex-wrap gap-2 mt-1">
            {DAY_LABELS.map((label, day) => {
              const on = days.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDays((prev) => (on ? prev.filter((d) => d !== day) : [...prev, day].sort()))}
                  className={`rounded-full px-4 py-2 font-body ${on ? "bg-olive-600 text-white" : "bg-olive-50 text-olive-700 border border-olive-100"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <p className="font-body text-olive-700">
            The steps, in order
            {steps.length > 0 && routine === null && copy.seedFromChores && (
              <span className="text-olive-600 text-sm"> — started from your morning chores, change anything</span>
            )}
          </p>
          {steps.map((step, index) => (
            <div key={index} className="rounded-card border-2 border-olive-100 p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={step.title}
                  aria-label={`Step ${index + 1} name`}
                  onChange={(event) => updateStep(index, { title: event.target.value })}
                  className="flex-1 min-w-0 rounded-card border-2 border-olive-100 px-3 py-2 font-body"
                />
                <label className="shrink-0">
                  <span className="sr-only">Minutes for {step.title || `step ${index + 1}`}</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={step.targetMinutes}
                    onChange={(event) => updateStep(index, { targetMinutes: Number(event.target.value) || 1 })}
                    className="w-20 rounded-card border-2 border-olive-100 px-3 py-2 font-body text-center"
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${step.title || `step ${index + 1}`}`}
                  onClick={() => setSteps((prev) => prev.filter((_, at) => at !== index))}
                  className="shrink-0 text-clay-700 px-3"
                >
                  ✕
                </button>
              </div>
              {/* MemberPicker speaks in "" for nobody; the routine stores null. */}
              <MemberPicker
                members={members}
                value={step.memberId ?? ""}
                onChange={(memberId) => updateStep(index, { memberId: memberId || null })}
                anyoneLabel="Anyone"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSteps((prev) => [...prev, { title: "", targetMinutes: 5, memberId: null }])}
            className="font-body text-olive-700 underline underline-offset-2 py-2"
          >
            Add a step
          </button>
        </div>

        {error && (
          <p role="alert" className="text-clay-900 bg-clay-100 rounded-card px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="font-display bg-olive-600 text-white rounded-full px-6 py-3 disabled:bg-olive-300"
          >
            {saving ? "Saving…" : "Save the morning"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="font-body text-olive-600 underline py-2">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!routine) {
    return (
      <div>
        <p className="font-body text-olive-700">{copy.blurb}</p>
        <button
          type="button"
          onClick={beginEditing}
          className="mt-3 font-display bg-olive-600 text-white rounded-full px-6 py-3"
        >
          {copy.setUp}
        </button>
      </div>
    );
  }

  // One shape for the list, whether or not the routine runs today (no plan
  // at the weekend, so the figures fall back to the family's own estimates).
  const summary = routine.steps.map((step) => {
    const planned = plan?.steps.find((candidate) => candidate.stepId === step.stepId);
    return {
      stepId: step.stepId,
      title: step.title,
      memberId: step.memberId,
      minutes: planned?.expectedMinutes ?? step.targetMinutes,
      timedCount: planned?.basis.kind === "learned" ? planned.basis.samples : null,
    };
  });

  return (
    <div className="space-y-3">
      <p className="font-display text-2xl text-olive-800">
        {kind === "bedtime" ? "Lights out" : "Out by"} {routine.anchorTime}
        <span className="font-body text-base text-olive-600">
          {" "}
          · {routine.daysOfWeek.map((day) => DAY_LABELS[day]).join(" ")}
        </span>
      </p>

      <ol className="space-y-1">
        {summary.map((step) => (
          <li key={step.stepId} className="font-body text-olive-700 flex justify-between gap-3">
            <span className="truncate">
              {step.memberId && <span className="text-clay-700">{step.memberId} · </span>}
              {step.title}
            </span>
            <span className="shrink-0 text-olive-600 text-sm">
              {step.minutes} min
              {/* Learned or guessed, said plainly. A family that can't tell
                  the difference can't tell whether to trust the plan. */}
              {step.timedCount === null ? "" : ` · timed ${step.timedCount}×`}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3 items-center">
        <button type="button" onClick={onStartNow} className="font-display bg-olive-600 text-white rounded-full px-5 py-3">
          Start now
        </button>
        <button type="button" onClick={beginEditing} className="font-body text-olive-700 underline py-2">
          Edit
        </button>
        <button
          type="button"
          onClick={() => void onSetActive(!routine.active)}
          className="font-body text-olive-600 underline py-2"
        >
          {routine.active ? "Turn off" : "Turn back on"}
        </button>
      </div>
    </div>
  );
}
