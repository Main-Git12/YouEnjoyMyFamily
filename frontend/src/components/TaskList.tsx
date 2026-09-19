import type { Task } from "../types";

interface TaskListProps {
  tasks: Task[];
}

export default function TaskList({ tasks }: TaskListProps) {
  if (!tasks.length) {
    return <p className="text-olive-700 italic">No tasks yet — nice and calm.</p>;
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li key={task.taskId} className="flex items-center justify-between bg-olive-50 rounded-lg px-4 py-3">
          <span className="text-lg">{task.title}</span>
          {task.dueDate && <span className="text-sm text-olive-600">{task.dueDate}</span>}
        </li>
      ))}
    </ul>
  );
}
