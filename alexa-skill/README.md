# PealSync Alexa skill

Custom Alexa Skills Kit skill with an APL visual card (olive/earthy theme,
matching the frontend dashboard) for Echo Show devices.

## Structure

```
skill-package/
  skill.json                             Skill manifest (publishing info, APL interface)
  interactionModels/custom/en-US.json     Invocation name + intents (GetSchedule, GetTasks, AddTask)
lambda/
  index.js                                ask-sdk-core request handlers, calls the PealSync backend API
  apl/dashboardCard.json                  APL document rendered on Echo Show for schedule/task responses
```

## Configuration

The Lambda handler reads:

- `PEALSYNC_API_BASE_URL` — the deployed backend's API Gateway URL (see `backend/template.yaml` outputs).
- `PEALSYNC_FAMILY_ID` — placeholder until account linking resolves the family from the Alexa user; defaults to `fam_demo`.

## Deploy

Use the [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html):

```bash
cd alexa-skill
npm install --prefix lambda
ask deploy
```

This deploys both the skill package (interaction model) and the Lambda
function referenced by `skill-package/skill.json`'s `apis.custom.endpoint`.
