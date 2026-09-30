import { useState, type ReactNode } from "react";

interface KitchenProps {
  /** The week's meals, plus the draft-a-week offer. */
  mealPlan: ReactNode;
  /** The shopping list built from it. */
  groceries: ReactNode;
  /** Lines still to buy, shown on the tab so the count is visible either way. */
  outstandingCount: number;
}

/**
 * The meal plan and the shopping list, behind one pair of tabs.
 *
 * They were two peer cards where one is literally the other's input:
 * planning the week is what fills the list. Side by side they cost two
 * cells of a kitchen display to show one workflow, and the meal plan is
 * the tallest panel on the screen by some way.
 *
 * Nothing about either is changed — both render exactly what they did.
 */
export default function Kitchen({ mealPlan, groceries, outstandingCount }: KitchenProps) {
  const [tab, setTab] = useState<"meals" | "list">("meals");

  const tabClass = (which: typeof tab) =>
    `rounded-full px-4 py-2 font-body ${
      tab === which ? "bg-olive-600 text-white" : "bg-olive-50 text-olive-700 border border-olive-100"
    }`;

  return (
    <div>
      <div role="tablist" aria-label="Kitchen" className="flex gap-2 mb-4">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "meals"}
          onClick={() => setTab("meals")}
          className={tabClass("meals")}
        >
          This week
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          onClick={() => setTab("list")}
          className={tabClass("list")}
        >
          Shopping list
          {outstandingCount > 0 && (
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-sm ${
                tab === "list" ? "bg-white text-olive-700" : "bg-olive-600 text-white"
              }`}
            >
              {outstandingCount}
            </span>
          )}
        </button>
      </div>
      {tab === "meals" ? mealPlan : groceries}
    </div>
  );
}
