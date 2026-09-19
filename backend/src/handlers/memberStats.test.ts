import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./memberStats";

const ddbMock = mockClient(DynamoDBDocumentClient);

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

beforeEach(() => {
  ddbMock.reset();
});

test("GET without familyId or memberId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 400);
});

test("GET returns zeroed defaults when no stats stored yet", async () => {
  ddbMock.on(GetCommand).resolves({});

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1", memberId: "member_1" } })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), {
    gems: 0,
    tasksCompleted: 0,
    familyId: "fam_1",
    memberId: "member_1",
  });
});

test("GET returns stored stats", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: { gems: 15, tasksCompleted: 3, familyId: "fam_1", memberId: "member_1" },
  });

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1", memberId: "member_1" } })
  );

  assert.deepEqual(JSON.parse(result.body ?? "{}"), {
    gems: 15,
    tasksCompleted: 3,
    familyId: "fam_1",
    memberId: "member_1",
  });
});

test("PUT is unsupported", async () => {
  const result = await handler(
    makeEvent({ method: "PUT", pathParameters: { familyId: "fam_1", memberId: "member_1" } })
  );
  assert.equal(result.statusCode, 400);
});
