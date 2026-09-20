import { useState, type FormEvent } from "react";
import type { StatedPreference, StatedPreferenceCategory } from "../types";

interface FamilyFavoritesProps {
  preferences: StatedPreference[];
  onAdd: (input: { memberId: string; category: StatedPreferenceCategory; statement: string }) => Promise<void>;
  onRemove: (preference: StatedPreference) => void;
}

const CATEGORY_LABELS: Record<StatedPreferenceCategory, string> = {
  meal: "Meal",
  activity: "Activity",
  chore: "Chore",
};

// Shows only what a family member has explicitly told the app — never
// anything inferred or passively tracked. See backend/models/schema.md.
export default function FamilyFavorites({ preferences, onAdd, onRemove }: FamilyFavoritesProps) {
  const [memberId, setMemberId] = useState("");
  const [category, setCategory] = useState<StatedPreferenceCategory>("meal");
  const [statement, setStatement] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!memberId.trim() || !statement.trim()) return;
    try {
      await onAdd({ memberId: memberId.trim(), category, statement: statement.trim() });
      setMemberId("");
      setStatement("");
    } catch {
      // Leave the form filled in on failure so nothing has to be retyped.
    }
  }

  return (
    <div>
      <p className="text-sm text-olive-600 mb-3">
        Only what a family member has actually told us — nothing tracked or guessed.
      </p>

      {preferences.length === 0 ? (
        <p className="text-olive-700 italic mb-4">Nothing remembered yet.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {preferences.map((preference) => (
            <li
              key={preference.preferenceId}
              className="flex items-center justify-between bg-olive-50 rounded-lg px-4 py-2"
            >
              <span>
                <span className="text-xs uppercase tracking-wide text-olive-700 font-semibold mr-2">
                  {CATEGORY_LABELS[preference.category]}
                </span>
                <span className="font-medium">{preference.memberId}</span>: {preference.statement}
              </span>
              <button
                type="button"
                aria-label={`Forget "${preference.statement}"`}
                onClick={() => onRemove(preference)}
                className="text-sm text-olive-600 underline underline-offset-2"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Who said it?"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="flex-1 min-w-[8rem] rounded-lg border border-olive-300 px-3 py-2"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as StatedPreferenceCategory)}
          className="rounded-lg border border-olive-300 px-3 py-2"
        >
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="What did they say? (e.g. prefers penne over spaghetti)"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          className="flex-[2] min-w-[12rem] rounded-lg border border-olive-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-olive-500 text-white px-4 py-2 hover:bg-olive-600">
          Remember this
        </button>
      </form>
    </div>
  );
}
