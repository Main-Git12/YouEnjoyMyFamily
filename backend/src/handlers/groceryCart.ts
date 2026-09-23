import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { CartItemInput, CartItemPatch, type CartItem, type LearnedSubstitutionItem } from "../types";

// Instacart Developer Platform ("Create shopping list page") is the real,
// public integration point for retailers without their own developer API
// (Giant Eagle, Aldi) — see https://docs.instacart.com/developer_platform_api.
// It hands back a link for the family to finish shopping/checkout on
// Instacart's own site, where they pick the actual store; it isn't a
// remote-cart API, so this backend keeps the cart itself and only calls out
// at checkout time.
const INSTACART_API_BASE_URL = process.env.INSTACART_API_BASE_URL ?? "https://connect.instacart.com";

export interface InstacartLineItem {
  name: string;
  quantity: number;
}

/** Only the one call this module makes — keeps test fakes simple. */
export interface InstacartClient {
  createShoppingListLink(title: string, lineItems: InstacartLineItem[]): Promise<string>;
}

export function createRealInstacartClient(): InstacartClient {
  return {
    async createShoppingListLink(title, lineItems) {
      const apiKey = process.env.INSTACART_API_KEY;
      if (!apiKey) throw new Error("INSTACART_API_KEY is not configured");

      const response = await fetch(`${INSTACART_API_BASE_URL}/idp/v1/products/products_link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          line_items: lineItems.map((item) => ({ name: item.name, quantity: item.quantity })),
        }),
      });
      if (!response.ok) throw new Error(`Instacart API error: ${response.status}`);

      const body = (await response.json()) as { products_link_url: string };
      return body.products_link_url;
    },
  };
}

const cartItemKey = (familyId: string, itemId: string) => ({ PK: `FAMILY#${familyId}`, SK: `CARTITEM#${itemId}` });

const normalize = (description: string) => description.trim().toLowerCase();

const substitutionKey = (familyId: string, originalDescription: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SUBSTITUTION#${normalize(originalDescription)}`,
});

export async function listCartItems(familyId: string): Promise<CartItem[]> {
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
    description: input.description,
    quantity: input.quantity ?? 1,
    status: "pending",
    substituteDescription: null,
    orderedAt: null,
    addedBy: input.addedBy ?? null,
    source: "manual",
    mealPlanSourceKey: null,
    addedAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

/**
 * Adds a cart item generated from a family's own meal plan ingredients (see
 * mealPlans.ts's generateGroceryListFromMealPlan) rather than typed in
 * directly. `mealPlanSourceKey` (the ingredient's normalized text) is what
 * makes re-running that generation idempotent — see listCartItems callers.
 */
export async function addMealPlanCartItem(
  familyId: string,
  description: string,
  quantity: number,
  mealPlanSourceKey: string
): Promise<CartItem> {
  const itemId = ulid();
  const now = new Date().toISOString();
  const item: CartItem = {
    ...cartItemKey(familyId, itemId),
    entityType: "CART_ITEM",
    familyId,
    itemId,
    description,
    quantity,
    status: "pending",
    substituteDescription: null,
    orderedAt: null,
    addedBy: null,
    source: "meal_plan",
    mealPlanSourceKey,
    addedAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function findLearnedSubstitute(familyId: string, originalDescription: string): Promise<string | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: substitutionKey(familyId, originalDescription) })
  );
  return (result.Item as LearnedSubstitutionItem | undefined)?.substituteDescription ?? null;
}

/** Only called when a family member explicitly confirms what they picked instead. */
async function recordConfirmedSubstitution(familyId: string, originalDescription: string, substituteDescription: string): Promise<void> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: substitutionKey(familyId, originalDescription) })
  );
  const current = existing.Item as LearnedSubstitutionItem | undefined;

  const item: LearnedSubstitutionItem = {
    ...substitutionKey(familyId, originalDescription),
    entityType: "LEARNED_SUBSTITUTION",
    familyId,
    originalDescription: normalize(originalDescription),
    substituteDescription,
    timesConfirmed: (current?.timesConfirmed ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

interface PatchCartItemResult {
  item: CartItem;
  suggestedSubstitute: string | null;
}

async function patchCartItem(familyId: string, itemId: string, patch: CartItemPatch): Promise<PatchCartItemResult | null> {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: cartItemKey(familyId, itemId) }));
  if (!existing.Item) return null;
  const current = existing.Item as CartItem;

  const nextStatus = patch.status ?? current.status;
  const item: CartItem = {
    ...current,
    status: nextStatus,
    substituteDescription: patch.substituteDescription ?? current.substituteDescription,
    // Putting an item back on the list clears the order stamp, so it reads as
    // genuinely outstanding again rather than "ordered, but pending".
    orderedAt: nextStatus === "ordered" ? (current.orderedAt ?? new Date().toISOString()) : null,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  if (nextStatus === "substituted" && patch.substituteDescription) {
    await recordConfirmedSubstitution(familyId, current.description, patch.substituteDescription);
  }

  const suggestedSubstitute =
    nextStatus === "unavailable" ? await findLearnedSubstitute(familyId, current.description) : null;

  return { item, suggestedSubstitute };
}

async function deleteCartItem(familyId: string, itemId: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: cartItemKey(familyId, itemId) }));
}

/**
 * What checkout will actually send: everything still outstanding. An item
 * already handed over on a previous trip is not sent again, and neither is
 * one someone marked unavailable.
 */
export function outstandingCartItems(items: CartItem[]): CartItem[] {
  return items.filter((item) => item.status !== "unavailable" && item.status !== "ordered");
}

async function checkout(familyId: string, instacart: InstacartClient): Promise<string> {
  const items = await listCartItems(familyId);
  const shoppable = outstandingCartItems(items);
  if (!shoppable.length) throw new ValidationError("The cart has no shoppable items");

  const lineItems: InstacartLineItem[] = shoppable.map((item) => ({
    name: item.status === "substituted" && item.substituteDescription ? item.substituteDescription : item.description,
    quantity: item.quantity,
  }));

  const productsLinkUrl = await instacart.createShoppingListLink("YouEnjoyMyFamily grocery list", lineItems);

  // Stamped only once the link exists: if Instacart fails, the list is still
  // there to try again. Without this the shop never ends — next week's
  // generation sees every ingredient already on the list and adds nothing,
  // and the cart grows until someone deletes it line by line.
  const orderedAt = new Date().toISOString();
  for (const item of shoppable) {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { ...item, status: "ordered", orderedAt, updatedAt: orderedAt } satisfies CartItem,
      })
    );
  }

  return productsLinkUrl;
}

/**
 * Exported separately from `handler` so tests can inject a fake Instacart
 * client — Lambda always invokes `handler(event, context, callback)`, so a
 * real invocation would otherwise clobber a client living in the handler's
 * own parameter list (see calendarSync.ts's runCalendarSync for the same
 * pattern).
 */
export async function routeGroceryCart(
  event: APIGatewayProxyEventV2,
  instacart: InstacartClient = createRealInstacartClient()
): Promise<APIGatewayProxyStructuredResultV2> {
  const { familyId, itemId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const isCheckout = event.rawPath.endsWith("/checkout");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (isCheckout && method === "POST") {
      return ok({ productsLinkUrl: await checkout(familyId, instacart) });
    }

    switch (method) {
      case "GET":
        return ok(await listCartItems(familyId));
      case "POST":
        return created(await addCartItem(familyId, parseBody(CartItemInput, event.body)));
      case "PUT": {
        if (!itemId) return badRequest("itemId is required");
        const result = await patchCartItem(familyId, itemId, parseBody(CartItemPatch, event.body));
        return result ? ok(result) : notFound("Cart item not found");
      }
      case "DELETE": {
        if (!itemId) return badRequest("itemId is required");
        await deleteCartItem(familyId, itemId);
        return ok({ deleted: itemId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> =>
  routeGroceryCart(event);
