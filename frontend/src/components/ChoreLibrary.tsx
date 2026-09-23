import { useState, type FormEvent } from "react";
import type { DueWindow } from "../types";
import { CHORE_CATALOG, DUE_WINDOW_LABELS, DUE_WINDOW_ORDER, choresByWindow } from "../lib/choreCatalog";

export interface NewChore {
  title: string;
  gemValue: number;
  dueWindow: DueWindow;
  assignedTo: string | null;
}

interface ChoreLibraryProps {
  onAdd: (chore: NewChore) => Promise<void>;
}

/**
 * The chore library: the chores this family already runs on, one tap each,
 * already priced the way the children are used to. Nothing here is fixed —
 * a chore typed into the bottom row is worth exactly as much as one from
 * the list, and either can be re-priced later.
 */
export default function ChoreLibrary({ onAdd }: ChoreLibraryProps) {
  const [open, setOpen] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customGems, setCustomGems] = useState("5");
  const [customWindow, setCustomWindow] = useState<DueWindow>("anytime");

  async function add(chore: NewChore) {
    setAdding(chore.title);
    try {
      await onAdd(chore);
    } finally {
      setAdding(null);
    }
  }

  async function handleCustomSubmit(event: FormEvent) {
    event.preventDefault();
    const gems = Number(customGems);
    if (!customTitle.trim() || !Number.isFinite(gems) || gems < 0) return;
    await add({
      title: customTitle.trim(),
      gemValue: Math.floor(gems),
      dueWindow: customWindow,
      assignedTo: assignedTo.trim() || null,
    });
    setCustomTitle("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-lg border-2 border-dashed border-olive-500 text-olive-700 px-4 py-3 hover:bg-olive-50"
      >
        + Add a chore ({CHORE_CATALOG.length} in the library)
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-card bg-olive-50 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <label className="flex-1 min-w-0">
          <span className="block text-xs uppercase tracking-wide text-olive-700 mb-1">Who's it for?</span>
          <input
            type="text"
            placeholder="Leave blank for anyone"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className="w-full rounded-lg border border-olive-500 px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="self-end text-sm text-olive-700 underline underline-offset-2 py-2 shrink-0"
        >
          Done
        </button>
      </div>

      {choresByWindow().map(({ window, chores }) => (
        <div key={window} className="mb-3">
          <p className="text-xs uppercase tracking-wide text-olive-700 mb-1">{DUE_WINDOW_LABELS[window]}</p>
          <div className="flex flex-wrap gap-2">
            {chores.map((chore) => (
              <button
                key={chore.title}
                type="button"
                disabled={adding !== null}
                onClick={() =>
                  void add({
                    title: chore.title,
                    gemValue: chore.gemValue,
                    dueWindow: chore.window,
                    assignedTo: assignedTo.trim() || null,
                  })
                }
                className="rounded-full bg-white border border-olive-500 px-3 py-2 text-left hover:bg-olive-100 disabled:opacity-60"
              >
                {chore.title}
                <span className="ml-2 font-display text-sm bg-gem-amber text-olive-900 rounded-full px-2 py-0.5">
                  {chore.gemValue}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <form onSubmit={handleCustomSubmit} className="flex flex-wrap gap-2 pt-2 border-t border-olive-200">
        <input
          type="text"
          aria-label="New chore"
          placeholder="Something else…"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          className="flex-[2] min-w-[10rem] rounded-lg border border-olive-500 px-3 py-2"
        />
        <input
          type="number"
          min={0}
          aria-label="Gems it pays"
          value={customGems}
          onChange={(e) => setCustomGems(e.target.value)}
          className="w-20 rounded-lg border border-olive-500 px-3 py-2"
        />
        <select
          aria-label="When it's due"
          value={customWindow}
          onChange={(e) => setCustomWindow(e.target.value as DueWindow)}
          className="rounded-lg border border-olive-500 px-3 py-2 bg-white"
        >
          {DUE_WINDOW_ORDER.map((window) => (
            <option key={window} value={window}>
              {DUE_WINDOW_LABELS[window]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding !== null}
          className="rounded-lg bg-olive-600 text-white px-4 py-2 hover:bg-olive-700 disabled:bg-olive-300"
        >
          Add
        </button>
      </form>
    </div>
  );
}
