# YouEnjoyMyFamily backend

AWS SAM application: HTTP API Gateway → Lambda handlers → single-table
DynamoDB, plus an EventBridge-scheduled Lambda for Google Calendar sync.
Handlers are strict TypeScript, bundled per-function by `sam build` via
esbuild (see `Metadata.BuildMethod` on each function in `template.yaml`).

## Structure

```
template.yaml         SAM template — API Gateway, Lambda functions (esbuild-bundled TS), DynamoDB table, EventBridge rule
tsconfig.json          Strict compiler options
eslint.config.js        typescript-eslint flat config
models/schema.md        Single-table DynamoDB entity/access-pattern design
src/types.ts            Zod input schemas + persisted item interfaces (single source of truth)
src/lib/                Dynamo client, typed API Gateway responses, request-body validation,
                         per-family API key check (auth.ts — see "Authentication" below)
src/handlers/                (every handler below has a matching *.test.ts)
  families.ts            POST /families — the one unauthenticated route; provisions a family and its API key.
                           Also GET/PUT /families/{familyId} (name, household location) and
                           POST /families/{familyId}/key to replace a key that has got out
  tasks.ts              CRUD: /families/{familyId}/tasks[/{taskId}]
  schedules.ts           CRUD: /families/{familyId}/schedules[/{scheduleId}]
  preferences.ts         GET/PUT: /families/{familyId}/members/{memberId}/preferences
  groceryCart.ts          CRUD-ish: /families/{familyId}/grocery-cart[/items[/{itemId}]], /checkout;
                           checkout calls the Instacart Developer Platform via an injectable
                           `InstacartClient` (Giant Eagle/Aldi don't have their own developer APIs);
                           sends `line_item_measurements`, not the `quantity`/`unit` they deprecated
                           in March 2026, and searches on the food while the whole line goes in
                           `display_text` — see `toInstacartLineItem`. Their unit vocabulary is a
                           closed list and an unrecognised unit fails their matching *silently*, so
                           lib/ingredients.ts converts anything outside it rather than sending it;
                           tests cover the explicit "mark unavailable → confirm substitute" learning flow
  statedPreferences.ts    CRUD: /families/{familyId}/stated-preferences[/{preferenceId}] — things a
                           family member explicitly *said*, never inferred from behaviour
  mealPlans.ts            /families/{familyId}/meal-plan[/{date}/{slot}] plus
                           POST /meal-plan/generate-grocery-list — turns planned ingredients into
                           cart items idempotently (see schema.md on `mealPlanSourceKey`), merging
                           by food *and measurement dimension* via lib/ingredients.ts so "2 onions"
                           on Tuesday and "1 onion" on Thursday are one line of three onions. An
                           amount that can't be read is never guessed: the row keeps the family's
                           own words and is flagged `needsCheck`
  rewardGoals.ts          /families/{familyId}/reward-goals[/{memberId}[/claim]] and
                           GET /gem-balances — balances are derived on read (earned minus claimed),
                           never stored; claiming is a TransactWrite so two taps can't both charge
  routines.ts             /families/{familyId}/routines[/{routineId}[/runs]] — the morning and
                           bedtime sequences, and what actually happened on each date. Note the
                           sort-key prefixes are `ROUTINE#` and `RUN#`, not `ROUTINERUN#`
  focusBlocks.ts          /families/{familyId}/focus-blocks[/{blockId}] — a block of focused work
                           and, inseparably, its timesheet line. `actualMinutes` is computed on
                           write from the timestamps rather than trusted from the caller
  schoolProfiles.ts       CRUD: /families/{familyId}/school-profiles[/{memberId}] — one row per
                           child: the school, the teacher, the weekly specials rotation, and which
                           published lunch menu is theirs. All typed in off the sheet the school
                           sent home. `menuSource` is three integers against a closed provider
                           list, never a URL — a URL in a row is request forgery with a table for
                           a front door
  schoolPrep.ts           /families/{familyId}/school-prep[/{memberId}/{date}] — the record that
                           what the school asked for on one day was ticked off. Records that
                           *somebody said they had done it*, nothing more: the app cannot see
                           inside a schoolbag, so an absent row reads "not ticked off" and never
                           "forgotten". `packedAt` is kept from the first write, never bumped
  schoolMenu.ts           GET /families/{familyId}/school-menu?memberId=&start=&end= — the
                           published lunch menu, read through a DynamoDB cache of one row per
                           menu-month. Goes to the provider only when what it has is over 12h old;
                           a month it cannot refresh is served from the last copy with
                           `stale: true` and *without* its `fetchedAt` bumped. `getSchoolMenu`
                           takes an injectable fetch, for the same reason `runCalendarSync` does
  calendarSync.ts         EventBridge cron: refreshes Google Calendar events per connected family;
                           `runCalendarSync`/`syncFamilyCalendar` take an injectable `CalendarClientFactory`
                           so tests fake the Google API without network access — see `MinimalCalendarClient`
  mealPlanGrocerySync.ts  Weekly EventBridge job: runs the meal-plan → grocery generation for every
                           family, paging the Scan on `LastEvaluatedKey` (the 1MB cap counts rows
                           scanned, not matched)
```

## Authentication

Every route except `POST /families` requires `Authorization: Bearer <apiKey>`
and returns 401 without it or with the wrong key. A family has no
credential until it's created:

```bash
curl -X POST "$API_BASE_URL/families" \
  -H "Content-Type: application/json" \
  -d '{"name": "The Peals"}'
# -> { "familyId": "fam_...", "apiKey": "fk_..." }
```

The response's `apiKey` is shown exactly once — only its SHA-256 hash is
ever stored (see `FamilyRecord` in `src/types.ts`). Save it somewhere a
password manager would go.

**Do not put it in the frontend's build environment.** An earlier version
of this file said to set `VITE_FAMILY_API_KEY` before `npm run build`, and
that is precisely how the key ended up compiled into a bundle served from
a public URL: Vite inlines `import.meta.env.*` at build time. The web app
now asks for the family id and key once per device and keeps them in that
device's `localStorage` (see `frontend/src/lib/familyKey.ts`); the env vars
survive only as a `import.meta.env.DEV`-gated convenience for local work,
and `npm run verify:bundle` fails the build if a key reaches the output.

The Alexa skill is different — it runs on Lambda, not in a browser — and
does read `YOUENJOYMYFAMILY_FAMILY_API_KEY` from its function environment.

This is one deployment per family rather than public multi-tenant signup,
so `POST /families` has no invite/approval gate — whoever can reach it
gets a family, the same trust model as the Alexa skill's invocation name.
It is the one route with no credential to present, so it is the one route
with its own throttle (`RouteSettings` in `template.yaml`): 1/second,
burst 3. A household creates a family once; anyone minting them in a loop
is doing something else, and the bill would be the family's.

### Replacing a key that has got out

```bash
curl -X POST "$API_BASE_URL/families/$FAMILY_ID/key" \
  -H "Authorization: Bearer $CURRENT_API_KEY"
# -> { "familyId": "fam_...", "apiKey": "fk_..." }   (the old key stops working)
```

Authenticated with the key being replaced, and conditioned on that key
still being the stored one — two rotations racing would otherwise both
answer with a key while only one of them worked, which is worse than
either failing, because nobody could tell which screen held the real one.

Worth having because of where the key lives: the browser storage of a
screen on a kitchen wall, which guests use, repair shops see, and
households eventually sell. Every device then has to be re-linked, which
is the point — that is what cutting off the old key means.

## Prerequisites

- AWS SAM CLI, Node.js 20+, an AWS account/credentials configured locally.
- Google OAuth client (Calendar API scope) and an Instacart Developer Platform
  API key, stored in SSM Parameter Store under `/youenjoymyfamily/google/*` and
  `/youenjoymyfamily/instacart/*` (see the `{{resolve:ssm:...}}` references in
  `template.yaml`).

## Checks

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint          # eslint src
npm test               # node --test (aws-sdk-client-mock, no AWS credentials needed)
```

## Local development

```bash
cp .env.example .env   # fill in local values
npm run build            # sam build (esbuild-bundles each TS handler)
npm run local:api        # SAM local API on http://localhost:3000
```

## Deploy

See [`DEPLOY.md`](../DEPLOY.md) for the whole sequence — SSM parameters
first (a missing one rolls the stack back), then the backend, the web app,
and linking the screens.

The short version, once that's been done at least once:

```bash
npm run verify:template   # no AWS access needed; catches what sam build won't
npm run build             # sam build
npm run deploy            # sam deploy --guided first time, then `sam deploy`
```

`npm run verify:template` is worth the second it takes. Typecheck, lint and
the tests never read `template.yaml`, so a route pointing at a logical id
that doesn't exist passes all of them and fails four minutes into a deploy
— which has happened here. It also catches a handler whose DynamoDB policy
has gone missing, which `sam build` accepts and which then fails at
runtime with `AccessDenied`.

