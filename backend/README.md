# PealSync backend

AWS SAM application: HTTP API Gateway → Lambda handlers → single-table
DynamoDB, plus an EventBridge-scheduled Lambda for Google Calendar sync.

## Structure

```
template.yaml        SAM template — API Gateway, Lambda functions, DynamoDB table, EventBridge rule
models/schema.md      Single-table DynamoDB entity/access-pattern design
src/lib/              Shared Dynamo client + HTTP response helpers
src/handlers/
  tasks.js            CRUD: /families/{familyId}/tasks[/{taskId}]
  schedules.js        CRUD: /families/{familyId}/schedules[/{scheduleId}]
  preferences.js      GET/PUT: /families/{familyId}/members/{memberId}/preferences
  groceryCart.js       GET/POST: /families/{familyId}/grocery-cart[/items] (Kroger OAuth client-credentials)
  calendarSync.js      EventBridge cron: refreshes Google Calendar events per connected family
```

## Prerequisites

- AWS SAM CLI, Node.js 20+, an AWS account/credentials configured locally.
- Google OAuth client (Calendar API scope) and Kroger developer app credentials,
  stored in SSM Parameter Store under `/pealsync/google/*` and `/pealsync/kroger/*`
  (see the `{{resolve:ssm:...}}` references in `template.yaml`).

## Local development

```bash
cp .env.example .env   # fill in local values
npm install
npm run build
npm run local:api      # SAM local API on http://localhost:3000
```

## Deploy

```bash
npm run build
npm run deploy          # sam deploy --guided (first run), then `sam deploy` after
```
