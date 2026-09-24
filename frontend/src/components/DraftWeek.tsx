import { useState } from "react";
import type { DraftedMeal } from "../lib/routines";

interface DraftWeekProps {
  draft: DraftedMeal[];
  onAccept: (meals: DraftedMeal[]) => Promise<void>;
}

/**
 * A week of dinners, proposed from what this family actually cooks.
 *
 * Every other planner on the market will invent you a recipe. This one
 * won't: each line is a meal someone here has already made, placed on the
 * day their own records put it, with the reason spelled out underneath.
 * A suggestion you can read the workings of is worth more than a confident
 * one you can't.
 *
 * Nothing is saved until someone says so, and any single line can be
 * dropped before accepting the rest.
 */
export default function DraftWeek({ draft, onAccept }: DraftWeekProps) {
  const [dropped, setDropped] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const keeping = draft.filter((meal) => !dropped.includes(meal.date));
  if (!draft.length) return null;

  async function handleAccept() {
    setSaving(true);
    try {
      await onAccept(keeping);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-card border-2 border-dashed border-olive-300 p-4">
      <p className="font-display text-lg text-olive-700">Shall I pencil in the rest of the week?</p>
      <p className="text-sm text-olive-600 mb-3">
        All meals you already cook — nothing invented. Drop any you don&apos;t fancy.
      </p>

      <ul className="space-y-2 mb-4">
        {draft.map((meal) => {
          const isDropped = dropped.includes(meal.date);
          return (
            <li
              key={meal.date}
              className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 ${
                isDropped ? "bg-white" : "bg-olive-50"
              }`}
            >
              <span className="min-w-0">
                <span className={`block ${isDropped ? "line-through text-olive-600" : "text-olive-900"}`}>
                  {new Date(`${meal.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })} —{" "}
                  {meal.mealName}
                </span>
                <span className="block text-sm text-olive-600">{meal.because}</span>
              </span>
              <button
                type="button"
                aria-label={isDropped ? `Put ${meal.mealName} back` : `Drop ${meal.mealName}`}
                onClick={() =>
                  setDropped((prev) => (isDropped ? prev.filter((d) => d !== meal.date) : [...prev, meal.date]))
                }
                className="text-sm text-olive-700 underline underline-offset-2 py-1 shrink-0"
              >
                {isDropped ? "Put back" : "Drop"}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={handleAccept}
        disabled={saving || keeping.length === 0}
        className="font-display bg-olive-600 text-white rounded-full px-6 py-3 shadow-[var(--shadow-card)] hover:bg-olive-700 disabled:bg-olive-300"
      >
        {saving
          ? "Pencilling in…"
          : keeping.length === 0
            ? "Nothing selected"
            : `Pencil in ${keeping.length} ${keeping.length === 1 ? "dinner" : "dinners"}`}
      </button>
    </div>
  );
}
