import * as Alexa from "ask-sdk-core";
import type { Response } from "ask-sdk-model";

// JSON lives outside tsconfig's rootDir, so a TS `import` would fail; require() sidesteps that.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dashboardCard = require("../apl/dashboardCard.json") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const choreBattleCard = require("../apl/choreBattleCard.json") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gemCastleCard = require("../apl/gemCastleCard.json") as Record<string, unknown>;

const API_BASE_URL = process.env.YOUENJOYMYFAMILY_API_BASE_URL;
// TODO: resolve from the authenticated Alexa household account linking flow
// instead of a fixed id once account linking is implemented.
const FAMILY_ID = process.env.YOUENJOYMYFAMILY_FAMILY_ID ?? "fam_demo";

// Issued once by POST /families (see backend/README.md) for this same fixed
// family; required on every backend call now that the API checks it. Read
// fresh (not cached at module scope) so tests can flip it per case.
function authHeaders(): Record<string, string> {
  const apiKey = process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

interface TaskItem {
  taskId: string;
  title: string;
  status: "pending" | "in_progress" | "done";
  gemsAwarded: number;
}

interface ScheduleEntry {
  scheduleId: string;
  title: string;
}

// Mirrors what mealPlans.ts's listMealPlan / generateGroceryListFromMealPlan
// and groceryCart.ts's listCartItems return — only the fields these
// handlers actually read, per this repo's "no shared code across
// subprojects" convention (frontend/backend/alexa-skill deploy separately).
type MealSlot = "breakfast" | "lunch" | "dinner";

interface MealPlanEntry {
  date: string;
  slot: MealSlot;
  mealName: string;
}

interface CartItemEntry {
  description: string;
  status: "pending" | "unavailable" | "substituted";
}

const MEAL_SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner"];
const MEAL_SLOT_LABELS: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function sortByMealSlot(entries: MealPlanEntry[]): MealPlanEntry[] {
  return [...entries].sort((a, b) => MEAL_SLOT_ORDER.indexOf(a.slot) - MEAL_SLOT_ORDER.indexOf(b.slot));
}

// Mirrors frontend/src/components/gemCastle/index.ts's stage thresholds —
// kept as an independent copy per this repo's "no shared code across
// subprojects" convention (frontend/backend/alexa-skill deploy separately).
interface CastleStage {
  id: string;
  name: string;
  threshold: number;
}

const WATCHTOWER_STAGE: CastleStage = { id: "watchtower", name: "Watchtower", threshold: 0 };
const CASTLE_STAGES: CastleStage[] = [
  WATCHTOWER_STAGE,
  { id: "knights-keep", name: "Knight's Keep", threshold: 25 },
  { id: "rising-castle", name: "Rising Castle", threshold: 75 },
  { id: "grand-fortress", name: "Grand Fortress", threshold: 150 },
  { id: "kingdom-of-gems", name: "Kingdom of Gems", threshold: 300 },
];

interface CastleProgress {
  stage: CastleStage;
  nextStage: CastleStage | null;
  gemsToNextStage: number | null;
}

function getCastleProgress(totalGems: number): CastleProgress {
  let stage = WATCHTOWER_STAGE;
  let stageIndex = 0;

  CASTLE_STAGES.forEach((candidate, index) => {
    if (totalGems >= candidate.threshold) {
      stage = candidate;
      stageIndex = index;
    }
  });

  const nextStage = CASTLE_STAGES[stageIndex + 1] ?? null;
  const gemsToNextStage = nextStage ? nextStage.threshold - totalGems : null;
  return { stage, nextStage, gemsToNextStage };
}

// Mirrors who's visibly present in each frontend castle stage illustration —
// gives the voice response the same "the kingdom is coming alive" narrative
// as the screen, rather than just a number.
function getResidentsPhrase(stageId: string): string {
  switch (stageId) {
    case "knights-keep":
      return "Sir Olive is standing guard";
    case "rising-castle":
      return "Sir Olive and Wren are both home";
    case "grand-fortress":
      return "Sir Olive, Wren, and Ember the dragon are all home";
    case "kingdom-of-gems":
      return "Sir Olive, Wren, and Ember are all home, and the kingdom sparkles";
    default:
      return "";
  }
}

// Several equivalent flavor lines for the same event — picked at random so
// repeat chore completions don't all sound identical. Every line must keep
// the literal "<gems> gems" substring and the member's name, since those are
// the only parts callers (and tests) actually depend on.
type CelebrationLine = (memberName: string, taskTitle: string, gems: number) => string;

const CELEBRATION_LINE_DRAGON_CHASED: CelebrationLine = (memberName, taskTitle, gems) =>
  `A dragon swooped in for "${taskTitle}", but ${memberName}'s knight chased it off and earned ${gems} gems!`;
const CELEBRATION_LINE_HERO: CelebrationLine = (memberName, taskTitle, gems) =>
  `${memberName} battled through "${taskTitle}" like a true hero and claimed ${gems} gems!`;
const CELEBRATION_LINE_DRAGON_FLED: CelebrationLine = (memberName, taskTitle, gems) =>
  `The gem dragon guarding "${taskTitle}" gave up the moment it saw ${memberName} coming, dropping ${gems} gems!`;

export const CHORE_CELEBRATION_LINES: CelebrationLine[] = [
  CELEBRATION_LINE_DRAGON_CHASED,
  CELEBRATION_LINE_HERO,
  CELEBRATION_LINE_DRAGON_FLED,
];

export function pickCelebrationLine(memberName: string, taskTitle: string, gems: number): string {
  const roll = Math.floor(Math.random() * CHORE_CELEBRATION_LINES.length);
  if (roll === 1) return CELEBRATION_LINE_HERO(memberName, taskTitle, gems);
  if (roll === 2) return CELEBRATION_LINE_DRAGON_FLED(memberName, taskTitle, gems);
  return CELEBRATION_LINE_DRAGON_CHASED(memberName, taskTitle, gems);
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

function renderChoreBattle(handlerInput: Alexa.HandlerInput, memberName: string, taskTitle: string, gems: number): void {
  if (!supportsApl(handlerInput)) return;

  handlerInput.responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    document: choreBattleCard,
    datasources: { battle: { memberName, taskTitle, gems } },
  });
}

function renderGemCastle(
  handlerInput: Alexa.HandlerInput,
  stageName: string,
  totalGems: number,
  progressPercent: number,
  progressLabel: string
): void {
  if (!supportsApl(handlerInput)) return;

  handlerInput.responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    document: gemCastleCard,
    datasources: { castle: { stageName, totalGems, progressPercent, progressLabel } },
  });
}

async function fetchJson<T>(path: string): Promise<T> {
  if (!API_BASE_URL) throw new Error("YOUENJOYMYFAMILY_API_BASE_URL is not configured");
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`YouEnjoyMyFamily API error: ${response.status}`);
  return response.json() as Promise<T>;
}

export const LaunchRequestHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput): Response {
    const speakOutput = "Welcome to You Enjoy My Family. You can ask what's on today's schedule, or what the tasks are.";
    renderDashboard(handlerInput, "YouEnjoyMyFamily", ["Ask me about today's schedule or tasks"]);
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

export const GetScheduleIntentHandler: Alexa.RequestHandler = {
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

export const GetTasksIntentHandler: Alexa.RequestHandler = {
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

export const AddTaskIntentHandler: Alexa.RequestHandler = {
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
      if (!API_BASE_URL) throw new Error("YOUENJOYMYFAMILY_API_BASE_URL is not configured");

      const response = await fetch(`${API_BASE_URL}/families/${FAMILY_ID}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(`YouEnjoyMyFamily API error: ${response.status}`);

      return handlerInput.responseBuilder.speak(`Added "${title}" to the tasks.`).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't add that task right now.").getResponse();
    }
  },
};

export const CompleteChoreIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "CompleteChoreIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    const taskTitle = Alexa.getSlotValue(handlerInput.requestEnvelope, "taskTitle");
    const memberName = Alexa.getSlotValue(handlerInput.requestEnvelope, "memberName") || "You";

    if (!taskTitle) {
      return handlerInput.responseBuilder
        .speak("Which chore did you finish?")
        .reprompt("Which chore did you finish?")
        .getResponse();
    }

    try {
      if (!API_BASE_URL) throw new Error("YOUENJOYMYFAMILY_API_BASE_URL is not configured");

      const tasks = await fetchJson<TaskItem[]>(`/families/${FAMILY_ID}/tasks`);
      const match = tasks.find(
        (task) => task.status !== "done" && task.title.toLowerCase().includes(taskTitle.toLowerCase())
      );

      if (!match) {
        return handlerInput.responseBuilder
          .speak(`I couldn't find an open chore called "${taskTitle}".`)
          .getResponse();
      }

      const response = await fetch(`${API_BASE_URL}/families/${FAMILY_ID}/tasks/${match.taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: "done" }),
      });
      if (!response.ok) throw new Error(`YouEnjoyMyFamily API error: ${response.status}`);
      const completed = (await response.json()) as TaskItem;

      const speakOutput = pickCelebrationLine(memberName, match.title, completed.gemsAwarded);
      renderChoreBattle(handlerInput, memberName, match.title, completed.gemsAwarded);
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't mark that chore done right now.").getResponse();
    }
  },
};

export const GetGemCastleIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetGemCastleIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      const tasks = await fetchJson<TaskItem[]>(`/families/${FAMILY_ID}/tasks`);
      const totalGems = tasks.reduce((sum, task) => sum + task.gemsAwarded, 0);
      const { stage, nextStage, gemsToNextStage } = getCastleProgress(totalGems);
      const residents = getResidentsPhrase(stage.id);
      const residentsClause = residents ? ` ${residents}.` : "";

      const speakOutput = nextStage
        ? `Your castle is a ${stage.name} with ${totalGems} gems!${residentsClause} ${gemsToNextStage} more gem${
            gemsToNextStage === 1 ? "" : "s"
          } to grow into a ${nextStage.name}.`
        : `Your castle is a ${stage.name} with ${totalGems} gems!${residentsClause} The kingdom is complete!`;

      const progressPercent = nextStage
        ? Math.min(100, Math.round(((totalGems - stage.threshold) / (nextStage.threshold - stage.threshold)) * 100))
        : 100;
      const progressLabel = nextStage
        ? `${gemsToNextStage} more gem${gemsToNextStage === 1 ? "" : "s"} to reach ${nextStage.name}!`
        : "The kingdom is complete — every hero has come home!";

      renderGemCastle(handlerInput, stage.name, totalGems, progressPercent, progressLabel);
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't check the gem castle right now.").getResponse();
    }
  },
};

export const GetMealPlanIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetMealPlanIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const entries = sortByMealSlot(
        await fetchJson<MealPlanEntry[]>(`/families/${FAMILY_ID}/meal-plan?start=${today}&end=${today}`)
      );

      const speakOutput = entries.length
        ? entries.map((entry) => `${MEAL_SLOT_LABELS[entry.slot]}: ${entry.mealName}`).join(". ") + "."
        : "Nothing's planned for today yet.";

      renderDashboard(
        handlerInput,
        "Today's meals",
        entries.length ? entries.map((entry) => `${MEAL_SLOT_LABELS[entry.slot]}: ${entry.mealName}`) : ["Nothing planned yet"]
      );
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't check the meal plan right now.").getResponse();
    }
  },
};

export const GenerateGroceryListIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GenerateGroceryListIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      if (!API_BASE_URL) throw new Error("YOUENJOYMYFAMILY_API_BASE_URL is not configured");

      const start = new Date();
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);

      const response = await fetch(
        `${API_BASE_URL}/families/${FAMILY_ID}/meal-plan/generate-grocery-list?start=${startDate}&end=${endDate}`,
        { method: "POST", headers: authHeaders() }
      );
      if (!response.ok) throw new Error(`YouEnjoyMyFamily API error: ${response.status}`);
      const result = (await response.json()) as { added: number; skipped: number };

      const speakOutput = result.added
        ? `Added ${result.added} ingredient${result.added === 1 ? "" : "s"} to the grocery list from this week's meal plan${
            result.skipped ? `. ${result.skipped} ${result.skipped === 1 ? "was" : "were"} already on it` : ""
          }.`
        : "Everything from this week's meal plan is already on the grocery list.";

      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't build the grocery list right now.").getResponse();
    }
  },
};

export const GetGroceryListIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "GetGroceryListIntent"
    );
  },
  async handle(handlerInput): Promise<Response> {
    try {
      const items = await fetchJson<CartItemEntry[]>(`/families/${FAMILY_ID}/grocery-cart`);
      const shoppable = items.filter((item) => item.status !== "unavailable");

      const speakOutput = shoppable.length
        ? `The grocery list has ${shoppable.length} item${shoppable.length === 1 ? "" : "s"}: ${shoppable
            .map((item) => item.description)
            .join(", ")}.`
        : "The grocery list is empty.";

      renderDashboard(
        handlerInput,
        "Grocery list",
        shoppable.length ? shoppable.map((item) => item.description) : ["Nothing on the list"]
      );
      return handlerInput.responseBuilder.speak(speakOutput).getResponse();
    } catch (err) {
      console.error(err);
      return handlerInput.responseBuilder.speak("I couldn't check the grocery list right now.").getResponse();
    }
  },
};

export const HelpIntentHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput): Response {
    const speakOutput =
      "You can ask what's on today's schedule, what the tasks are, add a task, say you finished a chore to battle for gems, ask how the gem castle is growing, check today's meal plan, build the grocery list from this week's meals, or ask what's on the grocery list.";
    return handlerInput.responseBuilder.speak(speakOutput).reprompt(speakOutput).getResponse();
  },
};

export const CancelAndStopIntentHandler: Alexa.RequestHandler = {
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

export const SessionEndedRequestHandler: Alexa.RequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput): Response {
    return handlerInput.responseBuilder.getResponse();
  },
};

export const ErrorHandler: Alexa.ErrorHandler = {
  canHandle(): boolean {
    return true;
  },
  handle(handlerInput, error): Response {
    console.error(error);
    return handlerInput.responseBuilder.speak("Sorry, something went wrong. Please try again.").getResponse();
  },
};

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetScheduleIntentHandler,
    GetTasksIntentHandler,
    AddTaskIntentHandler,
    CompleteChoreIntentHandler,
    GetGemCastleIntentHandler,
    GetMealPlanIntentHandler,
    GenerateGroceryListIntentHandler,
    GetGroceryListIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
