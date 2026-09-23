import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./rewardGoals";
import type { RewardGoalItem } from "../types";
import { mockFamilyAuth } from "../lib/authTestSupport";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string }
): APIGatewayProxyEventV2 {
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

const goal = (overrides: Partial<RewardGoalItem> = {}): RewardGoalItem => ({
  PK: "FAMILY#fam_1",
  SK: "REWARDGOAL#Parker",
  entityType: "REWARD_GOAL",
  familyId: "fam_1",
  memberId: "Parker",
  title: "Nintendo Switch game",
  gemCost: 500,
  note: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("GET lists every child's goal", async () => {
  const goals = [goal(), goal({ SK: "REWARDGOAL#Isla", memberId: "Isla", title: "Art set", gemCost: 300 })];
  ddbMock.on(QueryCommand).resolves({ Items: goals });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), goals);
});

test("PUT sets the child's goal, keyed so each child has exactly one", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({ title: "Nintendo Switch game", gemCost: 500 }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.title, "Nintendo Switch game");
  assert.equal(body.gemCost, 500);
  assert.equal(body.SK, "REWARDGOAL#Parker");
});

test("PUT rejects a goal with no title or a nonsense cost", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const noTitle = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({ gemCost: 500 }),
    })
  );
  assert.equal(noTitle.statusCode, 400);

  const freeGoal = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({ title: "A pony", gemCost: 0 }),
    })
  );
  assert.equal(freeGoal.statusCode, 400);
});

test("DELETE clears a child's goal once they've earned it", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", memberId: "Parker" }, headers })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key, {
    PK: "FAMILY#fam_1",
    SK: "REWARDGOAL#Parker",
  });
});
