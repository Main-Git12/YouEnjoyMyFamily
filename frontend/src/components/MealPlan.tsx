import { useMemo, useState, type FormEvent } from "react";
import type { MealPlanEntry, MealSlot } from "../types";

interface MealPlanProps {
  entries: MealPlanEntry[];
  onSave: (date: string, slot: MealSlot, input: { mealName: string; ingredients: string[] }) => Promise<void>;
  onRemove: (date: string, slot: MealSlot) => Promise<void>;
  onGenerateGroceryList: () => Promise<{ added: number; skipped: number }>;
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];
const SLOT_LABELS: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

export function nextSevenDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Only what a family member has typed in for their week — no AI-invented
// meals or ingredients. generateGroceryListFromMealPlan (backend) is the
// only thing that ever turns these ingredients into cart items.
export default function MealPlan({ entries, onSave, onRemove, onGenerateGroceryList }: MealPlanProps) {
  const days = useMemo(() => nextSevenDays(), []);
  const [editing, setEditing] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [mealName, setMealName] = useState("");
  const [ingredientsText, setIngredientsText] = useState("");
  const [generateResult, setGenerateResult] = useState<string | null>(null);

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
    await onSave(editing.date, editing.slot, { mealName: mealName.trim(), ingredients });
    setEditing(null);
  }

  async function handleRemove() {
    if (!editing) return;
    await onRemove(editing.date, editing.slot);
    setEditing(null);
  }

  async function handleGenerate() {
    const result = await onGenerateGroceryList();
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

      <div className="space-y-2 mb-4">
        {days.map((date) => (
          <div key={date} className="flex items-center gap-2 flex-wrap">
            <span className="w-24 shrink-0 text-sm font-semibold text-olive-700">{formatDayLabel(date)}</span>
            {SLOTS.map((slot) => {
              const entry = entryFor(date, slot);
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => startEditing(date, slot)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    entry ? "bg-olive-100 text-olive-800" : "bg-olive-50 text-olive-500 italic"
                  }`}
                >
                  {entry ? entry.mealName : `+ ${SLOT_LABELS[slot]}`}
                </button>
              );
            })}
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
            placeholder="Meal name (e.g. Tacos)"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
            className="w-full rounded-lg border border-olive-300 px-3 py-2"
          />
          <input
            type="text"
            placeholder="Ingredients, comma separated (e.g. Tortillas, Ground beef, Cheddar)"
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            className="w-full rounded-lg border border-olive-300 px-3 py-2"
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-olive-500 text-white px-4 py-2 hover:bg-olive-600">
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

      <button type="button" onClick={handleGenerate} className="rounded-lg bg-olive-500 text-white px-4 py-2 hover:bg-olive-600">
        Generate grocery list for this week
      </button>
      {generateResult && <p className="text-sm text-clay-700 mt-2">{generateResult}</p>}
    </div>
  );
}
