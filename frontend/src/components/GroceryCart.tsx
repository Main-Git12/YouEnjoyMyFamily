import { useState } from "react";
import { api } from "../lib/api";
import type { CartItem, GroceryStore, SubstituteSuggestion } from "../types";

const STORE_LABEL: Record<GroceryStore, string> = {
  giant_eagle: "Giant Eagle",
  aldi: "Aldi",
};

interface GroceryCartProps {
  familyId: string;
  items: CartItem[];
  onItemsChange: (items: CartItem[]) => void;
}

export default function GroceryCart({ familyId, items, onItemsChange }: GroceryCartProps) {
  const [suggestionsByItem, setSuggestionsByItem] = useState<Record<string, SubstituteSuggestion[]>>({});
  const [description, setDescription] = useState("");
  const [store, setStore] = useState<GroceryStore>("giant_eagle");
  const [error, setError] = useState<string | null>(null);

  function replaceItem(updated: CartItem) {
    onItemsChange(items.map((item) => (item.itemId === updated.itemId ? updated : item)));
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    try {
      const created = await api.addCartItem(familyId, { store, description: description.trim() });
      onItemsChange([...items, created]);
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMarkUnavailable(itemId: string) {
    try {
      const { item, suggestions } = await api.markCartItemUnavailable(familyId, itemId);
      replaceItem(item);
      setSuggestionsByItem((prev) => ({ ...prev, [itemId]: suggestions }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubstitute(itemId: string, newDescription: string) {
    try {
      const { item } = await api.substituteCartItem(familyId, itemId, newDescription);
      replaceItem(item);
      setSuggestionsByItem((prev) => {
        const { [itemId]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-clay-700 bg-clay-100 rounded-lg px-3 py-2 text-sm">{error}</p>}

      {!items.length && <p className="text-olive-700 italic">Cart's empty — nice and calm.</p>}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.itemId} className="bg-olive-50 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className={`text-lg ${item.status === "unavailable" ? "line-through text-olive-500" : ""}`}>
                  {item.description}
                </span>
                {item.quantity > 1 && <span className="text-olive-600 text-sm ml-2">×{item.quantity}</span>}
              </div>
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-clay-700 bg-clay-100 rounded-full px-2 py-1">
                {STORE_LABEL[item.store]}
              </span>
            </div>

            {item.status === "needed" && (
              <button
                type="button"
                onClick={() => handleMarkUnavailable(item.itemId)}
                className="mt-2 text-sm text-olive-700 underline decoration-dotted hover:text-olive-900"
              >
                Out of stock?
              </button>
            )}

            {item.status === "unavailable" && (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-clay-700">Not available — swap it for something else?</p>
                {(suggestionsByItem[item.itemId] ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {suggestionsByItem[item.itemId]?.map((suggestion) => (
                      <button
                        key={suggestion.description}
                        type="button"
                        onClick={() => handleSubstitute(item.itemId, suggestion.description)}
                        className="text-sm bg-sand-100 hover:bg-sand-50 rounded-full px-3 py-1 border border-clay-300"
                      >
                        {suggestion.description}
                        <span className="text-olive-600"> · picked {suggestion.timesChosen}×</span>
                      </button>
                    ))}
                  </div>
                )}
                <SubstituteForm onSubmit={(value) => handleSubstitute(item.itemId, value)} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="flex gap-2">
        <select
          value={store}
          onChange={(event) => setStore(event.target.value as GroceryStore)}
          className="rounded-lg border border-olive-300 bg-sand-50 px-2 text-sm"
        >
          <option value="giant_eagle">Giant Eagle</option>
          <option value="aldi">Aldi</option>
        </select>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add an item…"
          className="flex-1 min-w-0 rounded-lg border border-olive-300 bg-sand-50 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-olive-500 text-sand-50 px-4 py-1.5 text-sm font-semibold hover:bg-olive-600"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function SubstituteForm({ onSubmit }: { onSubmit: (description: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onSubmit(value.trim());
        setValue("");
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Or type a substitute…"
        className="flex-1 min-w-0 rounded-lg border border-clay-300 bg-sand-50 px-3 py-1 text-sm"
      />
      <button type="submit" className="rounded-lg bg-clay-500 text-sand-50 px-3 py-1 text-sm font-semibold hover:bg-clay-700">
        Swap
      </button>
    </form>
  );
}
