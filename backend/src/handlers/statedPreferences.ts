import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { StatedPreferenceInput, type StatedPreferenceItem } from "../types";

const preferenceKey = (familyId: string, memberId: string, preferenceId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `STATEDPREF#${memberId}#${preferenceId}`,
});

// Lists everything a family has explicitly told us — optionally scoped to one
// member — never anything inferred. See STATED_PREFERENCE_CATEGORIES in types.ts.
async function listStatedPreferences(familyId: string, memberId?: string): Promise<StatedPreferenceItem[]> {
  const prefix = memberId ? `STATEDPREF#${memberId}#` : "STATEDPREF#";
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": prefix },
    })
  );
  return (result.Items ?? []) as StatedPreferenceItem[];
}

async function createStatedPreference(familyId: string, input: StatedPreferenceInput): Promise<StatedPreferenceItem> {
  const preferenceId = ulid();
  const item: StatedPreferenceItem = {
    ...preferenceKey(familyId, input.memberId, preferenceId),
    entityType: "STATED_PREFERENCE",
    familyId,
    preferenceId,
    memberId: input.memberId,
    category: input.category,
    statement: input.statement,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, preferenceId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listStatedPreferences(familyId, query.memberId));
      case "POST":
        return created(await createStatedPreference(familyId, parseBody(StatedPreferenceInput, event.body)));
      case "DELETE": {
        if (!preferenceId || !query.memberId) return badRequest("preferenceId and memberId query param are required");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: preferenceKey(familyId, query.memberId, preferenceId) })
        );
        return ok({ deleted: preferenceId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
