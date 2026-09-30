import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./routines";
import { mockFamilyAuth } from "../lib/authTestSupport";
import type { RoutineItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string; rawPath?: string }
): APIGatewayProxyEventV2 {
  const { method, rawPath = "/", ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...rest,
  } as APIGatewayProxyEventV2;
}

const MORNING_STEPS = [
  { title: "Get dressed", targetMinutes: 10, memberId: "Parker" },
  { title: "Breakfast", targetMinutes: 15, memberId: null },
  { title: "Shoes and coat", targetMinutes: 4, memberId: null },
];

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("GET lists only routine definitions, never the daily run rows", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ routineId: "r1", name: "School morning" }] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  // The prefix must not also match RUN# rows. `ROUTINERUN#` would have.
  assert.equal(query?.ExpressionAttributeValues?.[":prefix"], "ROUTINE#");
});

test("POST stores the routine, assigns step ids and defaults it active", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({
        name: "School morning",
        kind: "morning",
        anchorTime: "07:52",
        daysOfWeek: [1, 2, 3, 4, 5],
        steps: MORNING_STEPS,
      }),
    })
  );

  assert.equal(result.statusCode, 201);
  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as RoutineItem;
  assert.equal(saved.SK.startsWith("ROUTINE#"), true);
  assert.equal(saved.anchorTime, "07:52");
  assert.equal(saved.active, true);
  assert.equal(saved.steps.length, 3);
  assert.equal(saved.steps.every((step) => typeof step.stepId === "string" && step.stepId.length > 0), true);
  assert.equal(new Set(saved.steps.map((step) => step.stepId)).size, 3, "step ids must be distinct");
  assert.equal(saved.steps[1]?.memberId, null);
});

test("POST rejects an anchor time that isn't HH:MM", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ name: "x", kind: "morning", anchorTime: "7:52am", daysOfWeek: [1], steps: MORNING_STEPS }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST de-duplicates and sorts the days it runs on", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({
        name: "School morning",
        kind: "morning",
        anchorTime: "07:52",
        daysOfWeek: [5, 1, 1, 3],
        steps: MORNING_STEPS,
      }),
    })
  );

  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as RoutineItem;
  assert.deepEqual(saved.daysOfWeek, [1, 3, 5]);
});

test("PUT can switch a routine off without the merge turning it back on", async () => {
  const current: Partial<RoutineItem> = {
    PK: "FAMILY#fam_1",
    SK: "ROUTINE#r1",
    entityType: "ROUTINE",
    familyId: "fam_1",
    routineId: "r1",
    name: "School morning",
    kind: "morning",
    anchorTime: "07:52",
    daysOfWeek: [1, 2, 3, 4, 5],
    steps: [{ stepId: "s1", title: "Get dressed", targetMinutes: 10, memberId: "Parker" }],
    active: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "ROUTINE#r1" } }).resolves({ Item: current });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      body: JSON.stringify({ active: false }),
    })
  );

  assert.equal(result.statusCode, 200);
  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as RoutineItem;
  assert.equal(saved.active, false);
  // Everything not in the patch survives it.
  assert.equal(saved.anchorTime, "07:52");
  assert.equal(saved.steps[0]?.stepId, "s1");
  assert.equal(saved.createdAt, "2025-01-01T00:00:00Z");
});

test("PUT on a routine that isn't there returns 404", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "ROUTINE#missing" } }).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", routineId: "missing" },
      headers,
      body: JSON.stringify({ name: "Renamed" }),
    })
  );
  assert.equal(result.statusCode, 404);
});

test("DELETE removes the definition by key", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", routineId: "r1" }, headers })
  );

  assert.equal(result.statusCode, 200);
  const key = ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key;
  assert.deepEqual(key, { PK: "FAMILY#fam_1", SK: "ROUTINE#r1" });
});

test("PUT /runs writes one row per routine per day, keyed on the caller's own date", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      rawPath: "/families/fam_1/routines/r1/runs",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      body: JSON.stringify({
        date: "2026-09-25",
        startedAt: "2026-09-25T11:05:00.000Z",
        finishedAt: null,
        steps: [
          { stepId: "s1", title: "Get dressed", startedAt: "2026-09-25T11:05:00.000Z", finishedAt: "2026-09-25T11:14:00.000Z" },
          { stepId: "s2", title: "Breakfast", startedAt: "2026-09-25T11:14:00.000Z", finishedAt: null },
        ],
      }),
    })
  );

  assert.equal(result.statusCode, 200);
  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(saved?.SK, "RUN#2026-09-25#r1");
  assert.equal(saved?.entityType, "ROUTINE_RUN");
  assert.equal(saved?.steps.length, 2);
  // A step begun and not ticked is a real outcome, and must stay null rather
  // than being filled in — a duration must never be invented for it.
  assert.equal(saved?.steps[1].finishedAt, null);
});

test("PUT /runs is idempotent — re-sending the same run rewrites the same key", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const body = JSON.stringify({
    date: "2026-09-25",
    startedAt: "2026-09-25T11:05:00.000Z",
    finishedAt: null,
    steps: [{ stepId: "s1", title: "Get dressed", startedAt: "2026-09-25T11:05:00.000Z", finishedAt: null }],
  });
  const event = makeEvent({
    method: "PUT",
    rawPath: "/families/fam_1/routines/r1/runs",
    pathParameters: { familyId: "fam_1", routineId: "r1" },
    headers,
    body,
  });

  await handler(event);
  await handler(event);

  const keys = ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item?.SK);
  assert.deepEqual(keys, ["RUN#2026-09-25#r1", "RUN#2026-09-25#r1"]);
});

test("GET /runs queries the RUN# range and keeps only this routine's rows", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { routineId: "r1", date: "2026-09-24", steps: [] },
      { routineId: "r2", date: "2026-09-24", steps: [] },
    ],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/routines/r1/runs",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      queryStringParameters: { start: "2026-09-01", end: "2026-09-25" },
    })
  );

  assert.equal(result.statusCode, 200);
  const returned = JSON.parse(result.body ?? "[]") as { routineId: string }[];
  assert.deepEqual(returned.map((run) => run.routineId), ["r1"]);
  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":from"], "RUN#2026-09-01");
});

test("GET /runs with no date range still builds a range that can match", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/routines/r1/runs",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      queryStringParameters: { start: "", end: "" },
    })
  );

  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  // An empty string kept as-is would sort below every real RUN# key.
  assert.equal(query?.ExpressionAttributeValues?.[":from"], "RUN#0000-00-00");
});

test("PUT /runs rejects a body whose date isn't a date", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "PUT",
      rawPath: "/families/fam_1/routines/r1/runs",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      body: JSON.stringify({ date: "yesterday", steps: [] }),
    })
  );
  assert.equal(result.statusCode, 400);
});

/** Serves rows the way DynamoDB does past 1MB: in pages, linked by LastEvaluatedKey. */
function pagedQuery(pages: unknown[][]) {
  ddbMock.on(QueryCommand).callsFake((input: { ExclusiveStartKey?: { page: number } }) => {
    const page = input.ExclusiveStartKey?.page ?? 0;
    return { Items: pages[page] ?? [], LastEvaluatedKey: page + 1 < pages.length ? { page: page + 1 } : undefined };
  });
}

test("GET /runs reads every page, not just the first 1MB", async () => {
  // The rows for every routine share one key range and are separated by
  // routineId afterwards. A truncated first page therefore doesn't just
  // return fewer runs — here it returns *none* of r1's, and the median
  // built from what's left would still be shown as a measured fact.
  pagedQuery([
    [{ routineId: "r2", date: "2026-09-20", steps: [] }],
    [{ routineId: "r1", date: "2026-09-21", steps: [] }, { routineId: "r1", date: "2026-09-22", steps: [] }],
  ]);
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/routines/r1/runs",
      pathParameters: { familyId: "fam_1", routineId: "r1" },
      headers,
      queryStringParameters: { start: "2026-09-01", end: "2026-09-25" },
    })
  );

  assert.equal(result.statusCode, 200);
  const runs = JSON.parse(result.body ?? "[]") as { date: string }[];
  assert.deepEqual(runs.map((run) => run.date), ["2026-09-21", "2026-09-22"]);
});

test("GET /routines reads every page", async () => {
  pagedQuery([[{ routineId: "r1", kind: "morning" }], [{ routineId: "r2", kind: "bedtime" }]]);
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  const routines = JSON.parse(result.body ?? "[]") as { kind: string }[];
  // A household with a morning and a bedtime routine must get both, or the
  // screen silently stops running one of them.
  assert.deepEqual(routines.map((routine) => routine.kind), ["morning", "bedtime"]);
});
