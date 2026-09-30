import { useState, type FormEvent } from "react";

interface LinkDeviceProps {
  onLink: (familyId: string, apiKey: string) => void;
  /** Set when an existing key stopped working, rather than never existing. */
  signedOut?: boolean;
}

/**
 * The one-time setup for a new screen: which family, and the key that proves
 * it. Shown instead of the dashboard until both are known.
 *
 * Deliberately a paste-once step rather than a password: this is a household
 * of a handful of devices, and inventing accounts and password resets for
 * four people who live together would be more to go wrong, not less. The
 * key came from `POST /families` and is the same one the voice skill uses.
 */
export default function LinkDevice({ onLink, signedOut = false }: LinkDeviceProps) {
  const [familyId, setFamilyId] = useState("");
  const [apiKey, setApiKey] = useState("");

  const ready = familyId.trim().length > 0 && apiKey.trim().length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    onLink(familyId.trim(), apiKey.trim());
  }

  return (
    <main className="min-h-screen bg-white flex items-center justify-center p-4 sm:p-8">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-card shadow-[var(--shadow-card)] border-2 border-olive-100 px-6 sm:px-10 py-8 w-full max-w-lg"
      >
        <div className="flex items-center gap-3 mb-5">
          <img src="/brand-mark.png" alt="" className="h-12 w-12 rounded-full ring-4 ring-olive-100" />
          <h1 className="font-display text-2xl sm:text-3xl text-olive-700">YouEnjoyMyFamily</h1>
        </div>

        {signedOut ? (
          <p role="alert" className="text-clay-900 bg-clay-100 rounded-card px-4 py-3 mb-4">
            This screen isn&apos;t signed in to the family account any more. Enter the key again to reconnect it.
          </p>
        ) : (
          <p className="text-olive-700 mb-4">
            Connect this screen to your family. You&apos;ll only do this once per device.
          </p>
        )}

        <label className="block mb-4">
          <span className="block text-sm text-olive-700 mb-1">Family ID</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="fam_…"
            value={familyId}
            onChange={(e) => setFamilyId(e.target.value)}
            className="w-full rounded-lg border border-olive-500 px-3 py-2"
          />
        </label>

        <label className="block mb-2">
          <span className="block text-sm text-olive-700 mb-1">Family key</span>
          <input
            // `password` so it isn't left readable on a kitchen wall while
            // someone types it, and so browsers don't offer to autofill it
            // somewhere else.
            type="password"
            autoComplete="off"
            placeholder="fk_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-olive-500 px-3 py-2"
          />
        </label>

        <p className="text-sm text-olive-600 mb-5">
          Both came from setting the family up — see the backend README. The key is kept on this device only; it never
          goes into the page itself.
        </p>

        <button
          type="submit"
          disabled={!ready}
          className="w-full font-display bg-olive-600 text-white rounded-full px-6 py-4 text-lg shadow-[var(--shadow-card)] hover:bg-olive-700 disabled:bg-olive-300"
        >
          Connect this screen
        </button>
      </form>
    </main>
  );
}
