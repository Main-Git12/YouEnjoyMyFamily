import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { RewardGoalInput, type RewardGoalItem } from "../types";

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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

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
