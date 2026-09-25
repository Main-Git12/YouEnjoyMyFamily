# YouEnjoyMyFamily DynamoDB single-table design

Table: `YouEnjoyMyFamily-{stage}` — on-demand billing, one GSI (`GSI1`) for
lookups that don't fit the primary `PK`/`SK` access pattern.

Every item carries an `entityType` attribute so handlers can discriminate
items returned from a `Query` without a second read.

| Entity            | PK                    | SK                          | GSI1PK                | GSI1SK                    |
|--------------------|-----------------------|-----------------------------|------------------------|----------------------------|
| Family             | `FAMILY#<familyId>`   | `METADATA`                  | —                       | —                          |
| Family member      | `FAMILY#<familyId>`   | `MEMBER#<memberId>`         | `MEMBER#<memberId>`    | `FAMILY#<familyId>`        |
| Member preferences | `FAMILY#<familyId>`   | `PREFS#<memberId>`          | —                       | —                          |
| Stated preference  | `FAMILY#<familyId>`   | `STATEDPREF#<memberId>#<id>`| —                       | —                          |
| Task (definition)  | `FAMILY#<familyId>`   | `TASK#<taskId>`             | `TASK#<taskId>`        | `DUE#<isoDate>`            |
| Task completion    | `FAMILY#<familyId>`   | `COMPLETION#<isoDate>#<taskId>`| —                    | —                          |
| Schedule entry      | `FAMILY#<familyId>`   | `SCHEDULE#<isoDate>#<id>`   | —                       | —                          |
| Synced calendar evt | `FAMILY#<familyId>`   | `CALEVENT#<isoDate>#<id>`   | `EXTID#<googleEventId>`| `FAMILY#<familyId>`        |
| Grocery cart item   | `FAMILY#<familyId>`   | `CARTITEM#<itemId>`         | —                       | —                          |
| Learned substitution| `FAMILY#<familyId>`   | `SUBSTITUTION#<normalizedDescription>`| —             | —                          |
| Meal plan entry     | `FAMILY#<familyId>`   | `MEALPLAN#<isoDate>#<slot>` | —                       | —                          |
| Reward goal         | `FAMILY#<familyId>`   | `REWARDGOAL#<memberId>`     | —                       | —                          |
| Reward claim        | `FAMILY#<familyId>`   | `REWARDCLAIM#<claimId>`     | —                       | —                          |
| Gem ledger version  | `FAMILY#<familyId>`   | `GEMLEDGER#<memberId>`      | —                       | —                          |
| OAuth token set     | `FAMILY#<familyId>`   | `TOKEN#<provider>`          | `PROVIDER#<provider>`   | `FAMILY#<familyId>`        |
| Routine (definition)| `FAMILY#<familyId>`   | `ROUTINE#<routineId>`       | —                       | —                          |
| Routine run         | `FAMILY#<familyId>`   | `RUN#<isoDate>#<routineId>` | —                       | —                          |
| Focus block         | `FAMILY#<familyId>`   | `FOCUS#<isoDate>#<blockId>` | —                       | —                          |

`Family` (`METADATA`) is the tenant record every other item's `PK` depends
on, and the only thing that makes a `familyId` real rather than an
arbitrary caller-supplied string — it holds `apiKeyHash` (a SHA-256 hash,
never the raw key) and is created by `POST /families`, the one
unauthenticated route in this API. Every other route requires
`Authorization: Bearer <apiKey>` and checks it against this record before
touching any data (see `backend/src/lib/auth.ts`).

`Member preferences` (`PREFS#<memberId>`, one item per member) is app/UI
settings — theme, notifications, quiet hours. `Stated preference`
(`STATEDPREF#<memberId>#<id>`, many items per member) is a separate,
deliberately narrow entity: something a family member *explicitly said*
(a chosen meal, a stated activity preference, a chore they picked),
recorded only when they say it. It is never populated by passively
tracking behavior or inferring anything — see `STATED_PREFERENCE_CATEGORIES`
in `backend/src/types.ts` for the closed list of categories this covers.

Grocery ordering goes through the [Instacart Developer Platform](https://docs.instacart.com/developer_platform_api)
("create shopping list page") rather than a retailer-specific API — Giant
Eagle and Aldi don't have public developer APIs of their own, and Instacart
covers both. `Grocery cart item` is this app's own cart, kept locally;
checkout calls Instacart once to get a shoppable link, and the family
picks the actual store there. `Learned substitution` is the "smarter over
time" piece: the *only* way it's ever written is a family member marking an
item unavailable and then explicitly saying what they picked instead (see
`CartItemPatch` in `types.ts`) — never inferred, and even once learned it's
only ever offered back as a suggestion on the next matching "unavailable",
not applied automatically.

`Meal plan entry` (`MEALPLAN#<isoDate>#<slot>`, one item per family per
day+slot) is a meal a family member has explicitly planned — a name plus
its ingredients, typed in the same way a task or a stated preference is.
`generateGroceryListFromMealPlan` (`mealPlans.ts`) is the only thing that
turns that into `Grocery cart item`s: it aggregates a date range's planned
ingredients (case-insensitively, so "Rice" and "rice" become one line with
a summed quantity) and adds the ones not already on the list as a cart item
tagged `source: "meal_plan"` with `mealPlanSourceKey` set to the
ingredient's normalized text — the same idempotent-upsert spirit as
`Synced calendar evt`'s `GSI1PK`, just checked by a Query + in-memory Set
instead of a GSI, since a family's cart is small. "Already on the list"
means matching *either* an existing `mealPlanSourceKey` (a previous
generation) *or* an existing item's normalized `description` on a line
that's still outstanding (`pending`/`substituted`) — the latter is what
stops a hand-added "Milk" and a meal plan's "milk" turning into two lines on
the same trip. Each generated line also records `mealPlanDates`, the plan
dates it was generated for; once it's `ordered` or `unavailable` it keeps
covering exactly those dates, so a midweek regeneration over a range that
overlaps an already-shopped one only adds ingredients for the dates nobody
has bought for yet (and doesn't put a second "Saffron" beside the
unavailable one), while next week's dates are still uncovered. Generated
lines get a deterministic `itemId` — `mp-` plus a SHA-256 of the
ingredient's normalized text and its sorted `mealPlanDates` (hashed because
ingredient text is free-typed and may contain `#`) — written with
`attribute_not_exists(PK)`, so two generations racing over the same plan
write each line once. Manual items keep ULID ids. Clearing an item off the cart (`DELETE`) therefore
lets the next generation re-add it, which is what makes the weekly job
right across weeks rather than only the first time. A weekly EventBridge job
(`mealPlanGrocerySync.ts`, see `template.yaml`) calls it for every family
over the coming 7 days so nobody has to remember to hit "generate"; it's
still driven entirely by what the family already typed into their meal
plan, never an AI-invented meal or ingredient. A manually-added cart item
(`POST /grocery-cart/items`) always has `source: "manual"` and
`mealPlanSourceKey: null`.

`Routine` and `Routine run` are the getting-out-of-the-door pair. A
`Routine` is a definition — an ordered list of steps, each with the number
of minutes the family thinks it takes, plus the clock time the whole thing
has to be *finished* by (`anchorTime`) and the weekdays it applies to. The
anchor is the point: a school bus leaves at 07:52 whether or not anyone
has shoes on, so the plan is computed backwards from it rather than
forwards from whenever the morning happens to start. That is what turns
"hurry up" into a number.

A `Routine run` is what actually happened on one date: per step, when it
was started and when it was ticked. `finishedAt` stays `null` for a step
that was begun and never finished, which is a real outcome and must never
be filled in with a guess — a step nobody completed has no duration, and
counting one would quietly flatter every plan built afterwards.

Note the sort-key prefixes. Definitions are `ROUTINE#` and runs are `RUN#`,
*not* `ROUTINERUN#`, because `begins_with(SK, "ROUTINE#")` also matches
every key beginning `ROUTINERUN#` — listing a family's three routines would
have returned all of them plus every morning since the app was installed.

Nothing about a routine is inferred. The steps, their order, the expected
minutes and the deadline are all typed in by a parent. The only thing the
app derives is how long each step has actually been taking, as the median
of that step's finished runs (median, not mean: one morning where someone
wandered off for twenty minutes should not move tomorrow's plan). Steps are
matched to their own history by normalized `title` rather than `stepId`,
because `stepId` is reissued whenever the step list is edited, and a family
renaming "Shoes" to "Shoes and coat" has arguably described a different
step anyway.

`Focus block` is a block of focused work and, inseparably, its timesheet
line. They are one row on purpose: the expensive part of billable work is
not the timer, it is reconstructing at six in the evening what the morning
was spent on, and capturing the line as the block ends — while it is still
obvious — is the part that actually saves the hour.

`actualMinutes` is computed on write from the two timestamps rather than
trusted from the caller, because a paused timer or a sleeping tab would
otherwise report a length the clock never saw. `outcome` (`completed` |
`cut_short` | `abandoned`) is the whole basis of what the feature learns:
a block that ran to the bell is evidence its length works, and one dropped
after four minutes is evidence it doesn't. Collapsing the two into "did
some work" would throw that away. `matter` is free text — this app has no
business prescribing another organisation's matter taxonomy, and a short
code is the sensible thing to type where the full client name is
privileged.

## Access patterns

- Get a family + all members: `Query PK = FAMILY#<familyId>`, filter/prefix on `SK`.
- List a family's chore definitions: `Query PK = FAMILY#<familyId>, SK begins_with TASK#`.
- List what got done over a date range: `Query PK = FAMILY#<familyId>, SK between COMPLETION#<start> and COMPLETION#<end>#\uffff`.
- List a family's schedule for a date range: `Query PK = FAMILY#<familyId>, SK between SCHEDULE#<start> and SCHEDULE#<end>`. Paged to the end. Moving an entry to another day is one `TransactWriteItems` — Put the new `SCHEDULE#<newDate>#<id>` row with `attribute_not_exists(PK)`, Delete the old one with `attribute_exists(PK)` — so it can never end up on both days; a cancelled transaction (another screen moved it first) is a 409. A same-day edit is a Put conditioned on `attribute_exists(PK)`, so it can't resurrect a deleted entry.
- Find a task by id across the table (e.g. Alexa deep link): `Query GSI1PK = TASK#<taskId>`.
- Upsert a synced Google Calendar event idempotently by external id: `Query GSI1PK = EXTID#<googleEventId>`.
- Re-sync a family's calendar: `Query PK = FAMILY#<familyId>, SK begins_with CALEVENT#` once per sync, to find what's already held. The date is part of the sort key, so an event moved to another day writes a *new* row — the old one has to be deleted or the family sees it on both days for good. Idempotency by external id alone isn't enough here. Every stored row for an event id whose key isn't the current one is deleted — not just the latest — so a row left by an earlier failed delete doesn't linger. Stored rows on strictly future days that Google no longer returns (cancelled or deleted there) are deleted too; if Google's answer hit the sync's `maxResults`, only rows before the last returned event's date are pruned, since later ones may simply be past the cut. Today's rows are never pruned, because Google omits events that already ended today.
- Look up a family's stored OAuth tokens for a provider (`google`): `GetItem PK = FAMILY#<familyId>, SK = TOKEN#<provider>`.
- List every family connected to a provider (the calendar sync's starting point): `Query GSI1 GSI1PK = PROVIDER#<provider>`, paged to the end. Token rows therefore carry `GSI1PK = PROVIDER#<provider>`, `GSI1SK = FAMILY#<familyId>`.
- List all of a family's stated preferences: `Query PK = FAMILY#<familyId>, SK begins_with STATEDPREF#`.
- List one member's stated preferences: `Query PK = FAMILY#<familyId>, SK begins_with STATEDPREF#<memberId>#`.
- Look up a learned substitute for an item by its (lowercased, trimmed) description: `GetItem PK = FAMILY#<familyId>, SK = SUBSTITUTION#<normalizedDescription>`.
- List a family's whole cart: `Query PK = FAMILY#<familyId>, begins_with(SK, "CARTITEM#")`, paged to the end with `queryAll` (`src/lib/queryAll.ts`). `ordered`/`unavailable` rows are kept as history and ULIDs sort oldest first, so reading only the first 1MB page would eventually drop exactly the newest, outstanding items.
- Stamp an item as handed over at checkout: `UpdateItem PK = FAMILY#<familyId>, SK = CARTITEM#<itemId>` setting only `status`/`orderedAt`/`updatedAt`, conditioned on `attribute_exists(PK) AND status = <status checkout read>` — an item deleted or changed while Instacart was building the list is left alone (the conditional failure is ignored), and a failed stamp never withholds the Instacart link from the response.
- Remove a grocery cart item outright by id (not just marking it unavailable): `DeleteItem PK = FAMILY#<familyId>, SK = CARTITEM#<itemId>`.
- Find what a checkout should actually send, and what a fresh generation should treat as covering an ingredient outright: the cart items whose `status` is neither `unavailable` nor `ordered` (`outstandingCartItems` in `groceryCart.ts`). An `ordered` item is a past shop, not a standing line — without that distinction the weekly generation sees every ingredient already on the list and quietly adds nothing from the second week onward. An `ordered` or `unavailable` meal-plan line instead covers only its own `mealPlanDates`.
- Add a meal-plan-generated line: `PutItem PK = FAMILY#<familyId>, SK = CARTITEM#mp-<sha256(normalizedIngredient + "\n" + sortedDates)[0..32]>` conditioned on `attribute_not_exists(PK)`; a conditional failure means a concurrent generation already wrote it, and counts as skipped.
- List every child's reward goal: `Query PK = FAMILY#<familyId>, SK begins_with REWARDGOAL#`.
- Set or clear one child's goal: `UpdateItem`/`DeleteItem PK = FAMILY#<familyId>, SK = REWARDGOAL#<memberId>` — the key holds one live goal per child, so setting a new prize replaces the old one rather than accumulating a history. The update keeps `createdAt` (`if_not_exists`) and stamps a fresh `updatedAt` on every save; claiming conditions the goal's delete on that exact `updatedAt`, so a prize re-set at the same price mid-claim is never the one claimed.
- List what's been claimed: `Query PK = FAMILY#<familyId>, SK begins_with REWARDCLAIM#`. A child's balance is everything they've earned (completions) minus everything they've claimed — derived on read, never stored, so it can't drift out of step with the records behind it. Without the claim rows a total could only ever go up, and "Earned it!" would stay on the board for good.
- Every "all of X" read above (chore definitions, completions over an all-time range, goals, claims) pages on `LastEvaluatedKey` via `queryAll` (`src/lib/queryAll.ts`). A single Query stops at 1MB — about a year of a busy family's completions — and reading only that page silently freezes earned gems while claims keep subtracting.
- Guard a spend: `GetItem PK = FAMILY#<familyId>, SK = GEMLEDGER#<memberId>` (strongly consistent) for the child's `version` (absent = 0), *then* read the balance strongly consistent, then in the same `TransactWriteItems` as the spend bump `version` conditioned on it being unchanged (`attribute_not_exists(PK)` when it was 0). Both operations that take gems away — claiming a prize and un-ticking a chore — do this, so two of them can't both pass the "is there enough?" check against the same balance. Ticking a chore off only adds gems and doesn't touch it. The row holds nothing but the counter; balances are still derived from completions and claims.
- List a family's meal plan for a date range: `Query PK = FAMILY#<familyId>, SK between MEALPLAN#<start> and MEALPLAN#<end>`.
- List a family's routines: `Query PK = FAMILY#<familyId>, SK begins_with ROUTINE#`. The run rows deliberately use a `RUN#` prefix so they don't match this.
- List what a routine's mornings actually looked like, to learn its step durations: `Query PK = FAMILY#<familyId>, SK between RUN#<start> and RUN#<end>#\uffff`, then keep the rows whose `routineId` matches. One family runs few enough routines that filtering in memory beats a second index.
- Record or update today's run: `PutItem PK = FAMILY#<familyId>, SK = RUN#<isoDate>#<routineId>` — one row per routine per day, replaced wholesale as the morning progresses, so a retry after a dropped response rewrites the same row instead of double-recording a step.
- Read a day's timesheet, or a month of blocks to learn which length holds: `Query PK = FAMILY#<familyId>, SK between FOCUS#<start> and FOCUS#<end>#\uffff`. The same rows, read two ways.
- Remove one timesheet line: `DeleteItem PK = FAMILY#<familyId>, SK = FOCUS#<isoDate>#<blockId>` — the date is in the sort key, so the caller says which day's line it means.
- Look up or replace one day+slot's planned meal: `GetItem`/`PutItem PK = FAMILY#<familyId>, SK = MEALPLAN#<isoDate>#<slot>`.
- List every family (weekly meal-plan grocery sync only): `Scan filter entityType = FAMILY`, paging on `LastEvaluatedKey` — the one access pattern here with no natural partition to query across; a Scan is the pragmatic choice for a job that runs once a week over what's expected to be a small number of families. The paging is not optional: the 1MB cap counts rows *scanned*, not matched, so a filtered Scan can return an empty page while families sit further down the table.

## Chores: definition vs. completion

A `Task` row is a chore *definition* — its title, what it pays, whose it is,
which part of the day it belongs to, and how often it comes back
(`recurrence`: `none` | `daily` | `weekdays` | `weekends`). It deliberately
carries no `status` and no `gemsAwarded`, because a chore isn't done or
undone in the abstract — only on a particular day.

Whether it got done on a given day is a separate `COMPLETION#<isoDate>#<taskId>`
row, written when someone ticks it off and deleted when they un-tick it.
`GET /families/{id}/tasks?date=<isoDate>` reads both and merges them, so the
API still returns the `status` and `gemsAwarded` a caller expects, for the
day it asked about.

This is why there is no nightly "reset the chores" job:

- Nothing has to be mutated at midnight, so there is no cron to fall over
  and no race between a rollover and a child ticking something off.
- Nothing has to guess which timezone the family woke up in — the caller
  passes its own local date, which is the only device that actually knows.
- Ticking the same chore twice in a day is naturally idempotent: the
  completion row already exists, so it pays once.
- Last Tuesday stays answerable, which is what streaks and any gem ledger
  need.

The one denormalized field is `completedOn` on the definition, set only for
one-off (`recurrence: "none"`) chores in the same `TransactWriteItems` as the
completion row (the completion `Put` conditioned on `attribute_not_exists`,
the definition `Update` on the chore still existing with `completedOn` unset
or already that date — so a one-off pays once, not once per date). It's
what lets "does this chore apply today?" be answered without a second
query: an unfinished one-off keeps appearing every day until someone does
it, then shows only on the day it was done.

Definition edits are `UpdateItem`s of just the changed fields, conditioned on
`attribute_exists(PK)` — never a whole-item put from an earlier read, which
would reset `completedOn` under a concurrent tick, undo a concurrent edit, or
bring back a chore deleted a moment ago. Un-ticking deletes the completion
(and clears a one-off's `completedOn`) in one transaction, and is refused
with a 409 if the child's balance would go below zero — those gems were
already spent on a prize (see "Guard a spend" above).

## Item shape examples

```jsonc
// Family — created by POST /families; apiKeyHash is a SHA-256 hex digest,
// never the raw key (that's returned exactly once, in the POST response)
{
  "PK": "FAMILY#fam_123",
  "SK": "METADATA",
  "entityType": "FAMILY",
  "familyId": "fam_123",
  "name": "The Peals",
  "apiKeyHash": "3b2e...c1",
  "createdAt": "2025-01-10T12:00:00Z"
}

// Task — the chore *definition*. No status, no gemsAwarded: see "Chores:
// definition vs. completion" above.
{
  "PK": "FAMILY#fam_123",
  "SK": "TASK#01J...ULID",
  "GSI1PK": "TASK#01J...ULID",
  "GSI1SK": "DUE#2025-01-15",
  "entityType": "TASK",
  "familyId": "fam_123",
  "taskId": "01J...ULID",
  "title": "Wipe Table",
  "assignedTo": "Parker",
  "dueDate": null, // only meaningful for a one-off
  "gemValue": 10, // what this chore pays — "sleep in my own bed" is worth more than "fill my water bottle"
  "dueWindow": "after_dinner", // morning | after_school | after_dinner | bedtime | anytime — set by the family, never inferred
  "recurrence": "daily", // none | daily | weekdays | weekends
  "completedOn": null, // one-offs only; the day it was finished, so it stops reappearing
  "createdAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Task completion — "this chore was done on this day, for this many gems".
// One per chore per day, so ticking twice pays once.
{
  "PK": "FAMILY#fam_123",
  "SK": "COMPLETION#2025-01-15#01J...ULID",
  "entityType": "TASK_COMPLETION",
  "familyId": "fam_123",
  "taskId": "01J...ULID",
  "date": "2025-01-15",
  "title": "Wipe Table", // copied so a day's history reads without re-joining
  "memberId": "Parker",
  "gemsAwarded": 10,
  "completedAt": "2025-01-15T19:04:00Z"
}

// Stated preference — recorded only when a family member explicitly says it
{
  "PK": "FAMILY#fam_123",
  "SK": "STATEDPREF#member_456#01J...ULID",
  "entityType": "STATED_PREFERENCE",
  "familyId": "fam_123",
  "preferenceId": "01J...ULID",
  "memberId": "member_456",
  "category": "meal",
  "statement": "Isla prefers penne over spaghetti",
  "createdAt": "2025-01-10T12:00:00Z"
}

// Grocery cart item
{
  "PK": "FAMILY#fam_123",
  "SK": "CARTITEM#01J...ULID",
  "entityType": "CART_ITEM",
  "familyId": "fam_123",
  "itemId": "01J...ULID",
  "description": "Spaghetti",
  "quantity": 1,
  "status": "unavailable", // "pending" | "unavailable" | "substituted" | "ordered"
  "substituteDescription": null, // set only once the family confirms a pick
  "orderedAt": null, // stamped by checkout once the Instacart link exists; null until then
  "addedBy": "member_456",
  "source": "manual", // "manual" | "meal_plan" — "meal_plan" items came from generateGroceryListFromMealPlan
  "mealPlanSourceKey": null, // the ingredient's normalized text, set only on a "meal_plan" item — makes regeneration idempotent
  // "mealPlanDates": ["2025-01-15", "2025-01-17"], // "meal_plan" items only: the plan dates this line covers — still counted as covered after it's ordered/unavailable
  "addedAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Reward claim — the prize a child actually took, and what it cost them
{
  "PK": "FAMILY#fam_123",
  "SK": "REWARDCLAIM#01J...ULID",
  "entityType": "REWARD_CLAIM",
  "familyId": "fam_123",
  "claimId": "01J...ULID",
  "memberId": "Parker",
  "title": "LEGO Bricks Set",
  "gemCost": 50,
  "claimedAt": "2025-01-20T18:30:00Z"
}

// Gem ledger version — a per-child counter guarding spends, nothing more
{
  "PK": "FAMILY#fam_123",
  "SK": "GEMLEDGER#Parker",
  "entityType": "GEM_LEDGER",
  "familyId": "fam_123",
  "memberId": "Parker",
  "version": 3, // bumped by every claim and every un-tick that removes a child's gems
  "updatedAt": "2025-01-20T18:30:00Z"
}

// Meal plan entry — a meal a family member explicitly planned for one day+slot
{
  "PK": "FAMILY#fam_123",
  "SK": "MEALPLAN#2025-01-15#dinner",
  "entityType": "MEAL_PLAN_ENTRY",
  "familyId": "fam_123",
  "date": "2025-01-15",
  "slot": "dinner", // "breakfast" | "lunch" | "dinner"
  "mealName": "Spaghetti and meatballs",
  "ingredients": ["Spaghetti", "Ground beef", "Marinara sauce"],
  "createdAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Routine — the definition. Planned backwards from anchorTime.
{
  "PK": "FAMILY#fam_123",
  "SK": "ROUTINE#01J...ULID",
  "entityType": "ROUTINE",
  "familyId": "fam_123",
  "routineId": "01J...ULID",
  "name": "School morning",
  "kind": "morning", // morning | bedtime | custom
  "anchorTime": "07:52", // the bus. Everything is planned backwards from here.
  "daysOfWeek": [1, 2, 3, 4, 5], // 0 = Sunday, matching Date.prototype.getDay
  "steps": [
    { "stepId": "01J...A", "title": "Get dressed", "targetMinutes": 10, "memberId": "Parker" },
    { "stepId": "01J...B", "title": "Breakfast", "targetMinutes": 15, "memberId": null }
  ],
  "active": true,
  "createdAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Routine run — what one morning actually looked like. The only thing the
// learned step durations are computed from.
{
  "PK": "FAMILY#fam_123",
  "SK": "RUN#2025-01-15#01J...ULID",
  "entityType": "ROUTINE_RUN",
  "familyId": "fam_123",
  "routineId": "01J...ULID",
  "date": "2025-01-15",
  "startedAt": "2025-01-15T11:02:00Z",
  "finishedAt": null,
  "steps": [
    { "stepId": "01J...A", "title": "Get dressed", "startedAt": "2025-01-15T11:02:00Z", "finishedAt": "2025-01-15T11:13:00Z" },
    // begun and never ticked — no duration, and none may be invented for it
    { "stepId": "01J...B", "title": "Breakfast", "startedAt": "2025-01-15T11:13:00Z", "finishedAt": null }
  ],
  "updatedAt": "2025-01-15T11:13:00Z"
}

// Learned substitution — written only when a family member confirms a pick
{
  "PK": "FAMILY#fam_123",
  "SK": "SUBSTITUTION#spaghetti",
  "entityType": "LEARNED_SUBSTITUTION",
  "familyId": "fam_123",
  "originalDescription": "spaghetti",
  "substituteDescription": "Penne",
  "timesConfirmed": 2,
  "updatedAt": "2025-01-10T12:00:00Z"
}
```
