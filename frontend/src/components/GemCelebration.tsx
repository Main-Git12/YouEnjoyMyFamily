import { useEffect, useState } from "react";
import Confetti from "./Confetti";
import { randomSpirit } from "./spirits";

const CHEERS = ["Nice work!", "You got it!", "Gem time!", "Way to go!", "Crushed it!"];

interface GemCelebrationProps {
  gemsAwarded: number;
  onDone: () => void;
}

export default function GemCelebration({ gemsAwarded, onDone }: GemCelebrationProps) {
  const [Spirit] = useState(() => randomSpirit());
  const [cheer] = useState(() => CHEERS[Math.floor(Math.random() * CHEERS.length)] ?? "Nice work!");

  useEffect(() => {
    const timer = setTimeout(onDone, 2200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bark/30"
      role="status"
      aria-live="polite"
    >
      <Confetti />
      <div className="flex flex-col items-center">
        <Spirit className="w-32 h-32 animate-spirit-pop drop-shadow-[0_8px_16px_rgba(31,32,19,0.25)]" />
        <div className="mt-2 rounded-card bg-sand-50 px-6 py-3 text-center shadow-[var(--shadow-card)] animate-spirit-pop">
          <p className="font-display text-2xl text-olive-900">{cheer}</p>
          <p className="text-clay-700 font-semibold">+{gemsAwarded} 💎</p>
        </div>
      </div>
    </div>
  );
}
