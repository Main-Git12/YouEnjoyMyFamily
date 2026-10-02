#!/usr/bin/env node
/**
 * Fails if this repository is carrying the family's own private details.
 *
 * Written because it already happened. A seed file naming a child, his
 * school, his teacher and his weekly whereabouts was committed and pushed
 * to a public repository, and by the time anybody looked the same
 * identifiers had spread into a library comment, two input placeholders and
 * eleven test fixtures. Cleaning that up fixes one instance; this is the
 * part that stops there being a second.
 *
 * Two checks, deliberately different in kind.
 *
 * The structural one needs no configuration and so cannot be forgotten: a
 * filled-in seed must never be tracked. That is the exact shape of what
 * went wrong, and it is decidable from `git ls-files` alone.
 *
 * The denylist one reads terms from `.private-terms`, which is itself
 * gitignored — a list of "never commit these words" is worse than useless
 * if the list is in the repository spelling them out. Each household keeps
 * its own; CI can supply one as a secret. Absent, that half skips loudly
 * rather than passing silently, because a guard that quietly does nothing
 * is how you end up believing you are covered.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const problems = [];

// --- 1. No filled-in seed may be tracked --------------------------------
for (const path of tracked.filter((candidate) => /(^|\/)seeds\/.+\.json$/.test(candidate))) {
  problems.push(
    `${path} is tracked. A filled-in seed names a real school, a real teacher and a real ` +
      `child's week; it belongs in the deployed table. Keep only *.json.example.`
  );
}

// --- 2. No term the household has marked private ------------------------
const TERMS_FILE = ".private-terms";
let ranDenylist = false;

if (existsSync(TERMS_FILE)) {
  ranDenylist = true;
  const terms = readFileSync(TERMS_FILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  // Text files only: a short term would otherwise match arbitrary bytes
  // inside a PNG or a wav and fail the build for nothing.
  const textLike = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|html|css|txt|sh|webmanifest|example)$/;
  for (const path of tracked.filter((c) => textLike.test(c) && c !== TERMS_FILE)) {
    let body;
    try {
      body = readFileSync(path, "utf8").toLowerCase();
    } catch {
      continue;
    }
    if (terms.some((term) => body.includes(term.toLowerCase()))) {
      // The matched term is deliberately not printed. "Found 'Oak Lane
      // Primary' in X" would publish it straight into the build log, which
      // is the thing this exists to prevent.
      problems.push(`${path} contains a term from ${TERMS_FILE} (the term is not printed here, by design).`);
    }
  }
}

if (problems.length) {
  console.error("✗ Private data in tracked files:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nThis repository has been public. Treat anything committed to it as published:\n" +
      "a school and a teacher beside a child's name cannot be rotated the way a key can."
  );
  process.exit(1);
}

console.log(
  ranDenylist
    ? "✓ No filled-in seeds tracked, and no private terms in any tracked file."
    : "✓ No filled-in seeds tracked. (No .private-terms file, so the denylist half did not run.)"
);
