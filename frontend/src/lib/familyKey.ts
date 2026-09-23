/**
 * Where the family's API key and id live on this device.
 *
 * They used to be compiled into the JavaScript bundle. That's defensible on
 * a laptop; it is not defensible once the same bundle is served from a
 * public CloudFront URL, because anyone who loads the page can read the key
 * out of the source and then has full read/write on the family's data —
 * chores, schedules, the children's names.
 *
 * So the key is entered once per device and kept in localStorage instead.
 * It never ships in the build, never appears in a URL, and never leaves the
 * device except as the Authorization header it was always meant to be.
 *
 * The environment variables are kept as a convenience for local development
 * and are deliberately only a *fallback* — a production build simply won't
 * have them set.
 */

const KEY_STORAGE = "yemf.familyApiKey";
const ID_STORAGE = "yemf.familyId";

/** Private browsing and locked-down kiosks can both make storage throw. */
function readStored(name: string): string | null {
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeStored(name: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(name);
    else window.localStorage.setItem(name, value);
  } catch {
    // A device that can't remember is still usable for this session.
  }
}

/**
 * The env fallback is gated on DEV deliberately, and it matters.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so an ungated
 * fallback would still bake the key into the bundle for anyone who kept
 * passing it to `npm run build` — which the deploy instructions used to
 * say to do. Behind `import.meta.env.DEV` the whole branch is eliminated
 * from a production build, so there is nothing left to inline into and no
 * way to reintroduce the leak by habit.
 */
export function getFamilyApiKey(): string | null {
  const stored = readStored(KEY_STORAGE);
  if (stored) return stored;
  if (import.meta.env.DEV) return import.meta.env.VITE_FAMILY_API_KEY || null;
  return null;
}

export function getFamilyId(): string | null {
  const stored = readStored(ID_STORAGE);
  if (stored) return stored;
  if (import.meta.env.DEV) return import.meta.env.VITE_FAMILY_ID || null;
  return null;
}

/** True once this device knows which family it belongs to, and can prove it. */
export function isDeviceLinked(): boolean {
  return Boolean(getFamilyApiKey() && getFamilyId());
}

export function linkDevice(familyId: string, apiKey: string): void {
  writeStored(ID_STORAGE, familyId.trim());
  writeStored(KEY_STORAGE, apiKey.trim());
}

/** Forgets the family on this device — for a screen being passed on or sold. */
export function unlinkDevice(): void {
  writeStored(ID_STORAGE, null);
  writeStored(KEY_STORAGE, null);
}
