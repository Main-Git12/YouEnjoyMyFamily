import { useEffect, useMemo } from "react";
import { randomMascot } from "./mascots";

interface CelebrationProps {
  gemsEarned: number;
  totalGems: number;
  onDismiss: () => void;
}

const CONFETTI_COLORS = ["bg-gem-amber", "bg-gem-ruby", "bg-gem-emerald", "bg-gem-sapphire", "bg-clay-500"];
const CONFETTI_PIECE_COUNT = 18;
const AUTO_DISMISS_MS = 3200;

interface ConfettiPiece {
  id: number;
  leftPercent: number;
  delayMs: number;
  color: string;
  sizePx: number;
}

function makeConfetti(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    leftPercent: Math.random() * 100,
    delayMs: Math.random() * 400,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? "bg-gem-amber",
    sizePx: 6 + Math.random() * 6,
  }));
}

// Original mascot celebration for a completed task — no third-party
// characters, see frontend/src/components/mascots/.
export default function Celebration({ gemsEarned, totalGems, onDismiss }: CelebrationProps) {
  const mascot = useMemo(() => randomMascot(), []);
  const confetti = useMemo(() => makeConfetti(CONFETTI_PIECE_COUNT), []);
  const Mascot = mascot.Component;

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-olive-900/70 overflow-hidden">
      {confetti.map((piece) => (
        <span
          key={piece.id}
          className={`absolute top-0 rounded-sm animate-confetti-fall ${piece.color}`}
          style={{ left: `${piece.leftPercent}%`, width: piece.sizePx, height: piece.sizePx, animationDelay: `${piece.delayMs}ms` }}
        />
      ))}

      <div className="relative bg-sand-50 rounded-card shadow-[var(--shadow-card)] px-10 py-8 text-center animate-pop-in">
        <Mascot size={120} className="mx-auto" />
        <p className="font-display text-2xl text-olive-900 mt-3">{mascot.name} cheers you on!</p>
        <p className="text-xl text-clay-700 font-semibold mt-1">+{gemsEarned} gems</p>
        <p className="text-olive-700 mt-1">{totalGems} gems collected so far</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 text-sm text-olive-600 underline underline-offset-2"
        >
          Nice!
        </button>
      </div>
    </div>
  );
}
