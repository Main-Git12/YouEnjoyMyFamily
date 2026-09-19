# PealSync — project conventions

## Architecture

- `/backend` — AWS SAM (API Gateway HTTP API + Lambda + single-table DynamoDB + EventBridge). Strict TypeScript, AWS SDK v3, zod validation at the API boundary, esbuild-bundled per function.
- `/frontend` — React + Vite + TypeScript + Tailwind, olive/earthy theme (`frontend/tailwind.config.js`, `frontend/src/theme.css`). Built for Echo Show screen sizes.
- `/alexa-skill` — Alexa Skills Kit custom skill (`ask-sdk-core`, TypeScript) with an APL visual card matching the frontend theme.

DynamoDB is single-table; see `backend/models/schema.md` before adding a new
entity or access pattern — extend that doc when you add one instead of
inventing a parallel key scheme. `backend/src/types.ts` is the single
source of truth for entity shapes and zod input validation; update it
first when an entity changes, and let the handlers follow.

## Working conventions

- **No guessing:** before adding a dependency, endpoint, or DynamoDB key
  pattern, check what's already used in the codebase (`schema.md`,
  existing handlers, `package.json`) rather than assuming a shape.
- **Strict typing everywhere:** both `backend` and `frontend` compile with
  `strict: true` plus `noUncheckedIndexedAccess`. Run `npm run typecheck`
  after any change — don't rely on `any` or type assertions to silence
  errors; a type error from a naive object spread usually means a real
  runtime bug (see `tasks.ts`/`preferences.ts` for the pattern: merge
  optional patch fields explicitly with `??`, don't spread-merge partials
  onto a fully-typed item).
- **Validate at the boundary:** Lambda handlers parse request bodies with
  the zod schemas in `types.ts` via `parseBody()` (`backend/src/lib/validation.ts`).
  Don't hand-roll ad hoc `if (!body.x)` checks for new fields.
- **Env vars, not hardcoded secrets:** OAuth client IDs/secrets for Google
  Calendar and Kroger come from SSM Parameter Store in deployed
  environments (see `template.yaml`) and `.env` locally (see
  `backend/.env.example`, `frontend/.env.example`). Never commit real
  credentials.
- **Idempotent sync:** background sync jobs (`calendarSync.ts`) must be
  safe to re-run — upsert by external id via `GSI1`, don't assume a clean
  slate.
- **Keep handlers small:** one Lambda handler per resource family (tasks,
  schedules, preferences, grocery cart), CRUD-shaped, matching the routes
  in `backend/template.yaml`.
- **Test new handler logic:** add a `*.test.ts` alongside new/changed
  backend handlers using `node:test` + `aws-sdk-client-mock` (see
  `tasks.test.ts`, `groceryCart.test.ts`). Mind module-level caches (e.g.
  the Kroger token cache) when ordering tests that need a fresh state.
- **Run the checks before considering a change done:** `npm run typecheck`,
  `npm run lint`, and `npm test` (backend) / `npm run build` (frontend)
  all need to pass — this repo has registry access, so there's no excuse
  to skip actually running them.
