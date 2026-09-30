# YouEnjoyMyFamily Alexa skill

Custom Alexa Skills Kit skill with an APL visual card (olive/earthy theme,
matching the frontend dashboard) for Echo Show devices.

## Structure

```
skill-package/
  skill.json                             Skill manifest (publishing info, APL interface)
  interactionModels/custom/en-US.json     Invocation name + intents (GetSchedule, GetTasks, AddTask,
                                           CompleteChore, GetGemCastle, GetMealPlan,
                                           GenerateGroceryList, GetGroceryList,
                                           AddGroceryItem)
lambda/
  src/index.ts                            ask-sdk-core request handlers (TypeScript), calls the YouEnjoyMyFamily backend API
  src/index.test.ts                        node:test unit tests for every handler (mocked fetch, no network)
  src/testSupport.ts                       Fake HandlerInput/ResponseBuilder builders for the tests above
  apl/dashboardCard.json                  APL document rendered on Echo Show for schedule/task responses
  apl/choreBattleCard.json                Animated knight-vs-dragon APL scene for CompleteChoreIntent
  apl/gemCastleCard.json                  APL card for GetGemCastleIntent's current stage + progress bar
  tsconfig.json                            Strict compiler options (typechecks src/ including tests)
  tsconfig.build.json                      Extends tsconfig.json, excludes test files — used by `npm run build`
  eslint.config.js                         typescript-eslint flat config
```

## Configuration

The Lambda handler reads:

- `YOUENJOYMYFAMILY_API_BASE_URL` — the deployed backend's API Gateway URL (see `backend/template.yaml` outputs).
- `YOUENJOYMYFAMILY_FAMILY_ID` — placeholder until account linking resolves the family from the Alexa user; defaults to `fam_demo`.
- `YOUENJOYMYFAMILY_FAMILY_API_KEY` — the API key for that same family, issued once by `POST /families` (see `backend/README.md`). Every backend route now requires it; requests without it get a 401.
- `YOUENJOYMYFAMILY_TIME_ZONE` — the family's IANA timezone (e.g. `America/New_York`), used to work out what "today" means for the schedule and meal-plan intents, and what time of day it is for "what chores are left". Lambda runs in UTC, so without this an evening "what's for dinner?" would answer with *tomorrow's* meal for any family west of UTC, and "that was meant for bedtime" would land hours out. Defaults to `UTC`; an unrecognized value falls back to `UTC` rather than failing the response.

## What the skill knows about gems

Chores are not all worth the same — each one carries its own `gemValue`
and a `dueWindow` (the part of the day the family assigned it to), both
set on the backend (see `backend/models/schema.md`). The skill reads
those, so "what chores are left" says who each one belongs to and what it
pays, and calls out anything whose part of the day has already gone.

That last bit is only the clock against a window a person typed in. The
skill never watches a child, infers habits, or keeps a profile — the same
rule the screen follows (see `frontend/src/lib/gemThreats.ts`).

`GetPrizeProgressIntent` reads the prize board: ask "how close is Parker
to his prize?" and it sums the gems from the chores assigned to that child
against the goal someone set on the family screen.

## Checks

```bash
cd lambda
npm install
npm run typecheck   # tsc --noEmit (includes test files)
npm run lint          # eslint src
npm test               # node --test (mocked fetch, no AWS/Alexa credentials needed)
npm run build           # tsc -p tsconfig.build.json -> dist/index.js (test files excluded)
```

## Deploy

Use the [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html).
The Lambda entry point is TypeScript, so it must be compiled before the
function is packaged — run `npm run build --prefix lambda` first, or wire
an ask-cli deploy hook to do it:

```bash
cd alexa-skill
npm install --prefix lambda
npm run build --prefix lambda
ask deploy
```

This deploys both the skill package (interaction model) and the Lambda
function referenced by `skill-package/skill.json`'s `apis.custom.endpoint`.
`package.json`'s `main` points at `dist/index.js`; if your ask-cli deployer
configuration needs an explicit handler string, use `dist/index.handler`.
