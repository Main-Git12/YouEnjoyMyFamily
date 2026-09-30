import { useState } from "react";

interface ReplaceKeyProps {
  /** Issues a new key and returns it. Called once, only after an explicit confirmation. */
  onReplace: () => Promise<string>;
  /** Stores the new key on this device, so the screen doing the replacing keeps working. */
  onKeepOnThisDevice: (apiKey: string) => void;
}

/**
 * Replacing the family's API key, from the screen on the wall.
 *
 * The key lives in this browser's storage, on a device that guests use, that
 * a repair shop might see, and that a household eventually sells. Until
 * there was a way to replace it, the only way to cut off a key that had got
 * out was to tear down the whole stack — so this is here.
 *
 * Two deliberate frictions. It takes a second tap to confirm, because a
 * stray hand on a kitchen wall must not be able to lock the house out. And
 * the new key is shown once, in full, with an explicit "I've written it
 * down" — the old key stops working the instant this succeeds, and every
 * other device needs this string typed into it. A key shown briefly and
 * then lost is the same as no key at all.
 */
export default function ReplaceKey({ onReplace, onKeepOnThisDevice }: ReplaceKeyProps) {
  const [stage, setStage] = useState<"idle" | "confirming" | "working" | "showing" | "failed">("idle");
  const [newKey, setNewKey] = useState<string | null>(null);

  async function replace() {
    setStage("working");
    try {
      const apiKey = await onReplace();
      setNewKey(apiKey);
      onKeepOnThisDevice(apiKey);
      setStage("showing");
    } catch {
      setStage("failed");
    }
  }

  if (stage === "showing" && newKey) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-olive-800">
          Done. The old key no longer works. This screen has already been switched over; every other
          phone and screen in the house needs the key below typed in once.
        </p>
        <p
          // `select-all` so one tap on a touchscreen selects the whole thing:
          // this is a string nobody should be transcribing by eye twice.
          className="select-all break-all rounded-lg bg-olive-100 px-3 py-2 font-mono text-base text-olive-900"
          data-testid="new-family-key"
        >
          {newKey}
        </p>
        <p className="text-sm text-olive-700">
          It is not stored anywhere it can be read back, so this is the only time it will be shown.
        </p>
        <button
          type="button"
          onClick={() => {
            setNewKey(null);
            setStage("idle");
          }}
          className="min-h-11 rounded-lg bg-olive-600 px-4 py-2 text-white"
        >
          I've written it down
        </button>
      </div>
    );
  }

  if (stage === "confirming" || stage === "working") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-olive-800">
          This signs out every phone and screen in the house, including the ones that aren't here.
          Each one has to be linked again with the new key.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={stage === "working"}
            onClick={replace}
            className="min-h-11 rounded-lg bg-clay-700 px-4 py-2 text-white disabled:opacity-60"
          >
            {stage === "working" ? "Replacing…" : "Yes, replace the key"}
          </button>
          <button
            type="button"
            disabled={stage === "working"}
            onClick={() => setStage("idle")}
            className="min-h-11 rounded-lg border border-olive-400 px-4 py-2 text-olive-800"
          >
            Leave it alone
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-olive-700">
        The key is what any device uses to reach this family's data. Replace it if it has been
        written down somewhere it shouldn't be, or if a screen or phone that had it has left the
        house.
      </p>
      {stage === "failed" && (
        <p className="text-sm text-clay-700">
          Nothing was replaced — the old key still works. Try again in a moment.
        </p>
      )}
      <button
        type="button"
        onClick={() => setStage("confirming")}
        className="min-h-11 rounded-lg border border-clay-500 px-4 py-2 text-clay-700"
      >
        Replace the family key…
      </button>
    </div>
  );
}
