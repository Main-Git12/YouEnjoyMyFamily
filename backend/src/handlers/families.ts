import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { generateApiKey, hashApiKey, familyMetadataKey } from "../lib/auth";
import { authenticateFamily } from "../lib/auth";
import { roundCoordinate } from "../lib/weather";
import { CreateFamilyInput, FamilyPatch, type FamilyRecord, type HouseholdLocation } from "../types";

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

/**
 * Updating the family record — today, only its name and where the house is.
 *
 * Merged field by field onto the stored record rather than spread over it,
 * because `apiKeyHash` and `createdAt` live on this row and a spread of a
 * partial would be one careless edit away from erasing the family's only
 * credential. That is the same rule the rest of the API follows, and it
 * matters more here than anywhere else.
 *
 * The coordinate is rounded on the way in, not on the way out to the
 * weather service. Storing it at full precision and trimming it later would
 * leave the exact location of a house sitting in a database for the sake of
 * a forecast that does not need it.
 */
async function updateFamily(familyId: string, patch: FamilyPatch): Promise<FamilyRecord | null> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: familyMetadataKey(familyId) })
  );
  if (!existing.Item) return null;
  const current = existing.Item as FamilyRecord;

  let location: HouseholdLocation | null | undefined = undefined;
  if (patch.location !== undefined) {
    location =
      patch.location === null
        ? null
        : {
            latitude: roundCoordinate(patch.location.latitude),
            longitude: roundCoordinate(patch.location.longitude),
            timeZone: patch.location.timeZone,
            label: patch.location.label?.trim() || null,
          };
  }

  const updated: FamilyRecord = {
    ...familyMetadataKey(familyId),
    entityType: "FAMILY",
    familyId,
    name: patch.name !== undefined ? patch.name : current.name,
    apiKeyHash: current.apiKeyHash,
    createdAt: current.createdAt,
    location: location !== undefined ? location : (current.location ?? null),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  return updated;
}

/** Everything about the family except the one thing that must never be read back. */
const publicFamily = (record: FamilyRecord) => ({
  familyId: record.familyId,
  name: record.name,
  location: record.location ?? null,
  createdAt: record.createdAt,
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const { familyId } = event.pathParameters ?? {};

  try {
    if (method === "POST") {
      return created(await createFamily(parseBody(CreateFamilyInput, event.body)));
    }

    // Everything else is about an existing family, so it needs the key.
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    switch (method) {
      case "GET": {
        const existing = await docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: familyMetadataKey(familyId) })
        );
        return existing.Item ? ok(publicFamily(existing.Item as FamilyRecord)) : notFound("Family not found");
      }
      case "PUT": {
        const updated = await updateFamily(familyId, parseBody(FamilyPatch, event.body));
        return updated ? ok(publicFamily(updated)) : notFound("Family not found");
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
