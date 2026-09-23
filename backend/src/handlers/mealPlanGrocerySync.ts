import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { generateGroceryListFromMealPlan } from "./mealPlans";
import type { FamilyRecord } from "../types";

export interface MealPlanGrocerySyncResult {
  synced: number;
  failed: number;
}

// The one access pattern in this table with no natural partition to query
// across — a weekly job over every family is rare enough that a Scan
// (filtered to just the Family metadata item) is the pragmatic choice over
// adding a GSI. See backend/models/schema.md.
async function listAllFamilies(): Promise<FamilyRecord[]> {
  const families: FamilyRecord[] = [];
  // A Scan stops at 1MB of *scanned* rows, not matched ones, so with the
  // filter doing the work this can come back empty-handed while there are
  // still families further down the table. Paging is the only way to be
  // sure every household's list gets built.
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "entityType = :entityType",
        ExpressionAttributeValues: { ":entityType": "FAMILY" },
        ExclusiveStartKey: startKey,
      })
    );
    families.push(...((result.Items ?? []) as FamilyRecord[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return families;
}

// UTC is safe here where it wouldn't be in the UI: the schedule fires at
// 13:00 UTC (see template.yaml), which is mid-morning across the Americas
// and mid-afternoon across Europe — never near a date rollover — and the
// window is a whole week wide either way.
function nextSevenDayWindow(now: Date = new Date()): { start: string; end: string } {
  const start = now.toISOString().slice(0, 10);
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

/**
 * Orchestrates the sync across every family. Exported separately from
 * `handler` so tests can isolate a failing family without needing an
 * injectable client — Lambda always invokes `handler` as
 * `(event, context, callback)`, so a real invocation would otherwise
 * clobber a parameter living in the handler's own parameter list (same
 * pattern as calendarSync.ts's runCalendarSync).
 */
export async function runMealPlanGrocerySync(): Promise<MealPlanGrocerySyncResult> {
  const families = await listAllFamilies();
  const { start, end } = nextSevenDayWindow();

  const results = await Promise.allSettled(
    families.map((family) => generateGroceryListFromMealPlan(family.familyId, start, end))
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    console.error(`MealPlanGrocerySync: ${failures.length}/${families.length} families failed`, failures);
  }

  return { synced: families.length - failures.length, failed: failures.length };
}

/**
 * EventBridge-triggered handler (weekly, see template.yaml). Turns each
 * family's already-planned meals for the coming week into grocery cart
 * items automatically, so nobody has to remember to hit "generate" — still
 * driven entirely by ingredients a family member typed into their meal
 * plan, never an invented meal or ingredient.
 */
export const handler = async (): Promise<MealPlanGrocerySyncResult> => runMealPlanGrocerySync();
