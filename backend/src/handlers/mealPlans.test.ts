import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, routeMealPlans, generateGroceryListFromMealPlan } from "./mealPlans";
import type { MealPlanEntryItem, CartItem } from "../types";
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

const mealPlanEntry = (overrides: Partial<MealPlanEntryItem> = {}): MealPlanEntryItem => ({
  PK: "FAMILY#fam_1",
  SK: "MEALPLAN#2025-01-15#dinner",
  entityType: "MEAL_PLAN_ENTRY",
  familyId: "fam_1",
  date: "2025-01-15",
  slot: "dinner",
  mealName: "Spaghetti and meatballs",
  ingredients: ["Spaghetti", "Ground beef", "Marinara sauce"],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

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

test("GET lists meal plan entries for a family", async () => {
  const entries = [mealPlanEntry()];
  ddbMock.on(QueryCommand).resolves({ Items: entries });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), entries);
});

test("PUT rejects an invalid slot", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", date: "2025-01-15", slot: "brunch" },
      headers,
      body: JSON.stringify({ mealName: "Pancakes" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("PUT rejects a missing mealName", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", date: "2025-01-15", slot: "dinner" },
      headers,
      body: JSON.stringify({}),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("PUT upserts a meal plan entry keyed by date and slot", async () => {
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", date: "2025-01-15", slot: "dinner" },
      headers,
      body: JSON.stringify({ mealName: "Tacos", ingredients: ["Tortillas", "Ground beef"] }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.mealName, "Tacos");
  assert.deepEqual(body.ingredients, ["Tortillas", "Ground beef"]);
  assert.equal(body.SK, "MEALPLAN#2025-01-15#dinner");
});

test("DELETE removes a meal plan entry for a date and slot", async () => {
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", date: "2025-01-15", slot: "dinner" }, headers })
  );

  assert.equal(result.statusCode, 200);
  const deleteCalls = ddbMock.commandCalls(DeleteCommand);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0]?.args[0].input.Key, { PK: "FAMILY#fam_1", SK: "MEALPLAN#2025-01-15#dinner" });
});

test("generate-grocery-list route adds new cart items from planned ingredients", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":from": "MEALPLAN#0000-00-00", ":to": "MEALPLAN#9999-12-31#￿" } })
    .resolves({ Items: [mealPlanEntry()] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "CARTITEM#" } })
    .resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await routeMealPlans(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/meal-plan/generate-grocery-list",
      pathParameters: { familyId: "fam_1" },
      headers,
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { added: 3, skipped: 0 });

  const cartPuts = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as Record<string, unknown>)
    .filter((item) => item.entityType === "CART_ITEM");
  assert.equal(cartPuts.length, 3);
  const spaghettiItem = cartPuts.find((item) => item.description === "Spaghetti");
  assert.equal(spaghettiItem?.source, "meal_plan");
  assert.equal(spaghettiItem?.mealPlanSourceKey, "spaghetti");
});

test("generateGroceryListFromMealPlan is idempotent — never duplicates an ingredient already generated", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":from": "MEALPLAN#0000-00-00", ":to": "MEALPLAN#9999-12-31#￿" } })
    .resolves({ Items: [mealPlanEntry()] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "CARTITEM#" } })
    .resolves({
      Items: [
        cartItem({ itemId: "i1", description: "Spaghetti", source: "meal_plan", mealPlanSourceKey: "spaghetti" }),
      ],
    });
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1");

  assert.deepEqual(result, { added: 2, skipped: 1 });
  const cartPuts = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as Record<string, unknown>)
    .filter((item) => item.entityType === "CART_ITEM");
  assert.ok(!cartPuts.some((item) => item.description === "Spaghetti"));
});

test("generateGroceryListFromMealPlan doesn't duplicate an ingredient someone already added to the cart by hand", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":from": "MEALPLAN#0000-00-00", ":to": "MEALPLAN#9999-12-31#￿" } })
    .resolves({ Items: [mealPlanEntry({ ingredients: ["Spaghetti", "Ground beef"] })] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "CARTITEM#" } })
    .resolves({
      // Typed in by a family member, so it has no mealPlanSourceKey at all —
      // matching on the description is the only thing that catches it.
      Items: [cartItem({ itemId: "i1", description: "spaghetti ", source: "manual", mealPlanSourceKey: null })],
    });
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1");

  assert.deepEqual(result, { added: 1, skipped: 1 });
  const cartPuts = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as Record<string, unknown>)
    .filter((item) => item.entityType === "CART_ITEM");
  assert.deepEqual(
    cartPuts.map((item) => item.description),
    ["Ground beef"]
  );
});

test("generateGroceryListFromMealPlan aggregates a repeated ingredient across meals into one line with a summed quantity", async () => {
  const monday = mealPlanEntry({ SK: "MEALPLAN#2025-01-13#dinner", date: "2025-01-13", ingredients: ["Rice"] });
  const wednesday = mealPlanEntry({ SK: "MEALPLAN#2025-01-15#dinner", date: "2025-01-15", ingredients: ["rice"] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":from": "MEALPLAN#0000-00-00", ":to": "MEALPLAN#9999-12-31#￿" } })
    .resolves({ Items: [monday, wednesday] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "CARTITEM#" } })
    .resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1");

  assert.deepEqual(result, { added: 1, skipped: 0 });
  const cartPuts = ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as Record<string, unknown>)
    .filter((item) => item.entityType === "CART_ITEM");
  assert.equal(cartPuts.length, 1);
  assert.equal(cartPuts[0]?.quantity, 2);
});

test("generateGroceryListFromMealPlan is a no-op when the meal plan has no ingredients", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  const result = await generateGroceryListFromMealPlan("fam_1");

  assert.deepEqual(result, { added: 0, skipped: 0 });
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});
