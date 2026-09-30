#!/usr/bin/env node
/**
 * Pre-deploy checks for template.yaml, runnable without AWS credentials.
 *
 * This exists because of a real failure. An earlier commit added three
 * routes pointing at `!Ref HttpApi` — a logical id that does not exist in
 * this template; the API is `YouEnjoyMyFamilyHttpApi`. Nothing caught it:
 * it typechecks, it lints, every test passes, and the only thing that
 * would have said so is `sam deploy`, which fails several minutes in and
 * rolls back. There is no SAM CLI in CI, so the check has to be this.
 *
 * What it verifies:
 *   1. Every !Ref / !GetAtt / ${...} names a real Resource, Parameter or
 *      AWS pseudo-parameter.
 *   2. Every esbuild EntryPoint file exists on disk.
 *   3. Every Handler "<path>.<export>" resolves to a file that exports it.
 *   4. Every function that reads DynamoDB actually has a policy for it.
 *   5. It reports the SSM parameters the deploy will need, so a missing
 *      one is a line of output rather than a rollback.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const templatePath = join(root, "template.yaml");
const raw = readFileSync(templatePath, "utf8");

const problems = [];
const notes = [];

// CloudFormation's own intrinsics and pseudo-parameters, which are always valid.
const PSEUDO = new Set([
  "AWS::Region",
  "AWS::AccountId",
  "AWS::StackName",
  "AWS::StackId",
  "AWS::Partition",
  "AWS::URLSuffix",
  "AWS::NoValue",
]);

/**
 * Top-level keys of a block, by indentation. Deliberately not a YAML
 * parser: the template uses short-form intrinsics (`!Ref`, `!Sub`) that a
 * plain YAML load rejects without custom constructors, and the structure
 * here is shallow and regular enough that reading it by indentation is
 * honest rather than clever.
 */
function topLevelKeysOf(section) {
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${section}:`));
  if (start === -1) return [];
  const keys = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(" ")) break; // next top-level section
    const match = /^ {2}([A-Za-z0-9]+):\s*$/.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

const resources = topLevelKeysOf("Resources");
const parameters = topLevelKeysOf("Parameters");
const known = new Set([...resources, ...parameters, ...PSEUDO]);

if (resources.length === 0) problems.push("No resources found — is template.yaml intact?");

// --- 1. every reference names something real ---------------------------
const referenced = new Map(); // name -> first line number
const lines = raw.split("\n");
lines.forEach((line, index) => {
  if (line.trimStart().startsWith("#")) return;
  const add = (name) => {
    if (!referenced.has(name)) referenced.set(name, index + 1);
  };
  for (const m of line.matchAll(/!Ref\s+([A-Za-z0-9:]+)/g)) if (m[1]) add(m[1]);
  for (const m of line.matchAll(/!GetAtt\s+([A-Za-z0-9]+)\./g)) if (m[1]) add(m[1]);
  // ${X} and ${X.Attr} inside !Sub. Skips ${!Literal}, which is an escape.
  for (const m of line.matchAll(/\$\{(?!!)([A-Za-z0-9:]+)(?:\.[A-Za-z0-9]+)?\}/g)) if (m[1]) add(m[1]);
});

for (const [name, line] of referenced) {
  if (!known.has(name)) {
    const near = resources.find((r) => r.toLowerCase().includes(name.toLowerCase()));
    problems.push(
      `template.yaml:${line} references "${name}", which is not a resource or parameter in this template.` +
        (near ? ` Did you mean "${near}"?` : "")
    );
  }
}

// --- 2 & 3. handlers and entry points exist ----------------------------
for (const m of raw.matchAll(/EntryPoints:\s*\[([^\]]+)\]/g)) {
  for (const entry of (m[1] ?? "").split(",")) {
    const file = entry.trim().replace(/^["']|["']$/g, "");
    if (file && !existsSync(join(root, file))) problems.push(`EntryPoint "${file}" does not exist`);
  }
}

for (const m of raw.matchAll(/^\s*Handler:\s*(\S+)\s*$/gm)) {
  const handler = m[1];
  if (!handler || !handler.includes("/")) continue; // not a file-path handler
  const lastDot = handler.lastIndexOf(".");
  const modulePath = handler.slice(0, lastDot);
  const exportName = handler.slice(lastDot + 1);
  const file = join(root, `${modulePath}.ts`);
  if (!existsSync(file)) {
    problems.push(`Handler "${handler}" points at ${modulePath}.ts, which does not exist`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  if (!new RegExp(`export\\s+(const|function|async function)\\s+${exportName}\\b`).test(source)) {
    problems.push(`Handler "${handler}" — ${modulePath}.ts does not export "${exportName}"`);
  }
}

// --- 4. every handler that touches the table can actually reach it -----
const functionBlocks = raw.split(/\n  (?=[A-Za-z0-9]+:\n    Type: AWS::Serverless::Function)/);
for (const block of functionBlocks) {
  const nameMatch = /^\s*([A-Za-z0-9]+):\n\s*Type: AWS::Serverless::Function/m.exec(block);
  const handlerMatch = /Handler:\s*(\S+)/.exec(block);
  if (!nameMatch?.[1] || !handlerMatch?.[1]) continue;
  const handler = handlerMatch[1];
  const modulePath = handler.slice(0, handler.lastIndexOf("."));
  const file = join(root, `${modulePath}.ts`);
  if (!existsSync(file)) continue;
  const source = readFileSync(file, "utf8");
  const usesTable = /docClient|TABLE_NAME/.test(source);
  const hasPolicy = /DynamoDBCrudPolicy|DynamoDBReadPolicy/.test(block);
  if (usesTable && !hasPolicy) {
    problems.push(`${nameMatch[1]} reads or writes DynamoDB but has no DynamoDB policy — it will fail at runtime with AccessDenied`);
  }
}

// --- 5. what the deploy will need to already exist ---------------------
const ssm = [...raw.matchAll(/\{\{resolve:(ssm|ssm-secure):([^}]+)\}\}/g)].map((m) => ({
  secure: m[1] === "ssm-secure",
  path: (m[2] ?? "").trim(),
}));
const uniqueSsm = [...new Map(ssm.map((s) => [s.path, s])).values()];
if (uniqueSsm.length) {
  notes.push("SSM parameters this stack resolves at deploy time — create them first, or the deploy rolls back:");
  for (const entry of uniqueSsm) {
    notes.push(`  ${entry.path}   (${entry.secure ? "SecureString" : "String"})`);
  }
}

// --- report ------------------------------------------------------------
const functionCount = (raw.match(/Type: AWS::Serverless::Function/g) ?? []).length;
const routeCount = (raw.match(/Type: HttpApi/g) ?? []).length;
console.log(`Checked ${resources.length} resources — ${functionCount} functions, ${routeCount} HTTP routes.`);
for (const note of notes) console.log(note);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? "" : "s"} that would fail the deploy:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\n✓ Template references, handlers and policies all check out.");
