import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, conflict, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { generateApiKey, hashApiKey, familyMetadataKey, extractBearerToken } from "../lib/auth";
import { authenticateFamily } from "../lib/auth";
import { roundCoordinate } from "../lib/weather";
import { CreateFamilyInput, FamilyPatch, type FamilyRecord } from "../types";

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
 * An `UpdateItem` naming only the fields being changed, never a Put of a
 * whole record built from one read earlier. `apiKeyHash` is on this row: it
 * is the family's only credential, it cannot be recovered if it is lost, and
 * losing it locks every screen in the house out at once. A read-modify-write
 * kept it alive only by remembering to copy it across, which is a promise a
 * comment makes and a future edit breaks. Not mentioning the attribute at
 * all is a promise the database keeps.
 *
 * The same shape also means a delete landing mid-edit isn't undone
 * (`attribute_exists`), and two screens editing different fields don't
 * overwrite each other.
 *
 * The coordinate is rounded on the way in, not on the way out to the
 * weather service. Storing it at full precision and trimming it later would
 * leave the exact location of a house sitting in a database for the sake of
 * a forecast that does not need it.
 */
async function updateFamily(familyId: string, patch: FamilyPatch): Promise<FamilyRecord | null> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const assign = (field: "name" | "location", value: unknown) => {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  };

  // `name` is a DynamoDB reserved word, which is why every field goes
  // through ExpressionAttributeNames rather than only the ones that need it.
  if (patch.name !== undefined) assign("name", patch.name);
  if (patch.location !== undefined) {
    assign(
      "location",
      patch.location === null
        ? null
        : {
            latitude: roundCoordinate(patch.location.latitude),
            longitude: roundCoordinate(patch.location.longitude),
            timeZone: patch.location.timeZone,
            label: patch.location.label?.trim() || null,
          }
    );
  }

  // An empty patch is a read, not a write: there is nothing to SET, and an
  // UpdateExpression of "SET " is a malformed request.
  if (!sets.length) {
    const existing = await docClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: familyMetadataKey(familyId) })
    );
    return (existing.Item as FamilyRecord | undefined) ?? null;
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: familyMetadataKey(familyId),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return (result.Attributes as FamilyRecord | undefined) ?? null;
  } catch (err) {
    if (isConditionalCheckFailure(err)) return null;
    throw err;
  }
}

const isConditionalCheckFailure = (err: unknown): boolean =>
  err instanceof Error && err.name === "ConditionalCheckFailedException";

/**
 * Issues a new API key and retires the old one, returning the new key once.
 *
 * Worth having because of where the old key lives: in the browser storage of
 * a screen on a kitchen wall, which guests use, repair shops see, and
 * households eventually sell. Until now the only way to cut off a key that
 * had got out was to tear down the stack, and DEPLOY.md's troubleshooting
 * table already told people rotation was a thing that could happen.
 *
 * Conditioned on the hash that was just authenticated still being the stored
 * one. Two rotations racing would otherwise both answer with a key, and only
 * one of them would work — the worse failure, because the family would have
 * no way to tell which screen holds the key that is real.
 */
async function rotateApiKey(familyId: string, currentHash: string): Promise<string | null> {
  const apiKey = generateApiKey();
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: familyMetadataKey(familyId),
        UpdateExpression: "SET apiKeyHash = :next, keyRotatedAt = :now",
        ConditionExpression: "attribute_exists(PK) AND apiKeyHash = :current",
        ExpressionAttributeValues: {
          ":next": hashApiKey(apiKey),
          ":current": currentHash,
          ":now": new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) return null;
    throw err;
  }
  return apiKey;
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
    // Creating a family is the POST with no family in its path. The guard is
    // load-bearing: `POST /families/{familyId}/key` is a POST too, and
    // without it that route quietly created a brand-new family and handed
    // back its key instead of replacing the caller's — an answer that looks
    // exactly like a successful rotation.
    if (method === "POST" && !familyId) {
      return created(await createFamily(parseBody(CreateFamilyInput, event.body)));
    }

    // Everything else is about an existing family, so it needs the key.
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (event.rawPath.endsWith("/key") && method === "POST") {
      // The hash of the key that was just authenticated, not one re-read
      // from the row: it is what the rotation is conditioned on, so it has
      // to be the same value the caller actually proved they hold.
      const presented = extractBearerToken(event);
      if (!presented) return badRequest("An API key is required to replace one");
      const apiKey = await rotateApiKey(familyId, hashApiKey(presented));
      if (!apiKey) return conflict("The key changed while this was in flight — nothing was rotated");
      return created({ familyId, apiKey });
    }

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
