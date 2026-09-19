import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Task, ScheduleEntry, CartItem } from "../types";
import FamilyCard from "./FamilyCard";
import TaskList from "./TaskList";
import Calendar from "./Calendar";
import GroceryCart from "./GroceryCart";
import GemCelebration from "./GemCelebration";

// Placeholder until family selection / auth is wired up.
const DEMO_FAMILY_ID = "fam_demo";
const DEMO_MEMBER_ID = "member_demo";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [gems, setGems] = useState(0);
  const [gemBump, setGemBump] = useState(0);
  const [celebration, setCelebration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listTasks(DEMO_FAMILY_ID),
      api.listSchedules(DEMO_FAMILY_ID),
      api.listCartItems(DEMO_FAMILY_ID),
      api.getMemberStats(DEMO_FAMILY_ID, DEMO_MEMBER_ID),
    ])
      .then(([taskItems, scheduleItems, cartItemsResult, stats]) => {
        setTasks(taskItems);
        setSchedule(scheduleItems);
        setCartItems(cartItemsResult);
        setGems(stats.gems);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleCompleteTask(taskId: string) {
    try {
      const updated = await api.updateTask(DEMO_FAMILY_ID, taskId, { status: "done" });
      setTasks((prev) => prev.map((task) => (task.taskId === taskId ? updated : task)));

      if (updated.gemsAwarded) {
        setGems((prev) => prev + (updated.gemsAwarded ?? 0));
        setGemBump((prev) => prev + 1);
        setCelebration(updated.gemsAwarded);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="min-h-screen bg-olive-100 p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <header className="md:col-span-2 lg:col-span-3 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-olive-900">PealSync</h1>
          <p className="text-olive-700">Today at a glance</p>
        </div>
        <div
          key={gemBump}
          className="flex items-center gap-2 bg-sand-50 rounded-card px-4 py-2 shadow-[var(--shadow-card)] animate-gem-jar-bump"
        >
          <span className="text-2xl">💎</span>
          <span className="font-display text-2xl text-olive-900">{gems}</span>
        </div>
      </header>

      {error && (
        <p className="md:col-span-2 lg:col-span-3 text-clay-700 bg-clay-100 rounded-card px-4 py-3">
          Couldn&apos;t reach the backend: {error}
        </p>
      )}

      <FamilyCard title="Today's tasks">
        <TaskList tasks={tasks} onComplete={handleCompleteTask} />
      </FamilyCard>

      <FamilyCard title="Today's schedule" accent>
        <Calendar entries={schedule} />
      </FamilyCard>

      <FamilyCard title="Grocery cart">
        <GroceryCart familyId={DEMO_FAMILY_ID} items={cartItems} onItemsChange={setCartItems} />
      </FamilyCard>

      {celebration !== null && <GemCelebration gemsAwarded={celebration} onDone={() => setCelebration(null)} />}
    </main>
  );
}
