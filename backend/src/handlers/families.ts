import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { created, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { generateApiKey, hashApiKey, familyMetadataKey } from "../lib/auth";
import { CreateFamilyInput, type FamilyRecord } from "../types";

/**
 * The only unauthenticated route in this API — a family has no credential to
 * present until this creates one. Returns the raw API key exactly once; only
 * its SHA-256 hash is ever persisted (see FamilyRecord in types.ts). This app
 * is one deployment per family rather than public multi-tenant signup, so
 * there's no invite/approval step here — same trust model as the Alexa
 * skill's invocation name or the link Instacart hands back at checkout.
 */
async function createFamily(input: CreateFamilyInput): Promise<{ familyId: string; apiKey: string }> {
  const familyId = `fam_${ulid()}`;
  const apiKey = generateApiKey();
  const item: FamilyRecord = {
    ...familyMetadataKey(familyId),
    entityType: "FAMILY",
    familyId,
    name: input.name ?? null,
    apiKeyHash: hashApiKey(apiKey),
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { familyId, apiKey };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;

  try {
    if (method !== "POST") return badRequest(`Unsupported method: ${method}`);
    return created(await createFamily(parseBody(CreateFamilyInput, event.body)));
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
