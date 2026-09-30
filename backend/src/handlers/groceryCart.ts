import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
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

/**
 * How long checkout waits on Instacart before giving up. Kept well inside the
 * GroceryCartFunction timeout (template.yaml) so that a slow reply still
 * leaves time to stamp items and hand the link back — rather than the Lambda
 * dying mid-stamp, the family never seeing the link, and a retry sending only
 * whatever hadn't been stamped yet.
 */
export const INSTACART_TIMEOUT_MS = 8000;

export interface InstacartLineItem {
  name: string;
  quantity: number;
}

/** Only the one call this module makes — keeps test fakes simple. */
export interface InstacartClient {
  createShoppingListLink(title: string, lineItems: InstacartLineItem[]): Promise<string>;
}

export function createRealInstacartClient(timeoutMs: number = INSTACART_TIMEOUT_MS): InstacartClient {
  return {
    async createShoppingListLink(title, lineItems) {
      const apiKey = process.env.INSTACART_API_KEY;
      if (!apiKey) throw new Error("INSTACART_API_KEY is not configured");

      const response = await fetch(`${INSTACART_API_BASE_URL}/idp/v1/products/products_link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
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

const isConditionalCheckFailure = (err: unknown): boolean =>
  err instanceof Error && err.name === "ConditionalCheckFailedException";

const cartItemKey = (familyId: string, itemId: string) => ({ PK: `FAMILY#${familyId}`, SK: `CARTITEM#${itemId}` });

const normalize = (description: string) => description.trim().toLowerCase();

const substitutionKey = (familyId: string, originalDescription: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SUBSTITUTION#${normalize(originalDescription)}`,
});

/**
 * Every cart item, across all pages. Ordered/unavailable rows are kept (they
 * are the family's shopping history) and ULID keys sort oldest first, so a
 * single 1MB page would eventually be all old orders and leave out exactly
 * the newest, still-outstanding items.
 */
export async function listCartItems(familyId: string): Promise<CartItem[]> {
  return queryAll<CartItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "CARTITEM#" },
  });
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
 * The deterministic id of a meal-plan-generated line: a hash of the
 * ingredient's normalized text and the dates it covers. Two generations
 * racing over the same plan (a double-tap, or a tap landing on the weekly
 * job) compute the same id, so the conditional put below lets only one of
 * them write the line. Hashed, not concatenated, because ingredient text is
 * free-typed and can contain `#` or anything else that would muddle a key.
 */
export function mealPlanCartItemId(mealPlanSourceKey: string, mealPlanDates: string[]): string {
  const digest = createHash("sha256").update(`${mealPlanSourceKey}\n${mealPlanDates.join(",")}`).digest("hex");
  return `mp-${digest.slice(0, 32)}`;
}

/**
 * Adds a cart item generated from a family's own meal plan ingredients (see
 * mealPlans.ts's generateGroceryListFromMealPlan) rather than typed in
 * directly. `mealPlanSourceKey` (the ingredient's normalized text) and
 * `mealPlanDates` (the plan dates it covers) are what make re-running that
 * generation idempotent. Returns null when an identical line already exists
 * — another generation over the same plan got there first.
 */
export async function addMealPlanCartItem(
  familyId: string,
  description: string,
  quantity: number,
  mealPlanSourceKey: string,
  mealPlanDates: string[]
): Promise<CartItem | null> {
  const itemId = mealPlanCartItemId(mealPlanSourceKey, mealPlanDates);
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
    mealPlanDates,
    addedAt: now,
    updatedAt: now,
  };

  try {
    await docClient.send(
      new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(PK)" })
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) return null;
    throw err;
  }
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
  //
  // Each stamp is a conditional Update of just the order fields, not a Put of
  // the copy read before calling Instacart: an item deleted mid-checkout stays
  // deleted, an edit made meanwhile isn't overwritten, and one whose status
  // changed in the meantime is left as the family set it. Stamps run in
  // parallel and a failed one never costs the family the link — the link is
  // the only record of what was handed over, so it always comes back.
  const orderedAt = new Date().toISOString();
  const outcomes = await Promise.allSettled(
    shoppable.map((item) =>
      docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: cartItemKey(familyId, item.itemId),
          UpdateExpression: "SET #status = :ordered, orderedAt = :orderedAt, updatedAt = :orderedAt",
          ConditionExpression: "attribute_exists(PK) AND #status = :expected",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":ordered": "ordered", ":orderedAt": orderedAt, ":expected": item.status },
        })
      )
    )
  );
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" || isConditionalCheckFailure(outcome.reason)) return;
    console.error("checkout: failed to stamp cart item as ordered", {
      familyId,
      itemId: shoppable[index]?.itemId,
      error: outcome.reason,
    });
  });

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
