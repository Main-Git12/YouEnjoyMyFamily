import type { Task } from "../types";

interface TaskListProps {
  tasks: Task[];
  onComplete: (taskId: string) => void;
}

export default function TaskList({ tasks, onComplete }: TaskListProps) {
  if (!tasks.length) {
    return <p className="text-olive-700 italic">No tasks yet — nice and calm.</p>;
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const done = task.status === "done";
        return (
          <li key={task.taskId} className="flex items-center justify-between bg-olive-50 rounded-lg px-4 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => !done && onComplete(task.taskId)}
                disabled={done}
                aria-label={done ? `${task.title} complete` : `Mark ${task.title} complete`}
                className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                  done
                    ? "bg-olive-500 border-olive-500 text-sand-50"
                    : "border-olive-400 text-transparent hover:border-olive-600 hover:bg-olive-100"
                }`}
              >
                ✓
              </button>
              <span className={`text-lg truncate ${done ? "line-through text-olive-500" : ""}`}>{task.title}</span>
            </div>
            {task.dueDate && <span className="text-sm text-olive-600 shrink-0">{task.dueDate}</span>}
          </li>
        );
      })}
    </ul>
  );
}
