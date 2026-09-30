import type { Task } from "../types";
import { DUE_WINDOW_LABELS } from "../lib/choreCatalog";
import { currentWindow, isWindowPast, windowOrderFor } from "../lib/timeOfDay";

interface TaskListProps {
  tasks: Task[];
  onComplete?: (task: Task) => void;
  /** Injectable so tests can stand at a particular moment of the day. */
  now?: Date;
}

/**
 * The day, stacked the way it's actually running.
 *
 * A flat list of twenty chores is the same wall of text at breakfast and at
 * bathtime. Grouped by part of the day and reordered around the clock, the
 * thing you need is at the top whenever you walk past: morning chores at
 * seven, bedtime at eight, and what's already gone pushed quietly to the
 * bottom rather than nagging from the middle.
 */
export default function TaskList({ tasks, onComplete, now = new Date() }: TaskListProps) {
  if (!tasks.length) {
    return <p className="text-olive-700 italic">Nothing on the list — nice and calm.</p>;
  }

  const here = currentWindow(now);
  const groups = windowOrderFor(now)
    .map((window) => ({ window, tasks: tasks.filter((task) => task.dueWindow === window) }))
    .filter((group) => group.tasks.length > 0);

  return (
    <div className="space-y-5">
      {groups.map(({ window, tasks: group }) => {
        const past = isWindowPast(window, now);
        const isNow = window === here;
        const left = group.filter((task) => task.status !== "done").length;

        return (
          <section key={window} className={past ? "opacity-70" : ""}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3
                className={`font-display ${
                  isNow ? "text-xl text-olive-800" : "text-base uppercase tracking-wide text-olive-700"
                }`}
              >
                {DUE_WINDOW_LABELS[window]}
              </h3>
              {isNow && (
                <span className="text-xs uppercase tracking-wide bg-olive-600 text-white rounded-full px-2 py-0.5">
                  now
                </span>
              )}
              <span className="text-sm text-olive-600">
                {left === 0 ? "all done" : `${left} to go`}
              </span>
            </div>

            <ul className="space-y-2">
              {group.map((task) => (
                <TaskRow key={task.taskId} task={task} past={past} onComplete={onComplete} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({
  task,
  past,
  onComplete,
}: {
  task: Task;
  past: boolean;
  onComplete?: (task: Task) => void;
}) {
  const done = task.status === "done";
  // "Slipped" is just the clock against the window the family chose for
  // this chore — nothing about the child is being watched.
  const slipped = !done && past;

  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-lg px-3 sm:px-4 py-2 ${
        slipped ? "bg-clay-100" : "bg-olive-50"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {onComplete && !done && (
          <button
            type="button"
            aria-label={`Mark "${task.title}" done`}
            onClick={() => onComplete(task)}
            // A full 44px target, not a 28px dot with padding around it:
            // the ring a child aims at should be the thing that takes the tap.
            className="h-11 w-11 shrink-0 rounded-full border-[3px] border-olive-600 hover:bg-olive-200 active:bg-olive-300 transition-colors"
          />
        )}
        {done && (
          <span aria-hidden="true" className="h-11 w-11 shrink-0 grid place-items-center text-olive-600 text-xl">
            ✓
          </span>
        )}
        <span className="min-w-0">
          <span className={`text-lg ${done ? "line-through text-olive-600" : "text-olive-900"}`}>{task.title}</span>
          <span className="block text-xs uppercase tracking-wide text-olive-600">
            {task.assignedTo ?? "Anyone"}
            {task.dueDate ? ` · ${task.dueDate}` : ""}
            {slipped ? " · still to do" : ""}
          </span>
        </span>
      </div>
      <span
        className={`font-display shrink-0 rounded-full px-3 py-1 text-sm ${
          done ? "bg-olive-200 text-olive-700" : "bg-gem-amber text-olive-900"
        }`}
      >
        {done ? `+${task.gemsAwarded}` : task.gemValue} gems
      </span>
    </li>
  );
}


