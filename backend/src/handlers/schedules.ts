import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { ScheduleInput, type ScheduleItem } from "../types";

const scheduleKey = (familyId: string, isoDate: string, entryId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHEDULE#${isoDate}#${entryId}`,
});

async function listSchedules(familyId: string, start?: string, end?: string): Promise<ScheduleItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        ":from": `SCHEDULE#${start ?? "0000-00-00"}`,
        ":to": `SCHEDULE#${end ?? "9999-12-31"}#￿`,
      },
    })
  );
  return (result.Items ?? []) as ScheduleItem[];
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
