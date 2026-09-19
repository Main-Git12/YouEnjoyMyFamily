import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Task, ScheduleEntry } from "../types";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import Calendar from "./Calendar";

// Placeholder until family selection / auth is wired up.
const DEMO_FAMILY_ID = "fam_demo";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listTasks(DEMO_FAMILY_ID), api.listSchedules(DEMO_FAMILY_ID)])
      .then(([taskItems, scheduleItems]) => {
        setTasks(taskItems);
        setSchedule(scheduleItems);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <main className="min-h-screen bg-olive-100 p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      <header className="md:col-span-2">
        <h1 className="font-display text-3xl text-olive-900">YouEnjoyMyFamily</h1>
        <p className="text-olive-700">Today at a glance</p>
      </header>

      {error && (
        <p className="md:col-span-2 text-clay-700 bg-clay-100 rounded-card px-4 py-3">
          Couldn&apos;t reach the backend: {error}
        </p>
      )}

      <FamilyCard title="Today's tasks">
        <TaskList tasks={tasks} />
      </FamilyCard>

      <FamilyCard title="Today's schedule" accent>
        <Calendar entries={schedule} />
      </FamilyCard>
    </main>
  );
}
