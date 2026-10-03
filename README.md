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

## What it does

- **Chores and gems** — recurring chores that are definitions rather than
  rows re-created each morning, gems that can actually be spent on a prize,
  and a castle that grows with the family's total.
- **The morning, and bedtime** — a full-screen sequence planned backwards
  from the time you have to be out of the door, one step at a time, with
  the slack shown as a number and (where the browser allows) read aloud.
- **Focused work** — timed blocks for someone working from home, each one
  closed by its own timesheet line while it is still obvious what the last
  hour was.
- **Meals and the shop** — a week's meals typed in by the family, with the
  grocery list building itself from the ingredients and checking out through
  Instacart.
- **What we've noticed** — observations derived from the household's own
  records, each carrying the evidence it came from.

## Design principles

- **Visual theme:** olive and earthy tones, high-contrast and low-glare for
  Echo Show hardware. See `frontend/src/theme.css`.
- **Single-table DynamoDB design:** all app state (users, tasks, schedules,
  preferences, synced calendar events, grocery cart items) lives in one
  table, keyed by entity-prefixed partition/sort keys. See
  `backend/models/schema.md`.
- **Event-driven sync:** an EventBridge schedule triggers a Lambda handler
  that refreshes Google Calendar data in the background, decoupled from
  user-facing API requests. Grocery checkout is request-driven: it calls the
  Instacart Developer Platform (Giant Eagle/Aldi don't have their own
  developer APIs) to hand the family a shoppable link.
- **The screen follows the day.** What is on the dashboard, and how loudly,
  is decided by the clock and by whether a panel has anything in it — see
  `frontend/src/lib/dashboardLayout.ts`. At any moment it commits to one
  lead panel and three alongside; everything else stays one tap away. A
  kitchen display is glanced at for about two seconds, and nine equal boxes
  give the eye nowhere to land.
- **Routines are planned backwards from their deadline.** The bus leaves at
  07:52 whether or not anyone has shoes on, so the morning (and bedtime)
  start at the finish time and subtract what each remaining step actually
  takes. The output is one number — minutes of slack — and it is the screen
  saying it rather than a parent. See `frontend/src/lib/routinePlan.ts`.
- **What the app learns, and what it refuses to.** It derives how long each
  routine step really takes and which length of focused work actually gets
  finished, both from the household's own records, both as a median so one
  bad day can't reshape every plan after it. It does not characterise
  people: an observation's subject is a chore, a step or a block — "Shoes
  and coat usually takes 4 minutes", never "Parker is slow" on a screen
  Parker can read. Every figure says where it came from. See the
  conventions in `CLAUDE.md`; there are tests asserting both rules.
- **A care shift is planned forwards, and keeps its own record.** Every
  other routine here runs backwards from a deadline; a carer arrives at ten
  and there is no bus, so forcing that shape would mean inventing a
  finishing time nobody agreed to. The shift signs itself in and out, and
  the hours it comes to are compared against the hours agreed — because
  knowing whether a shift was worked should not itself be a job that lands
  on whoever already carries the most invisible work in the house. The
  record is open to everyone the carer included, it stays quiet until there
  are three shifts to talk about, and it asks rather than concludes: a run
  of short shifts might mean the hours aren't being worked, or that the
  hours were never right. See `frontend/src/lib/shiftLog.ts`.
- **A step that can't be done is paused, never deleted.** Four weeks in a
  cast is a month, not a change of plan — deleting the step throws away the
  job and everything it has learned about how long it takes. A paused step
  keeps its place, says when it's back, and shows plainly whether anybody
  has picked it up.
- **The shopping list adds up, and shows its working.** Ingredients merge by
  food *and* measurement dimension, so "2 onions" and "1 onion" are one line
  of three while 300 g of beef and 2 packs of beef stay two — there is no
  honest number of grams in a pack. An amount nobody wrote is never guessed
  at: the row keeps the family's words and is flagged. And every merged row
  names the meals it came from, because an aisle is the worst place to start
  wondering where a number came from. See `backend/src/lib/ingredients.ts`
  and `frontend/src/lib/groceryLine.ts`.

## Getting started

**Deploying it for real: [`DEPLOY.md`](DEPLOY.md)** — the whole sequence in
order, from an empty AWS account to a linked Echo Show.

Each subproject has its own README with setup/deploy detail:

- [`backend/README.md`](backend/README.md)
- [`frontend/README.md`](frontend/README.md)
- [`alexa-skill/README.md`](alexa-skill/README.md)
