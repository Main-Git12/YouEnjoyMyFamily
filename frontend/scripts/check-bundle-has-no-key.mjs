/**
 * Proves the family's API key cannot reach the built bundle.
 *
 * This is the one property that lets the site be served from a public
 * CloudFront URL at all, and it is not something a unit test can check:
 * Vite inlines `import.meta.env.VITE_*` at build time, so the only honest
 * test is to build with a key set — exactly as the old deploy command did
 * — and then look in the output for it.
 *
 * Run by `npm run verify:bundle`, and in CI.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const CANARY_KEY = "fk_canary_this_must_never_ship";
const CANARY_ID = "fam_canary_this_must_never_ship";
const DIST = new URL("../dist/", import.meta.url).pathname;

rmSync(DIST, { recursive: true, force: true });
execFileSync("npm", ["run", "build"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    VITE_API_BASE_URL: "https://example.invalid",
    VITE_FAMILY_API_KEY: CANARY_KEY,
    VITE_FAMILY_ID: CANARY_ID,
  },
  stdio: "inherit",
});

function everyFile(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? everyFile(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

const leaked = everyFile(DIST).filter((file) => {
  const contents = readFileSync(file, "latin1");
  return contents.includes(CANARY_KEY) || contents.includes(CANARY_ID);
});

if (leaked.length) {
  console.error(
    `\nThe family's API key reached the built bundle:\n${leaked.map((f) => `  ${f}`).join("\n")}\n\n` +
      "Anyone who loads the site could read it out of the source, which is the\n" +
      "whole reason the key is entered per device instead (src/lib/familyKey.ts).\n"
  );
  process.exit(1);
}

console.log("\n✓ No family key in the bundle — safe to serve from a public URL.\n");
