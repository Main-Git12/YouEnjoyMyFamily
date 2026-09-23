import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { RewardGoalInput, type RewardGoalItem, type RewardClaimItem } from "../types";
import { listCompletions } from "./tasks";

// One live goal per child, keyed by the child — the big prize on the wall,
// not a history of prizes. Whoever sets it up with them decides what it is
// and what it costs; nothing here is suggested or inferred by the app.
const rewardGoalKey = (familyId: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `REWARDGOAL#${memberId}`,
});

async function listRewardGoals(familyId: string): Promise<RewardGoalItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "REWARDGOAL#" },
    })
  );
  return (result.Items ?? []) as RewardGoalItem[];
}

async function upsertRewardGoal(
  familyId: string,
  memberId: string,
  input: RewardGoalInput
): Promise<RewardGoalItem> {
  const now = new Date().toISOString();
  const item: RewardGoalItem = {
    ...rewardGoalKey(familyId, memberId),
    entityType: "REWARD_GOAL",
    familyId,
    memberId,
    title: input.title,
    gemCost: input.gemCost,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

const rewardClaimKey = (familyId: string, claimId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `REWARDCLAIM#${claimId}`,
});

export async function listRewardClaims(familyId: string): Promise<RewardClaimItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "REWARDCLAIM#" },
    })
  );
  return (result.Items ?? []) as RewardClaimItem[];
}

export interface GemBalance {
  memberId: string;
  earned: number;
  spent: number;
  balance: number;
}

/**
 * What each child has, right now: everything they've ever earned, minus
 * everything they've claimed. Derived rather than stored, so it can't drift
 * out of step with the records it's built from.
 */
export function gemBalances(
  completions: { memberId: string | null; gemsAwarded: number }[],
  claims: { memberId: string; gemCost: number }[]
): Record<string, GemBalance> {
  const balances: Record<string, GemBalance> = {};
  const forMember = (memberId: string): GemBalance =>
    (balances[memberId] ??= { memberId, earned: 0, spent: 0, balance: 0 });

  for (const completion of completions) {
    if (!completion.memberId) continue;
    forMember(completion.memberId).earned += completion.gemsAwarded;
  }
  for (const claim of claims) {
    forMember(claim.memberId).spent += claim.gemCost;
  }
  for (const balance of Object.values(balances)) {
    balance.balance = balance.earned - balance.spent;
  }
  return balances;
}

async function listGemBalances(familyId: string): Promise<GemBalance[]> {
  const [completions, claims] = await Promise.all([
    listCompletions(familyId, "0000-00-00", "9999-12-31"),
    listRewardClaims(familyId),
  ]);
  return Object.values(gemBalances(completions, claims));
}

interface ClaimResult {
  claim: RewardClaimItem;
  balance: GemBalance;
}

/**
 * Takes the prize: checks the child can actually afford it, records the
 * spend, and clears the goal so the board is ready for the next one.
 * Refuses rather than going negative — a prize nobody has saved for isn't
 * a prize.
 */
async function claimRewardGoal(familyId: string, memberId: string): Promise<ClaimResult | "not_found" | "not_enough"> {
  const goals = await listRewardGoals(familyId);
  const goal = goals.find((candidate) => candidate.memberId === memberId);
  if (!goal) return "not_found";

  const balances = await listGemBalances(familyId);
  const current = balances.find((candidate) => candidate.memberId === memberId);
  const available = current?.balance ?? 0;
  if (available < goal.gemCost) return "not_enough";

  const claimId = ulid();
  const claim: RewardClaimItem = {
    ...rewardClaimKey(familyId, claimId),
    entityType: "REWARD_CLAIM",
    familyId,
    claimId,
    memberId,
    title: goal.title,
    gemCost: goal.gemCost,
    claimedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: claim }));
  // The goal is done, so it comes off the board — saving starts again.
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: rewardGoalKey(familyId, memberId) }));

  return {
    claim,
    balance: {
      memberId,
      earned: current?.earned ?? 0,
      spent: (current?.spent ?? 0) + goal.gemCost,
      balance: available - goal.gemCost,
    },
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const isClaim = event.rawPath.endsWith("/claim");
  const isBalances = event.rawPath.endsWith("/gem-balances");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (isBalances && method === "GET") return ok(await listGemBalances(familyId));

    if (isClaim && method === "POST") {
      if (!memberId) return badRequest("memberId is required");
      const result = await claimRewardGoal(familyId, memberId);
      if (result === "not_found") return notFound("No prize is set for that person");
      if (result === "not_enough") return badRequest("Not enough gems saved for that prize yet");
      return created(result);
    }

    switch (method) {
      case "GET":
        return ok(await listRewardGoals(familyId));
      case "PUT": {
        if (!memberId) return badRequest("memberId is required");
        return ok(await upsertRewardGoal(familyId, memberId, parseBody(RewardGoalInput, event.body)));
      }
      case "DELETE": {
        if (!memberId) return badRequest("memberId is required");
        await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: rewardGoalKey(familyId, memberId) }));
        return ok({ deleted: memberId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
