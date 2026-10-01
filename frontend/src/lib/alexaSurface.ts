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
  } = options;

  if (!isAlexaSurface()) return "unavailable";

  try {
    if (!getClient()) await load(ALEXA_CLIENT_LIBRARY);
    const client = getClient();
    if (!client) return "unavailable";

    const { message } = await client.create({ version: ALEXA_CLIENT_VERSION });
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
