import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
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
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (method === "GET") {
      const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: prefsKey(familyId, memberId) }));
      return ok(result.Item ?? { ...DEFAULT_PREFERENCES, familyId, memberId });
    }

    if (method === "PUT") {
      const input = parseBody(PreferencesInput, event.body);
      // Every field on PreferencesInput is optional, so a PUT that only flips
      // notifications must keep whatever theme and quiet hours are already
      // stored. Falling straight through to DEFAULT_PREFERENCES would quietly
      // put the theme back to olive and the quiet hours back to 20:00–07:00
      // every time anyone changed anything else.
      const existing = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: prefsKey(familyId, memberId) })
      );
      const current = (existing.Item as PreferencesItem | undefined) ?? null;

      const item: PreferencesItem = {
        ...prefsKey(familyId, memberId),
        entityType: "PREFERENCES",
        familyId,
        memberId,
        theme: input.theme ?? current?.theme ?? DEFAULT_PREFERENCES.theme,
        notificationsEnabled:
          input.notificationsEnabled ?? current?.notificationsEnabled ?? DEFAULT_PREFERENCES.notificationsEnabled,
        quietHours: input.quietHours ?? current?.quietHours ?? DEFAULT_PREFERENCES.quietHours,
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
