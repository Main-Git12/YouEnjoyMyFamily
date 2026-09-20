import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { MealPlanEntryInput, MEAL_SLOTS, type MealPlanEntryItem, type MealSlot } from "../types";
import { listCartItems, addMealPlanCartItem } from "./groceryCart";

const mealPlanKey = (familyId: string, date: string, slot: MealSlot) => ({
  PK: `FAMILY#${familyId}`,
  SK: `MEALPLAN#${date}#${slot}`,
});

const normalizeIngredient = (ingredient: string) => ingredient.trim().toLowerCase();

const isValidDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

function isMealSlot(value: string | undefined): value is MealSlot {
  return !!value && (MEAL_SLOTS as readonly string[]).includes(value);
}

export async function listMealPlan(familyId: string, start?: string, end?: string): Promise<MealPlanEntryItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        ":from": `MEALPLAN#${start ?? "0000-00-00"}`,
        ":to": `MEALPLAN#${end ?? "9999-12-31"}#￿`,
      },
    })
  );
  return (result.Items ?? []) as MealPlanEntryItem[];
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
 * Idempotent: re-running for the same range never duplicates an ingredient
 * already generated from a meal plan before (tracked via each cart item's
 * mealPlanSourceKey), which is what makes the weekly scheduled sync in
 * mealPlanGrocerySync.ts safe to re-run.
 */
export async function generateGroceryListFromMealPlan(
  familyId: string,
  start?: string,
  end?: string
): Promise<GenerateGroceryListResult> {
  const entries = await listMealPlan(familyId, start, end);

  const aggregated = new Map<string, { description: string; quantity: number }>();
  for (const entry of entries) {
    for (const ingredient of entry.ingredients) {
      const key = normalizeIngredient(ingredient);
      const current = aggregated.get(key);
      aggregated.set(key, {
        description: current?.description ?? ingredient.trim(),
        quantity: (current?.quantity ?? 0) + 1,
      });
    }
  }

  if (aggregated.size === 0) return { added: 0, skipped: 0 };

  // Anything already on the list — whether a previous generation put it
  // there (mealPlanSourceKey) or someone typed it in themselves (its
  // description) — counts as covered. Matching on the description too is
  // what stops a hand-added "Milk" and a meal plan's "milk" becoming two
  // separate lines on the same shopping trip.
  const existingItems = await listCartItems(familyId);
  const alreadyOnTheList = new Set(
    existingItems.flatMap((item) => [
      ...(item.mealPlanSourceKey ? [item.mealPlanSourceKey] : []),
      normalizeIngredient(item.description),
    ])
  );

  let added = 0;
  let skipped = 0;
  for (const [key, { description, quantity }] of aggregated) {
    if (alreadyOnTheList.has(key)) {
      skipped++;
      continue;
    }
    await addMealPlanCartItem(familyId, description, quantity, key);
    added++;
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
