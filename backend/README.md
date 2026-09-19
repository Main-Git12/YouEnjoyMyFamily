# PealSync backend

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
src/lib/                Dynamo client, typed API Gateway responses, request-body validation
src/handlers/
  tasks.ts              CRUD: /families/{familyId}/tasks[/{taskId}]
  tasks.test.ts          Unit tests (node:test + aws-sdk-client-mock)
  schedules.ts           CRUD: /families/{familyId}/schedules[/{scheduleId}]
  preferences.ts         GET/PUT: /families/{familyId}/members/{memberId}/preferences
  groceryCart.ts          GET/POST /families/{familyId}/grocery-cart[/items], PATCH .../items/{itemId} (store-tagged list; PATCH marks an item unavailable and returns/learns substitutes)
  groceryCart.test.ts     Unit tests, including the substitution-suggestion and learning paths
  calendarSync.ts         EventBridge cron: refreshes Google Calendar events per connected family
```

## Prerequisites

- AWS SAM CLI, Node.js 20+, an AWS account/credentials configured locally.
- Google OAuth client (Calendar API scope), stored in SSM Parameter Store
  under `/pealsync/google/*` (see the `{{resolve:ssm:...}}` references in
  `template.yaml`). The grocery cart has no external credential: Giant Eagle
  and Aldi don't expose a public product/stock API, so it's a plain
  store-tagged list plus a self-learned substitution log (see
  `models/schema.md`).

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

## Known issues

- `googleapis` pulls in a transitively vulnerable `uuid` (moderate,
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq))
  via `gaxios`. Not reachable from this codebase's usage, but fixing it
  requires a major `googleapis` bump — left for a dedicated upgrade rather
  than bundled into this change.
