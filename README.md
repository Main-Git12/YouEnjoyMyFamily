# YouEnjoyMyFamily — Family Management & Echo Show Hub

A multi-agent family management system that runs locally, syncs with external
calendars and grocery APIs, and surfaces a calm, readable dashboard on
Amazon Echo Show devices.

## Repository layout

```
/backend        AWS serverless backend (SAM: API Gateway + Lambda + DynamoDB + EventBridge)
/frontend       React dashboard SPA, tuned for Echo Show screens, olive/earthy theme
/alexa-skill    Alexa Skills Kit custom skill (voice + APL visual cards)
```

## Design principles

- **Visual theme:** olive and earthy tones, high-contrast and low-glare for
  Echo Show hardware. See `frontend/src/theme.css`.
- **Single-table DynamoDB design:** all app state (users, tasks, schedules,
  preferences, synced calendar events, grocery cart items) lives in one
  table, keyed by entity-prefixed partition/sort keys. See
  `backend/models/schema.md`.
- **Event-driven sync:** EventBridge schedules trigger Lambda handlers that
  refresh Google Calendar and grocery delivery (Kroger) data in the
  background, decoupled from user-facing API requests.

## Getting started

Each subproject has its own README with setup/deploy instructions:

- [`backend/README.md`](backend/README.md)
- [`frontend/README.md`](frontend/README.md)
- [`alexa-skill/README.md`](alexa-skill/README.md)
