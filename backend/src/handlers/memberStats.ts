import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, serverError } from "../lib/response";

const DEFAULT_STATS = { gems: 0, tasksCompleted: 0 };

const statsKey = (familyId: string, memberId: string) => ({ PK: `FAMILY#${familyId}`, SK: `STATS#${memberId}` });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId || !memberId) return badRequest("familyId and memberId are required");
    if (method !== "GET") return badRequest(`Unsupported method: ${method}`);

    const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: statsKey(familyId, memberId) }));
    return ok(result.Item ?? { ...DEFAULT_STATS, familyId, memberId });
  } catch (err) {
    return serverError(err);
  }
};
