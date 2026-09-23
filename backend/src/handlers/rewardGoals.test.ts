import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, gemBalances } from "./rewardGoals";
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

test("gemBalances is earned minus spent, per child", () => {
  const balances = gemBalances(
    [
      { memberId: "Parker", gemsAwarded: 30 },
      { memberId: "Parker", gemsAwarded: 20 },
      { memberId: "Isla", gemsAwarded: 25 },
      { memberId: null, gemsAwarded: 999 },
    ],
    [{ memberId: "Parker", gemCost: 50 }]
  );

  assert.deepEqual(balances["Parker"], { memberId: "Parker", earned: 50, spent: 50, balance: 0 });
  assert.deepEqual(balances["Isla"], { memberId: "Isla", earned: 25, spent: 0, balance: 25 });
  assert.equal(Object.keys(balances).length, 2);
});

test("gemBalances shows a child who has only ever spent, rather than hiding them", () => {
  const balances = gemBalances([], [{ memberId: "Parker", gemCost: 10 }]);
  assert.equal(balances["Parker"]?.balance, -10);
});

test("claiming a prize records the spend and takes the goal off the board", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") {
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.claim.title, "LEGO set");
  assert.equal(body.claim.gemCost, 50);
  // 60 earned, 50 spent — the saving starts again from 10, not from 60.
  assert.equal(body.balance.balance, 10);

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.entityType, "REWARD_CLAIM");
  assert.equal(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key?.SK, "REWARDGOAL#Parker");
});

test("claiming refuses rather than going negative when the gems aren't there yet", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") {
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 49 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  assert.equal(result.statusCode, 400);
  // Nothing written, nothing removed — the prize is still there to save for.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});

test("claiming a prize nobody set returns 404", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  assert.equal(result.statusCode, 404);
});

test("claiming a second time is refused, because the first claim spent the gems", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") {
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [{ memberId: "Parker", gemCost: 50 }] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  assert.equal(result.statusCode, 400);
});

test("GET /gem-balances reports what each child has right now", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDCLAIM#") return { Items: [{ memberId: "Parker", gemCost: 50 }] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 75 }, { memberId: "Isla", gemsAwarded: 20 }] };
    }
    return { Items: [] };
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/gem-balances",
      pathParameters: { familyId: "fam_1" },
      headers,
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "[]") as { memberId: string; balance: number }[];
  assert.equal(body.find((b) => b.memberId === "Parker")?.balance, 25);
  assert.equal(body.find((b) => b.memberId === "Isla")?.balance, 20);
});
