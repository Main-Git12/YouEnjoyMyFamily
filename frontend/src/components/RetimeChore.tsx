import type { DueWindow, Task } from "../types";
import { DUE_WINDOW_LABELS, DUE_WINDOW_ORDER } from "../lib/choreCatalog";
import { useDismissableOverlay } from "../lib/useDismissableOverlay";

interface RetimeChoreProps {
  task: Task;
  onChoose: (dueWindow: DueWindow) => Promise<void>;
  onDismiss: () => void;
}

/**
 * Where a chore that keeps getting left should live instead.
 *
 * The app opens this but never answers it. Which part of the day a chore
 * belongs in depends on how this family's evening actually runs — whether
 * bath is before dinner, who gets home when — and none of that is
 * knowable from completion records. Proposing the question is useful;
 * answering it would be a guess wearing a confident face.
 */
export default function RetimeChore({ task, onChoose, onDismiss }: RetimeChoreProps) {
  const containerRef = useDismissableOverlay<HTMLDivElement>(onDismiss);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`When should ${task.title} happen?`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-olive-900/70 p-4"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="bg-white rounded-card shadow-[var(--shadow-card)] px-6 sm:px-10 py-8 max-w-md w-full animate-pop-in"
      >
        <p className="font-display text-2xl text-olive-700">When should {task.title} happen?</p>
        <p className="text-olive-700 mt-2">
          It&apos;s set for {DUE_WINDOW_LABELS[task.dueWindow].toLowerCase()} at the moment. You know the evening
          better than the screen does.
        </p>

        <div className="mt-5 space-y-2">
          {DUE_WINDOW_ORDER.map((window) => (
            <button
              key={window}
              type="button"
              disabled={window === task.dueWindow}
              onClick={() => void onChoose(window)}
              className="w-full rounded-lg border border-olive-500 px-4 py-3 text-left hover:bg-olive-50 disabled:bg-olive-100 disabled:text-olive-600"
            >
              {DUE_WINDOW_LABELS[window]}
              {window === task.dueWindow && <span className="text-sm"> — where it is now</span>}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 text-sm text-olive-700 underline underline-offset-2 py-1"
        >
          Leave it where it is
        </button>
      </div>
    </div>
  );
}
