import { useMemo } from "react";
import { pickCastleThreat } from "./castleThreats";
import type { Task } from "../types";

interface CastleAlertProps {
  task: Task;
  onDefend: (task: Task) => void;
  onDismiss: () => void;
}

// A storm cloud looming over the castle — the visual cue that something
// needs defending. Original art, matching the mascots' plush-toy style.
function StormCloud({ size = 96 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={size} role="img" aria-label="A dark storm cloud over the castle">
      <ellipse cx="60" cy="58" rx="46" ry="26" fill="var(--color-olive-800)" />
      <circle cx="34" cy="46" r="20" fill="var(--color-olive-800)" />
      <circle cx="60" cy="36" r="24" fill="var(--color-olive-800)" />
      <circle cx="88" cy="48" r="18" fill="var(--color-olive-800)" />
      <path d="M40 78 L34 94" stroke="var(--color-gem-amber)" strokeWidth="4" strokeLinecap="round" />
      <path d="M62 78 L54 96" stroke="var(--color-gem-amber)" strokeWidth="4" strokeLinecap="round" />
      <path d="M84 78 L78 94" stroke="var(--color-gem-amber)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export default function CastleAlert({ task, onDefend, onDismiss }: CastleAlertProps) {
  const threatLine = useMemo(
    () => pickCastleThreat(task.assignedTo ?? "Someone", task.title),
    [task.assignedTo, task.title],
  );

  return (
    <div role="alertdialog" aria-label="Castle under attack" className="fixed inset-0 z-50 flex items-center justify-center bg-olive-900/70">
      <div className="relative bg-white rounded-card shadow-[var(--shadow-card)] px-10 py-8 text-center max-w-sm">
        <StormCloud size={100} />
        <p className="font-display text-2xl text-olive-700 mt-3">Castle Under Attack!</p>
        <p className="text-olive-700 mt-2">{threatLine}</p>
        <button
          type="button"
          onClick={() => onDefend(task)}
          className="mt-5 font-display bg-olive-500 text-white rounded-full px-6 py-2 shadow-[var(--shadow-card)] hover:bg-olive-600 transition-colors"
        >
          Defend the Castle!
        </button>
        <div>
          <button type="button" onClick={onDismiss} className="mt-3 text-sm text-olive-600 underline underline-offset-2">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
