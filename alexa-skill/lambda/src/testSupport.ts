import type * as Alexa from "ask-sdk-core";
import type { IntentRequest, Response } from "ask-sdk-model";

/**
 * ask-sdk-core's real HandlerInput/ResponseBuilder types carry far more than
 * our handlers touch (attributesManager, serviceClientFactory, the full
 * Lambda Context, ...). Rather than construct a fully-compliant fake, this
 * builds exactly what LaunchRequestHandler/GetTasksIntentHandler/etc. read
 * (requestEnvelope.request, .context.System.device, and the chainable
 * responseBuilder), then casts once at this boundary — the single place a
 * test double for a large third-party interface is allowed to do that.
 */
// Deliberately not `extends Response` — the real type's `directives` field
// (Directive[]) would conflict with the plain-object list we collect here
// for assertions; this is a test double, not a production response value.
export interface FakeResponse {
  speech: string[];
  directives: unknown[];
  outputSpeech?: Response["outputSpeech"];
  reprompt?: Response["reprompt"];
}

export function makeResponseBuilder() {
  const speech: string[] = [];
  const directives: unknown[] = [];
  let repromptText: string | undefined;

  const builder = {
    speak(text: string) {
      speech.push(text);
      return builder;
    },
    reprompt(text: string) {
      repromptText = text;
      return builder;
    },
    addDirective(directive: unknown) {
      directives.push(directive);
      return builder;
    },
    getResponse(): FakeResponse {
      return {
        speech,
        directives,
        outputSpeech: speech.length ? { type: "SSML", ssml: `<speak>${speech.join(" ")}</speak>` } : undefined,
        reprompt: repromptText
          ? { outputSpeech: { type: "SSML", ssml: `<speak>${repromptText}</speak>` } }
          : undefined,
      };
    },
  };

  return builder;
}

export function makeHandlerInput(
  request: IntentRequest | { type: "LaunchRequest" } | { type: "SessionEndedRequest" },
  { supportsApl = false }: { supportsApl?: boolean } = {}
): Alexa.HandlerInput {
  const fake = {
    requestEnvelope: {
      version: "1.0",
      request,
      context: {
        System: {
          device: supportsApl ? { supportedInterfaces: { "Alexa.Presentation.APL": {} } } : { supportedInterfaces: {} },
        },
      },
    },
    responseBuilder: makeResponseBuilder(),
  };

  return fake as unknown as Alexa.HandlerInput;
}

export function intentRequest(name: string, slots: Record<string, string> = {}): IntentRequest {
  return {
    type: "IntentRequest",
    requestId: "test-request-id",
    timestamp: new Date().toISOString(),
    locale: "en-US",
    dialogState: "COMPLETED",
    intent: {
      name,
      confirmationStatus: "NONE",
      slots: Object.fromEntries(
        Object.entries(slots).map(([slotName, value]) => [
          slotName,
          { name: slotName, value, confirmationStatus: "NONE" as const },
        ])
      ),
    },
  };
}
