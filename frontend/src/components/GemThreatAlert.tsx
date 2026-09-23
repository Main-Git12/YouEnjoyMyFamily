import { useState } from "react";
import type { ThreatenedChore } from "../lib/gemThreats";
import ThreatArt from "./threats/ThreatArt";
import King from "./mascots/King";
import Princess from "./mascots/Princess";

interface GemThreatAlertProps {
  threatened: ThreatenedChore;
  onDefend: () => Promise<void>;
  onDismiss: () => void;
}

/**
 * The scenario overlay: something is after the gems, and the chore is the
 * way to stop it. Two beats — the threat prowling, then the King and Wren
 * celebrating once it's seen off — so finishing the chore has a payoff on
 * screen rather than the box simply vanishing.
 */
export default function GemThreatAlert({ threatened, onDefend, onDismiss }: GemThreatAlertProps) {
  const { task, threat, assignee } = threatened;
  const [defeated, setDefeated] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleDefend() {
    setSaving(true);
    try {
      await onDefend();
      setDefeated(true);
      // Let the children watch the villain leave before the box closes.
      setTimeout(onDismiss, 2600);
    } catch {
      // Dashboard shows the error; keep the scenario open so it can be retried.
      setSaving(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label={defeated ? "The gems are safe" : `${threat.name} is after the gems`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-olive-900/70 p-4"
    >
      <div className="relative bg-white rounded-card shadow-[var(--shadow-card)] px-6 sm:px-10 py-8 text-center max-w-md w-full animate-pop-in">
        {defeated ? (
          <>
            <div className="flex items-end justify-center gap-2">
              <King size={104} className="animate-king-nod" />
              <Princess size={88} className="animate-princess-twirl" />
            </div>
            <p className="font-display text-2xl text-olive-700 mt-3">Gems saved!</p>
            <p className="text-olive-700 mt-2">{threat.defeated(assignee)}</p>
            <p className="font-display text-xl text-olive-600 mt-3 animate-gem-count">+{task.gemValue} gems</p>
          </>
        ) : (
          <>
            <ThreatArt threatId={threat.id} size={124} className="mx-auto animate-sneak-in" />
            <p className="font-display text-2xl text-clay-700 mt-3">Your gems are in danger!</p>
            <p className="text-olive-700 mt-2">{threat.taunt(assignee, task.title, task.gemValue)}</p>
            <button
              type="button"
              onClick={handleDefend}
              disabled={saving}
              className="mt-5 font-display bg-olive-600 text-white rounded-full px-6 py-3 shadow-[var(--shadow-card)] hover:bg-olive-700 disabled:bg-olive-300"
            >
              {saving ? "Saving the gems…" : threat.callToAction}
            </button>
            <div>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-3 text-sm text-olive-600 underline underline-offset-2 py-1"
              >
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
