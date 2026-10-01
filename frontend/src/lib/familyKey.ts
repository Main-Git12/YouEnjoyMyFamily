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

/**
 * The same two values, held in memory as well as in storage.
 *
 * Not a cache — a second home. The Alexa HTML runtime on an Echo Show
 * *disables* localStorage outright (it is on Amazon's published list of
 * switched-off browser capabilities, alongside geolocation and getUserMedia),
 * and clears cookies at the end of every skill session. A device where
 * storage silently does nothing would read as a screen that can never be
 * linked, forever showing the setup prompt no matter what anybody typed.
 *
 * Reads prefer memory, so a session handed its credentials by the Alexa
 * skill works exactly like a linked browser. Writes go to both, and the
 * storage half is allowed to fail quietly, which is what it already did.
 */
const inMemory: { familyId: string | null; apiKey: string | null } = { familyId: null, apiKey: null };

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
  if (inMemory.apiKey) return inMemory.apiKey;
  const stored = readStored(KEY_STORAGE);
  if (stored) return stored;
  if (import.meta.env.DEV) return import.meta.env.VITE_FAMILY_API_KEY || null;
  return null;
}

export function getFamilyId(): string | null {
  if (inMemory.familyId) return inMemory.familyId;
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
  inMemory.familyId = familyId.trim();
  inMemory.apiKey = apiKey.trim();
  writeStored(ID_STORAGE, inMemory.familyId);
  writeStored(KEY_STORAGE, inMemory.apiKey);
}

/**
 * Half a link: which family this screen belongs to, without the key.
 *
 * What an Echo Show gets when the skill has not been told it may hand over
 * the credential. Knowing the family id is not nothing — it saves typing
 * half of what a linking screen asks for — but the screen still has to ask
 * for the key, so this deliberately does not make `isDeviceLinked()` true.
 */
export function rememberFamilyId(familyId: string): void {
  inMemory.familyId = familyId.trim();
  writeStored(ID_STORAGE, inMemory.familyId);
}

/** Forgets the family on this device — for a screen being passed on or sold. */
export function unlinkDevice(): void {
  inMemory.familyId = null;
  inMemory.apiKey = null;
  writeStored(ID_STORAGE, null);
  writeStored(KEY_STORAGE, null);
}
