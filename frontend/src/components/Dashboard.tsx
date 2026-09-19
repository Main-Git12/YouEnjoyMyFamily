import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Task, ScheduleEntry, StatedPreference, StatedPreferenceCategory } from "../types";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import Calendar from "./Calendar";
import Celebration from "./Celebration";
import FamilyFavorites from "./FamilyFavorites";

// Placeholder until family selection / auth is wired up.
const DEMO_FAMILY_ID = "fam_demo";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [preferences, setPreferences] = useState<StatedPreference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ gemsEarned: number } | null>(null);

  useEffect(() => {
    Promise.all([api.listTasks(DEMO_FAMILY_ID), api.listSchedules(DEMO_FAMILY_ID), api.listStatedPreferences(DEMO_FAMILY_ID)])
      .then(([taskItems, scheduleItems, preferenceItems]) => {
        setTasks(taskItems);
        setSchedule(scheduleItems);
        setPreferences(preferenceItems);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const totalGems = tasks.reduce((sum, task) => sum + task.gemsAwarded, 0);

  async function handleComplete(task: Task) {
    try {
      const updated = await api.completeTask(DEMO_FAMILY_ID, task.taskId);
      setTasks((prev) => prev.map((t) => (t.taskId === updated.taskId ? updated : t)));
      setCelebration({ gemsEarned: updated.gemsAwarded - task.gemsAwarded });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddPreference(input: { memberId: string; category: StatedPreferenceCategory; statement: string }) {
    try {
      const created = await api.addStatedPreference(DEMO_FAMILY_ID, input);
      setPreferences((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function handleRemovePreference(preference: StatedPreference) {
    try {
      await api.removeStatedPreference(DEMO_FAMILY_ID, preference.preferenceId, preference.memberId);
      setPreferences((prev) => prev.filter((p) => p.preferenceId !== preference.preferenceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="min-h-screen bg-olive-100 p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      <header className="md:col-span-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/brand-mark.png" alt="" className="h-12 w-12 rounded-full" />
          <div>
            <h1 className="font-display text-3xl text-olive-900">YouEnjoyMyFamily</h1>
            <p className="text-olive-700">Today at a glance</p>
          </div>
        </div>
        <p className="text-lg text-clay-700 font-semibold">{totalGems} gems collected</p>
      </header>

      {error && (
        <p className="md:col-span-2 text-clay-700 bg-clay-100 rounded-card px-4 py-3">
          Couldn&apos;t reach the backend: {error}
        </p>
      )}

      <FamilyCard title="Today's tasks">
        <TaskList tasks={tasks} onComplete={handleComplete} />
      </FamilyCard>

      <FamilyCard title="Today's schedule" accent>
        <Calendar entries={schedule} />
      </FamilyCard>

      <FamilyCard title="Family favorites">
        <FamilyFavorites preferences={preferences} onAdd={handleAddPreference} onRemove={handleRemovePreference} />
      </FamilyCard>

      {celebration && (
        <Celebration
          gemsEarned={celebration.gemsEarned}
          totalGems={totalGems}
          onDismiss={() => setCelebration(null)}
        />
      )}
    </main>
  );
}
