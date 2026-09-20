import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LaunchRequestHandler,
  GetScheduleIntentHandler,
  GetTasksIntentHandler,
  AddTaskIntentHandler,
  CompleteChoreIntentHandler,
  GetGemGardenIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  SessionEndedRequestHandler,
  ErrorHandler,
  CHORE_CELEBRATION_LINES,
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

  assert.match(speechOf(response), /Welcome to You Enjoy My Family/);
  assert.equal(response.directives.length, 1);
});

test("LaunchRequestHandler skips the APL directive on APL-less devices", () => {
  const handlerInput = makeHandlerInput({ type: "LaunchRequest" }, { supportsApl: false });
  const response = LaunchRequestHandler.handle(handlerInput) as FakeResponse;

  assert.equal(response.directives.length, 0);
});

test("sends the Authorization header when YOUENJOYMYFAMILY_FAMILY_API_KEY is set", async () => {
  const previous = process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY;
  process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY = "fk_test_key";
  let seenHeaders: RequestInit["headers"];
  mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    seenHeaders = init?.headers;
    return new Response(JSON.stringify([]), { status: 200 });
  });

  try {
    await GetScheduleIntentHandler.handle(makeHandlerInput(intentRequest("GetScheduleIntent")));
  } finally {
    process.env.YOUENJOYMYFAMILY_FAMILY_API_KEY = previous;
  }

  assert.deepEqual(seenHeaders, { Authorization: "Bearer fk_test_key" });
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

test("CompleteChoreIntentHandler asks which chore when the slot is empty", async () => {
  const handlerInput = makeHandlerInput(intentRequest("CompleteChoreIntent", {}));
  const response = (await CompleteChoreIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /which chore/i);
});

test("CompleteChoreIntentHandler sends the child on a dragon battle and awards gems", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    if (!init?.method) {
      return new Response(
        JSON.stringify([{ taskId: "t1", title: "Clean room", status: "pending", gemsAwarded: 0 }]),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ taskId: "t1", title: "Clean room", status: "done", gemsAwarded: 10 }),
      { status: 200 }
    );
  });

  const handlerInput = makeHandlerInput(
    intentRequest("CompleteChoreIntent", { taskTitle: "clean room", memberName: "Isla" }),
    { supportsApl: true }
  );
  const response = (await CompleteChoreIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Isla/);
  assert.match(speechOf(response), /10 gems/);
  assert.equal(response.directives.length, 1);
});

test("CompleteChoreIntentHandler reports when no matching open chore exists", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("CompleteChoreIntent", { taskTitle: "clean room" }));
  const response = (await CompleteChoreIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't find an open chore/i);
});

test("CompleteChoreIntentHandler degrades gracefully when the backend rejects the completion", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    if (!init?.method) {
      return new Response(
        JSON.stringify([{ taskId: "t1", title: "Clean room", status: "pending", gemsAwarded: 0 }]),
        { status: 200 }
      );
    }
    return new Response("error", { status: 500 });
  });

  const handlerInput = makeHandlerInput(intentRequest("CompleteChoreIntent", { taskTitle: "clean room" }));
  const response = (await CompleteChoreIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't mark that chore done/i);
});

test("every CHORE_CELEBRATION_LINES variant keeps the member name and the literal gem count", () => {
  for (const line of CHORE_CELEBRATION_LINES) {
    const text = line("Isla", "Clean room", 10);
    assert.match(text, /Isla/);
    assert.match(text, /10 gems/);
  }
});

test("GetGemGardenIntentHandler reports the current stage and progress toward the next one", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag", status: "done", gemsAwarded: 50 }]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetGemGardenIntent"), { supportsApl: true });
  const response = (await GetGemGardenIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Sprout/);
  assert.match(speechOf(response), /50 gems/);
  assert.match(speechOf(response), /25 more gem/);
  assert.equal(response.directives.length, 1);
});

test("GetGemGardenIntentHandler reports full bloom at the top stage with singular phrasing intact", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag", status: "done", gemsAwarded: 300 }]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetGemGardenIntent"));
  const response = (await GetGemGardenIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Magical Grove/);
  assert.match(speechOf(response), /full bloom/i);
});

test("GetGemGardenIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetGemGardenIntent"));
  const response = (await GetGemGardenIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't check the gem garden/i);
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
