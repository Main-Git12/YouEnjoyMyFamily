import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { handler, runMealPlanGrocerySync } from "./mealPlanGrocerySync";
import type { FamilyRecord } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const family = (familyId: string): FamilyRecord => ({
  PK: `FAMILY#${familyId}`,
  SK: "METADATA",
  entityType: "FAMILY",
  familyId,
  name: null,
  apiKeyHash: "hash",
  createdAt: "2025-01-01T00:00:00Z",
});

test("handler is a no-op when no families exist", async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [] });

  const result = await handler();
  assert.deepEqual(result, { synced: 0, failed: 0 });
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("scans only Family metadata items via the entityType filter", async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [] });

  await handler();

  const scanCalls = ddbMock.commandCalls(ScanCommand);
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.args[0].input.FilterExpression, "entityType = :entityType");
  assert.deepEqual(scanCalls[0]?.args[0].input.ExpressionAttributeValues, { ":entityType": "FAMILY" });
});

test("runMealPlanGrocerySync isolates a failing family instead of aborting the batch", async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [family("fam_fails"), family("fam_ok")] });
  ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, unknown> }) => {
    if (input.ExpressionAttributeValues?.[":pk"] === "FAMILY#fam_fails") {
      throw new Error("meal plan lookup failed");
    }
    return { Items: [] };
  });

  const result = await runMealPlanGrocerySync();
  assert.deepEqual(result, { synced: 1, failed: 1 });
});

test("runs each family's generation over the coming 7-day window", async () => {
  ddbMock.on(ScanCommand).resolves({ Items: [family("fam_1")] });
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  await runMealPlanGrocerySync();

  const queryCalls = ddbMock.commandCalls(QueryCommand);
  assert.equal(queryCalls.length, 1);
  const values = queryCalls[0]?.args[0].input.ExpressionAttributeValues as Record<string, string>;
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(values[":from"], `MEALPLAN#${today}`);
});
