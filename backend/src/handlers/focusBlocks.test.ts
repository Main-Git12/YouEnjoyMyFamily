import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./focusBlocks";
import { mockFamilyAuth } from "../lib/authTestSupport";
import type { FocusBlockItem } from "../types";

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

const BLOCK = {
  memberId: "Paige",
  date: "2026-09-25",
  startedAt: "2026-09-25T13:00:00.000Z",
  endedAt: "2026-09-25T13:52:00.000Z",
  plannedMinutes: 52,
  outcome: "completed",
  matter: "DR-1042",
  note: "Drafted response to agency denial",
};

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("POST records the block and computes what it actually ran for", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "POST", pathParameters: { familyId: "fam_1" }, headers, body: JSON.stringify(BLOCK) })
  );

  assert.equal(result.statusCode, 201);
  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as FocusBlockItem;
  assert.equal(saved.SK.startsWith("FOCUS#2026-09-25#"), true);
  assert.equal(saved.actualMinutes, 52);
  assert.equal(saved.matter, "DR-1042");
  assert.equal(saved.outcome, "completed");
});

test("POST computes the real length rather than trusting the planned one", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      // Planned 52, stopped after 11. What gets billed, and what the app
      // learns from, is the 11.
      body: JSON.stringify({ ...BLOCK, endedAt: "2026-09-25T13:11:00.000Z", outcome: "cut_short" }),
    })
  );

  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as FocusBlockItem;
  assert.equal(saved.plannedMinutes, 52);
  assert.equal(saved.actualMinutes, 11);
});

test("POST never records a negative length when a clock moves under it", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ ...BLOCK, endedAt: "2026-09-25T12:00:00.000Z" }),
    })
  );

  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as FocusBlockItem;
  assert.equal(saved.actualMinutes, 0);
});

test("POST keeps a block with no matter on it", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ ...BLOCK, matter: null, note: null }),
    })
  );

  const saved = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as FocusBlockItem;
  assert.equal(saved.matter, null);
  assert.equal(saved.note, null);
});

test("POST rejects an outcome outside the closed list", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ ...BLOCK, outcome: "sort of finished" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("GET reads a date range of blocks", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ blockId: "b1", actualMinutes: 52 }] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2026-09-01", end: "2026-09-25" },
    })
  );

  assert.equal(result.statusCode, 200);
  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":from"], "FOCUS#2026-09-01");
  assert.equal(query?.ExpressionAttributeValues?.[":to"], "FOCUS#2026-09-25#￿");
});

test("GET with no range still builds a range that can match", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "", end: "" },
    })
  );

  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":from"], "FOCUS#0000-00-00");
});

test("DELETE needs the date, because it's part of the key", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", blockId: "b1" }, headers })
  );
  assert.equal(result.statusCode, 400);
});

test("DELETE removes one line by key", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "DELETE",
      pathParameters: { familyId: "fam_1", blockId: "b1" },
      headers,
      queryStringParameters: { date: "2026-09-25" },
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key, {
    PK: "FAMILY#fam_1",
    SK: "FOCUS#2026-09-25#b1",
  });
});

test("GET reads every page, so a year of blocks isn't silently truncated", async () => {
  // A truncated read here doesn't fail — it produces a confident
  // "100% of your 60-minute blocks ran to the end, over 20 of them" from
  // whatever happened to fit in the first megabyte.
  ddbMock.on(QueryCommand).callsFake((input: { ExclusiveStartKey?: { page: number } }) => {
    const pages = [
      [{ blockId: "b1", plannedMinutes: 60, outcome: "completed" }],
      [{ blockId: "b2", plannedMinutes: 60, outcome: "abandoned" }],
      [{ blockId: "b3", plannedMinutes: 60, outcome: "abandoned" }],
    ];
    const page = input.ExclusiveStartKey?.page ?? 0;
    return { Items: pages[page] ?? [], LastEvaluatedKey: page + 1 < pages.length ? { page: page + 1 } : undefined };
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2026-01-01", end: "2026-09-25" },
    })
  );

  const blocks = JSON.parse(result.body ?? "[]") as { blockId: string }[];
  // Reading only page one says 60-minute blocks always finish. They don't.
  assert.deepEqual(blocks.map((block) => block.blockId), ["b1", "b2", "b3"]);
});
