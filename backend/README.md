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
  families.ts            POST /families — the one unauthenticated route; provisions a family and its API key
  tasks.ts              CRUD: /families/{familyId}/tasks[/{taskId}]
  schedules.ts           CRUD: /families/{familyId}/schedules[/{scheduleId}]
  preferences.ts         GET/PUT: /families/{familyId}/members/{memberId}/preferences
  groceryCart.ts          CRUD-ish: /families/{familyId}/grocery-cart[/items[/{itemId}]], /checkout;
                           checkout calls the Instacart Developer Platform via an injectable
                           `InstacartClient` (Giant Eagle/Aldi don't have their own developer APIs);
                           tests cover the explicit "mark unavailable → confirm substitute" learning flow
  statedPreferences.ts    CRUD: /families/{familyId}/stated-preferences[/{preferenceId}] — things a
                           family member explicitly *said*, never inferred from behaviour
  mealPlans.ts            /families/{familyId}/meal-plan[/{date}/{slot}] plus
                           POST /meal-plan/generate-grocery-list — turns planned ingredients into
                           cart items idempotently (see schema.md on `mealPlanSourceKey`)
  rewardGoals.ts          /families/{familyId}/reward-goals[/{memberId}[/claim]] and
                           GET /gem-balances — balances are derived on read (earned minus claimed),
                           never stored; claiming is a TransactWrite so two taps can't both charge
  routines.ts             /families/{familyId}/routines[/{routineId}[/runs]] — the morning and
                           bedtime sequences, and what actually happened on each date. Note the
                           sort-key prefixes are `ROUTINE#` and `RUN#`, not `ROUTINERUN#`
  focusBlocks.ts          /families/{familyId}/focus-blocks[/{blockId}] — a block of focused work
                           and, inseparably, its timesheet line. `actualMinutes` is computed on
                           write from the timestamps rather than trusted from the caller
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

```bash
npm run build
npm run deploy          # sam deploy --guided (first run), then `sam deploy` after
```

