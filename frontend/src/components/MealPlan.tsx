import { useState, type FormEvent } from "react";
import type { MealPlanEntry, MealSlot } from "../types";
import type { EveningRoom, EveningStandby } from "../lib/eveningRoom";
import { swapOptions, ingredientsFor, STANDING_OPTIONS } from "../lib/mealSwap";

interface MealPlanProps {
  entries: MealPlanEntry[];
  /** The 7 dates currently on screen — owned by Dashboard, which fetches them. */
  days: string[];
  weekOffset: number;
  onWeekOffsetChange: (offset: number) => void;
  onSave: (date: string, slot: MealSlot, input: { mealName: string; ingredients: string[] }) => Promise<void>;
  onRemove: (date: string, slot: MealSlot) => Promise<void>;
  onGenerateGroceryList: () => Promise<{ added: number; skipped: number }>;
  /**
   * What is already on the calendar between school and dinner, per day.
   * Shown while the family is choosing, because the meal is rarely what
   * went wrong on a Wednesday — the evening was, and it was already on the
   * calendar when the plan was made.
   */
  eveningRoom?: EveningRoom[];
  /** Dinners this family has itself put on evenings that already had something on. */
  standbys?: EveningStandby[];
  /**
   * Everything the family has planned or eaten, not just the week on
   * screen. A swap suggestion built from one week of history would offer
   * back the three dinners already in front of you.
   */
  history?: MealPlanEntry[];
  /**
   * Today, so "not had since" only ever talks about days that happened.
   * Passed in rather than read from the clock so the week on screen and
   * the suggestions under it can't disagree about what day it is.
   */
  today: string;
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];
const SLOT_LABELS: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function weekLabel(offset: number, days: string[]): string {
  if (offset === 0) return "This week";
  const first = days[0];
  if (!first) return offset > 0 ? "Next week" : "Last week";
  const date = new Date(`${first}T00:00:00`);
  return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// Only what a family member has typed in for their week — no AI-invented
// meals or ingredients. generateGroceryListFromMealPlan (backend) is the
// only thing that ever turns these ingredients into cart items.
export default function MealPlan({
  entries,
  days,
  weekOffset,
  onWeekOffsetChange,
  onSave,
  onRemove,
  onGenerateGroceryList,
  eveningRoom = [],
  standbys = [],
  history,
  today,
}: MealPlanProps) {
  // Falls back to the week on screen, so the component still works on its
  // own; Dashboard passes the lot.
  const allEntries = history ?? entries;
  const [editing, setEditing] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [mealName, setMealName] = useState("");
  const [ingredientsText, setIngredientsText] = useState("");
  const [generateResult, setGenerateResult] = useState<string | null>(null);

  const roomFor = (date: string): string | null =>
    eveningRoom.find((room) => room.date === date)?.because ?? null;

  const entryFor = (date: string, slot: MealSlot) =>
    entries.find((entry) => entry.date === date && entry.slot === slot);

  function startEditing(date: string, slot: MealSlot) {
    const existing = entryFor(date, slot);
    setEditing({ date, slot });
    setMealName(existing?.mealName ?? "");
    setIngredientsText(existing?.ingredients.join(", ") ?? "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !mealName.trim()) return;
    const ingredients = ingredientsText
      .split(",")
      .map((ingredient) => ingredient.trim())
      .filter((ingredient) => ingredient.length > 0);
    try {
      await onSave(editing.date, editing.slot, { mealName: mealName.trim(), ingredients });
    } catch {
      // Leave the form open and filled in — retyping a meal and its whole
      // ingredient list because the network blipped is its own small insult.
      return;
    }
    setEditing(null);
    // The last generate result described a plan that just changed.
    setGenerateResult(null);
  }

  async function handleRemove() {
    if (!editing) return;
    await onRemove(editing.date, editing.slot);
    setEditing(null);
    setGenerateResult(null);
  }

  async function handleGenerate() {
    let result;
    try {
      result = await onGenerateGroceryList();
    } catch {
      setGenerateResult("Couldn't build the grocery list just now — try again in a moment.");
      return;
    }
    setGenerateResult(
      result.added === 0 && result.skipped === 0
        ? "No ingredients planned yet."
        : `Added ${result.added} ingredient${result.added === 1 ? "" : "s"} to the grocery list` +
            (result.skipped > 0 ? ` (${result.skipped} already on it).` : ".")
    );
  }

  return (
    <div>
      <p className="text-sm text-olive-600 mb-3">
        Plan the week's meals — the grocery list builds itself from what's typed in here.
      </p>

      <div className="flex items-center justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => onWeekOffsetChange(weekOffset - 1)}
          aria-label="Show the previous week"
          className="rounded-lg bg-olive-50 text-olive-700 px-3 py-2 text-sm hover:bg-olive-100"
        >
          ← Previous
        </button>
        <span className="text-sm font-semibold text-olive-700">{weekLabel(weekOffset, days)}</span>
        <button
          type="button"
          onClick={() => onWeekOffsetChange(weekOffset + 1)}
          aria-label="Show the next week"
          className="rounded-lg bg-olive-50 text-olive-700 px-3 py-2 text-sm hover:bg-olive-100"
        >
          Next →
        </button>
      </div>

      {standbys.length > 0 && (
        <p className="text-xs text-olive-600 mb-3">
          On full evenings you've reached for{" "}
          {standbys.slice(0, 3).map((standby, index) => (
            <span key={standby.mealName}>
              {index > 0 ? ", " : ""}
              <span className="text-olive-800">{standby.mealName}</span> ({standby.times}×)
            </span>
          ))}
          .
        </p>
      )}

      <div className="space-y-2 mb-4">
        {days.map((date) => (
          // Label above the slots on a phone, beside them from `sm` up; the
          // slots stay a 3-column grid either way so a day's breakfast,
          // lunch and dinner always line up instead of wrapping raggedly.
          <div key={date} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
            <span className="sm:w-24 shrink-0 text-sm font-semibold text-olive-700">
              {formatDayLabel(date)}
              {/* The calendar's own words, not a judgement about the evening:
                  the family can see what it is and decide for themselves
                  whether it leaves room to cook. */}
              {roomFor(date) && (
                <span className="block text-xs font-normal normal-case text-clay-700">{roomFor(date)}</span>
              )}
            </span>
            <div className="grid grid-cols-3 gap-2 flex-1">
              {SLOTS.map((slot) => {
                const entry = entryFor(date, slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-label={`${SLOT_LABELS[slot]} on ${formatDayLabel(date)}${entry ? `: ${entry.mealName}` : " — nothing planned"}`}
                    title={entry ? `${entry.mealName}${entry.ingredients.length ? ` — ${entry.ingredients.join(", ")}` : ""}` : undefined}
                    onClick={() => startEditing(date, slot)}
                    className={`rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm truncate ${
                      entry ? "bg-olive-100 text-olive-800" : "bg-olive-50 text-olive-600 italic"
                    }`}
                  >
                    {entry
                      ? entry.ingredients.length
                        ? `${entry.mealName} (${entry.ingredients.length})`
                        : entry.mealName
                      : `+ ${SLOT_LABELS[slot]}`}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className="bg-olive-50 rounded-lg p-4 space-y-2 mb-4">
          <p className="text-sm font-semibold text-olive-700">
            {SLOT_LABELS[editing.slot]} — {formatDayLabel(editing.date)}
          </p>
          <input
            type="text"
            aria-label="Meal name"
            placeholder="Meal name (e.g. Tacos)"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
            className="w-full rounded-lg border border-olive-500 px-3 py-2"
          />
          <input
            type="text"
            aria-label="Ingredients, comma separated"
            placeholder="Ingredients, comma separated (e.g. Tortillas, Ground beef, Cheddar)"
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            className="w-full rounded-lg border border-olive-500 px-3 py-2"
          />

          {/* Swapping a dinner meant deleting it and typing another, which
              is the moment a Sunday plan stops being worth making. Every
              option is a meal this family has cooked, with the reason it
              is being offered, and tapping one brings back the ingredients
              it needed last time — retyping those is the actual work. */}
          {editing.slot === "dinner" && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-olive-600">Or one of these</p>
              <div className="flex flex-wrap gap-2">
                {swapOptions({
                  entries: allEntries,
                  date: editing.date,
                  currentName: mealName,
                  today,
                }).map((option) => (
                  <button
                    key={option.mealName}
                    type="button"
                    title={option.because}
                    onClick={() => {
                      setMealName(option.mealName);
                      setIngredientsText(ingredientsFor(allEntries, option.mealName).join(", "));
                    }}
                    className="rounded-lg bg-olive-100 px-3 py-2 text-left text-sm text-olive-800 hover:bg-olive-200"
                  >
                    {option.mealName}
                    {/* The working, not just the answer. A suggestion you
                        can check beats a confident one you can't. */}
                    <span className="block text-xs font-normal text-olive-600">{option.because}</span>
                  </button>
                ))}
                {STANDING_OPTIONS.map((option) => (
                  <button
                    key={option.mealName}
                    type="button"
                    onClick={() => {
                      setMealName(option.mealName);
                      setIngredientsText("");
                    }}
                    className="rounded-lg border border-olive-300 px-3 py-2 text-left text-sm text-olive-800 hover:bg-olive-50"
                  >
                    {option.mealName}
                    <span className="block text-xs font-normal text-olive-600">{option.because}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-olive-600 text-white px-4 py-2 hover:bg-olive-700">
              Save
            </button>
            {entryFor(editing.date, editing.slot) && (
              <button type="button" onClick={handleRemove} className="text-sm text-olive-600 underline underline-offset-2">
                Clear this meal
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm text-olive-600 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <button type="button" onClick={handleGenerate} className="rounded-lg bg-olive-600 text-white px-4 py-2 hover:bg-olive-700">
        {weekOffset === 0 ? "Generate grocery list for this week" : "Generate grocery list for this view"}
      </button>
      {generateResult && <p className="text-sm text-clay-700 mt-2">{generateResult}</p>}
    </div>
  );
}
