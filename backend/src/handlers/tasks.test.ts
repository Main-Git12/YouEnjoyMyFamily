import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, appliesOn } from "./tasks";
import type { TaskItem, TaskCompletionItem } from "../types";
import { mockFamilyAuth } from "../lib/authTestSupport";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> & { method: string }): APIGatewayProxyEventV2 {
  const { method, ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...rest,
  } as APIGatewayProxyEventV2;
}

const task = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  PK: "FAMILY#fam_1",
  SK: "TASK#t1",
  GSI1PK: "TASK#t1",
  GSI1SK: "DUE#9999-12-31",
  entityType: "TASK",
  familyId: "fam_1",
  taskId: "t1",
  title: "Wipe Table",
  assignedTo: "Parker",
  dueDate: null,
  gemValue: 10,
  dueWindow: "after_dinner",
  recurrence: "daily",
  completedOn: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

const completion = (overrides: Partial<TaskCompletionItem> = {}): TaskCompletionItem => ({
  PK: "FAMILY#fam_1",
  SK: "COMPLETION#2026-09-23#t1",
  entityType: "TASK_COMPLETION",
  familyId: "fam_1",
  taskId: "t1",
  date: "2026-09-23",
  title: "Wipe Table",
  memberId: "Parker",
  gemsAwarded: 10,
  completedAt: "2026-09-23T19:00:00Z",
  ...overrides,
});

/** Routes the two SK prefixes the handler queries to separate result sets. */
function mockQueries({ tasks = [], completions = [] }: { tasks?: TaskItem[]; completions?: TaskCompletionItem[] }) {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const values = input.ExpressionAttributeValues ?? {};
    if (values[":prefix"] === "TASK#") return { Items: tasks };
    if (typeof values[":from"] === "string" && values[":from"].startsWith("COMPLETION#")) return { Items: completions };
    return { Items: [] };
  });
}

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("rejects a request with the wrong API key", async () => {
  mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers: { authorization: "Bearer wrong" } })
  );
  assert.equal(result.statusCode, 401);
});

test("appliesOn puts a daily chore on every day", () => {
  const daily = task({ recurrence: "daily" });
  assert.equal(appliesOn(daily, "2026-09-23"), true); // Wednesday
  assert.equal(appliesOn(daily, "2026-09-26"), true); // Saturday
});

test("appliesOn keeps a weekday chore off the weekend, and vice versa", () => {
  const weekdays = task({ recurrence: "weekdays" });
  const weekends = task({ recurrence: "weekends" });
  // 2026-09-25 is a Friday, 26th Saturday, 27th Sunday, 28th Monday.
  assert.equal(appliesOn(weekdays, "2026-09-25"), true);
  assert.equal(appliesOn(weekdays, "2026-09-26"), false);
  assert.equal(appliesOn(weekdays, "2026-09-27"), false);
  assert.equal(appliesOn(weekdays, "2026-09-28"), true);
  assert.equal(appliesOn(weekends, "2026-09-25"), false);
  assert.equal(appliesOn(weekends, "2026-09-26"), true);
  assert.equal(appliesOn(weekends, "2026-09-27"), true);
});

test("appliesOn reads the weekday from the date itself, not the server's timezone", () => {
  // Parsed as local time, 2026-09-26 west of UTC reports Friday and a
  // weekend chore would go missing on the Saturday it belongs to.
  const original = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  try {
    assert.equal(appliesOn(task({ recurrence: "weekends" }), "2026-09-26"), true);
  } finally {
    process.env.TZ = original;
  }
});

test("appliesOn keeps an undone one-off around until someone does it", () => {
  const oneOff = task({ recurrence: "none", dueDate: null, completedOn: null });
  assert.equal(appliesOn(oneOff, "2026-09-23"), true);
  assert.equal(appliesOn(oneOff, "2026-09-24"), true);
});

test("appliesOn retires a one-off after the day it was done, but keeps that day honest", () => {
  const done = task({ recurrence: "none", completedOn: "2026-09-23" });
  assert.equal(appliesOn(done, "2026-09-23"), true);
  assert.equal(appliesOn(done, "2026-09-24"), false);
});

test("appliesOn puts a dated one-off only on its own day", () => {
  const dated = task({ recurrence: "none", dueDate: "2026-09-25" });
  assert.equal(appliesOn(dated, "2026-09-25"), true);
  assert.equal(appliesOn(dated, "2026-09-23"), false);
});

test("GET returns the day's chores, with that day's state merged in", async () => {
  mockQueries({
    tasks: [
      task({ taskId: "t1", title: "Wipe Table", recurrence: "daily" }),
      task({ taskId: "t2", SK: "TASK#t2", title: "Homework", recurrence: "weekdays", gemValue: 10 }),
    ],
    completions: [completion({ taskId: "t1", gemsAwarded: 10 })],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { date: "2026-09-23" },
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "[]") as { taskId: string; status: string; gemsAwarded: number }[];
  assert.deepEqual(
    body.map((t) => [t.taskId, t.status, t.gemsAwarded]),
    [
      ["t1", "done", 10],
      ["t2", "pending", 0],
    ]
  );
});

test("GET leaves out a chore that doesn't belong on the day asked for", async () => {
  mockQueries({ tasks: [task({ recurrence: "weekdays" })] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      // Saturday.
      queryStringParameters: { date: "2026-09-26" },
    })
  );

  assert.deepEqual(JSON.parse(result.body ?? "[]"), []);
});

test("GET for yesterday answers about yesterday, not today", async () => {
  mockQueries({
    tasks: [task({ recurrence: "daily" })],
    completions: [],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { date: "2026-09-22" },
    })
  );

  const body = JSON.parse(result.body ?? "[]") as { date: string; status: string }[];
  assert.equal(body[0]?.date, "2026-09-22");
  assert.equal(body[0]?.status, "pending");
  const completionQuery = ddbMock
    .commandCalls(QueryCommand)
    .map((call) => call.args[0].input.ExpressionAttributeValues?.[":from"])
    .find((from) => typeof from === "string" && from.startsWith("COMPLETION#"));
  assert.equal(completionQuery, "COMPLETION#2026-09-22");
});

test("POST creates a chore that comes back every day", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ title: "Brush Teeth", gemValue: 5, dueWindow: "morning", recurrence: "daily" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.recurrence, "daily");
  assert.equal(written?.completedOn, null);
  // The definition carries no per-day state.
  assert.equal(written?.status, undefined);
  assert.equal(written?.gemsAwarded, undefined);
});

test("POST defaults a chore to a one-off, so nothing repeats by accident", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ title: "Return library books" }),
    })
  );

  assert.equal(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.recurrence, "none");
});

test("completing a chore writes that day's record and pays its own gem value", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task({ gemValue: 20 }) });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-23" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.status, "done");
  assert.equal(body.gemsAwarded, 20);

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.SK, "COMPLETION#2026-09-23#t1");
  assert.equal(written?.gemsAwarded, 20);
  assert.equal(written?.memberId, "Parker");
});

test("ticking the same chore twice in a day pays once", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion({ gemsAwarded: 10 }) });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-23" }),
    })
  );

  assert.equal(JSON.parse(result.body ?? "{}").gemsAwarded, 10);
  // Nothing new written — no second helping of gems.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("a daily chore done yesterday is still waiting this morning", async () => {
  mockQueries({
    tasks: [task({ recurrence: "daily" })],
    // Yesterday's completion is not in today's range.
    completions: [],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { date: "2026-09-24" },
    })
  );

  const body = JSON.parse(result.body ?? "[]") as { status: string; gemsAwarded: number }[];
  assert.equal(body[0]?.status, "pending");
  assert.equal(body[0]?.gemsAwarded, 0);
});

test("un-ticking a chore removes that day's record, and the gems with it", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "pending", date: "2026-09-23" }),
    })
  );

  assert.equal(JSON.parse(result.body ?? "{}").status, "pending");
  assert.equal(JSON.parse(result.body ?? "{}").gemsAwarded, 0);
  assert.equal(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key?.SK, "COMPLETION#2026-09-23#t1");
});

test("finishing a one-off retires it, so it stops turning up tomorrow", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none" }) });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-23" }),
    })
  );

  const definitionWrite = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item)
    .find((item) => item?.entityType === "TASK");
  assert.equal(definitionWrite?.completedOn, "2026-09-23");
});

test("un-ticking a one-off brings it back", async () => {
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none", completedOn: "2026-09-23" }) });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "pending", date: "2026-09-23" }),
    })
  );

  const definitionWrite = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item)
    .find((item) => item?.entityType === "TASK");
  assert.equal(definitionWrite?.completedOn, null);
});

test("PUT edits the chore itself without touching whether it's done", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ gemValue: 25, recurrence: "weekdays" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.gemValue, 25);
  assert.equal(written?.recurrence, "weekdays");
  assert.equal(written?.title, "Wipe Table");
  assert.equal(written?.assignedTo, "Parker");
});

test("PUT can hand a chore to nobody in particular", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ assignedTo: null }),
    })
  );

  assert.equal(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.assignedTo, null);
});

test("PUT for a chore that isn't there returns 404", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "nope" },
      headers,
      body: JSON.stringify({ status: "done" }),
    })
  );

  assert.equal(result.statusCode, 404);
});

test("DELETE removes the chore definition", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", taskId: "t1" }, headers })
  );

  assert.equal(result.statusCode, 200);
  assert.equal(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key?.SK, "TASK#t1");
});

test("GET /task-completions returns what was actually done over a range", async () => {
  mockQueries({ completions: [completion({ taskId: "t1", gemsAwarded: 10 })] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/task-completions",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2026-09-01", end: "2026-09-30" },
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "[]") as { taskId: string; gemsAwarded: number }[];
  assert.equal(body[0]?.gemsAwarded, 10);

  const range = ddbMock
    .commandCalls(QueryCommand)
    .map((call) => call.args[0].input.ExpressionAttributeValues)
    .find((values) => typeof values?.[":from"] === "string" && values[":from"].startsWith("COMPLETION#"));
  assert.equal(range?.[":from"], "COMPLETION#2026-09-01");
});

test("GET /task-completions with no range covers everything, rather than nothing", async () => {
  // `??` instead of `||` here would keep the empty strings and build a
  // range that sorts below every real key — quietly returning no gems at all.
  mockQueries({ completions: [completion()] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/task-completions",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "", end: "" },
    })
  );

  const range = ddbMock
    .commandCalls(QueryCommand)
    .map((call) => call.args[0].input.ExpressionAttributeValues)
    .find((values) => typeof values?.[":from"] === "string" && values[":from"].startsWith("COMPLETION#"));
  assert.equal(range?.[":from"], "COMPLETION#0000-00-00");
});

test("a chore assigned with a stray space belongs to the same child", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ title: "Wipe Table", assignedTo: "  Parker  " }),
    })
  );

  assert.equal(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.assignedTo, "Parker");
});
