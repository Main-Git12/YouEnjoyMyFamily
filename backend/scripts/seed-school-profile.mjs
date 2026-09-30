/**
 * Loads a child's school profile — the specials rotation and which published
 * lunch menu is theirs — from a JSON file into a deployed API.
 *
 * There is no screen for this yet, and one sheet of paper per child per year
 * did not seem worth a settings page before the rest of it was proven. This
 * is the interim: edit the JSON, run it once, and it is a normal `PUT` to
 * the same route a settings screen would use later.
 *
 * Credentials come from the environment and are never written to a file:
 *
 *   API_BASE_URL=https://xxxx.execute-api.us-east-2.amazonaws.com \
 *   FAMILY_ID=fam_... FAMILY_API_KEY=fk_... \
 *   npm run seed:school -- seeds/parker-school.json
 *
 * Keys starting with `_` are stripped, so the file can carry its own notes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , file] = process.argv;
const { API_BASE_URL, FAMILY_ID, FAMILY_API_KEY } = process.env;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!file) fail("Usage: npm run seed:school -- <file.json>");
for (const [name, value] of Object.entries({ API_BASE_URL, FAMILY_ID, FAMILY_API_KEY })) {
  if (!value) fail(`${name} must be set in the environment.`);
}

let profile;
try {
  profile = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
} catch (err) {
  fail(`Could not read ${file}: ${err.message}`);
}

const { memberId, ...rest } = profile;
if (!memberId) fail(`${file} has no "memberId" — that is which child this is.`);
const body = Object.fromEntries(Object.entries(rest).filter(([key]) => !key.startsWith("_")));

const url = `${API_BASE_URL.replace(/\/$/, "")}/families/${FAMILY_ID}/school-profiles/${encodeURIComponent(memberId)}`;
const response = await fetch(url, {
  method: "PUT",
  headers: { "Content-Type": "application/json", authorization: `Bearer ${FAMILY_API_KEY}` },
  body: JSON.stringify(body),
});

const text = await response.text();
if (!response.ok) fail(`PUT ${url} returned ${response.status}\n${text}`);

const saved = JSON.parse(text);
console.log(`\n✓ ${saved.memberId} — ${saved.schoolName}${saved.teacher ? `, ${saved.teacher}` : ""}`);
for (const special of saved.specials) {
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][special.dayOfWeek];
  console.log(`    ${day.padEnd(10)} ${special.subject}${special.prepNote ? ` — ${special.prepNote}` : ""}`);
}
console.log(saved.menuSource ? `\n  Lunch menu: ${saved.menuSource.provider} #${saved.menuSource.menuId}\n` : "\n");
