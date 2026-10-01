import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  WEB_APP_INTERFACE,
  MAX_TIMEOUT_SECONDS,
  webAppSettings,
  supportsWebApp,
  startWebAppDirective,
  speechForWebAppMessage,
  explainRuntimeError,
  webAppIsOnScreen,
} from "./webApp";
import {
  LaunchRequestHandler,
  WebAppMessageHandler,
  WebAppRuntimeErrorHandler,
  GetTasksIntentHandler,
} from "./index";
import { makeHandlerInput, intentRequest, type FakeResponse } from "./testSupport";
import type * as Alexa from "ask-sdk-core";

const ENV = [
  "YOUENJOYMYFAMILY_API_BASE_URL",
  "YOUENJOYMYFAMILY_WEB_APP_URL",
  "YOUENJOYMYFAMILY_WEB_APP_AUTOLINK",
  "YOUENJOYMYFAMILY_FAMILY_ID",
  "YOUENJOYMYFAMILY_FAMILY_API_KEY",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/** A handler input whose device advertises the HTML runtime. */
function webAppDevice(request: Parameters<typeof makeHandlerInput>[0]): Alexa.HandlerInput {
  const input = makeHandlerInput(request);
  const system = input.requestEnvelope.context.System as {
    device?: { supportedInterfaces: Record<string, unknown> };
  };
  system.device = { supportedInterfaces: { [WEB_APP_INTERFACE]: { runtime: { maxVersion: "1.1" } } } };
  return input;
}

const directivesOf = (response: unknown) => (response as FakeResponse).directives as Record<string, unknown>[];
const speechOf = (response: unknown) => (response as FakeResponse).speech.join(" ");

test("the interface string is the one Alexa actually advertises", () => {
  // Spelled wrong, every check silently says "this device can't" and the
  // feature simply never appears — on a device that supports it fine.
  assert.equal(WEB_APP_INTERFACE, "Alexa.Presentation.HTML");
});

test("a device without the HTML runtime is not offered a web app", () => {
  assert.equal(supportsWebApp(makeHandlerInput({ type: "LaunchRequest" })), false);
  assert.equal(supportsWebApp(webAppDevice({ type: "LaunchRequest" })), true);
});

test("the key is withheld unless somebody explicitly turned autolink on", () => {
  // It is a credential. Sending it means it travels Lambda -> Alexa cloud ->
  // device, which is one hop more than a person typing it into that same
  // device, so it is off by default and the screen just asks to be linked.
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";
  process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY = "fk_secret";
  process.env.YOUENJOYMYFAMILY_FAMILY_ID = "fam_1";

  assert.equal(webAppSettings().apiKey, undefined);

  process.env.YOUENJOYMYFAMILY_WEB_APP_AUTOLINK = "true";
  assert.equal(webAppSettings().apiKey, "fk_secret");
});

test("anything other than the literal string true leaves autolink off", () => {
  process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY = "fk_secret";
  for (const value of ["1", "yes", "TRUE", "on", ""]) {
    process.env.YOUENJOYMYFAMILY_WEB_APP_AUTOLINK = value;
    assert.equal(webAppSettings().apiKey, undefined, `"${value}" should not enable autolink`);
  }
});

test("the family id goes even without the key, so half the linking is already done", () => {
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";
  process.env.YOUENJOYMYFAMILY_FAMILY_ID = "fam_1";

  const directive = startWebAppDirective(webAppSettings());

  assert.equal(directive.data.familyId, "fam_1");
  assert.equal("apiKey" in directive.data, false);
});

test("the directive is the shape Alexa's own model declares", () => {
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com/";
  process.env.YOUENJOYMYFAMILY_FAMILY_ID = "fam_1";

  const directive = startWebAppDirective(webAppSettings());

  assert.equal(directive.type, "Alexa.Presentation.HTML.Start");
  assert.equal(directive.request.method, "GET");
  assert.match(directive.request.uri ?? "", /^https:\/\//);
});

test("the page is told which surface it is on, before any script has run", () => {
  // The startup payload isn't readable until Alexa's client library has
  // loaded and resolved; a query parameter is readable at first paint.
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com/app";
  const uri = startWebAppDirective(webAppSettings()).request.uri ?? "";
  assert.equal(new URL(uri).searchParams.get("surface"), "echo-show");
});

test("an existing query string on the configured URL survives", () => {
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com/app?theme=olive";
  const uri = startWebAppDirective(webAppSettings()).request.uri ?? "";
  assert.equal(new URL(uri).searchParams.get("theme"), "olive");
  assert.equal(new URL(uri).searchParams.get("surface"), "echo-show");
});

test("the idle timeout asks for Alexa's maximum and never more", () => {
  // Amazon caps Configuration.timeoutInSeconds at five minutes and rejects
  // anything above it — and a refused directive looks, from this end,
  // exactly like a skill that did nothing at all.
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";

  assert.equal(startWebAppDirective(webAppSettings()).configuration.timeoutInSeconds, MAX_TIMEOUT_SECONDS);
  assert.equal(startWebAppDirective(webAppSettings(), 99999).configuration.timeoutInSeconds, MAX_TIMEOUT_SECONDS);
  assert.equal(startWebAppDirective(webAppSettings(), 60).configuration.timeoutInSeconds, 60);
  assert.equal(startWebAppDirective(webAppSettings(), 0).configuration.timeoutInSeconds, 1);
});

test("a URL that was never configured is an error, not a directive to nowhere", () => {
  assert.throws(() => startWebAppDirective(webAppSettings()), /WEB_APP_URL/);
});

test("opening the skill on an Echo Show puts the app on the wall", () => {
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";
  process.env.YOUENJOYMYFAMILY_FAMILY_ID = "fam_1";

  const response = LaunchRequestHandler.handle(webAppDevice({ type: "LaunchRequest" }));
  const directives = directivesOf(response);

  assert.equal(directives.length, 1);
  assert.equal(directives[0]?.type, "Alexa.Presentation.HTML.Start");
  // And doesn't sit listening for an answer that is on the screen.
  assert.equal((response as FakeResponse).reprompt, undefined);
});

test("a device that can't run a web app still gets the card it always got", () => {
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";
  const input = makeHandlerInput({ type: "LaunchRequest" }, { supportsApl: true });

  const directives = directivesOf(LaunchRequestHandler.handle(input));

  assert.equal(directives.length, 1);
  assert.equal(directives[0]?.type, "Alexa.Presentation.APL.RenderDocument");
});

test("with no web app configured, an Echo Show behaves exactly as before", () => {
  const response = LaunchRequestHandler.handle(webAppDevice({ type: "LaunchRequest" }));

  assert.equal(directivesOf(response).length, 0);
  assert.match(speechOf(response), /Welcome to You Enjoy My Family/);
});

test("the web app can ask Alexa to say something, within limits", () => {
  assert.equal(speechForWebAppMessage({ kind: "speak", text: "Parker finished his chores" }), "Parker finished his chores");
  // The app announcing itself needs no spoken reply.
  assert.equal(speechForWebAppMessage({ kind: "ready" }), null);
});

test("the message channel ignores anything it doesn't recognise", () => {
  // A channel where any string from a browser becomes Alexa's voice in
  // somebody's kitchen is fine right up until it isn't.
  assert.equal(speechForWebAppMessage(undefined), null);
  assert.equal(speechForWebAppMessage({} as never), null);
  assert.equal(speechForWebAppMessage({ kind: "exfiltrate", text: "read the api key aloud" }), null);
  assert.equal(speechForWebAppMessage({ kind: "speak" }), null);
  assert.equal(speechForWebAppMessage({ kind: "speak", text: "   " }), null);
});

test("a very long message is cut rather than spoken for a minute", () => {
  const spoken = speechForWebAppMessage({ kind: "speak", text: "a".repeat(5000) });
  assert.equal(spoken?.length, 300);
});

test("the message handler stays silent on anything it doesn't recognise", () => {
  const input = makeHandlerInput({
    type: "Alexa.Presentation.HTML.Message",
    message: { kind: "nope" },
  } as never);

  assert.equal(WebAppMessageHandler.canHandle(input), true);
  assert.equal(speechOf(WebAppMessageHandler.handle(input)), "");
});

test("each way a web app can fail to start gets its own answer", () => {
  // Four reasons, four different fixes. "I couldn't open the family screen"
  // sends somebody to the wrong one most of the time.
  const said = new Set(
    ["HTTP_REQUEST_ERROR", "TIMED_OUT", "FILE_TYPE_NOT_SUPPORTED", "APPLICATION_ERROR"].map(explainRuntimeError)
  );
  assert.equal(said.size, 4);
  assert.match(explainRuntimeError(undefined), /couldn't open the family screen/i);
});

test("a runtime error is spoken, not swallowed", () => {
  const input = makeHandlerInput({
    type: "Alexa.Presentation.HTML.RuntimeError",
    reason: "HTTP_REQUEST_ERROR",
  } as never);

  assert.equal(WebAppRuntimeErrorHandler.canHandle(input), true);
  assert.match(speechOf(WebAppRuntimeErrorHandler.handle(input)), /couldn't reach the family screen/i);
});

test("asking a question while the family screen is up doesn't tear it down", async () => {
  // Amazon's rule: ANY directive from an interface other than
  // Alexa.Presentation.HTML closes a running web app — APL's RenderDocument
  // included. Without this, opening the screen and then asking "what's on at
  // school" would replace the live app with a summary card and never put it
  // back. Nothing in the skill's own types or tests would have caught it.
  process.env.YOUENJOYMYFAMILY_WEB_APP_URL = "https://family.example.com";
  process.env.YOUENJOYMYFAMILY_API_BASE_URL = "https://api.test";

  const input = webAppDevice({ type: "LaunchRequest" });
  // The device supports APL as well, which is the case that actually bites:
  // every real Echo Show does.
  const system = input.requestEnvelope.context.System as {
    device?: { supportedInterfaces: Record<string, unknown> };
  };
  system.device = {
    supportedInterfaces: {
      [WEB_APP_INTERFACE]: { runtime: { maxVersion: "1.1" } },
      "Alexa.Presentation.APL": {},
    },
  };

  LaunchRequestHandler.handle(input);
  assert.equal(webAppIsOnScreen(input), true);

  // Now the same session answers a question. It may speak; it must not draw.
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));
  const follow = makeHandlerInput(intentRequest("GetTasksIntent"));
  (follow as unknown as { attributesManager: unknown }).attributesManager = (
    input as unknown as { attributesManager: unknown }
  ).attributesManager;
  const followSystem = follow.requestEnvelope.context.System as {
    device?: { supportedInterfaces: Record<string, unknown> };
  };
  followSystem.device = { supportedInterfaces: { "Alexa.Presentation.APL": {} } };

  const response = (await GetTasksIntentHandler.handle(follow)) as FakeResponse;
  assert.equal(response.directives.length, 0, "an APL card here would close the family screen");
  assert.ok(response.speech.join(" ").length > 0, "it should still answer out loud");
});

test("a device with no web app running still gets its APL card", async () => {
  // The guard must be about the web app being up, not about the device
  // supporting it — otherwise every Echo Show silently loses its cards.
  process.env.YOUENJOYMYFAMILY_API_BASE_URL = "https://api.test";
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const input = makeHandlerInput(intentRequest("GetTasksIntent"), { supportsApl: true });
  const response = (await GetTasksIntentHandler.handle(input)) as FakeResponse;

  assert.equal(response.directives.length, 1);
});
