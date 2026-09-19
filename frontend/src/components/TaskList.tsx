import type { Task } from "../types";

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
      {tasks.map((task) => (
        <li key={task.taskId} className="flex items-center justify-between bg-olive-50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            {onComplete && task.status !== "done" && (
              <button
                type="button"
                aria-label={`Mark "${task.title}" done`}
                onClick={() => onComplete(task)}
                className="h-6 w-6 shrink-0 rounded-full border-2 border-olive-500 hover:bg-olive-200"
              />
            )}
            <span className={`text-lg ${task.status === "done" ? "line-through text-olive-500" : ""}`}>{task.title}</span>
          </div>
          {task.dueDate && <span className="text-sm text-olive-600">{task.dueDate}</span>}
        </li>
      ))}
    </ul>
  );
}
