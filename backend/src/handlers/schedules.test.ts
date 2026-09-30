import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./schedules";
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

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("GET lists schedule entries in a date range", async () => {
  const items = [{ scheduleId: "s1", date: "2025-01-15", title: "Soccer practice" }];
  ddbMock.on(QueryCommand).resolves({ Items: items });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2025-01-01", end: "2025-01-31" },
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), items);

  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":from"], "SCHEDULE#2025-01-01");
});

test("GET treats blank start/end as 'no filter' rather than a range that matches nothing", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  // This is exactly what the dashboard sends: `?start=&end=`. Read as empty
  // strings, the range becomes SCHEDULE#..SCHEDULE##￿, which sorts below
  // every real SCHEDULE#<date>#<id> key — the schedule card stays empty forever.
  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "", end: "" },
    })
  );

  assert.equal(result.statusCode, 200);
  const values = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues;
  assert.equal(values?.[":from"], "SCHEDULE#0000-00-00");
  assert.equal(values?.[":to"], "SCHEDULE#9999-12-31#￿");

  const realKey = "SCHEDULE#2026-09-20#01JABCDEF";
  assert.ok(realKey >= String(values?.[":from"]) && realKey <= String(values?.[":to"]));
});

test("POST rejects a missing date", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ title: "Soccer practice" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST creates a schedule entry with defaults for optional fields", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ date: "2025-01-15", title: "Soccer practice" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.title, "Soccer practice");
  assert.deepEqual(body.memberIds, []);
  assert.equal(body.startTime, null);
});

test("DELETE requires both scheduleId and a date query param", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", scheduleId: "s1" }, headers })
  );
  assert.equal(result.statusCode, 400);
});

test("DELETE removes a schedule entry", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "DELETE",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { deleted: "s1" });
});

test("PUT edits an entry in place without resending every field", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: {
      PK: "FAMILY#fam_1",
      SK: "SCHEDULE#2025-01-15#s1",
      entityType: "SCHEDULE",
      familyId: "fam_1",
      scheduleId: "s1",
      date: "2025-01-15",
      startTime: "17:30",
      endTime: "18:30",
      title: "Soccer practice",
      memberIds: ["Parker"],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ startTime: "18:00" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.body ?? "{}");
  assert.equal(saved.startTime, "18:00");
  // The fields nobody touched have to survive the edit.
  assert.equal(saved.title, "Soccer practice");
  assert.equal(saved.endTime, "18:30");
  assert.deepEqual(saved.memberIds, ["Parker"]);
  assert.equal(saved.createdAt, "2025-01-01T00:00:00.000Z");
  // Same day, so nothing should have been deleted.
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});

test("PUT clears a start time when one is explicitly set to null", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: {
      PK: "FAMILY#fam_1",
      SK: "SCHEDULE#2025-01-15#s1",
      entityType: "SCHEDULE",
      familyId: "fam_1",
      scheduleId: "s1",
      date: "2025-01-15",
      startTime: "17:30",
      endTime: null,
      title: "Soccer practice",
      memberIds: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ startTime: null }),
    })
  );

  assert.equal(JSON.parse(result.body ?? "{}").startTime, null);
});

test("PUT that moves an entry to another day does not leave it on the old one", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: {
      PK: "FAMILY#fam_1",
      SK: "SCHEDULE#2025-01-15#s1",
      entityType: "SCHEDULE",
      familyId: "fam_1",
      scheduleId: "s1",
      date: "2025-01-15",
      startTime: null,
      endTime: null,
      title: "Soccer practice",
      memberIds: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ date: "2025-01-16" }),
    })
  );

  assert.equal(result.statusCode, 200);
  // One transaction, not a put then a delete: if the delete failed on its
  // own, the entry would sit on both days.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
  const [put, del] = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
  assert.equal(put?.Put?.Item?.SK, "SCHEDULE#2025-01-16#s1");
  assert.equal(put?.Put?.ConditionExpression, "attribute_not_exists(PK)");
  assert.equal(del?.Delete?.Key?.SK, "SCHEDULE#2025-01-15#s1");
  assert.equal(del?.Delete?.ConditionExpression, "attribute_exists(PK)");
});

const soccerOnTheFifteenth = {
  PK: "FAMILY#fam_1",
  SK: "SCHEDULE#2025-01-15#s1",
  entityType: "SCHEDULE",
  familyId: "fam_1",
  scheduleId: "s1",
  date: "2025-01-15",
  startTime: null,
  endTime: null,
  title: "Soccer practice",
  memberIds: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

test("two screens moving the same entry to different days can't both win", async () => {
  ddbMock.on(GetCommand).resolves({ Item: soccerOnTheFifteenth });
  // The other screen's move already took the old row away.
  ddbMock.on(TransactWriteCommand).rejects(
    Object.assign(new Error("Transaction cancelled"), { name: "TransactionCanceledException" })
  );
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ date: "2025-01-17" }),
    })
  );

  assert.equal(result.statusCode, 409);
});

test("editing an entry deleted a moment ago returns 404 rather than bringing it back", async () => {
  ddbMock.on(GetCommand).resolves({ Item: soccerOnTheFifteenth });
  ddbMock.on(PutCommand).rejects(
    Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" })
  );
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ title: "Soccer (moved indoors)" }),
    })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.ConditionExpression, "attribute_exists(PK)");
});

test("GET follows LastEvaluatedKey, so a long history doesn't hide later entries", async () => {
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [{ scheduleId: "s1" }], LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "SCHEDULE#2025-01-15#s1" } })
    .resolvesOnce({ Items: [{ scheduleId: "s2" }] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers, queryStringParameters: {} })
  );

  assert.deepEqual(
    JSON.parse(result.body ?? "[]").map((entry: { scheduleId: string }) => entry.scheduleId),
    ["s1", "s2"]
  );
});

test("PUT for an entry that isn't there returns 404 rather than inventing one", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "nope" },
      headers,
      queryStringParameters: { date: "2025-01-15" },
      body: JSON.stringify({ title: "Anything" }),
    })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("PUT without the date query param says so rather than guessing the key", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", scheduleId: "s1" },
      headers,
      body: JSON.stringify({ title: "Anything" }),
    })
  );

  assert.equal(result.statusCode, 400);
});
