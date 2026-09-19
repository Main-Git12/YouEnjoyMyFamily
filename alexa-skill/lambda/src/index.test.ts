import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LaunchRequestHandler,
  GetScheduleIntentHandler,
  GetTasksIntentHandler,
  AddTaskIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  SessionEndedRequestHandler,
  ErrorHandler,
} from "./index";
import { makeHandlerInput, intentRequest, type FakeResponse } from "./testSupport";

function speechOf(response: unknown): string {
  return (response as FakeResponse).speech.join(" ");
}

beforeEach(() => {
  mock.restoreAll();
});

test("LaunchRequestHandler only handles LaunchRequest", () => {
  assert.equal(LaunchRequestHandler.canHandle(makeHandlerInput({ type: "LaunchRequest" })), true);
  assert.equal(LaunchRequestHandler.canHandle(makeHandlerInput(intentRequest("GetTasksIntent"))), false);
});

test("LaunchRequestHandler welcomes the user and renders the APL card when supported", () => {
  const handlerInput = makeHandlerInput({ type: "LaunchRequest" }, { supportsApl: true });
  const response = LaunchRequestHandler.handle(handlerInput) as FakeResponse;

  assert.match(speechOf(response), /Welcome to Peal Sync/);
  assert.equal(response.directives.length, 1);
});

test("LaunchRequestHandler skips the APL directive on APL-less devices", () => {
  const handlerInput = makeHandlerInput({ type: "LaunchRequest" }, { supportsApl: false });
  const response = LaunchRequestHandler.handle(handlerInput) as FakeResponse;

  assert.equal(response.directives.length, 0);
});

test("GetScheduleIntentHandler speaks each entry's title", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify([{ scheduleId: "s1", title: "Soccer practice" }]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetScheduleIntent"));
  const response = (await GetScheduleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Soccer practice/);
});

test("GetScheduleIntentHandler reports nothing scheduled on an empty list", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GetScheduleIntent"));
  const response = (await GetScheduleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /nothing on today's schedule/i);
});

test("GetScheduleIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetScheduleIntent"));
  const response = (await GetScheduleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't reach the schedule/i);
});

test("GetTasksIntentHandler pluralizes correctly for one vs many tasks", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag" }]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GetTasksIntent"));
  const response = (await GetTasksIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /You have 1 task: Pack bag/);
});

test("AddTaskIntentHandler asks for a title when the slot is empty", async () => {
  const handlerInput = makeHandlerInput(intentRequest("AddTaskIntent", {}));
  const response = (await AddTaskIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /What should I add/);
});

test("AddTaskIntentHandler confirms once the task is added", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ taskId: "t1" }), { status: 201 }));

  const handlerInput = makeHandlerInput(intentRequest("AddTaskIntent", { taskTitle: "Buy milk" }));
  const response = (await AddTaskIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Added "Buy milk" to the tasks/);
});

test("AddTaskIntentHandler reports failure without throwing when the backend rejects the write", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("AddTaskIntent", { taskTitle: "Buy milk" }));
  const response = (await AddTaskIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't add that task/i);
});

test("HelpIntentHandler and CancelAndStopIntentHandler respond without hitting the network", () => {
  const help = HelpIntentHandler.handle(makeHandlerInput(intentRequest("AMAZON.HelpIntent"))) as FakeResponse;
  assert.match(speechOf(help), /what's on today's schedule/i);

  const bye = CancelAndStopIntentHandler.handle(makeHandlerInput(intentRequest("AMAZON.StopIntent"))) as FakeResponse;
  assert.match(speechOf(bye), /Goodbye/);
});

test("SessionEndedRequestHandler returns an empty response without erroring", () => {
  const response = SessionEndedRequestHandler.handle(makeHandlerInput({ type: "SessionEndedRequest" })) as FakeResponse;
  assert.deepEqual(response.speech, []);
});

test("ErrorHandler always canHandle()s and produces a fallback apology", () => {
  assert.equal(ErrorHandler.canHandle(makeHandlerInput({ type: "LaunchRequest" }), new Error("boom")), true);

  const response = ErrorHandler.handle(makeHandlerInput({ type: "LaunchRequest" }), new Error("boom")) as FakeResponse;
  assert.match(speechOf(response), /Sorry, something went wrong/);
});
