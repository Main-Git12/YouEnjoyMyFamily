# YouEnjoyMyFamily — project conventions

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
  Every backend handler currently has one — keep it that way.
- **Inject third-party SDK clients, don't mock the module:** when a
  handler calls an external SDK that isn't just `fetch` (e.g. `googleapis`),
  don't try to structurally fake the SDK's own types or reach for module
  mocking — define a minimal interface for the one or two methods actually
  used (see `MinimalCalendarClient`, `CalendarClientFactory` in
  `calendarSync.ts`) and pass a factory with a real-SDK default. Also never
  put an injectable dependency in a Lambda `handler`'s own parameter
  list — Lambda always invokes `handler(event, context, callback)`, so a
  real invocation would silently overwrite it; export a separate
  orchestration function (see `runCalendarSync`) for tests to call instead.
- **Run the checks before considering a change done:** `npm run typecheck`,
  `npm run lint`, `npm test`, and `npm run build` (where each applies) all
  need to pass in `backend`, `frontend`, and `alexa-skill/lambda` — this
  repo has registry access, so there's no excuse to skip actually running
  them. All three subprojects now have equal footing here (typecheck +
  lint + test + build); keep it that way when adding a fourth. Frontend
  component tests use Vitest + `@testing-library/react` (see
  `Dashboard.test.tsx` for the pattern: mock `../lib/api`, don't hit a
  real network in tests). The Alexa skill's tests build fake
  `HandlerInput`/`ResponseBuilder` objects (`testSupport.ts`) rather than
  fighting `ask-sdk-core`'s full types — that file's `build` script uses
  `tsconfig.build.json` (excludes `*.test.ts`/`testSupport.ts`) so test
  code never ships in the deployed Lambda zip; `tsconfig.json` itself
  still typechecks everything.
- **Check `npm audit` after adding or bumping a dependency.** Don't force
  a major-version bump to silence it reflexively — check whether the
  flagged CVE's fixed-version range actually requires the major bump, or
  just a later version within the current major (see the vitest 3.2.7 fix
  in `frontend/package.json`, which closed a critical CVE without the
  vite 6+ bump a naive `npm audit fix --force` would have forced).
