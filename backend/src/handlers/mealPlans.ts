import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import { mergeIngredients, foodKey, parseIngredient } from "../lib/ingredients";
import { ok, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { MealPlanEntryInput, MEAL_SLOTS, type MealPlanEntryItem, type MealSlot } from "../types";
import { listCartItems, addMealPlanCartItem, outstandingCartItems } from "./groceryCart";

const mealPlanKey = (familyId: string, date: string, slot: MealSlot) => ({
  PK: `FAMILY#${familyId}`,
  SK: `MEALPLAN#${date}#${slot}`,
});


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

/**
 * An Update rather than a Put of a whole new item, for one attribute:
 * `createdAt`. A Put reset it on every edit, so correcting Tuesday's
 * spelling made Tuesday's dinner look like it had been planned just now —
 * and `createdAt` is what tells "this has been the plan all week" from
 * "someone changed this a minute ago". `if_not_exists` keeps the first
 * write's stamp without reading the row back first.
 *
 * `date` is a DynamoDB reserved word, so every attribute goes through
 * ExpressionAttributeNames rather than only the one that needs it.
 */
async function upsertMealPlanEntry(
  familyId: string,
  date: string,
  slot: MealSlot,
  input: MealPlanEntryInput
): Promise<MealPlanEntryItem> {
  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: mealPlanKey(familyId, date, slot),
      UpdateExpression:
        "SET #entityType = :entityType, #familyId = :familyId, #date = :date, #slot = :slot, " +
        "#mealName = :mealName, #ingredients = :ingredients, #updatedAt = :now, " +
        "#createdAt = if_not_exists(#createdAt, :now)",
      ExpressionAttributeNames: {
        "#entityType": "entityType",
        "#familyId": "familyId",
        "#date": "date",
        "#slot": "slot",
        "#mealName": "mealName",
        "#ingredients": "ingredients",
        "#createdAt": "createdAt",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":entityType": "MEAL_PLAN_ENTRY",
        ":familyId": familyId,
        ":date": date,
        ":slot": slot,
        ":mealName": input.mealName,
        ":ingredients": input.ingredients ?? [],
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes as MealPlanEntryItem;
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

  // Merged by food and measurement dimension, with the amounts actually
  // added up. This used to key on the whole lowercased string, so "2 onions"
  // on Tuesday and "1 onion" on Thursday were two different things and
  // arrived as two rows — and the quantity written to each row was the
  // number of *dates* it appeared on rather than how much anyone needed.
  // See lib/ingredients.ts for why nothing here invents an amount.
  const merged = mergeIngredients(
    entries.map((entry) => ({
      date: entry.date,
      slot: entry.slot,
      mealName: entry.mealName,
      ingredients: entry.ingredients,
    }))
  );

  if (merged.length === 0) return { added: 0, skipped: 0 };

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
  // Three spellings of the same row, because a description is not a key.
  // `mealPlanSourceKey` carries the dimension ("tortilla::count") and so can
  // only ever match `line.key`; a description does not, and a generated one
  // now leads with the amount ("1.5 kg mince"), so it has to be read back
  // through the same parser that wrote it rather than merely lowercased —
  // `foodKey("1.5 kg mince")` is "1.5 kg mince", which matches nothing and
  // would quietly put a second mince on the list every time anyone
  // regenerated. The plain `foodKey` stays as well, for descriptions the
  // parser declines to take an amount off.
  const coveredOutright = new Set(
    outstandingCartItems(cart).flatMap((item) => [
      ...(item.mealPlanSourceKey ? [item.mealPlanSourceKey] : []),
      parseIngredient(item.description).food,
      foodKey(item.description),
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
  for (const line of merged) {
    const key = line.key;
    const alreadyBought = coveredDates.get(key);
    const stillNeeded = coveredOutright.has(line.key) || coveredOutright.has(line.food)
      ? []
      : line.dates.filter((date) => !alreadyBought?.has(date));
    if (stillNeeded.length === 0) {
      skipped++;
      continue;
    }

    // Only the contributions for dates still needed: regenerating midweek
    // after Tuesday's shop must not re-buy Tuesday's share.
    const stillNeededSet = new Set(stillNeeded);
    const contributions = line.contributions.filter((c) => stillNeededSet.has(c.date));

    // The description carries the amount so a human reading the list sees
    // "1.5 kg mince" rather than "mince" and a number in another column.
    const description = line.quantity !== null
      ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""} ${line.foodLabel}`.trim()
      : line.foodLabel;

    // null: a concurrent generation already wrote this exact line.
    const item = await addMealPlanCartItem(familyId, description, 1, key, [...stillNeededSet].sort(), {
      amount: line.quantity,
      unit: line.unit,
      needsCheck: line.needsCheck,
      contributions,
    });
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
