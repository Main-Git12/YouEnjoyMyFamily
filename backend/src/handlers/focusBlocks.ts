import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { FocusBlockInput, type FocusBlockItem } from "../types";

const focusKey = (familyId: string, isoDate: string, blockId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `FOCUS#${isoDate}#${blockId}`,
});

/**
 * A date range of finished blocks. This is both the timesheet for a day
 * and the evidence for what block length actually works — same rows, read
 * two ways.
 */
async function listFocusBlocks(familyId: string, start?: string, end?: string): Promise<FocusBlockItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        // `||` not `??`: an omitted query param arrives as an empty string,
        // which would build a range sorting below every real FOCUS# key.
        ":from": `FOCUS#${start || "0000-00-00"}`,
        ":to": `FOCUS#${end || "9999-12-31"}#￿`,
      },
    })
  );
  return (result.Items ?? []) as FocusBlockItem[];
}

/**
 * Blocks are only ever written once they have ended, so `actualMinutes` is
 * computed here from the two timestamps rather than trusted from the
 * caller — a timer that was paused, or a tab that slept, would otherwise
 * report a length the clock never actually saw.
 */
async function recordFocusBlock(familyId: string, input: FocusBlockInput): Promise<FocusBlockItem> {
  const blockId = ulid();
  const elapsedMinutes = (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 60_000;
  const item: FocusBlockItem = {
    ...focusKey(familyId, input.date, blockId),
    entityType: "FOCUS_BLOCK",
    familyId,
    blockId,
    memberId: input.memberId,
    date: input.date,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    plannedMinutes: input.plannedMinutes,
    // Never negative: a clock that moved under us is not a block run backwards.
    actualMinutes: Math.max(0, Math.round(elapsedMinutes)),
    outcome: input.outcome,
    matter: input.matter ?? null,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, blockId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    switch (method) {
      case "GET":
        return ok(await listFocusBlocks(familyId, query.start, query.end));
      case "POST":
        return created(await recordFocusBlock(familyId, parseBody(FocusBlockInput, event.body)));
      case "DELETE": {
        // The date is in the sort key, so a caller has to say which day's
        // line it's removing — same shape as schedules.
        if (!blockId || !query.date) return badRequest("blockId and date query param are required");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: focusKey(familyId, query.date, blockId) })
        );
        return ok({ deleted: blockId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
