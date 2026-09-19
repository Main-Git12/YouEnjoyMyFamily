import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { CartItemInput, CartItemPatch, type CartItem, type GroceryStore, type SubstitutionLogItem } from "../types";

const MAX_SUGGESTIONS = 3;

const cartItemKey = (familyId: string, itemId: string) => ({ PK: `FAMILY#${familyId}`, SK: `CARTITEM#${itemId}` });

const normalize = (description: string) => description.trim().toLowerCase();

const substitutionKey = (familyId: string, store: GroceryStore, original: string, substitute: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SUBLOG#${store}#${normalize(original)}#${normalize(substitute)}`,
});

interface SubstituteSuggestion {
  description: string;
  timesChosen: number;
}

async function listCartItems(familyId: string): Promise<CartItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "CARTITEM#" },
    })
  );
  return (result.Items ?? []) as CartItem[];
}

async function addCartItem(familyId: string, input: CartItemInput): Promise<CartItem> {
  const itemId = ulid();
  const now = new Date().toISOString();
  const item: CartItem = {
    ...cartItemKey(familyId, itemId),
    entityType: "CART_ITEM",
    familyId,
    itemId,
    store: input.store,
    description: input.description,
    quantity: input.quantity ?? 1,
    status: "needed",
    addedBy: input.addedBy ?? null,
    addedAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

/**
 * Neither Giant Eagle nor Aldi expose a public stock/availability API, so
 * there's no live signal for "is this actually on the shelf." What we can do
 * is remember what this family swapped in the last time the same item (at
 * the same store) got marked unavailable, ranked by how often they picked
 * it — starts empty, gets more useful the more the family uses it.
 */
async function suggestSubstitutes(
  familyId: string,
  store: GroceryStore,
  description: string
): Promise<SubstituteSuggestion[]> {
  const prefix = `SUBLOG#${store}#${normalize(description)}#`;
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": prefix },
    })
  );
  const logs = (result.Items ?? []) as SubstitutionLogItem[];
  return logs
    .sort((a, b) => b.timesChosen - a.timesChosen)
    .slice(0, MAX_SUGGESTIONS)
    .map((log) => ({ description: log.substituteDescription, timesChosen: log.timesChosen }));
}

/** The learning step: every chosen substitute reinforces that pairing for next time. */
async function recordSubstitutionChoice(
  familyId: string,
  store: GroceryStore,
  originalDescription: string,
  substituteDescription: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: substitutionKey(familyId, store, originalDescription, substituteDescription),
      UpdateExpression:
        "SET entityType = :type, familyId = :familyId, store = :store, " +
        "originalDescription = :orig, substituteDescription = :sub, lastChosenAt = :now " +
        "ADD timesChosen :one",
      ExpressionAttributeValues: {
        ":type": "SUBSTITUTION_LOG",
        ":familyId": familyId,
        ":store": store,
        ":orig": normalize(originalDescription),
        ":sub": substituteDescription,
        ":now": new Date().toISOString(),
        ":one": 1,
      },
    })
  );
}

interface PatchResult {
  item: CartItem;
  suggestions?: SubstituteSuggestion[];
}

async function patchCartItem(familyId: string, itemId: string, patch: CartItemPatch): Promise<PatchResult | null> {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: cartItemKey(familyId, itemId) }));
  if (!existing.Item) return null;
  const current = existing.Item as CartItem;
  const updatedAt = new Date().toISOString();

  if (patch.action === "mark_unavailable") {
    const updated: CartItem = { ...current, status: "unavailable", updatedAt };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
    return { item: updated, suggestions: await suggestSubstitutes(familyId, current.store, current.description) };
  }

  const updated: CartItem = { ...current, description: patch.description, status: "needed", updatedAt };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  await recordSubstitutionChoice(familyId, current.store, current.description, patch.description);
  return { item: updated };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, itemId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listCartItems(familyId));
      case "POST":
        return created(await addCartItem(familyId, parseBody(CartItemInput, event.body)));
      case "PATCH": {
        if (!itemId) return badRequest("itemId is required");
        const result = await patchCartItem(familyId, itemId, parseBody(CartItemPatch, event.body));
        return result ? ok(result) : notFound("Cart item not found");
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
