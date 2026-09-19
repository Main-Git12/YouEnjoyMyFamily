import * as Alexa from "ask-sdk-core";
import type { Response } from "ask-sdk-model";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardCard = require("../apl/dashboardCard.json") as Record<string, unknown>;

const API_BASE_URL = process.env.PEALSYNC_API_BASE_URL;
// TODO: resolve from the authenticated Alexa household account linking flow
// instead of a fixed id once account linking is implemented.
const FAMILY_ID = process.env.PEALSYNC_FAMILY_ID ?? "fam_demo";

interface TaskItem {
  taskId: string;
  title: string;
}

interface ScheduleEntry {
  scheduleId: string;
  title: string;
}

function supportsApl(handlerInput: Alexa.HandlerInput): boolean {
  const supportedInterfaces = handlerInput.requestEnvelope.context.System.device?.supportedInterfaces;
  return Boolean(supportedInterfaces?.["Alexa.Presentation.APL"]);
}

function renderDashboard(handlerInput: Alexa.HandlerInput, heading: string, items: string[]): void {
  if (!supportsApl(handlerInput)) return;

  handlerInput.responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    document: dashboardCard,
    datasources: { dashboard: { heading, items } },
  });
}

async function fetchJson<T>(path: string): Promise<T> {
  if (!API_BASE_URL) throw new Error("PEALSYNC_API_BASE_URL is not configured");
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`PealSync API error: ${response.status}`);
  return response.json() as Promise<T>;
}

const LaunchRequestHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput): Response {
    const speakOutput = "Welcome to Peal Sync. You can ask what's on today's schedule, or what the tasks are.";
    renderDashboard(handlerInput, "PealSync", ["Ask me about today's schedule or tasks"]);
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

const GetScheduleIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetScheduleIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const entries = await fetchJson<ScheduleEntry[]>(`/families/${FAMILY_ID}/schedules?start=${today}&end=${today}`);

      const speakOutput = entries.length
        ? `Today you have ${entries.map((e) => e.title).join(", ")}.`
        : "There's nothing on today's schedule.";

      renderDashboard(handlerInput, "Today's schedule", entries.length ? entries.map((e) => e.title) : ["Nothing scheduled"]);
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't reach the schedule right now.").getResponse();
    }
  },
};

const GetTasksIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetTasksIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      const tasks = await fetchJson<TaskItem[]>(`/families/${FAMILY_ID}/tasks`);
      const speakOutput = tasks.length
        ? `You have ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${tasks.map((t) => t.title).join(", ")}.`
        : "There are no tasks right now.";

      renderDashboard(handlerInput, "Tasks", tasks.length ? tasks.map((t) => t.title) : ["No tasks"]);
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't reach the task list right now.").getResponse();
    }
  },
};

const AddTaskIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AddTaskIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    const title = Alexa.getSlotValue(handlerInput.requestEnvelope, "taskTitle");
    if (!title) {
      return handlerInput.responseBuilder.speak("What should I add to the tasks?").reprompt("What's the task?").getResponse();
    }

    try {
      if (!API_BASE_URL) throw new Error("PEALSYNC_API_BASE_URL is not configured");

      const response = await fetch(`${API_BASE_URL}/families/${FAMILY_ID}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(`PealSync API error: ${response.status}`);

      return handlerInput.responseBuilder.speak(`Added "${title}" to the tasks.`).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't add that task right now.").getResponse();
    }
  },
};

const HelpIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput): Response {
    const speakOutput = "You can ask what's on today's schedule, what the tasks are, or add a task.";
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

const CancelAndStopIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.CancelIntent" ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.StopIntent")
    );
  },
  handle(handlerInput): Response {
    return handlerInput.responseBuilder.speak("Goodbye!").getResponse();
  },
};

const SessionEndedRequestHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput): Response {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler: Alexa.ErrorHandler = {
  canHandle(): boolean {
    return true;
  },
  handle(handlerInput, error): Response {
    console.error(error);
    return handlerInput.responseBuilder.speak("Sorry, something went wrong. Please try again.").getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetScheduleIntentHandler,
    GetTasksIntentHandler,
    AddTaskIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
