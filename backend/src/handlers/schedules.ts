import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, conflict, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { queryAll } from "../lib/queryAll";
import { ScheduleInput, SchedulePatch, type ScheduleItem } from "../types";

const scheduleKey = (familyId: string, isoDate: string, entryId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHEDULE#${isoDate}#${entryId}`,
});

async function listSchedules(familyId: string, start?: string, end?: string): Promise<ScheduleItem[]> {
  // `||`, not `??`: an omitted query param reaches us as an empty string, and
  // `??` would keep it — building the range SCHEDULE#..SCHEDULE##￿,
  // which sorts *below* every real SCHEDULE#<date>#<id> key and quietly
  // returns nothing at all.
  return queryAll<ScheduleItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":from": `SCHEDULE#${start || "0000-00-00"}`,
      ":to": `SCHEDULE#${end || "9999-12-31"}#￿`,
    },
  });
}

async function createSchedule(familyId: string, input: ScheduleInput): Promise<ScheduleItem> {
  const entryId = ulid();
  const now = new Date().toISOString();
  const item: ScheduleItem = {
    ...scheduleKey(familyId, input.date, entryId),
    entityType: "SCHEDULE",
    familyId,
    scheduleId: entryId,
    date: input.date,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    title: input.title,
    memberIds: input.memberIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

/**
 * The date is part of the sort key (`SCHEDULE#<date>#<id>`), so callers have
 * to say which day the entry is on today — the same `date` query param DELETE
 * takes. Moving an entry to another day therefore writes a new row and
 * removes the old one; without that the entry would show up on both days.
 *
 * The move is one transaction — new row only if it isn't there yet, old row
 * only if it still is — so a failed delete can't leave the entry on both
 * days, and two screens moving it at once (Mon→Tue and Mon→Wed) can't both
 * win. The loser gets "conflict". A same-day edit is conditioned on the row
 * still existing, so it can't bring back an entry deleted a moment ago.
 */
async function updateSchedule(
  familyId: string,
  scheduleId: string,
  currentDate: string,
  patch: SchedulePatch
): Promise<ScheduleItem | "not_found" | "conflict"> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: scheduleKey(familyId, currentDate, scheduleId) })
  );
  if (!existing.Item) return "not_found";
  const current = existing.Item as ScheduleItem;

  const nextDate = patch.date ?? current.date;
  // Merged field by field rather than spread: `startTime: null` means "clear
  // it", which a `??` merge would silently turn back into the old time.
  const updated: ScheduleItem = {
    ...scheduleKey(familyId, nextDate, scheduleId),
    entityType: "SCHEDULE",
    familyId,
    scheduleId,
    date: nextDate,
    startTime: patch.startTime !== undefined ? patch.startTime : current.startTime,
    endTime: patch.endTime !== undefined ? patch.endTime : current.endTime,
    title: patch.title ?? current.title,
    memberIds: patch.memberIds ?? current.memberIds,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (nextDate === current.date) {
      await docClient.send(
        new PutCommand({ TableName: TABLE_NAME, Item: updated, ConditionExpression: "attribute_exists(PK)" })
      );
    } else {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: TABLE_NAME, Item: updated, ConditionExpression: "attribute_not_exists(PK)" } },
            {
              Delete: {
                TableName: TABLE_NAME,
                Key: scheduleKey(familyId, current.date, scheduleId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
          ],
        })
      );
    }
  } catch (err) {
    // Matched by name, not instanceof: a bundled SDK can load the error
    // class twice, and instanceof then silently fails.
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return "not_found";
    if (err instanceof Error && err.name === "TransactionCanceledException") return "conflict";
    throw err;
  }
  return updated;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, scheduleId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    switch (method) {
      case "GET":
        return ok(await listSchedules(familyId, query.start, query.end));
      case "POST":
        return created(await createSchedule(familyId, parseBody(ScheduleInput, event.body)));
      case "PUT": {
        if (!scheduleId || !query.date) return badRequest("scheduleId and date query param are required");
        const updated = await updateSchedule(
          familyId,
          scheduleId,
          query.date,
          parseBody(SchedulePatch, event.body)
        );
        if (updated === "not_found") return notFound("Schedule entry not found");
        if (updated === "conflict") return conflict("That entry was just moved on another screen — refresh and try again");
        return ok(updated);
      }
      case "DELETE": {
        if (!scheduleId || !query.date) return badRequest("scheduleId and date query param are required");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: scheduleKey(familyId, query.date, scheduleId) })
        );
        return ok({ deleted: scheduleId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
