import type { Task } from "../types";
import { DUE_WINDOW_LABELS } from "../lib/choreCatalog";
import { isPastWindow } from "../lib/gemThreats";

interface TaskListProps {
  tasks: Task[];
  onComplete?: (task: Task) => void;
}

export default function TaskList({ tasks, onComplete }: TaskListProps) {
  if (!tasks.length) {
    return <p className="text-olive-700 italic">No tasks yet — nice and calm.</p>;
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const done = task.status === "done";
        // "Slipped" is just the clock against the window the family chose
        // for this chore — nothing about the child is being watched.
        const slipped = !done && isPastWindow(task.dueWindow);

        return (
          <li
            key={task.taskId}
            className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
              slipped ? "bg-clay-100" : "bg-olive-50"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {onComplete && !done && (
                <button
                  type="button"
                  aria-label={`Mark "${task.title}" done`}
                  onClick={() => onComplete(task)}
                  className="h-7 w-7 shrink-0 rounded-full border-2 border-olive-600 hover:bg-olive-200"
                />
              )}
              <span className="min-w-0">
                <span className={`text-lg ${done ? "line-through text-olive-500" : ""}`}>{task.title}</span>
                <span className="block text-xs uppercase tracking-wide text-olive-600">
                  {task.assignedTo ? `${task.assignedTo} · ` : ""}
                  {DUE_WINDOW_LABELS[task.dueWindow]}
                  {task.dueDate ? (
                    <>
                      {" · "}
                      <span>{task.dueDate}</span>
                    </>
                  ) : null}
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
      })}
    </ul>
  );
}
