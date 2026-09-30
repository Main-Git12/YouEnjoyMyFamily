import { useState } from "react";
import type { HouseholdLocation as Location } from "../types";

export interface Place {
  label: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

interface HouseholdLocationProps {
  location: Location | null;
  onSearch: (query: string) => Promise<Place[]>;
  onSave: (location: Location | null) => Promise<void>;
}

/**
 * Where the house is — asked as a town, never as a coordinate.
 *
 * This exists for exactly one sentence on the morning panel: what the
 * weather will be doing at the moment the family leaves. It is worth being
 * clear on screen about that, because "the app wants your location" is a
 * sentence people have learned to be wary of, and rightly. So the copy says
 * what it is for, the coordinate is rounded to about a kilometre before it
 * is ever stored, and there is a plain way to take it back out again.
 */
export default function HouseholdLocation({ location, onSearch, onSave }: HouseholdLocationProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      setResults(await onSearch(query.trim()));
    } finally {
      setBusy(false);
    }
  }

  async function choose(place: Place) {
    setBusy(true);
    try {
      await onSave({ latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone, label: place.label });
      setResults(null);
      setQuery("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-olive-700">
        Used for one thing: what the weather is doing at the time you have to be out of the door.
        Stored to about a kilometre — a forecast, not an address.
      </p>

      {location ? (
        <div className="flex items-center gap-3 flex-wrap bg-olive-50 rounded-card px-4 py-3">
          <span className="text-olive-900">{location.label ?? "Set"}</span>
          <span className="text-sm text-olive-600">{location.timeZone}</span>
          <button
            type="button"
            onClick={() => void onSave(null)}
            disabled={busy}
            className="text-olive-700 underline underline-offset-2 py-2 min-h-[44px]"
          >
            Remove
          </button>
        </div>
      ) : (
        <p className="text-olive-700 italic">Not set — the morning says nothing about the weather until it is.</p>
      )}

      <form onSubmit={handleSearch} className="flex gap-2 flex-wrap">
        <label className="flex-1 min-w-[12rem]">
          <span className="sr-only">Town or city</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Town or city — e.g. Pickerington"
            className="w-full rounded-card border-2 border-olive-100 px-3 py-2 min-h-[44px]"
          />
        </label>
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="rounded-full px-5 py-2 min-h-[44px] font-body bg-olive-500 text-white hover:bg-olive-600 disabled:opacity-50"
        >
          {busy ? "Looking…" : "Find"}
        </button>
      </form>

      {results !== null && (
        results.length ? (
          <ul className="space-y-2">
            {results.map((place) => (
              <li key={`${place.label}:${place.latitude},${place.longitude}`}>
                <button
                  type="button"
                  onClick={() => void choose(place)}
                  disabled={busy}
                  className="w-full text-left bg-olive-50 hover:bg-olive-100 rounded-card px-4 py-3 min-h-[44px]"
                >
                  <span className="text-olive-900">{place.label}</span>
                  <span className="block text-sm text-olive-600">{place.timeZone}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-olive-700 italic">Nothing found for that name.</p>
        )
      )}
    </div>
  );
}
