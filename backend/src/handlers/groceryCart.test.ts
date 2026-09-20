import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, routeGroceryCart, type InstacartClient } from "./groceryCart";
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
  addedBy: null,
  source: "manual",
  mealPlanSourceKey: null,
  addedAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
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
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SUBSTITUTION#spaghetti" } }).resolves({ Item: undefined });
  ddbMock.on(PutCommand).resolves({});
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

  const learnedPut = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as Record<string, unknown>)
    .find((item) => item.entityType === "LEARNED_SUBSTITUTION");
  assert.equal(learnedPut?.originalDescription, "spaghetti");
  assert.equal(learnedPut?.substituteDescription, "Penne");
  assert.equal(learnedPut?.timesConfirmed, 1);
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
        { name: "Penne", quantity: 1 },
        { name: "Milk", quantity: 2 },
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
