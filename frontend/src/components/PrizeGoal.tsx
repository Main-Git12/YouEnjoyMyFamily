import { useState, type FormEvent } from "react";
import type { RewardGoal } from "../types";
import King from "./mascots/King";

interface PrizeGoalProps {
  /** One row per child who has gems or a goal, with their own running total. */
  goals: RewardGoal[];
  gemsByChild: Record<string, number>;
  onSetGoal: (memberId: string, goal: { title: string; gemCost: number }) => Promise<void>;
  onClaim: (memberId: string) => Promise<void>;
}

/**
 * The big prize board — what each child is actually saving for, and how
 * close they are. Deliberately the loudest thing on the card: a number on
 * its own means very little to a six-year-old, but "eleven more gems until
 * the LEGO set" means everything.
 */
export default function PrizeGoal({ goals, gemsByChild, onSetGoal, onClaim }: PrizeGoalProps) {
  const [memberId, setMemberId] = useState("");
  const [title, setTitle] = useState("");
  const [gemCost, setGemCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  async function handleClaim(who: string) {
    setClaiming(who);
    try {
      await onClaim(who);
    } finally {
      setClaiming(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const cost = Number(gemCost);
    if (!memberId.trim() || !title.trim() || !Number.isFinite(cost) || cost <= 0) return;
    setSaving(true);
    try {
      await onSetGoal(memberId.trim(), { title: title.trim(), gemCost: Math.floor(cost) });
      setMemberId("");
      setTitle("");
      setGemCost("");
    } catch {
      // Leave the form filled in so nothing has to be retyped.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-olive-600 mb-3">What everyone's saving up for.</p>

      {goals.length === 0 ? (
        <p className="text-olive-700 italic mb-4">No prizes set yet — pick one together below.</p>
      ) : (
        <ul className="space-y-4 mb-5">
          {goals.map((goal) => {
            const earned = gemsByChild[goal.memberId] ?? 0;
            const remaining = Math.max(0, goal.gemCost - earned);
            const percent = Math.min(100, Math.round((earned / goal.gemCost) * 100));
            const reached = remaining === 0;

            return (
              <li key={goal.memberId} className="bg-olive-50 rounded-card px-4 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-display text-lg text-olive-700 truncate">{goal.memberId}</p>
                    <p className="font-display text-2xl text-clay-700 truncate">{goal.title}</p>
                  </div>
                  {reached ? (
                    <King size={64} className="animate-king-nod shrink-0" />
                  ) : (
                    <p className="font-display text-xl text-olive-700 shrink-0">
                      {earned}
                      <span className="text-olive-600 text-base"> / {goal.gemCost}</span>
                    </p>
                  )}
                </div>

                <div
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${goal.memberId}'s progress toward ${goal.title}`}
                  className="h-4 w-full rounded-full bg-olive-200 overflow-hidden mt-3"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ${reached ? "bg-gem-amber" : "bg-olive-600"}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {reached ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="font-semibold text-clay-700">Earned it!</p>
                    <button
                      type="button"
                      disabled={claiming !== null}
                      onClick={() => void handleClaim(goal.memberId)}
                      className="font-display bg-clay-700 text-white rounded-full px-6 py-3 shadow-[var(--shadow-card)] hover:bg-clay-900 disabled:bg-olive-300"
                    >
                      {claiming === goal.memberId ? "Claiming…" : `Claim ${goal.title}`}
                    </button>
                    <p className="text-sm text-olive-700 w-full">
                      Claiming spends {goal.gemCost} gems and clears the board for the next prize.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 font-semibold text-olive-700">
                    {remaining} more gem{remaining === 1 ? "" : "s"} to go!
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <input
          type="text"
          aria-label="Whose prize"
          placeholder="Who's it for?"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="flex-1 min-w-[9rem] rounded-lg border border-olive-500 px-3 py-2"
        />
        <input
          type="text"
          aria-label="The prize"
          placeholder="The big prize"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-[2] min-w-[11rem] rounded-lg border border-olive-500 px-3 py-2"
        />
        <input
          type="number"
          min={1}
          aria-label="Gems needed"
          placeholder="Gems"
          value={gemCost}
          onChange={(e) => setGemCost(e.target.value)}
          className="w-24 rounded-lg border border-olive-500 px-3 py-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-olive-600 text-white px-4 py-2 hover:bg-olive-700 disabled:bg-olive-300"
        >
          {saving ? "Saving…" : "Set prize"}
        </button>
      </form>
    </div>
  );
}
