import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { PreferencesInput, type PreferencesItem } from "../types";

const DEFAULT_PREFERENCES = {
  theme: "olive",
  notificationsEnabled: true,
  quietHours: { start: "20:00", end: "07:00" },
};

const prefsKey = (familyId: string, memberId: string) => ({ PK: `FAMILY#${familyId}`, SK: `PREFS#${memberId}` });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId || !memberId) return badRequest("familyId and memberId are required");

    if (method === "GET") {
      const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: prefsKey(familyId, memberId) }));
      return ok(result.Item ?? { ...DEFAULT_PREFERENCES, familyId, memberId });
    }

    if (method === "PUT") {
      const input = parseBody(PreferencesInput, event.body);
      const item: PreferencesItem = {
        ...prefsKey(familyId, memberId),
        entityType: "PREFERENCES",
        familyId,
        memberId,
        theme: input.theme ?? DEFAULT_PREFERENCES.theme,
        notificationsEnabled: input.notificationsEnabled ?? DEFAULT_PREFERENCES.notificationsEnabled,
        quietHours: input.quietHours ?? DEFAULT_PREFERENCES.quietHours,
        updatedAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return ok(item);
    }

    return badRequest(`Unsupported method: ${method}`);
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
