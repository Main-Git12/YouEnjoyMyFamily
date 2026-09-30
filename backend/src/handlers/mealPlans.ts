import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { MealPlanEntryInput, MEAL_SLOTS, type MealPlanEntryItem, type MealSlot } from "../types";
import { listCartItems, addMealPlanCartItem, outstandingCartItems } from "./groceryCart";

const mealPlanKey = (familyId: string, date: string, slot: MealSlot) => ({
  PK: `FAMILY#${familyId}`,
  SK: `MEALPLAN#${date}#${slot}`,
});

const normalizeIngredient = (ingredient: string) => ingredient.trim().toLowerCase();

const isValidDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

function isMealSlot(value: string | undefined): value is MealSlot {
  return !!value && (MEAL_SLOTS as readonly string[]).includes(value);
}

/**
 * Paged to the end. This read is what `generateGroceryListFromMealPlan`
 * aggregates over, so a truncated page doesn't show up as a short list of
 * meals — it shows up at the shop, as ingredients that were planned and
 * silently never made it onto the list.
 */
export async function listMealPlan(familyId: string, start?: string, end?: string): Promise<MealPlanEntryItem[]> {
  return queryAll<MealPlanEntryItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      // `||`, not `??` — an omitted query param arrives as an empty string,
      // which would build a range sorting below every real key (see the
      // same guard in schedules.ts).
      ":from": `MEALPLAN#${start || "0000-00-00"}`,
      ":to": `MEALPLAN#${end || "9999-12-31"}#￿`,
    },
  });
}

async function upsertMealPlanEntry(
  familyId: string,
  date: string,
  slot: MealSlot,
  input: MealPlanEntryInput
): Promise<MealPlanEntryItem> {
  const now = new Date().toISOString();
  const item: MealPlanEntryItem = {
    ...mealPlanKey(familyId, date, slot),
    entityType: "MEAL_PLAN_ENTRY",
    familyId,
    date,
    slot,
    mealName: input.mealName,
    ingredients: input.ingredients ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function deleteMealPlanEntry(familyId: string, date: string, slot: MealSlot): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: mealPlanKey(familyId, date, slot) }));
}

export interface GenerateGroceryListResult {
  added: number;
  skipped: number;
}

/**
 * Turns the ingredients a family already explicitly typed into their meal
 * plan into grocery cart items — never an AI-invented meal or ingredient.
 * Idempotent: re-running for the same (or an overlapping) range never
 * duplicates an ingredient already on the list or already bought for the
 * same planned date, which is what makes the weekly scheduled sync in
 * mealPlanGrocerySync.ts safe to re-run alongside the family's own taps.
 */
export async function generateGroceryListFromMealPlan(
  familyId: string,
  start?: string,
  end?: string
): Promise<GenerateGroceryListResult> {
  const entries = await listMealPlan(familyId, start, end);

  // One date per time the ingredient is planned — "rice" at Monday lunch and
  // Monday dinner is two portions, both needed for Monday.
  const needs = new Map<string, { description: string; dates: string[] }>();
  for (const entry of entries) {
    for (const ingredient of entry.ingredients) {
      const key = normalizeIngredient(ingredient);
      const current = needs.get(key);
      needs.set(key, {
        description: current?.description ?? ingredient.trim(),
        dates: [...(current?.dates ?? []), entry.date],
      });
    }
  }

  if (needs.size === 0) return { added: 0, skipped: 0 };

  // Anything still on the list — pending or substituted, whether a previous
  // generation put it there (mealPlanSourceKey) or someone typed it in
  // themselves (its description) — covers the ingredient outright. Matching
  // on the description too is what stops a hand-added "Milk" and a meal
  // plan's "milk" becoming two separate lines on the same shopping trip.
  //
  // A line that has been ordered, or marked unavailable, is kept as history
  // and covers only the plan dates it was generated for (mealPlanDates).
  // That way tortillas bought for this Friday aren't bought again when
  // someone regenerates midweek, an unavailable "Saffron" doesn't sprout a
  // second line beside it, yet next week's tacos still get their tortillas.
  const cart = await listCartItems(familyId);
  const coveredOutright = new Set(
    outstandingCartItems(cart).flatMap((item) => [
      ...(item.mealPlanSourceKey ? [item.mealPlanSourceKey] : []),
      normalizeIngredient(item.description),
    ])
  );
  const coveredDates = new Map<string, Set<string>>();
  for (const item of cart) {
    if (item.status !== "ordered" && item.status !== "unavailable") continue;
    if (!item.mealPlanSourceKey || !item.mealPlanDates) continue;
    const dates = coveredDates.get(item.mealPlanSourceKey) ?? new Set<string>();
    for (const date of item.mealPlanDates) dates.add(date);
    coveredDates.set(item.mealPlanSourceKey, dates);
  }

  let added = 0;
  let skipped = 0;
  for (const [key, { description, dates }] of needs) {
    const alreadyBought = coveredDates.get(key);
    const stillNeeded = coveredOutright.has(key) ? [] : dates.filter((date) => !alreadyBought?.has(date));
    if (stillNeeded.length === 0) {
      skipped++;
      continue;
    }
    const coveringDates = [...new Set(stillNeeded)].sort();
    // null: a concurrent generation already wrote this exact line.
    const item = await addMealPlanCartItem(familyId, description, stillNeeded.length, key, coveringDates);
    if (item) added++;
    else skipped++;
  }

  return { added, skipped };
}

export async function routeMealPlans(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { familyId, date, slot } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};
  const isGenerate = event.rawPath.endsWith("/generate-grocery-list");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (isGenerate && method === "POST") {
      return ok(await generateGroceryListFromMealPlan(familyId, query.start, query.end));
    }

    switch (method) {
      case "GET":
        return ok(await listMealPlan(familyId, query.start, query.end));
      case "PUT": {
        if (!isValidDate(date) || !isMealSlot(slot)) return badRequest("A valid date and slot are required");
        return ok(await upsertMealPlanEntry(familyId, date, slot, parseBody(MealPlanEntryInput, event.body)));
      }
      case "DELETE": {
        if (!isValidDate(date) || !isMealSlot(slot)) return badRequest("A valid date and slot are required");
        await deleteMealPlanEntry(familyId, date, slot);
        return ok({ deleted: `${date}#${slot}` });
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
  routeMealPlans(event);
