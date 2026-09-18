# PealSync — project conventions

## Architecture

- `/backend` — AWS SAM (API Gateway HTTP API + Lambda + single-table DynamoDB + EventBridge). Node.js 20 handlers, AWS SDK v3.
- `/frontend` — React + Vite + Tailwind, olive/earthy theme (`frontend/tailwind.config.js`, `frontend/src/theme.css`). Built for Echo Show screen sizes.
- `/alexa-skill` — Alexa Skills Kit custom skill (`ask-sdk-core`) with an APL visual card matching the frontend theme.

DynamoDB is single-table; see `backend/models/schema.md` before adding a new
entity or access pattern — extend that doc when you add one instead of
inventing a parallel key scheme.

## Working conventions

- **No guessing:** before adding a dependency, endpoint, or DynamoDB key
  pattern, check what's already used in the codebase (`schema.md`,
  existing handlers, `package.json`) rather than assuming a shape.
- **Env vars, not hardcoded secrets:** OAuth client IDs/secrets for Google
  Calendar and Kroger come from SSM Parameter Store in deployed
  environments (see `template.yaml`) and `.env` locally (see
  `backend/.env.example`, `frontend/.env.example`). Never commit real
  credentials.
- **Idempotent sync:** background sync jobs (`calendarSync.js`) must be
  safe to re-run — upsert by external id via `GSI1`, don't assume a clean
  slate.
- **Keep handlers small:** one Lambda handler per resource family (tasks,
  schedules, preferences, grocery cart), CRUD-shaped, matching the routes
  in `backend/template.yaml`.
