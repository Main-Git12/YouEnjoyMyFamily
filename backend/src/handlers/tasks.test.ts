import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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

/** The items of the n-th TransactWrite the handler sent. */
function transactItems(n = 0) {
  return ddbMock.commandCalls(TransactWriteCommand)[n]?.args[0].input.TransactItems ?? [];
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
  ddbMock.on(TransactWriteCommand).resolves({});
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

  // Written in a transaction now (so a one-off's completedOn can't be left
  // behind), conditioned on no record for that day already existing.
  const put = transactItems().find((item) => item.Put)?.Put;
  const written = put?.Item;
  assert.equal(written?.SK, "COMPLETION#2026-09-23#t1");
  assert.equal(written?.gemsAwarded, 20);
  assert.equal(written?.memberId, "Parker");
  assert.equal(put?.ConditionExpression, "attribute_not_exists(PK)");
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
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion() });
  mockQueries({ completions: [completion()] });
  ddbMock.on(TransactWriteCommand).resolves({});
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
  assert.equal(transactItems().find((item) => item.Delete)?.Delete?.Key?.SK, "COMPLETION#2026-09-23#t1");
});

test("finishing a one-off retires it, so it stops turning up tomorrow", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none" }) });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-23" }),
    })
  );

  // Same transaction as the completion row, touching only completedOn.
  const definitionWrite = transactItems().find((item) => item.Update)?.Update;
  assert.equal(definitionWrite?.Key?.SK, "TASK#t1");
  assert.equal(definitionWrite?.UpdateExpression, "SET completedOn = :date, updatedAt = :now");
  assert.equal(definitionWrite?.ExpressionAttributeValues?.[":date"], "2026-09-23");
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("un-ticking a one-off brings it back", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none", completedOn: "2026-09-23" }) });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion() });
  mockQueries({ completions: [completion()] });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "pending", date: "2026-09-23" }),
    })
  );

  const definitionWrite = transactItems()
    .map((item) => item.Update)
    .find((update) => update?.Key?.SK === "TASK#t1");
  assert.equal(definitionWrite?.UpdateExpression, "SET completedOn = :null, updatedAt = :now");
  assert.equal(definitionWrite?.ExpressionAttributeValues?.[":null"], null);
});

test("PUT edits the chore itself without touching whether it's done", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(UpdateCommand).resolves({ Attributes: task({ gemValue: 25, recurrence: "weekdays" }) });
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
  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.equal(written?.ExpressionAttributeValues?.[":gemValue"], 25);
  assert.equal(written?.ExpressionAttributeValues?.[":recurrence"], "weekdays");
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.title, "Wipe Table");
  assert.equal(body.assignedTo, "Parker");
  assert.equal(body.gemValue, 25);
});

test("PUT can hand a chore to nobody in particular", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(UpdateCommand).resolves({ Attributes: task({ assignedTo: null }) });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ assignedTo: null }),
    })
  );

  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.match(written?.UpdateExpression ?? "", /#assignedTo = :assignedTo/);
  assert.equal(written?.ExpressionAttributeValues?.[":assignedTo"], null);
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

// --- T1: every page, not just the first 1MB ---------------------------------

test("GET /task-completions follows LastEvaluatedKey, so the newest completions aren't dropped", async () => {
  // Oldest first: a single page stops about a year in, and everything
  // after it — the newest gems — silently went missing from balances.
  ddbMock.on(QueryCommand).callsFake((input: { ExclusiveStartKey?: Record<string, string> }) =>
    input.ExclusiveStartKey
      ? { Items: [completion({ SK: "COMPLETION#2026-09-23#t1", date: "2026-09-23" })] }
      : {
          Items: [completion({ SK: "COMPLETION#2025-09-01#t1", date: "2025-09-01" })],
          LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "COMPLETION#2025-09-01#t1" },
        }
  );
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/task-completions",
      pathParameters: { familyId: "fam_1" },
      headers,
    })
  );

  const body = JSON.parse(result.body ?? "[]") as { date: string }[];
  assert.deepEqual(body.map((c) => c.date), ["2025-09-01", "2026-09-23"]);
});

test("GET lists every page of chore definitions", async () => {
  ddbMock.on(QueryCommand).callsFake(
    (input: { ExpressionAttributeValues?: Record<string, string>; ExclusiveStartKey?: Record<string, string> }) => {
      if (input.ExpressionAttributeValues?.[":prefix"] !== "TASK#") return { Items: [] };
      return input.ExclusiveStartKey
        ? { Items: [task({ taskId: "t2", SK: "TASK#t2" })] }
        : { Items: [task()], LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "TASK#t1" } };
    }
  );
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers, queryStringParameters: { date: "2026-09-23" } })
  );

  assert.deepEqual((JSON.parse(result.body ?? "[]") as { taskId: string }[]).map((t) => t.taskId), ["t1", "t2"]);
});

// --- T2: a one-off pays once, not once per date ------------------------------

test("a one-off already done yesterday can't be ticked again today from a stale screen", async () => {
  // Screen B loaded before midnight still shows it pending; screen A did
  // it on the 23rd; B taps at 00:05 and sends the 24th.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none", completedOn: "2026-09-23" }) });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-24" }),
    })
  );

  assert.equal(result.statusCode, 409);
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("a one-off's completion and its completedOn are one transaction, guarded against another date", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none" }) });
  ddbMock.on(TransactWriteCommand).resolves({});
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

  // Two separate writes could fail between them and leave the chore
  // pending with its gems paid, ready to pay again.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  const items = transactItems();
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.Put)?.Put?.ConditionExpression, "attribute_not_exists(PK)");
  const update = items.find((item) => item.Update)?.Update;
  assert.match(update?.ConditionExpression ?? "", /attribute_exists\(PK\)/);
  assert.match(update?.ConditionExpression ?? "", /completedOn = :date/);
  assert.match(update?.ConditionExpression ?? "", /attribute_not_exists\(completedOn\)/);
});

test("a one-off finished on another screen for another date while this tick was in flight is refused", async () => {
  // The task read showed it undone; by the time the transaction ran, the
  // other screen had finished it on a different date.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none" }) });
  ddbMock
    .on(TransactWriteCommand)
    .rejects(new TransactionCanceledException({ message: "Transaction cancelled", $metadata: {} }));
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-09-24" }),
    })
  );

  assert.equal(result.statusCode, 409);
});

test("a double-tap that loses the race still answers done, paid once", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  // First look: nothing yet. After the cancelled transaction: the winner's row.
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolvesOnce({ Item: undefined })
    .resolves({ Item: completion({ gemsAwarded: 10 }) });
  ddbMock
    .on(TransactWriteCommand)
    .rejects(new TransactionCanceledException({ message: "Transaction cancelled", $metadata: {} }));
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
  assert.equal(JSON.parse(result.body ?? "{}").status, "done");
});

// --- T3: only the changed fields, and never onto a deleted chore -------------

test("editing a chore writes only the fields being changed, so a tick in flight isn't undone", async () => {
  // A whole-item put from the earlier read put completedOn back to null
  // under a child who'd just ticked it, so it reappeared and paid again.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ recurrence: "none", completedOn: null }) });
  ddbMock
    .on(UpdateCommand)
    .resolves({ Attributes: task({ recurrence: "none", title: "Return books", completedOn: "2026-09-23" }) });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ title: "Return books" }),
    })
  );

  assert.equal(result.statusCode, 200);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.doesNotMatch(input?.UpdateExpression ?? "", /completedOn/);
  assert.equal(input?.ConditionExpression, "attribute_exists(PK)");
  // The answer reflects the row as it now stands, including the tick.
  assert.equal(JSON.parse(result.body ?? "{}").completedOn, "2026-09-23");
});

test("editing a chore deleted a moment ago returns 404 rather than bringing it back", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(UpdateCommand)
    .rejects(new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }));
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ title: "Wipe the table properly" }),
    })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("ticking a recurring chore is conditioned on the chore still existing", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(TransactWriteCommand).resolves({});
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

  // No whole-item write of the definition at all.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  const check = transactItems().find((item) => item.ConditionCheck)?.ConditionCheck;
  assert.equal(check?.Key?.SK, "TASK#t1");
  assert.equal(check?.ConditionExpression, "attribute_exists(PK)");
});

// --- T4: un-ticking can't take back gems already spent -----------------------

test("un-ticking a chore whose gems were already spent on a prize is refused, not driven negative", async () => {
  // Parker hit 50 with today's 10-gem chore and claimed a 50-gem prize.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion({ gemsAwarded: 10 }) });
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const values = input.ExpressionAttributeValues ?? {};
    if (values[":prefix"] === "REWARDCLAIM#") return { Items: [{ memberId: "Parker", gemCost: 50 }] };
    if (typeof values[":from"] === "string" && values[":from"].startsWith("COMPLETION#")) {
      return {
        Items: [
          completion({ SK: "COMPLETION#2026-09-22#t9", taskId: "t9", gemsAwarded: 40 }),
          completion({ gemsAwarded: 10 }),
        ],
      };
    }
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
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

  assert.equal(result.statusCode, 409);
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});

test("un-ticking bumps the child's ledger version, so a claim racing it can't also win", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion({ gemsAwarded: 10 }) });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "GEMLEDGER#Parker" } })
    .resolves({ Item: { version: 2 } });
  mockQueries({ completions: [completion({ gemsAwarded: 10 })] });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "pending", date: "2026-09-23" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const bump = transactItems()
    .map((item) => item.Update)
    .find((update) => update?.Key?.SK === "GEMLEDGER#Parker");
  assert.equal(bump?.ConditionExpression, "#version = :seen");
  assert.equal(bump?.ExpressionAttributeValues?.[":seen"], 2);
});

test("an un-tick that loses a race with a claim is refused with 409", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "COMPLETION#2026-09-23#t1" } })
    .resolves({ Item: completion({ gemsAwarded: 10 }) });
  mockQueries({ completions: [completion({ gemsAwarded: 10 })] });
  ddbMock
    .on(TransactWriteCommand)
    .rejects(new TransactionCanceledException({ message: "Transaction cancelled", $metadata: {} }));
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "pending", date: "2026-09-23" }),
    })
  );

  assert.equal(result.statusCode, 409);
});

// --- T6: real dates, within the chore's life ---------------------------------

test("GET refuses a date that isn't on the calendar", async () => {
  mockQueries({ tasks: [task()] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { date: "2026-02-31" },
    })
  );

  assert.equal(result.statusCode, 400);
});

test("a chore can't be ticked off for a day before it existed", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ createdAt: "2026-09-01T00:00:00Z" }) });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: "2026-08-15" }),
    })
  );

  assert.equal(result.statusCode, 400);
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});

test("a chore can be ticked off on the evening it was created west of UTC", async () => {
  // Created 9pm in Ohio is already the next day in UTC; the screen's own
  // date is the day before createdAt's.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } })
    .resolves({ Item: task({ createdAt: "2026-09-24T01:00:00Z" }) });
  ddbMock.on(TransactWriteCommand).resolves({});
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
});

test("a chore can't be ticked off for a day that hasn't happened yet", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "TASK#t1" } }).resolves({ Item: task() });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      headers,
      body: JSON.stringify({ status: "done", date: future }),
    })
  );

  assert.equal(result.statusCode, 400);
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});
