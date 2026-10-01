import { linkDevice, rememberFamilyId } from "./familyKey";

/**
 * The app running inside an Echo Show, launched by voice.
 *
 * `Alexa.Presentation.HTML` lets a skill hand the device an HTTPS URL and
 * have it run in a WebView inside the skill session. "Alexa, open you enjoy
 * my family" puts this exact React app on the kitchen wall — no browser, no
 * bookmark, and nobody keying a 32-character API key into a touchscreen.
 *
 * The runtime is Chromium-ish but deliberately narrowed, and two of the
 * things Amazon switches off matter here:
 *
 *  - **localStorage is disabled**, and cookies are wiped at the end of every
 *    skill session. There is no persistence on the device at all. That is
 *    why the credentials arrive in the launch payload and live in memory
 *    (see familyKey.ts) rather than being typed once and kept.
 *  - **No getUserMedia and no Web Speech API.** The page cannot listen. Voice
 *    belongs to the skill, which is the right place for it anyway.
 *
 * Everything here is optional and fails soft. On a phone or a laptop none of
 * it runs, the library is never even fetched, and the app behaves exactly as
 * it always has.
 */

/** Amazon's client library. Only ever fetched on a device that asked for it. */
export const ALEXA_CLIENT_LIBRARY = "https://cdn.html.games.alexa.a2z.com/alexa-html/latest/alexa-html.js";

/** The runtime version this app is written against, as a string — not a number. */
export const ALEXA_CLIENT_VERSION = "1.1";

/**
 * How long the whole handover gets before the screen stops waiting.
 *
 * Nothing in this exchange is under our control: a script fetched from
 * Amazon's CDN, and a promise resolved by a runtime we cannot see. Both can
 * simply never settle — a script tag whose onload and onerror both go
 * missing when the network black-holes, a `create()` that hangs. Without a
 * bound, the screen sits on "Opening your family screen…" until somebody
 * power-cycles the device, which on a wall is indistinguishable from the app
 * being broken.
 *
 * Eight seconds: long enough for a cold CDN fetch on a device that is not
 * fast, short enough that a family watching the wall sees it give up and
 * offer them something to do.
 */
export const ALEXA_HANDSHAKE_TIMEOUT_MS = 8000;

/** What the skill puts in the Start directive's `data`. See alexa-skill/lambda/src/webApp.ts. */
export interface AlexaStartupData {
  familyId?: string;
  apiKey?: string;
}

export type AlexaLinkOutcome =
  /** Family id and key both arrived: the screen is ready to use. */
  | "linked"
  /** Only the family id arrived — autolink is off, so the screen still asks for a key. */
  | "partial"
  /** Not on an Echo Show, or the handshake didn't complete. The app carries on unchanged. */
  | "unavailable";

interface AlexaClient {
  create(options: { version: string }): Promise<{ alexa?: unknown; message?: AlexaStartupData }>;
}

/**
 * Whether this page was opened by the skill.
 *
 * Read from the query string the skill puts on the URL rather than by
 * sniffing for the Alexa object, because it has to be answerable at first
 * paint — before any third-party script has loaded — so the layout can be
 * right the first time instead of reflowing a second later on a wall screen.
 */
export function isAlexaSurface(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("surface") === "echo-show";
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export interface LinkFromAlexaOptions {
  /** Injectable so tests never reach the network, and so a stub can stand in. */
  load?: (src: string) => Promise<void>;
  getClient?: () => AlexaClient | undefined;
  onLink?: (familyId: string, apiKey: string) => void;
  onFamilyId?: (familyId: string) => void;
  timeoutMs?: number;
}

/**
 * Resolves to "unavailable" if `work` has not settled in time. Never rejects.
 *
 * `start` is called with an "is this still wanted?" predicate rather than
 * being raced directly, because a promise cannot be cancelled. The handover
 * keeps running after the deadline — nothing can stop it — so the thing that
 * has to stop is its *effect*: a late answer must not reach in and link the
 * screen once the app has already given up and gone back to asking. Without
 * that, the family sees a form while the device is quietly already linked,
 * and typing a different family's key into it becomes a race.
 */
function withDeadline(
  start: (stillWanted: () => boolean) => Promise<AlexaLinkOutcome>,
  timeoutMs: number
): Promise<AlexaLinkOutcome> {
  return new Promise((resolve) => {
    // Resolving a promise twice is already a no-op, so this flag is not
    // guarding the resolution — it exists solely to answer `stillWanted`,
    // which is the thing that actually has to change behaviour.
    let settled = false;
    const finish = (outcome: AlexaLinkOutcome) => {
      settled = true;
      resolve(outcome);
    };

    const timer = setTimeout(() => finish("unavailable"), timeoutMs);
    void start(() => !settled)
      .then((outcome) => {
        clearTimeout(timer);
        finish(outcome);
      })
      .catch(() => {
        clearTimeout(timer);
        finish("unavailable");
      });
  });
}

/**
 * Take the credentials the skill handed over at launch, if there are any.
 *
 * Never throws. Every failure — not on an Echo Show, library blocked, the
 * handshake never resolving, a payload with nothing useful in it — lands on
 * "unavailable", and the app falls back to asking to be linked the way it
 * always did. A screen that shows a setup prompt is a recoverable Tuesday;
 * a screen showing an error nobody can act on is not.
 */
export async function linkFromAlexa(options: LinkFromAlexaOptions = {}): Promise<AlexaLinkOutcome> {
  const {
    load = loadScript,
    getClient = () => (window as unknown as { Alexa?: AlexaClient }).Alexa,
    onLink = linkDevice,
    onFamilyId = rememberFamilyId,
    timeoutMs = ALEXA_HANDSHAKE_TIMEOUT_MS,
  } = options;

  if (!isAlexaSurface()) return "unavailable";

  return withDeadline(handshake, timeoutMs);

  async function handshake(stillWanted: () => boolean): Promise<AlexaLinkOutcome> {
    try {
      if (!getClient()) await load(ALEXA_CLIENT_LIBRARY);
      const client = getClient();
      if (!client) return "unavailable";

      const { message } = await client.create({ version: ALEXA_CLIENT_VERSION });
      // Checked here rather than only at the top: everything above this line
      // is awaited, so the deadline may well have passed while we waited.
      if (!stillWanted()) return "unavailable";

      const familyId = message?.familyId?.trim();
      if (!familyId) return "unavailable";

      const apiKey = message?.apiKey?.trim();
      if (apiKey) {
        onLink(familyId, apiKey);
        return "linked";
      }

      onFamilyId(familyId);
      return "partial";
    } catch {
      return "unavailable";
    }
  }
}
