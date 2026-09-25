import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * No handler may send a bare Query and read only the first page.
 *
 * This has now been found three separate times in this codebase — in the
 * gem ledger, in the grocery cart, and in the routine and meal-plan reads
 * — and each time it looked fine in every test, because a test's fake
 * DynamoDB always returns one page.
 *
 * It is a nasty failure because it does not fail. Past 1MB a Query just
 * stops, reports it only through `LastEvaluatedKey`, and returns a short
 * answer that looks like a real one: gem totals that quietly stop growing,
 * a shopping list missing the ingredients that fell off page two, a median
 * computed from whichever mornings happened to fit and then shown on a
 * wall with "from the last 15 mornings" under it.
 *
 * So rather than catching it a fourth time in review, this asserts the
 * rule: reads go through `queryAll`, which follows the pages to the end.
 * If a genuinely single-page Query is ever needed — one item, or a
 * `Limit: 1` probe — name it in ALLOWED below with the reason.
 */

// Resolved from the working directory rather than the module's own path:
// this project's tsconfig module setting rules out `import.meta`, and the
// test script runs from `backend/` (see package.json).
const HANDLERS = join(process.cwd(), "src", "handlers");
const LIB = join(process.cwd(), "src", "lib");

/** file -> why a raw Query is correct there. */
const ALLOWED: Record<string, string> = {
  // Pages explicitly, inline, with its own loop — it is a Scan, not a Query,
  // and the paging is the whole point of the comment above it.
  "mealPlanGrocerySync.ts": "scans families, pages inline on LastEvaluatedKey",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
}

test("no handler reads only the first page of a Query", () => {
  const offenders: string[] = [];
  for (const [dir, files] of [
    [HANDLERS, sourceFiles(HANDLERS)],
    [LIB, sourceFiles(LIB).filter((name) => name !== "queryAll.ts")],
  ] as const) {
    for (const file of files) {
      if (ALLOWED[file]) continue;
      const source = readFileSync(join(dir, file), "utf8");
      if (/new QueryCommand\(/.test(source)) offenders.push(file);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These send a Query directly instead of using queryAll, so they read only the first 1MB ` +
      `and silently drop the rest: ${offenders.join(", ")}. Use queryAll from lib/queryAll.ts, ` +
      `or add the file to ALLOWED in this test with the reason it is genuinely single-page.`
  );
});

test("the Scan that exists pages to the end", () => {
  const source = readFileSync(join(HANDLERS, "mealPlanGrocerySync.ts"), "utf8");
  assert.match(source, /LastEvaluatedKey/, "the weekly job's Scan must follow LastEvaluatedKey");
  // A filtered Scan can return an empty page while rows it wants sit
  // further down the table, so stopping at the first page is worse here
  // than for a Query: it can skip a whole household.
  assert.match(source, /ExclusiveStartKey/, "...and pass it back as ExclusiveStartKey");
});
