import { useState } from "react";
import type { Insight } from "../lib/insights";

interface InsightsProps {
  insights: Insight[];
  /** May return a sentence saying what happened, shown under the insight — above all when it chose not to act. */
  onAct: (insight: Insight) => Promise<string | void>;
}

const KIND_MARK: Record<Insight["kind"], string> = {
  streak: "🔥",
  slipping: "🤔",
  busy_day: "📅",
  meal_rhythm: "🍽️",
  grocery_due: "🛒",
};

/**
 * What the app has noticed.
 *
 * Every line shows its own evidence underneath it, in smaller type. That's
 * deliberate and it's the whole point: a family should be able to check the
 * app's working rather than take its word, and an observation that can't
 * say where it came from has no business on a kitchen wall.
 */
export default function Insights({ insights, onAct }: InsightsProps) {
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  async function act(insight: Insight) {
    const outcome = await onAct(insight);
    if (outcome) setOutcomes((prev) => ({ ...prev, [insight.id]: outcome }));
  }

  if (!insights.length) {
    return (
      <p className="text-olive-700 italic">
        Nothing to note yet — this fills in once there&apos;s a week or so of chores behind it.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {insights.map((insight) => (
        <li key={insight.id} className="bg-olive-50 rounded-card px-4 py-3">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="text-xl leading-7 shrink-0">
              {KIND_MARK[insight.kind]}
            </span>
            <div className="min-w-0">
              <p className="text-olive-900">{insight.title}</p>
              <p className="text-sm text-olive-600 mt-0.5">{insight.because}</p>
              {insight.action && (
                <button
                  type="button"
                  onClick={() => void act(insight)}
                  className="mt-2 text-olive-700 underline underline-offset-2 py-1"
                >
                  {insight.action.label}
                </button>
              )}
              {outcomes[insight.id] && (
                <p role="status" className="text-sm text-clay-700 mt-1">
                  {outcomes[insight.id]}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
