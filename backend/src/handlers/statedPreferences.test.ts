import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./statedPreferences";
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

test("GET lists every stated preference for a family", async () => {
  const items = [{ preferenceId: "p1", memberId: "member_1", category: "meal", statement: "Isla prefers penne" }];
  ddbMock.on(QueryCommand).resolves({ Items: items });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), items);

  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":prefix"], "STATEDPREF#");
});

test("GET scopes to one member when memberId is given", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { memberId: "member_1" },
    })
  );

  const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
  assert.equal(query?.ExpressionAttributeValues?.[":prefix"], "STATEDPREF#member_1#");
});

test("POST rejects a missing statement", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ memberId: "member_1", category: "meal" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST rejects a category outside the bounded list", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ memberId: "member_1", category: "mood", statement: "seems tired lately" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST creates a stated preference with a generated id", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ memberId: "member_1", category: "meal", statement: "Isla prefers penne over spaghetti" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.category, "meal");
  assert.equal(body.statement, "Isla prefers penne over spaghetti");
  assert.ok(body.preferenceId);
});

test("DELETE requires both preferenceId and a memberId query param", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", preferenceId: "p1" }, headers })
  );
  assert.equal(result.statusCode, 400);
});

test("DELETE removes a stated preference", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "DELETE",
      pathParameters: { familyId: "fam_1", preferenceId: "p1" },
      headers,
      queryStringParameters: { memberId: "member_1" },
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { deleted: "p1" });
});
