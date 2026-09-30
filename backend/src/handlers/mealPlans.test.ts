import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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
  orderedAt: null,
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

test("GET treats blank start/end as 'no filter' rather than a range that matches nothing", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers, queryStringParameters: { start: "", end: "" } })
  );

  assert.equal(result.statusCode, 200);
  const values = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues;
  const realKey = "MEALPLAN#2026-09-20#dinner";
  assert.ok(realKey >= String(values?.[":from"]) && realKey <= String(values?.[":to"]));
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
  assert.deepEqual(spaghettiItem?.mealPlanDates, ["2025-01-15"]);
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

test("generation puts an ingredient back on the list once last week's shop has gone", async () => {
  // Tortillas were bought last week. Tacos are on again this week, so they
  // have to come back — an ordered item is history, not a standing line.
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
    const prefix = input.ExpressionAttributeValues?.[":prefix"];
    if (prefix === "CARTITEM#") {
      return {
        Items: [cartItem({ itemId: "i1", description: "Tortillas", status: "ordered", orderedAt: "2025-01-01T00:00:00Z", source: "meal_plan", mealPlanSourceKey: "tortillas" })],
      };
    }
    return {
      Items: [
        {
          PK: "FAMILY#fam_1",
          SK: "MEALPLAN#2025-01-15#dinner",
          entityType: "MEAL_PLAN_ENTRY",
          familyId: "fam_1",
          date: "2025-01-15",
          slot: "dinner",
          mealName: "Tacos",
          ingredients: ["Tortillas"],
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    };
  });
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1", "2025-01-15", "2025-01-21");

  assert.deepEqual(result, { added: 1, skipped: 0 });
});

/** Routes the meal-plan Query and the cart Query to separate fixtures. */
function mockPlanAndCart(plan: MealPlanEntryItem[], cart: CartItem[]) {
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) =>
    input.ExpressionAttributeValues?.[":prefix"] === "CARTITEM#" ? { Items: cart } : { Items: plan }
  );
}

const generatedCartPuts = () =>
  ddbMock
    .commandCalls(PutCommand)
    .map((call) => call.args[0].input.Item as CartItem)
    .filter((item) => item.entityType === "CART_ITEM");

test("regenerating midweek doesn't re-add ingredients already ordered for the same planned dates", async () => {
  // Sunday's job built Friday's taco list and the family checked out. On
  // Wednesday a parent plans Thursday pasta and taps Generate over a window
  // that still includes Friday.
  const fridayTacos = mealPlanEntry({
    SK: "MEALPLAN#2025-01-17#dinner",
    date: "2025-01-17",
    mealName: "Tacos",
    ingredients: ["Tortillas", "Ground beef", "Rice"],
  });
  const thursdayPasta = mealPlanEntry({
    SK: "MEALPLAN#2025-01-16#dinner",
    date: "2025-01-16",
    mealName: "Pasta",
    ingredients: ["Penne"],
  });
  // Tacos again the Friday after — that week hasn't been shopped for.
  const nextFridayTacos = mealPlanEntry({
    SK: "MEALPLAN#2025-01-24#dinner",
    date: "2025-01-24",
    mealName: "Tacos",
    ingredients: ["Tortillas"],
  });
  const ordered = (itemId: string, description: string) =>
    cartItem({
      itemId,
      SK: `CARTITEM#${itemId}`,
      description,
      status: "ordered",
      orderedAt: "2025-01-12T15:00:00Z",
      source: "meal_plan",
      mealPlanSourceKey: description.toLowerCase(),
      mealPlanDates: ["2025-01-17"],
    });
  mockPlanAndCart(
    [thursdayPasta, fridayTacos, nextFridayTacos],
    [ordered("o1", "Tortillas"), ordered("o2", "Ground beef"), ordered("o3", "Rice")]
  );
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1", "2025-01-15", "2025-01-24");

  assert.deepEqual(result, { added: 2, skipped: 2 });
  const puts = generatedCartPuts();
  assert.deepEqual(
    puts.map((item) => [item.description, item.quantity, item.mealPlanDates]),
    [
      ["Penne", 1, ["2025-01-16"]],
      // Only next Friday's portion — this Friday's was already bought.
      ["Tortillas", 1, ["2025-01-24"]],
    ]
  );
});

test("two generations racing over the same plan write each ingredient once", async () => {
  // A double-tap on Generate: both requests read the cart before either has
  // written anything, so both see every ingredient as missing.
  mockPlanAndCart([mealPlanEntry()], []);
  const stored = new Map<string, CartItem>();
  ddbMock.on(PutCommand).callsFake((input: { Item: CartItem; ConditionExpression?: string }) => {
    if (input.ConditionExpression === "attribute_not_exists(PK)" && stored.has(input.Item.SK)) {
      throw new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
    }
    stored.set(input.Item.SK, input.Item);
    return {};
  });

  const [first, second] = await Promise.all([
    generateGroceryListFromMealPlan("fam_1"),
    generateGroceryListFromMealPlan("fam_1"),
  ]);

  assert.equal(stored.size, 3);
  assert.deepEqual(
    [...stored.values()].map((item) => item.description).sort(),
    ["Ground beef", "Marinara sauce", "Spaghetti"]
  );
  assert.equal((first?.added ?? 0) + (second?.added ?? 0), 3);
  assert.equal((first?.skipped ?? 0) + (second?.skipped ?? 0), 3);
  // The id is a hash, so free-typed ingredient text can't leak a '#' into the key.
  for (const item of stored.values()) assert.match(item.itemId, /^mp-[0-9a-f]{32}$/);
});

test("regenerating the same week doesn't add a second line beside one marked unavailable", async () => {
  const paella = mealPlanEntry({ mealName: "Paella", ingredients: ["Saffron", "Rice"] });
  mockPlanAndCart(
    [paella],
    [
      cartItem({
        itemId: "u1",
        SK: "CARTITEM#u1",
        description: "Saffron",
        status: "unavailable",
        source: "meal_plan",
        mealPlanSourceKey: "saffron",
        mealPlanDates: ["2025-01-15"],
      }),
      cartItem({
        itemId: "s1",
        SK: "CARTITEM#s1",
        description: "Rice",
        status: "substituted",
        substituteDescription: "Arborio rice",
        source: "meal_plan",
        mealPlanSourceKey: "rice",
        mealPlanDates: ["2025-01-15"],
      }),
    ]
  );
  ddbMock.on(PutCommand).resolves({});

  const result = await generateGroceryListFromMealPlan("fam_1", "2025-01-13", "2025-01-19");

  assert.deepEqual(result, { added: 0, skipped: 2 });
  assert.equal(generatedCartPuts().length, 0);
});

test("listMealPlan reads every page, so a planned ingredient can't vanish before the shop", async () => {
  // This read is what generateGroceryListFromMealPlan aggregates over. A
  // truncated page doesn't look like a bug — it looks like standing in the
  // shop without the tortillas.
  ddbMock.on(QueryCommand).callsFake((input: { ExclusiveStartKey?: { page: number } }) => {
    const pages: MealPlanEntryItem[][] = [
      [{ date: "2026-09-21", slot: "dinner", mealName: "Pasta", ingredients: ["Pasta"] } as MealPlanEntryItem],
      [{ date: "2026-09-23", slot: "dinner", mealName: "Tacos", ingredients: ["Tortillas"] } as MealPlanEntryItem],
    ];
    const page = input.ExclusiveStartKey?.page ?? 0;
    return { Items: pages[page] ?? [], LastEvaluatedKey: page + 1 < pages.length ? { page: page + 1 } : undefined };
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "GET",
      rawPath: "/families/fam_1/meal-plan",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2026-09-01", end: "2026-09-30" },
    })
  );

  const entries = JSON.parse(result.body ?? "[]") as MealPlanEntryItem[];
  assert.deepEqual(entries.map((entry) => entry.mealName), ["Pasta", "Tacos"]);
});
