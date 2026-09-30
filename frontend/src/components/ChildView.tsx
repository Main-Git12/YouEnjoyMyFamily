import type { ChildView as ChildViewData } from "../lib/childView";
import { useDismissableOverlay } from "../lib/useDismissableOverlay";

interface ChildViewProps {
  view: ChildViewData;
  onDismiss: () => void;
}

/**
 * One child's own screen.
 *
 * Deliberately not a report card. It answers the three things a child
 * actually asks — what have I got left, how many gems is that worth, and
 * how close am I to the thing I'm saving for — and then stops.
 *
 * There is no sibling anywhere on it, by construction rather than by
 * styling: `buildChildView` never puts another child's rows in the data
 * this renders. A wall-mounted leaderboard is how a seven-year-old learns
 * that their brother is better at being good, and this app doesn't do
 * that.
 *
 * Read-only on purpose. Ticking a chore happens on the main list where
 * the gems and the celebration live; a second place to do it would be a
 * second thing to keep in step.
 */
export default function ChildView({ view, onDismiss }: ChildViewProps) {
  const containerRef = useDismissableOverlay<HTMLDivElement>(onDismiss);
  const goal = view.progress.goal;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${view.memberId}'s gems and chores`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-olive-900/70 p-4"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="bg-white rounded-card shadow-[var(--shadow-card)] px-6 sm:px-10 py-7 max-w-lg w-full max-h-full overflow-y-auto animate-pop-in"
      >
        <p className="font-display text-3xl sm:text-4xl text-olive-800">{view.memberId}</p>
        <p className="font-display text-5xl sm:text-6xl text-olive-600 mt-1">{view.balance}</p>
        <p className="font-body text-olive-700">gems saved up</p>

        {goal && (
          <div className="mt-5">
            <div className="flex justify-between items-baseline gap-3">
              <p className="font-body text-olive-700 truncate">{goal.title}</p>
              <p className="font-body text-olive-600 text-sm shrink-0">
                {goal.gemsSoFar} / {goal.gemCost}
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={goal.gemsSoFar}
              aria-valuemin={0}
              aria-valuemax={goal.gemCost}
              aria-label={`Saving for ${goal.title}`}
              className="mt-1 h-4 rounded-full bg-olive-50 border border-olive-100 overflow-hidden"
            >
              <div className="h-full bg-olive-600" style={{ width: `${Math.round(goal.fraction * 100)}%` }} />
            </div>
            {goal.fraction >= 1 && (
              <p className="font-body text-olive-700 mt-1">Enough saved — it can be claimed on the prize board.</p>
            )}
          </div>
        )}

        {/* A streak is the one place this app names a child, because it is
            praise they earned by doing the thing. */}
        {view.bestStreak && (
          <p className="font-display text-xl text-clay-700 mt-5">
            {view.bestStreak.days} days running on {view.bestStreak.title}
          </p>
        )}

        <div className="mt-5">
          <p className="font-body text-olive-700">
            {view.choresLeft === 0
              ? "Everything's done today."
              : `${view.choresLeft} left today · ${view.gemsStillToEarnToday} gems still to earn`}
          </p>
          <ul className="mt-2 space-y-1">
            {view.chores.map((chore) => (
              <li key={chore.taskId} className="font-body flex items-center justify-between gap-3">
                <span className={chore.done ? "text-olive-600 line-through" : "text-olive-800"}>
                  {/* Decorative: a screen reader announcing "circle" before
                      every chore is noise, and the done state is already
                      carried by the gem figure beside it. */}
                  <span aria-hidden="true">{chore.done ? "✓ " : "○ "}</span>
                  {chore.title}
                </span>
                <span className="shrink-0 text-olive-600 text-sm">
                  {chore.done ? `+${chore.gemValue}` : `${chore.gemValue} gems`}
                </span>
              </li>
            ))}
          </ul>
          {view.chores.length === 0 && (
            <p className="font-body text-olive-600 italic mt-2">No chores of their own today.</p>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 font-display bg-olive-600 text-white rounded-full px-8 py-3"
        >
          Close
        </button>
      </div>
    </div>
  );
}
