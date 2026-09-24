# YouEnjoyMyFamily — project conventions

## Architecture

- `/backend` — AWS SAM (API Gateway HTTP API + Lambda + single-table DynamoDB + EventBridge). Strict TypeScript, AWS SDK v3, zod validation at the API boundary, esbuild-bundled per function. Every route except `POST /families` requires `Authorization: Bearer <apiKey>`, checked against a per-family key hash (`src/lib/auth.ts`) — see `backend/README.md`'s Authentication section before adding a new route or forgetting to call `authenticateFamily`.
- `/frontend` — React + Vite + TypeScript + Tailwind, olive/earthy theme (`frontend/tailwind.config.js`, `frontend/src/theme.css`). Built for Echo Show screen sizes.
- `/alexa-skill` — Alexa Skills Kit custom skill (`ask-sdk-core`, TypeScript) with an APL visual card matching the frontend theme.

DynamoDB is single-table; see `backend/models/schema.md` before adding a new
entity or access pattern — extend that doc when you add one instead of
inventing a parallel key scheme. `backend/src/types.ts` is the single
source of truth for entity shapes and zod input validation; update it
first when an entity changes, and let the handlers follow.

## Working conventions

- **State comes from GitHub, not conversation history:** when resuming a
  session (including after context compaction), treat a carried-over
  conversation summary as a claim to verify, never as ground truth. Before
  acting on it, check the actual state — `git status`/`git log` on the
  repo, `git remote -v` to confirm which repo you're even in, and open
  PRs/issues/branches on GitHub — and reconcile any mismatch before doing
  anything else. If a summary describes work, branches, or repos that
  don't show up in git/GitHub, say so and ask rather than continuing as if
  it happened. Nothing else counts as synced either: an uploaded file, a
  generated zip, or a particular device is not the repo — if it isn't
  committed and pushed, treat it as not existing for the next session.
  Never say code is "saved," "pushed," or "deployed" unless you actually
  did that in this session and verified it landed. If you can't write to
  the repo, say so plainly and leave a clearly labeled handoff (what
  changed, why it's uncommitted, what's needed) instead of implying the
  work is done.
- **Insights describe chores and plans, never people.** `frontend/src/lib/insights.ts`
  is the "what we've noticed" engine, and it is bound by two rules. First,
  an observation's subject is a chore or a meal or a shopping list — "Wipe
  Table is the one that keeps getting left", never "Parker keeps leaving
  Wipe Table". A screen on a kitchen wall does not get to characterise a
  child where they can read it; streaks are the sole exception, because a
  streak is praise someone earned by doing the thing. Second, every insight
  carries a `because` naming the records it came from, so a parent can check
  the app's working rather than trust it. Anything that proposes a change
  (retiming a chore, planning a meal) opens the question and lets the family
  answer — the app never decides on their behalf. Keep both rules when you
  add an insight; there are tests asserting them.
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
- **Env vars, not hardcoded secrets:** the Google Calendar OAuth client and
  the Instacart Developer Platform API key come from SSM Parameter Store in
  deployed environments (see `template.yaml`) and `.env` locally (see
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
  `tasks.test.ts`, `groceryCart.test.ts`). If a handler keeps module-level
  state (a warm cache, etc.), account for it when ordering tests that need
  a fresh start. Every backend handler currently has a test file — keep it
  that way.
- **New API routes need `authenticateFamily` too:** any handler reading or
  writing `FAMILY#<familyId>` data must call `authenticateFamily(event,
  familyId)` right after checking `familyId` is present, and return its
  result if non-null — see any existing handler for the one-line pattern.
  In tests, call `mockFamilyAuth(ddbMock, familyId)` from
  `../lib/authTestSupport` *after* registering the handler's own
  DynamoDB mocks (aws-sdk-client-mock resolves the most-recently-registered
  matching stub per call, so registering it first would let a broad
  `.on(GetCommand).resolves(...)` shadow the family-record lookup).
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
