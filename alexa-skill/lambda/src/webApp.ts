import type * as Alexa from "ask-sdk-core";
import type { interfaces } from "ask-sdk-model";

/**
 * Putting the actual app on the Echo Show, by voice.
 *
 * The Echo Show cannot install a third-party app and cannot pin a web page
 * to its home screen. Until now the only route was: say "Alexa, open Silk",
 * find the bookmark, tap it, and link the screen by typing a 32-character
 * API key on a touchscreen keyboard. Silk then closes itself after a spell
 * of idle, with no setting to stop it, and the whole ritual starts again.
 *
 * `Alexa.Presentation.HTML` is Amazon's own answer: the skill hands the
 * device an HTTPS URL and the device runs it in a WebView inside the skill
 * session. "Alexa, open you enjoy my family" puts the real React app on the
 * wall. No browser, no bookmark, no typing.
 *
 * Two honest limits, both from Amazon's own interface definition rather
 * than from anybody's blog post:
 *
 *  - `configuration.timeoutInSeconds` is capped at five minutes. This does
 *    not give an always-on wall display and nothing here pretends it does.
 *    What it buys is a *predictable* teardown and a one-phrase recovery:
 *    the screen goes back to Alexa's home view and somebody says the
 *    invocation name again, rather than navigating a browser.
 *  - The URL must be HTTPS with a valid certificate, and at most 8000
 *    characters.
 */

/** Exactly as it appears in `supportedInterfaces`. */
export const WEB_APP_INTERFACE = "Alexa.Presentation.HTML";

/**
 * Amazon's ceiling on how long the page may sit without user interaction
 * (`Configuration.timeoutInSeconds`: default 30 seconds, maximum 5 minutes).
 * Asking for the maximum, because a kitchen wall is looked at rather than
 * touched, and thirty seconds of that is not a display, it is a flash.
 */
export const MAX_TIMEOUT_SECONDS = 300;

export interface WebAppSettings {
  /** HTTPS URL of the deployed frontend. Absent means the feature is off. */
  url: string | undefined;
  familyId: string;
  /**
   * The family API key, only when the operator has explicitly opted in.
   *
   * Sending it means it travels Lambda -> Alexa cloud -> device, which is
   * one hop more than a person typing it into the same device's browser.
   * The convenience is real — nobody wants to key 32 characters into a
   * wall-mounted touchscreen — but it is a credential, so it is off unless
   * somebody turned it on, and the skill works without it: the screen just
   * asks to be linked the way any other device does.
   */
  apiKey: string | undefined;
}

/** Read fresh rather than cached at module scope, so tests can flip it per case. */
export function webAppSettings(): WebAppSettings {
  const autolink = process.env.YOUENJOYMYFAMILY_WEB_APP_AUTOLINK === "true";
  return {
    url: process.env.YOUENJOYMYFAMILY_WEB_APP_URL || undefined,
    familyId: process.env.YOUENJOYMYFAMILY_FAMILY_ID ?? "fam_demo",
    apiKey: autolink ? process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY || undefined : undefined,
  };
}

/** Whether this device can run a web app at all. Echo Dots and phones cannot. */
export function supportsWebApp(handlerInput: Alexa.HandlerInput): boolean {
  const supported = handlerInput.requestEnvelope.context.System.device?.supportedInterfaces;
  return Boolean(supported?.[WEB_APP_INTERFACE]);
}

/**
 * What the device is told to load, and what it is handed on the way in.
 *
 * `data` is the startup payload (Amazon's cap: 18 KB — this sends a few
 * dozen bytes). The family id always goes; the key only when somebody opted
 * in. A screen that arrives knowing which family it belongs to still saves
 * half the linking even when it has to ask for the key.
 *
 * `surface=echo-show` is on the URL rather than only in `data` so the app
 * can lay itself out for a 1280x800 wall before any JavaScript has run —
 * the startup payload is not readable until the Alexa client library has
 * loaded and resolved.
 */
export function startWebAppDirective(
  settings: WebAppSettings,
  timeoutSeconds: number = MAX_TIMEOUT_SECONDS
): interfaces.alexa.presentation.html.StartDirective {
  if (!settings.url) throw new Error("YOUENJOYMYFAMILY_WEB_APP_URL is not configured");

  const uri = new URL(settings.url);
  uri.searchParams.set("surface", "echo-show");

  return {
    type: "Alexa.Presentation.HTML.Start",
    request: { method: "GET", uri: uri.toString() },
    configuration: {
      // Clamped rather than trusted: Amazon rejects anything above five
      // minutes, and a directive refused at the device is indistinguishable
      // on this end from a skill that simply did nothing.
      timeoutInSeconds: Math.min(Math.max(1, Math.round(timeoutSeconds)), MAX_TIMEOUT_SECONDS),
    },
    data: {
      familyId: settings.familyId,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    },
  };
}

/**
 * Session flag: is our web app currently on the screen?
 *
 * This is not bookkeeping for its own sake. Amazon's rule is that *any*
 * directive from an interface other than Alexa.Presentation.HTML closes the
 * web app — APL's RenderDocument included. So the moment somebody opens the
 * family screen and then asks a question, every handler that helpfully
 * renders an APL card would tear the screen down and leave a card in its
 * place. The flag is what lets those handlers know to stay quiet.
 */
export const WEB_APP_RUNNING = "webAppRunning";

export function markWebAppRunning(handlerInput: Alexa.HandlerInput): void {
  const attributes = handlerInput.attributesManager.getSessionAttributes();
  handlerInput.attributesManager.setSessionAttributes({ ...attributes, [WEB_APP_RUNNING]: true });
}

/** True while our own web app owns the screen, so nothing else should draw on it. */
export function webAppIsOnScreen(handlerInput: Alexa.HandlerInput): boolean {
  return Boolean(handlerInput.attributesManager.getSessionAttributes()?.[WEB_APP_RUNNING]);
}

/** What the web app says back, once it is up. Free-form by the interface; narrow by ours. */
export interface WebAppMessage {
  kind?: string;
  text?: string;
}

/**
 * The one thing the web app is allowed to ask the skill to do: say something.
 *
 * Deliberately a closed list rather than "speak whatever the page sends".
 * The page is ours, but a message channel that reads as "any string from the
 * browser becomes Alexa's voice in this kitchen" is the kind of thing that
 * is fine until the day it isn't.
 */
export function speechForWebAppMessage(message: WebAppMessage | undefined): string | null {
  if (!message || typeof message !== "object") return null;
  if (message.kind === "ready") return null; // The app announcing itself needs no reply.
  if (message.kind === "speak" && typeof message.text === "string") {
    const text = message.text.trim().slice(0, 300);
    return text || null;
  }
  return null;
}

/**
 * Amazon's own words for why a web app failed to start, turned into
 * something a person in a kitchen can act on.
 *
 * Worth the specificity: "I couldn't open the family screen" sends somebody
 * to the wrong place three times out of four, and all four of these have
 * different fixes.
 */
export function explainRuntimeError(
  reason: interfaces.alexa.presentation.html.RuntimeErrorReason | string | undefined
): string {
  switch (reason) {
    case "HTTP_REQUEST_ERROR":
      return "I couldn't reach the family screen. The web address may be wrong, or the site may be down.";
    case "TIMED_OUT":
      return "The family screen took too long to load.";
    case "FILE_TYPE_NOT_SUPPORTED":
      return "That web address didn't give me a page I can show.";
    case "APPLICATION_ERROR":
      return "The family screen loaded but then ran into a problem.";
    default:
      return "I couldn't open the family screen.";
  }
}
