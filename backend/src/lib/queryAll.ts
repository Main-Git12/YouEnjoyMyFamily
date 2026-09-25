import { QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { docClient } from "./dynamoClient";

/**
 * Runs a Query to the end, following `LastEvaluatedKey` page by page.
 *
 * A single Query stops at 1MB of data — a few thousand completion rows, or
 * about a year of chores for a busy family — and says so only through
 * `LastEvaluatedKey`. Reading just the first page silently drops everything
 * after it, which for a ledger means totals that quietly stop growing. Use
 * this for any "all of X" read.
 */
export async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((result.Items ?? []) as T[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}
