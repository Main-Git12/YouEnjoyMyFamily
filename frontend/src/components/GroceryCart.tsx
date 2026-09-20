import { useState, type FormEvent } from "react";
import type { CartItem } from "../types";

interface GroceryCartProps {
  items: CartItem[];
  onAdd: (description: string) => Promise<void>;
  onMarkUnavailable: (item: CartItem) => Promise<string | null>;
  onConfirmSubstitute: (item: CartItem, substituteDescription: string) => Promise<void>;
  onCheckout: () => Promise<string>;
}

const STATUS_LABELS: Record<CartItem["status"], string> = {
  pending: "",
  unavailable: "Unavailable",
  substituted: "Substituted",
};

export default function GroceryCart({ items, onAdd, onMarkUnavailable, onConfirmSubstitute, onCheckout }: GroceryCartProps) {
  const [description, setDescription] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [substituteDrafts, setSubstituteDrafts] = useState<Record<string, string>>({});
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    await onAdd(description.trim());
    setDescription("");
  }

  async function handleMarkUnavailable(item: CartItem) {
    const suggestion = await onMarkUnavailable(item);
    if (suggestion) {
      setSuggestions((prev) => ({ ...prev, [item.itemId]: suggestion }));
      setSubstituteDrafts((prev) => ({ ...prev, [item.itemId]: suggestion }));
    }
  }

  async function handleConfirmSubstitute(item: CartItem) {
    const substitute = substituteDrafts[item.itemId]?.trim();
    if (!substitute) return;
    await onConfirmSubstitute(item, substitute);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[item.itemId];
      return next;
    });
  }

  async function handleCheckout() {
    setError(null);
    try {
      const url = await onCheckout();
      setCheckoutUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <p className="text-sm text-olive-600 mb-3">Ships to Instacart for checkout — the family picks the actual store there.</p>

      {items.length === 0 ? (
        <p className="text-olive-700 italic mb-4">Nothing in the cart yet.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {items.map((item) => (
            <li key={item.itemId} className="bg-olive-50 rounded-lg px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {item.status === "substituted" && item.substituteDescription ? item.substituteDescription : item.description}
                  {item.quantity > 1 && <span className="text-olive-600"> ×{item.quantity}</span>}
                  {item.source === "meal_plan" && (
                    <span className="text-xs uppercase tracking-wide text-olive-500 ml-2">from meal plan</span>
                  )}
                  {STATUS_LABELS[item.status] && (
                    <span className="text-xs uppercase tracking-wide text-clay-700 ml-2">{STATUS_LABELS[item.status]}</span>
                  )}
                </span>
                {item.status === "pending" && (
                  <button
                    type="button"
                    aria-label={`Mark "${item.description}" unavailable`}
                    onClick={() => handleMarkUnavailable(item)}
                    className="text-sm text-olive-600 underline underline-offset-2 shrink-0"
                  >
                    Can't find it
                  </button>
                )}
              </div>
              {item.status === "unavailable" && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="What did you pick instead?"
                    value={substituteDrafts[item.itemId] ?? ""}
                    onChange={(e) => setSubstituteDrafts((prev) => ({ ...prev, [item.itemId]: e.target.value }))}
                    className="flex-1 rounded-lg border border-olive-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleConfirmSubstitute(item)}
                    className="text-sm rounded-lg bg-olive-500 text-white px-3 py-1.5 hover:bg-olive-600"
                  >
                    Confirm
                  </button>
                </div>
              )}
              {suggestions[item.itemId] && (
                <p className="text-xs text-clay-700 italic mt-1">Last time: {suggestions[item.itemId]}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Add an item"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="flex-1 rounded-lg border border-olive-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-olive-500 text-white px-4 py-2 hover:bg-olive-600">
          Add
        </button>
      </form>

      <button type="button" onClick={handleCheckout} className="rounded-lg bg-clay-500 text-white px-4 py-2 hover:bg-clay-700">
        Checkout with Instacart
      </button>
      {error && <p className="text-sm text-clay-700 mt-2">{error}</p>}
      {checkoutUrl && (
        <p className="text-sm mt-2">
          <a href={checkoutUrl} target="_blank" rel="noreferrer" className="text-olive-600 underline underline-offset-2">
            Continue on Instacart
          </a>
        </p>
      )}
    </div>
  );
}
