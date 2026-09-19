# PealSync Alexa skill

Custom Alexa Skills Kit skill with an APL visual card (olive/earthy theme,
matching the frontend dashboard) for Echo Show devices.

## Structure

```
skill-package/
  skill.json                             Skill manifest (publishing info, APL interface)
  interactionModels/custom/en-US.json     Invocation name + intents (GetSchedule, GetTasks, AddTask)
lambda/
  src/index.ts                            ask-sdk-core request handlers (TypeScript), calls the PealSync backend API
  apl/dashboardCard.json                  APL document rendered on Echo Show for schedule/task responses
  tsconfig.json                            Strict compiler options; compiles src/ to dist/
```

## Configuration

The Lambda handler reads:

- `PEALSYNC_API_BASE_URL` — the deployed backend's API Gateway URL (see `backend/template.yaml` outputs).
- `PEALSYNC_FAMILY_ID` — placeholder until account linking resolves the family from the Alexa user; defaults to `fam_demo`.

## Checks

```bash
cd lambda
npm install
npm run typecheck   # tsc --noEmit
npm run build         # tsc -> dist/index.js
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
