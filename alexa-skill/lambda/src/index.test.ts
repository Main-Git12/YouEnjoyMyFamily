import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LaunchRequestHandler,
  GetScheduleIntentHandler,
  GetTasksIntentHandler,
  AddTaskIntentHandler,
  CompleteChoreIntentHandler,
  GetGemCastleIntentHandler,
  GetPrizeProgressIntentHandler,
  GetMealPlanIntentHandler,
  GenerateGroceryListIntentHandler,
  GetGroceryListIntentHandler,
  AddGroceryItemIntentHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  SessionEndedRequestHandler,
  ErrorHandler,
  CHORE_CELEBRATION_LINES,
  familyToday,
  familyMinutesIntoDay,
  minutesFromClockString,
  addDaysToIsoDate,
  isPastDueWindow,
  describeChore,
  gemsByChild,
  describePrizeProgress,
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

test("GetTasksIntentHandler says who each chore belongs to and what it pays", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([
          { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", status: "pending", gemValue: 10, dueWindow: "anytime", gemsAwarded: 0 },
        ]),
        { status: 200 }
      )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetTasksIntent"));
  const response = (await GetTasksIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /There is 1 chore left: Parker's Wipe Table, worth 10 gems\./);
});

test("GetTasksIntentHandler leaves finished chores out of what's left", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([
          { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", status: "done", gemValue: 10, dueWindow: "anytime", gemsAwarded: 10 },
          { taskId: "t2", title: "Take a bath", assignedTo: "Isla", status: "pending", gemValue: 5, dueWindow: "anytime", gemsAwarded: 0 },
        ]),
        { status: 200 }
      )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetTasksIntent"));
  const response = (await GetTasksIntentHandler.handle(handlerInput)) as FakeResponse;

  const speech = speechOf(response);
  assert.match(speech, /1 chore left/);
  assert.match(speech, /Isla's Take a bath/);
  assert.doesNotMatch(speech, /Wipe Table/);
});

test("GetTasksIntentHandler celebrates rather than reciting when nothing is left", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([{ taskId: "t1", title: "Wipe Table", assignedTo: "Parker", status: "done", gemValue: 10, gemsAwarded: 10 }]),
        { status: 200 }
      )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetTasksIntent"));
  const response = (await GetTasksIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Every chore is done/);
});

test("GetTasksIntentHandler points out a chore whose part of the day has gone", async () => {
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
  // Half nine at night, so the after-dinner window has closed.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 23, 21, 30) });
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([
          { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", status: "pending", gemValue: 10, dueWindow: "after_dinner", gemsAwarded: 0 },
        ]),
        { status: 200 }
      )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetTasksIntent"));
  const response = (await GetTasksIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Wipe Table was meant for after dinner/);
  mock.timers.reset();
});

test("describeChore leaves out a gem value nobody set, rather than saying zero gems", () => {
  assert.equal(describeChore({ taskId: "t1", title: "Feed the fish", status: "pending", gemsAwarded: 0 }), "Feed the fish");
});

test("isPastDueWindow reads the family's clock, not the Lambda's", () => {
  // Half nine at night in Chicago is half three in the morning, UTC. Judging
  // "past bedtime" on the server clock would get this exactly backwards.
  const night = new Date("2026-09-24T02:30:00Z");
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "America/Chicago";
  assert.equal(isPastDueWindow("bedtime", night), true);
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
  assert.equal(isPastDueWindow("bedtime", night), false);
});

test("isPastDueWindow never calls an anytime chore late", () => {
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
  assert.equal(isPastDueWindow("anytime", new Date("2026-09-23T23:59:00Z")), false);
  assert.equal(isPastDueWindow(undefined, new Date("2026-09-23T23:59:00Z")), false);
});

test("familyMinutesIntoDay reads the wall clock where the family lives", () => {
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
  assert.equal(familyMinutesIntoDay(new Date("2026-09-23T00:00:00Z")), 0);
  assert.equal(familyMinutesIntoDay(new Date("2026-09-23T21:30:00Z")), 21 * 60 + 30);
});

test("minutesFromClockString folds midnight to zero however this runtime spells it", () => {
  // Some ICU builds render midnight as 24:00, others as 00:00.
  assert.equal(minutesFromClockString("00:00"), 0);
  assert.equal(minutesFromClockString("24:00"), 0);
  assert.equal(minutesFromClockString("21:30"), 21 * 60 + 30);
});

test("familyMinutesIntoDay falls back to UTC rather than taking the response down", () => {
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "Not/AZone";
  mock.method(console, "error", () => {});
  assert.equal(familyMinutesIntoDay(new Date("2026-09-23T08:15:00Z")), 8 * 60 + 15);
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
});

test("gemsByChild sums each child's own chores and ignores unassigned ones", () => {
  const totals = gemsByChild([
    { taskId: "t1", title: "a", assignedTo: "Parker", status: "done", gemsAwarded: 10 },
    { taskId: "t2", title: "b", assignedTo: "Parker", status: "done", gemsAwarded: 20 },
    { taskId: "t3", title: "c", assignedTo: "Isla", status: "done", gemsAwarded: 5 },
    { taskId: "t4", title: "d", assignedTo: null, status: "done", gemsAwarded: 100 },
  ]);
  assert.deepEqual(totals, { Parker: 30, Isla: 5 });
});

test("describePrizeProgress counts down, and stops at earned rather than going negative", () => {
  assert.match(describePrizeProgress({ memberId: "Parker", title: "a LEGO set", gemCost: 50 }, 30), /needs 20 more for a LEGO set/);
  assert.match(describePrizeProgress({ memberId: "Parker", title: "a LEGO set", gemCost: 50 }, 80), /has earned a LEGO set/);
});

test("GetPrizeProgressIntentHandler reads one child's progress when asked about them", async () => {
  mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("reward-goals")
      ? new Response(
          JSON.stringify([
            { memberId: "Parker", title: "a LEGO set", gemCost: 50 },
            { memberId: "Isla", title: "roller skates", gemCost: 25 },
          ]),
          { status: 200 }
        )
      : new Response(
          JSON.stringify([
            { taskId: "t1", title: "a", assignedTo: "Parker", status: "done", gemValue: 10, gemsAwarded: 30 },
            { taskId: "t2", title: "b", assignedTo: "Isla", status: "done", gemValue: 5, gemsAwarded: 25 },
          ]),
          { status: 200 }
        )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetPrizeProgressIntent", { memberName: "parker" }));
  const response = (await GetPrizeProgressIntentHandler.handle(handlerInput)) as FakeResponse;

  const speech = speechOf(response);
  assert.match(speech, /Parker has 30 gems and needs 20 more for a LEGO set/);
  assert.doesNotMatch(speech, /Isla/);
});

test("GetPrizeProgressIntentHandler reads the whole board when nobody is named", async () => {
  mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("reward-goals")
      ? new Response(JSON.stringify([{ memberId: "Isla", title: "roller skates", gemCost: 25 }]), { status: 200 })
      : new Response(
          JSON.stringify([{ taskId: "t2", title: "b", assignedTo: "Isla", status: "done", gemValue: 5, gemsAwarded: 25 }]),
          { status: 200 }
        )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetPrizeProgressIntent"));
  const response = (await GetPrizeProgressIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Isla has earned roller skates/);
});

test("GetPrizeProgressIntentHandler says where to set one when a child has no prize yet", async () => {
  mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("reward-goals")
      ? new Response(JSON.stringify([]), { status: 200 })
      : new Response(JSON.stringify([]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetPrizeProgressIntent", { memberName: "Parker" }));
  const response = (await GetPrizeProgressIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Parker hasn't picked a prize yet/);
});

test("GetPrizeProgressIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetPrizeProgressIntent"));
  const response = (await GetPrizeProgressIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't check the prize board/i);
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

test("GetGemCastleIntentHandler reports the current stage, its residents, and progress toward the next one", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag", status: "done", gemsAwarded: 50 }]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetGemCastleIntent"), { supportsApl: true });
  const response = (await GetGemCastleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Knight's Keep/);
  assert.match(speechOf(response), /Sir Olive is standing guard/);
  assert.match(speechOf(response), /50 gems/);
  assert.match(speechOf(response), /25 more gem/);
  assert.equal(response.directives.length, 1);
});

test("GetGemCastleIntentHandler reports the completed kingdom at the top stage with singular phrasing intact", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag", status: "done", gemsAwarded: 300 }]), { status: 200 })
  );

  const handlerInput = makeHandlerInput(intentRequest("GetGemCastleIntent"));
  const response = (await GetGemCastleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Kingdom of Gems/);
  assert.match(speechOf(response), /Ember are all home/);
  assert.match(speechOf(response), /kingdom is complete/i);
});

test("GetGemCastleIntentHandler reports nobody home yet at the watchtower stage", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GetGemCastleIntent"));
  const response = (await GetGemCastleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Watchtower/);
  assert.match(speechOf(response), /0 gems/);
});

test("GetGemCastleIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetGemCastleIntent"));
  const response = (await GetGemCastleIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't check the gem castle/i);
});

test("familyToday uses the family's configured timezone, not Lambda's UTC clock", () => {
  const previous = process.env.YOUENJOYMYFAMILY_TIME_ZONE;
  // 9:30pm on Sep 19 in New York is already Sep 20 in UTC.
  const lateEvening = new Date("2026-09-20T01:30:00Z");

  try {
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = "America/New_York";
    assert.equal(familyToday(lateEvening), "2026-09-19");

    process.env.YOUENJOYMYFAMILY_TIME_ZONE = "UTC";
    assert.equal(familyToday(lateEvening), "2026-09-20");
  } finally {
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = previous;
  }
});

test("familyToday falls back to UTC rather than breaking every response on a bad timezone", () => {
  const previous = process.env.YOUENJOYMYFAMILY_TIME_ZONE;
  try {
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = "Not/AZone";
    assert.equal(familyToday(new Date("2026-09-20T01:30:00Z")), "2026-09-20");
  } finally {
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = previous;
  }
});

test("addDaysToIsoDate rolls across month and year boundaries", () => {
  assert.equal(addDaysToIsoDate("2026-09-19", 6), "2026-09-25");
  assert.equal(addDaysToIsoDate("2026-12-30", 3), "2027-01-02");
});

test("GetMealPlanIntentHandler asks the backend for the family's local date", async () => {
  const previous = process.env.YOUENJOYMYFAMILY_TIME_ZONE;
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "America/New_York";
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 20, 1, 30) });

  let requestedUrl = "";
  mock.method(globalThis, "fetch", async (url: string) => {
    requestedUrl = url;
    return new Response(JSON.stringify([]), { status: 200 });
  });

  try {
    await GetMealPlanIntentHandler.handle(makeHandlerInput(intentRequest("GetMealPlanIntent")));
  } finally {
    mock.timers.reset();
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = previous;
  }

  assert.match(requestedUrl, /start=2026-09-19&end=2026-09-19/);
});

test("GenerateGroceryListIntentHandler spans the coming 7 days from the family's local date", async () => {
  const previous = process.env.YOUENJOYMYFAMILY_TIME_ZONE;
  process.env.YOUENJOYMYFAMILY_TIME_ZONE = "America/New_York";
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 20, 1, 30) });

  let requestedUrl = "";
  mock.method(globalThis, "fetch", async (url: string) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ added: 0, skipped: 0 }), { status: 200 });
  });

  try {
    await GenerateGroceryListIntentHandler.handle(makeHandlerInput(intentRequest("GenerateGroceryListIntent")));
  } finally {
    mock.timers.reset();
    process.env.YOUENJOYMYFAMILY_TIME_ZONE = previous;
  }

  assert.match(requestedUrl, /start=2026-09-19&end=2026-09-25/);
});

test("GetMealPlanIntentHandler speaks each planned slot in breakfast/lunch/dinner order", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify([
        { date: "2025-01-15", slot: "dinner", mealName: "Tacos" },
        { date: "2025-01-15", slot: "breakfast", mealName: "Pancakes" },
      ]),
      { status: 200 }
    )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetMealPlanIntent"), { supportsApl: true });
  const response = (await GetMealPlanIntentHandler.handle(handlerInput)) as FakeResponse;

  const speech = speechOf(response);
  assert.match(speech, /Breakfast: Pancakes/);
  assert.match(speech, /Dinner: Tacos/);
  assert.ok(speech.indexOf("Breakfast") < speech.indexOf("Dinner"));
  assert.equal(response.directives.length, 1);
});

test("GetMealPlanIntentHandler reports nothing planned on an empty day", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GetMealPlanIntent"));
  const response = (await GetMealPlanIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /nothing's planned for today/i);
});

test("GetMealPlanIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetMealPlanIntent"));
  const response = (await GetMealPlanIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't check the meal plan/i);
});

test("GenerateGroceryListIntentHandler reports how many ingredients were added and skipped", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ added: 3, skipped: 1 }), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GenerateGroceryListIntent"));
  const response = (await GenerateGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /Added 3 ingredients/);
  assert.match(speechOf(response), /1 was already on it/);
});

test("GenerateGroceryListIntentHandler reports when nothing new was added", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ added: 0, skipped: 2 }), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GenerateGroceryListIntent"));
  const response = (await GenerateGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /already on the grocery list/i);
});

test("GenerateGroceryListIntentHandler degrades gracefully when the backend rejects the request", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GenerateGroceryListIntent"));
  const response = (await GenerateGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't build the grocery list/i);
});

test("GetGroceryListIntentHandler speaks pending and substituted items but excludes unavailable ones", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify([
        { description: "Milk", status: "pending" },
        { description: "Rare cheese", status: "unavailable" },
        { description: "Penne", status: "substituted" },
      ]),
      { status: 200 }
    )
  );

  const handlerInput = makeHandlerInput(intentRequest("GetGroceryListIntent"), { supportsApl: true });
  const response = (await GetGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  const speech = speechOf(response);
  assert.match(speech, /Milk/);
  assert.match(speech, /Penne/);
  assert.doesNotMatch(speech, /Rare cheese/);
  assert.match(speech, /2 items/);
  assert.equal(response.directives.length, 1);
});

test("GetGroceryListIntentHandler reports an empty list", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([]), { status: 200 }));

  const handlerInput = makeHandlerInput(intentRequest("GetGroceryListIntent"));
  const response = (await GetGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /grocery list is empty/i);
});

test("GetGroceryListIntentHandler degrades gracefully when the backend is unreachable", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("GetGroceryListIntent"));
  const response = (await GetGroceryListIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't check the grocery list/i);
});

test("AddGroceryItemIntentHandler asks what to add when the slot is empty", async () => {
  const handlerInput = makeHandlerInput(intentRequest("AddGroceryItemIntent", {}));
  const response = (await AddGroceryItemIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /what should I add to the grocery list/i);
});

test("AddGroceryItemIntentHandler posts the item and confirms it", async () => {
  let seen: { url?: string; init?: RequestInit } = {};
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ itemId: "c1" }), { status: 201 });
  });

  const handlerInput = makeHandlerInput(intentRequest("AddGroceryItemIntent", { itemDescription: "oat milk" }));
  const response = (await AddGroceryItemIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(seen.url ?? "", /\/grocery-cart\/items$/);
  assert.equal(seen.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(seen.init?.body)), { description: "oat milk" });
  assert.match(speechOf(response), /Added oat milk to the grocery list/);
});

test("AddGroceryItemIntentHandler reports failure without throwing when the backend rejects the write", async () => {
  mock.method(globalThis, "fetch", async () => new Response("error", { status: 500 }));

  const handlerInput = makeHandlerInput(intentRequest("AddGroceryItemIntent", { itemDescription: "oat milk" }));
  const response = (await AddGroceryItemIntentHandler.handle(handlerInput)) as FakeResponse;

  assert.match(speechOf(response), /couldn't add that to the grocery list/i);
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
