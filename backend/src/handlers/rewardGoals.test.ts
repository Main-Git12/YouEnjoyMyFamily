import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
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
  ddbMock.on(UpdateCommand).resolves({ Attributes: { createdAt: "2026-09-01T00:00:00Z" } });
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
  assert.deepEqual(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.Key, {
    PK: "FAMILY#fam_1",
    SK: "REWARDGOAL#Parker",
  });
});

test("re-saving a goal keeps the day it was first set, and stamps a fresh updatedAt", async () => {
  // A whole-item put overwrote createdAt on every edit.
  ddbMock.on(UpdateCommand).resolves({ Attributes: { createdAt: "2026-09-01T00:00:00Z" } });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({ title: "LEGO set", gemCost: 60 }),
    })
  );

  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.match(input?.UpdateExpression ?? "", /createdAt = if_not_exists\(createdAt, :now\)/);
  assert.match(input?.UpdateExpression ?? "", /updatedAt = :now/);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.createdAt, "2026-09-01T00:00:00Z");
  assert.notEqual(body.updatedAt, "2026-09-01T00:00:00Z");
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
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null, updatedAt: "2026-09-20T10:00:00Z" }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(GetCommand).resolves({});
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

  // The spend and the goal's removal happen in one transaction, and the goal
  // delete is conditioned on it still being the very save we checked.
  const items = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
  const del = items.find((item) => item.Delete)?.Delete;
  const put = items.find((item) => item.Put)?.Put;
  assert.equal(del?.Key?.SK, "REWARDGOAL#Parker");
  assert.match(del?.ConditionExpression ?? "", /attribute_exists\(PK\) AND updatedAt = :updatedAt/);
  assert.equal(del?.ExpressionAttributeValues?.[":updatedAt"], "2026-09-20T10:00:00Z");
  assert.equal(put?.Item?.entityType, "REWARD_CLAIM");
});

test("a claim that loses a race is refused, not charged a second time", async () => {
  // Double-tap, two screens at once, or a client retry after a timeout: both
  // requests see enough gems, but only one can delete the goal.
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") {
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null, updatedAt: "2026-09-20T10:00:00Z" }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).rejects(
    new TransactionCanceledException({ message: "Transaction cancelled", $metadata: {} })
  );
  ddbMock.on(GetCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  assert.equal(result.statusCode, 409);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("claiming refuses rather than going negative when the gems aren't there yet", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") {
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null, updatedAt: "2026-09-20T10:00:00Z" }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 49 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(GetCommand).resolves({});
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
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});

test("claiming a prize nobody set returns 404", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(GetCommand).resolves({});
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
      return { Items: [{ memberId: "Parker", title: "LEGO set", gemCost: 50, note: null, updatedAt: "2026-09-20T10:00:00Z" }] };
    }
    if (prefix === "REWARDCLAIM#") return { Items: [{ memberId: "Parker", gemCost: 50 }] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    }
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(GetCommand).resolves({});
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
  const body = JSON.parse(result.body ?? "{}") as {
    balances: { memberId: string; balance: number }[];
    family: { earned: number; spent: number; balance: number };
  };
  assert.equal(body.balances.find((b) => b.memberId === "Parker")?.balance, 25);
  assert.equal(body.balances.find((b) => b.memberId === "Isla")?.balance, 20);
  // The kingdom's own total, so the screen doesn't need every completion
  // row ever written just to add them up.
  assert.deepEqual(body.family, { earned: 95, spent: 50, balance: 45 });
});

test("the family total counts gems from chores nobody was named on", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDCLAIM#") return { Items: [] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) {
      return { Items: [{ memberId: null, gemsAwarded: 15 }, { memberId: "Isla", gemsAwarded: 20 }] };
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

  const body = JSON.parse(result.body ?? "{}") as { family: { earned: number } };
  // Adding up the per-child balances would have lost the unassigned 15.
  assert.equal(body.family.earned, 35);
});

test("a name with a stray space is the same child, not a second one", async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker " },
      headers,
      body: JSON.stringify({ title: "LEGO set", gemCost: 50 }),
    })
  );

  // An invisible trailing space would otherwise key a whole second child,
  // with their own prize bar and half of Parker's gems.
  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.equal(written?.Key?.SK, "REWARDGOAL#Parker");
  assert.equal(written?.ExpressionAttributeValues?.[":memberId"], "Parker");
});

test("a name that is nothing but spaces is refused", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "   " },
      headers,
      body: JSON.stringify({ title: "LEGO set", gemCost: 50 }),
    })
  );

  assert.equal(result.statusCode, 400);
});

/** Serves a family's rows the way DynamoDB does past 1MB: in pages, linked by LastEvaluatedKey. */
function pagedQueries(pages: Record<string, unknown[][]>) {
  ddbMock.on(QueryCommand).callsFake(
    (input: { ExpressionAttributeValues?: Record<string, string>; ExclusiveStartKey?: { page: number } }) => {
      const values = input.ExpressionAttributeValues ?? {};
      const from = values[":from"];
      const kind = typeof from === "string" && from.startsWith("COMPLETION#") ? "COMPLETION#" : values[":prefix"] ?? "";
      const kindPages = pages[kind] ?? [[]];
      const page = input.ExclusiveStartKey?.page ?? 0;
      return {
        Items: kindPages[page] ?? [],
        LastEvaluatedKey: page + 1 < kindPages.length ? { page: page + 1 } : undefined,
      };
    }
  );
}

test("GET /gem-balances counts every page of completions and claims, not just the first 1MB", async () => {
  // A year of chores is more than one Query page. Reading only the first
  // page (oldest first) froze earned while claims kept subtracting.
  pagedQueries({
    "COMPLETION#": [[{ memberId: "Parker", gemsAwarded: 40 }], [{ memberId: "Parker", gemsAwarded: 30 }]],
    "REWARDCLAIM#": [[{ memberId: "Parker", gemCost: 10 }], [{ memberId: "Parker", gemCost: 5 }]],
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

  const body = JSON.parse(result.body ?? "{}") as { balances: { memberId: string; earned: number; spent: number }[] };
  assert.deepEqual(
    body.balances.find((b) => b.memberId === "Parker"),
    { memberId: "Parker", earned: 70, spent: 15, balance: 55 }
  );
});

test("GET lists every page of goals", async () => {
  pagedQueries({ "REWARDGOAL#": [[goal()], [goal({ SK: "REWARDGOAL#Isla", memberId: "Isla" })]] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.deepEqual(
    (JSON.parse(result.body ?? "[]") as RewardGoalItem[]).map((g) => g.memberId),
    ["Parker", "Isla"]
  );
});

test("a prize re-set at the same price mid-race can't be claimed a second time", async () => {
  // First claim deletes the goal; a parent sets the next prize at the same
  // cost; the second claim's transaction must not match the new prize. Only
  // the exact save that was checked (its updatedAt) will do.
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") return { Items: [goal({ gemCost: 50, updatedAt: "2026-09-24T08:00:00.123Z" })] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) return { Items: [{ memberId: "Parker", gemsAwarded: 120 }] };
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(GetCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  const del = ddbMock
    .commandCalls(TransactWriteCommand)[0]
    ?.args[0].input.TransactItems?.find((item) => item.Delete)?.Delete;
  assert.doesNotMatch(del?.ConditionExpression ?? "", /gemCost/);
  assert.match(del?.ConditionExpression ?? "", /updatedAt = :updatedAt/);
  assert.equal(del?.ExpressionAttributeValues?.[":updatedAt"], "2026-09-24T08:00:00.123Z");
});

test("a claim is conditioned on the child's ledger version, so an un-tick racing it can't both win", async () => {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    const from = input.ExpressionAttributeValues?.[":from"];
    if (prefix === "REWARDGOAL#") return { Items: [goal({ gemCost: 50 })] };
    if (typeof from === "string" && from.startsWith("COMPLETION#")) return { Items: [{ memberId: "Parker", gemsAwarded: 60 }] };
    return { Items: [] };
  });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "GEMLEDGER#Parker" } })
    .resolves({ Item: { version: 3 } });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "POST",
      rawPath: "/families/fam_1/reward-goals/Parker/claim",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
    })
  );

  const bump = ddbMock
    .commandCalls(TransactWriteCommand)[0]
    ?.args[0].input.TransactItems?.find((item) => item.Update)?.Update;
  assert.equal(bump?.Key?.SK, "GEMLEDGER#Parker");
  assert.equal(bump?.ConditionExpression, "#version = :seen");
  assert.equal(bump?.ExpressionAttributeValues?.[":seen"], 3);
  assert.equal(bump?.ExpressionAttributeValues?.[":next"], 4);
});
