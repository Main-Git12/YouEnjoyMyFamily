import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  handler,
  routeGroceryCart,
  createRealInstacartClient,
  toInstacartLineItem,
  type InstacartClient,
} from "./groceryCart";
import type { CartItem, LearnedSubstitutionItem } from "../types";
import { mockFamilyAuth } from "../lib/authTestSupport";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string; path?: string }
): APIGatewayProxyEventV2 {
  const { method, path, ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path ?? "/",
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: path ?? "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...rest,
  } as APIGatewayProxyEventV2;
}

const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  PK: "FAMILY#fam_1",
  SK: "CARTITEM#i1",
  entityType: "CART_ITEM",
  familyId: "fam_1",
  itemId: "i1",
  description: "Spaghetti",
  quantity: 1,
  status: "pending",
  substituteDescription: null,
  orderedAt: null,
  addedBy: null,
  source: "manual",
  mealPlanSourceKey: null,
  addedAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

// --- What actually reaches Instacart ------------------------------------
//
// Their quantity matching fails silently on anything it doesn't recognise,
// so a wrong line here doesn't look like a bug — it looks like the shop
// delivering one onion.

test("a merged meal-plan row sends the amount it added up, not the row count", () => {
  // Three meals asked for mince; generation added them to 1.5 kg and wrote
  // that into the description. `quantity` stayed 1, because it has always
  // meant "one line", and the deprecated field this used to go out in made
  // that 1 the order.
  const line = toInstacartLineItem(
    cartItem({
      description: "1.5 kg Ground beef",
      quantity: 1,
      amount: 1.5,
      unit: "kg",
      source: "meal_plan",
      mealPlanSourceKey: "ground beef::mass",
    })
  );

  // The search term is the food. Searching "1.5 kg Ground beef" matches
  // nothing and leaves a line to sort out in the shop.
  assert.equal(line.name, "Ground beef");
  assert.equal(line.displayText, "1.5 kg Ground beef");
  assert.deepEqual(line.measurements, [
    { quantity: 1.5, unit: "kg" },
    { quantity: 3.31, unit: "lb" },
  ]);
});

test("a hand-typed row keeps its own count", () => {
  const line = toInstacartLineItem(cartItem({ description: "Milk", quantity: 3 }));
  assert.deepEqual(line.measurements, [{ quantity: 3, unit: "each" }]);
});

test("a hand-typed row that says its own amount uses that", () => {
  const line = toInstacartLineItem(cartItem({ description: "2 gallons milk", quantity: 1 }));
  assert.equal(line.name, "milk");
  assert.deepEqual(line.measurements, [{ quantity: 2, unit: "gallon" }]);
});

test("a substitution brings its own amount and doesn't inherit the old one", () => {
  // "500 g rice" became "Arborio rice" — a named packet, not 500 g of it.
  // Carrying the 500 g across would be the app inventing an amount for
  // something nobody weighed.
  const line = toInstacartLineItem(
    cartItem({
      description: "500 g Rice",
      amount: 500,
      unit: "g",
      status: "substituted",
      substituteDescription: "Arborio rice",
    })
  );
  assert.equal(line.name, "Arborio rice");
  assert.equal(line.displayText, "Arborio rice");
  assert.deepEqual(line.measurements, [{ quantity: 1, unit: "each" }]);
});

test("a row nobody could put a number on goes over as one of it, flagged", () => {
  const line = toInstacartLineItem(
    cartItem({ description: "Parsley", amount: null, unit: null, needsCheck: true, source: "meal_plan" })
  );
  assert.deepEqual(line.measurements, [{ quantity: 1, unit: "each" }]);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("GET lists cart items for a family", async () => {
  const items = [cartItem()];
  ddbMock.on(QueryCommand).resolves({ Items: items });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), items);
});

test("POST rejects a missing description", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "POST", pathParameters: { familyId: "fam_1" }, headers, body: JSON.stringify({}) })
  );
  assert.equal(result.statusCode, 400);
});

test("POST adds an item with pending status and no Instacart product id required", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ description: "2% Milk, 1 Gallon" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.description, "2% Milk, 1 Gallon");
  assert.equal(body.status, "pending");
  assert.equal(body.quantity, 1);
});

test("PUT on a missing item returns 404", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "PUT", pathParameters: { familyId: "fam_1", itemId: "missing" }, headers, body: "{}" })
  );
  assert.equal(result.statusCode, 404);
});

test("PUT marks an item unavailable with no suggestion when nothing was ever confirmed", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } }).resolves({ Item: cartItem() });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SUBSTITUTION#spaghetti" } }).resolves({ Item: undefined });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "unavailable" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.item.status, "unavailable");
  assert.equal(body.suggestedSubstitute, null);
});

test("PUT marking an item unavailable surfaces a previously confirmed substitute as a suggestion only", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } }).resolves({ Item: cartItem() });
  const learned: LearnedSubstitutionItem = {
    PK: "FAMILY#fam_1",
    SK: "SUBSTITUTION#spaghetti",
    entityType: "LEARNED_SUBSTITUTION",
    familyId: "fam_1",
    originalDescription: "spaghetti",
    substituteDescription: "Penne",
    timesConfirmed: 2,
    updatedAt: "2025-01-01T00:00:00Z",
  };
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SUBSTITUTION#spaghetti" } }).resolves({ Item: learned });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "unavailable" }),
    })
  );

  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.suggestedSubstitute, "Penne");
  // Only ever a suggestion — the item itself isn't auto-substituted.
  assert.equal(body.item.status, "unavailable");
  assert.equal(body.item.substituteDescription, null);
});

test("PUT confirming a substitute records it as learned for next time", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } }).resolves({
    Item: cartItem({ status: "unavailable" }),
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "substituted", substituteDescription: "Penne" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.item.status, "substituted");
  assert.equal(body.item.substituteDescription, "Penne");

  const learned = ddbMock
    .commandCalls(UpdateCommand)
    .map((call) => call.args[0].input)
    .find((input) => input.Key?.SK === "SUBSTITUTION#spaghetti");
  assert.ok(learned, "expected the confirmed swap to be written under the original description");
  assert.equal(learned.ExpressionAttributeValues?.[":substitute"], "Penne");
  assert.equal(learned.ExpressionAttributeValues?.[":original"], "spaghetti");
  // The count is incremented in the database, not read and written back:
  // two people confirming the same swap at once must both be counted.
  assert.match(learned.UpdateExpression ?? "", /ADD timesConfirmed :one/);
  assert.equal(learned.ExpressionAttributeValues?.[":one"], 1);
  // And nothing re-reads the row first, which is what made it lossy.
  assert.equal(
    ddbMock.commandCalls(GetCommand).filter((call) => call.args[0].input.Key?.SK === "SUBSTITUTION#spaghetti").length,
    0
  );
});

test("checkout builds Instacart line items, using the substitute description where confirmed", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      cartItem({ itemId: "i1", description: "Spaghetti", status: "substituted", substituteDescription: "Penne" }),
      cartItem({ itemId: "i2", description: "Milk", status: "pending", quantity: 2 }),
      cartItem({ itemId: "i3", description: "Rare cheese", status: "unavailable" }),
    ],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const calls: unknown[] = [];
  const fakeInstacart: InstacartClient = {
    async createShoppingListLink(title, lineItems) {
      calls.push({ title, lineItems });
      return "https://instacart.example/list/abc";
    },
  };

  const result = await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    fakeInstacart
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { productsLinkUrl: "https://instacart.example/list/abc" });
  assert.deepEqual(calls, [
    {
      title: "YouEnjoyMyFamily grocery list",
      lineItems: [
        // The substitute's own words, not the row it replaced.
        { name: "Penne", displayText: "Penne", measurements: [{ quantity: 1, unit: "each" }] },
        // A manual row's count still travels; it just travels with a unit.
        { name: "Milk", displayText: "Milk", measurements: [{ quantity: 2, unit: "each" }] },
      ],
    },
  ]);
});

test("checkout rejects when every item is unavailable", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [cartItem({ status: "unavailable" })] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    { createShoppingListLink: async () => "unused" }
  );

  assert.equal(result.statusCode, 400);
});

test("DELETE requires an itemId", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1" }, headers }));
  assert.equal(result.statusCode, 400);
});

test("DELETE removes a cart item outright", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", itemId: "i1" }, headers })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { deleted: "i1" });
  const deleteCalls = ddbMock.commandCalls(DeleteCommand);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0]?.args[0].input.Key, { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" });
});

test("checkout stamps what it handed over, so the shop actually ends", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [cartItem({ itemId: "i1", description: "Tortillas" }), cartItem({ itemId: "i2", description: "Rare cheese", status: "unavailable" })],
  });
  ddbMock.on(UpdateCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    { createShoppingListLink: async () => "https://instacart.example/list/abc" }
  );

  assert.equal(result.statusCode, 200);
  const stamps = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input);
  assert.equal(stamps.length, 1);
  assert.deepEqual(stamps[0]?.Key, { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" });
  assert.equal(stamps[0]?.ExpressionAttributeValues?.[":ordered"], "ordered");
  assert.ok(stamps[0]?.ExpressionAttributeValues?.[":orderedAt"]);
});

test("checkout doesn't send last week's shop to Instacart all over again", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      cartItem({ itemId: "i1", description: "Tortillas", status: "ordered", orderedAt: "2025-01-01T00:00:00Z" }),
      cartItem({ itemId: "i2", description: "Milk" }),
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const sent: unknown[] = [];
  await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    {
      async createShoppingListLink(_title, lineItems) {
        sent.push(...lineItems);
        return "https://instacart.example/list/abc";
      },
    }
  );

  assert.deepEqual(sent, [{ name: "Milk", displayText: "Milk", measurements: [{ quantity: 1, unit: "each" }] }]);
});

test("checkout leaves the list alone when Instacart fails, so it can be retried", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [cartItem({ itemId: "i1" })] });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    {
      createShoppingListLink: async () => {
        throw new Error("Instacart API error: 503");
      },
    }
  );

  assert.equal(result.statusCode, 500);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  assert.equal(ddbMock.commandCalls(UpdateCommand).length, 0);
});

test("checkout rejects when everything outstanding has already been ordered", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [cartItem({ status: "ordered", orderedAt: "2025-01-01T00:00:00Z" })] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeGroceryCart(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/grocery-cart/checkout",
      pathParameters: { familyId: "fam_1" },
      headers,
    }),
    { createShoppingListLink: async () => "unused" }
  );

  assert.equal(result.statusCode, 400);
});

test("putting an ordered item back on the list clears the order stamp", async () => {
  ddbMock.on(GetCommand).resolves({ Item: cartItem({ status: "ordered", orderedAt: "2025-01-01T00:00:00Z" }) });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "pending" }),
    })
  );

  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body ?? "{}").item.orderedAt, null);
});

const checkoutEvent = (headers: Record<string, string>) =>
  makeEvent({
    method: "POST",
    path: "/families/fam_1/grocery-cart/checkout",
    pathParameters: { familyId: "fam_1" },
    headers,
  });

test("GET returns cart items from every page, not just the first 1MB", async () => {
  // ULIDs sort oldest first, so the newest items are the ones past page one.
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [cartItem({ itemId: "old", status: "ordered" })], LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "CARTITEM#old" } })
    .resolvesOnce({ Items: [cartItem({ itemId: "new", description: "Bread" })] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "[]") as CartItem[];
  assert.deepEqual(
    body.map((item) => item.itemId),
    ["old", "new"]
  );
  const queries = ddbMock.commandCalls(QueryCommand);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1]?.args[0].input.ExclusiveStartKey, { PK: "FAMILY#fam_1", SK: "CARTITEM#old" });
});

test("checkout sends outstanding items that live past the first page", async () => {
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [cartItem({ itemId: "old", status: "ordered" })], LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "CARTITEM#old" } })
    .resolvesOnce({ Items: [cartItem({ itemId: "new", description: "Bread" })] });
  ddbMock.on(UpdateCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const sent: unknown[] = [];
  const result = await routeGroceryCart(checkoutEvent(headers), {
    async createShoppingListLink(_title, lineItems) {
      sent.push(...lineItems);
      return "https://instacart.example/list/abc";
    },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(sent, [{ name: "Bread", displayText: "Bread", measurements: [{ quantity: 1, unit: "each" }] }]);
});

test("checkout still hands back the Instacart link when stamping an item fails", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [cartItem({ itemId: "i1", description: "Tortillas" }), cartItem({ itemId: "i2", description: "Milk" })],
  });
  // Every write fails: the link is the only record of what went to Instacart,
  // so losing it to a 500 would strand the family mid-shop.
  ddbMock.on(UpdateCommand).rejects(new Error("ProvisionedThroughputExceededException"));
  ddbMock.on(PutCommand).rejects(new Error("ProvisionedThroughputExceededException"));
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await routeGroceryCart(checkoutEvent(headers), {
      createShoppingListLink: async () => "https://instacart.example/list/abc",
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body ?? "{}"), { productsLinkUrl: "https://instacart.example/list/abc" });
  } finally {
    console.error = originalError;
  }
});

test("checkout stamps conditionally, so an item deleted or changed mid-checkout isn't resurrected or overwritten", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      cartItem({ itemId: "i1", description: "Tortillas" }),
      cartItem({ itemId: "i2", description: "Spaghetti", status: "substituted", substituteDescription: "Penne" }),
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  // i1 was deleted while Instacart was building the list.
  ddbMock
    .on(UpdateCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } })
    .rejects(new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }));
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeGroceryCart(checkoutEvent(headers), {
    createShoppingListLink: async () => "https://instacart.example/list/abc",
  });

  assert.equal(result.statusCode, 200);
  // No whole-item Put of the pre-Instacart copy.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
  const stamps = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input);
  assert.deepEqual(
    stamps.map((input) => input.Key),
    [
      { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" },
      { PK: "FAMILY#fam_1", SK: "CARTITEM#i2" },
    ]
  );
  for (const input of stamps) {
    assert.match(input.ConditionExpression ?? "", /attribute_exists\(PK\)/);
    assert.match(input.ConditionExpression ?? "", /#status = :expected/);
  }
  // Only stamped if the status is still what checkout read and sent.
  assert.deepEqual(
    stamps.map((input) => input.ExpressionAttributeValues?.[":expected"]),
    ["pending", "substituted"]
  );
});

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.INSTACART_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.INSTACART_API_KEY;
  else process.env.INSTACART_API_KEY = originalApiKey;
});

test("the real Instacart client gives up on a hung request instead of riding out the Lambda timeout", async () => {
  process.env.INSTACART_API_KEY = "test-key";
  // A fetch that never answers, and only settles if the caller aborts it.
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    })) as typeof fetch;

  let guard: NodeJS.Timeout | undefined;
  const hung = new Promise<"hung">((resolve) => {
    guard = setTimeout(() => resolve("hung"), 1000);
  });
  try {
    const outcome = await Promise.race([
      createRealInstacartClient(20)
        .createShoppingListLink("list", [{ name: "Milk", displayText: "Milk", measurements: [{ quantity: 1, unit: "each" }] }])
        .then(
          () => "resolved" as const,
          () => "rejected" as const
        ),
      hung,
    ]);
    assert.equal(outcome, "rejected");
  } finally {
    clearTimeout(guard);
  }
});

/**
 * Stands in for DynamoDB rejecting a write. Deliberately keyed on the write
 * *asking* to be checked: a Put with no ConditionExpression is one DynamoDB
 * would happily land, so an unguarded patch has to show up here as a write
 * that succeeded, not as one this fake threw on anyway.
 */
const rejectsIfGuarded = (input: { ConditionExpression?: string }) => {
  if (!input.ConditionExpression?.includes("attribute_exists(PK)")) return {};
  throw new ConditionalCheckFailedException({ $metadata: {}, message: "the row moved under you" });
};

// --- The two races a patch has to survive on a kitchen wall ---------------
//
// The cart is edited from the Echo Show, from phones, and by checkout itself.
// Before this guard a patch was a plain Put of the copy it had read, so
// whichever write landed last won outright.

test("a patch that loses a race to checkout re-applies on top of it rather than reverting it", async () => {
  // First read: still pending. Then checkout stamps it "ordered", so the
  // conditional write fails; the second read sees the stamp.
  const reads = [cartItem({ status: "pending" }), cartItem({ status: "ordered", orderedAt: "2025-01-02T09:00:00Z" })];
  let read = 0;
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } }).callsFake(() => ({
    Item: reads[Math.min(read++, reads.length - 1)],
  }));

  let writes = 0;
  ddbMock.on(PutCommand).callsFake((input) => {
    if ((input.Item as CartItem).entityType !== "CART_ITEM") return {};
    writes += 1;
    if (writes === 1) return rejectsIfGuarded(input);
    return {};
  });
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SUBSTITUTION#spaghetti" } }).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "unavailable" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.item.status, "unavailable");
  assert.equal(writes, 2, "expected the patch to be re-applied after losing the race");

  // The point of all of it: the winning write must have been guarded, and
  // guarded against what the *second* read saw — not the first.
  const guarded = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input)
    .filter((input) => (input.Item as CartItem).entityType === "CART_ITEM");
  assert.match(guarded[0]?.ConditionExpression ?? "", /attribute_exists\(PK\)/);
  assert.equal(guarded[0]?.ExpressionAttributeValues?.[":seenStatus"], "pending");
  assert.equal(guarded[1]?.ExpressionAttributeValues?.[":seenStatus"], "ordered");
});

test("a patch racing a delete 404s rather than putting the deleted item back", async () => {
  let read = 0;
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } })
    .callsFake(() => (read++ === 0 ? { Item: cartItem({ status: "pending" }) } : { Item: undefined }));
  ddbMock.on(PutCommand).callsFake((input) => {
    if ((input.Item as CartItem).entityType !== "CART_ITEM") return {};
    return rejectsIfGuarded(input);
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "unavailable" }),
    })
  );

  assert.equal(result.statusCode, 404);
  const writtenBack = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as CartItem)
    .filter((item) => item.entityType === "CART_ITEM");
  // It may have *attempted* one write before learning the row was gone — the
  // condition is what stops that attempt landing. It must not try again after.
  assert.equal(writtenBack.length, 1);
});

test("a patch that keeps losing gives up with a conflict instead of retrying forever", async () => {
  ddbMock
    .on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "CARTITEM#i1" } })
    .resolves({ Item: cartItem({ status: "pending" }) });
  ddbMock.on(PutCommand).callsFake((input) => {
    if ((input.Item as CartItem).entityType !== "CART_ITEM") return {};
    return rejectsIfGuarded(input);
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      headers,
      body: JSON.stringify({ status: "unavailable" }),
    })
  );

  assert.equal(result.statusCode, 409);
  const attempts = ddbMock
    .commandCalls(PutCommand)
    .filter((call) => (call.args[0].input.Item as CartItem).entityType === "CART_ITEM").length;
  assert.equal(attempts, 3, "expected a bounded number of attempts");
});
