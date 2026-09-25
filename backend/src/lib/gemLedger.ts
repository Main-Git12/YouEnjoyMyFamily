import { GetCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "./dynamoClient";
import { queryAll } from "./queryAll";
import type { GemLedgerItem, RewardClaimItem } from "../types";

// Shared by the tasks and reward-goals handlers. It lives here rather than
// in either handler so neither has to import the other (rewardGoals.ts
// already imports listCompletions from tasks.ts).

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export const gemLedgerKey = (familyId: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `GEMLEDGER#${memberId}`,
});

export async function listRewardClaims(familyId: string, consistent = false): Promise<RewardClaimItem[]> {
  return queryAll<RewardClaimItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "REWARDCLAIM#" },
    ConsistentRead: consistent,
  });
}

/**
 * The child's ledger version, read strongly consistent. Must be read
 * *before* the balance it guards — otherwise a spend that lands between the
 * two reads would be missed by the balance and not by the version.
 * A child who has never spent anything has no row yet: version 0.
 */
export async function readLedgerVersion(familyId: string, memberId: string): Promise<number> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: gemLedgerKey(familyId, memberId), ConsistentRead: true })
  );
  return (result.Item as GemLedgerItem | undefined)?.version ?? 0;
}

/** The transaction item that bumps the child's version, if nobody else has since `seen`. */
export function bumpLedgerVersion(familyId: string, memberId: string, seen: number): TransactItem {
  return {
    Update: {
      TableName: TABLE_NAME,
      Key: gemLedgerKey(familyId, memberId),
      UpdateExpression:
        "SET #version = :next, entityType = :entityType, familyId = :familyId, memberId = :memberId, updatedAt = :now",
      ConditionExpression: seen === 0 ? "attribute_not_exists(PK)" : "#version = :seen",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: {
        ":next": seen + 1,
        ":entityType": "GEM_LEDGER",
        ":familyId": familyId,
        ":memberId": memberId,
        ":now": new Date().toISOString(),
        ...(seen === 0 ? {} : { ":seen": seen }),
      },
    },
  };
}
