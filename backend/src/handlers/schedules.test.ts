import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
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
