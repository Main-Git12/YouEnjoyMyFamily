import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./preferences";

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

test("GET without memberId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 400);
});

test("GET returns defaults when no preferences are stored", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1", memberId: "mem_1" } })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.theme, "olive");
  assert.equal(body.notificationsEnabled, true);
  assert.deepEqual(body.quietHours, { start: "20:00", end: "07:00" });
});

test("GET returns the stored preferences when present", async () => {
  const stored = { theme: "clay", notificationsEnabled: false, quietHours: { start: "21:00", end: "06:00" } };
  ddbMock.on(GetCommand).resolves({ Item: stored });

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1", memberId: "mem_1" } })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), stored);
});

test("PUT with a partial body only overrides the given fields", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "mem_1" },
      body: JSON.stringify({ notificationsEnabled: false }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.notificationsEnabled, false);
  assert.equal(body.theme, "olive");
  assert.deepEqual(body.quietHours, { start: "20:00", end: "07:00" });
});

test("PUT rejects an invalid quietHours shape", async () => {
  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "mem_1" },
      body: JSON.stringify({ quietHours: { start: "21:00" } }),
    })
  );
  assert.equal(result.statusCode, 400);
});
