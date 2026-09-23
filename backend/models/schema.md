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
| Task               | `FAMILY#<familyId>`   | `TASK#<taskId>`             | `TASK#<taskId>`        | `DUE#<isoDate>`            |
| Schedule entry      | `FAMILY#<familyId>`   | `SCHEDULE#<isoDate>#<id>`   | —                       | —                          |
| Synced calendar evt | `FAMILY#<familyId>`   | `CALEVENT#<isoDate>#<id>`   | `EXTID#<googleEventId>`| `FAMILY#<familyId>`        |
| Grocery cart item   | `FAMILY#<familyId>`   | `CARTITEM#<itemId>`         | —                       | —                          |
| Learned substitution| `FAMILY#<familyId>`   | `SUBSTITUTION#<normalizedDescription>`| —             | —                          |
| Meal plan entry     | `FAMILY#<familyId>`   | `MEALPLAN#<isoDate>#<slot>` | —                       | —                          |
| Reward goal         | `FAMILY#<familyId>`   | `REWARDGOAL#<memberId>`     | —                       | —                          |
| OAuth token set     | `FAMILY#<familyId>`   | `TOKEN#<provider>`          | —                       | —                          |

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
generation) *or* an existing item's normalized `description` — the latter
is what stops a hand-added "Milk" and a meal plan's "milk" turning into two
lines on the same trip. Clearing an item off the cart (`DELETE`) therefore
lets the next generation re-add it, which is what makes the weekly job
right across weeks rather than only the first time. A weekly EventBridge job
(`mealPlanGrocerySync.ts`, see `template.yaml`) calls it for every family
over the coming 7 days so nobody has to remember to hit "generate"; it's
still driven entirely by what the family already typed into their meal
plan, never an AI-invented meal or ingredient. A manually-added cart item
(`POST /grocery-cart/items`) always has `source: "manual"` and
`mealPlanSourceKey: null`.

## Access patterns

- Get a family + all members: `Query PK = FAMILY#<familyId>`, filter/prefix on `SK`.
- List a family's tasks: `Query PK = FAMILY#<familyId>, SK begins_with TASK#`.
- List a family's schedule for a date range: `Query PK = FAMILY#<familyId>, SK between SCHEDULE#<start> and SCHEDULE#<end>`.
- Find a task by id across the table (e.g. Alexa deep link): `Query GSI1PK = TASK#<taskId>`.
- Upsert a synced Google Calendar event idempotently by external id: `Query GSI1PK = EXTID#<googleEventId>`.
- Look up a family's stored OAuth tokens for a provider (`google`): `GetItem PK = FAMILY#<familyId>, SK = TOKEN#<provider>`.
- List all of a family's stated preferences: `Query PK = FAMILY#<familyId>, SK begins_with STATEDPREF#`.
- List one member's stated preferences: `Query PK = FAMILY#<familyId>, SK begins_with STATEDPREF#<memberId>#`.
- Look up a learned substitute for an item by its (lowercased, trimmed) description: `GetItem PK = FAMILY#<familyId>, SK = SUBSTITUTION#<normalizedDescription>`.
- Remove a grocery cart item outright by id (not just marking it unavailable): `DeleteItem PK = FAMILY#<familyId>, SK = CARTITEM#<itemId>`.
- Find what a checkout should actually send, and what a fresh generation should treat as already covered: the cart items whose `status` is neither `unavailable` nor `ordered` (`outstandingCartItems` in `groceryCart.ts`). An `ordered` item is a past shop, not a standing line — without that distinction the weekly generation sees every ingredient already on the list and quietly adds nothing from the second week onward.
- List every child's reward goal: `Query PK = FAMILY#<familyId>, SK begins_with REWARDGOAL#`.
- Set or clear one child's goal: `PutItem`/`DeleteItem PK = FAMILY#<familyId>, SK = REWARDGOAL#<memberId>` — the key holds one live goal per child, so setting a new prize replaces the old one rather than accumulating a history.
- List a family's meal plan for a date range: `Query PK = FAMILY#<familyId>, SK between MEALPLAN#<start> and MEALPLAN#<end>`.
- Look up or replace one day+slot's planned meal: `GetItem`/`PutItem PK = FAMILY#<familyId>, SK = MEALPLAN#<isoDate>#<slot>`.
- List every family (weekly meal-plan grocery sync only): `Scan filter entityType = FAMILY`, paging on `LastEvaluatedKey` — the one access pattern here with no natural partition to query across; a Scan is the pragmatic choice for a job that runs once a week over what's expected to be a small number of families. The paging is not optional: the 1MB cap counts rows *scanned*, not matched, so a filtered Scan can return an empty page while families sit further down the table.

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

// Task
{
  "PK": "FAMILY#fam_123",
  "SK": "TASK#01J...ULID",
  "GSI1PK": "TASK#01J...ULID",
  "GSI1SK": "DUE#2025-01-15",
  "entityType": "TASK",
  "familyId": "fam_123",
  "taskId": "01J...ULID",
  "title": "Pack soccer bag",
  "assignedTo": "member_456",
  "dueDate": "2025-01-15",
  "gemValue": 10, // what this chore pays — "sleep in my own bed" is worth more than "fill my water bottle"
  "dueWindow": "after_dinner", // morning | after_school | after_dinner | bedtime | anytime — set by the family, never inferred
  "status": "pending",
  "gemsAwarded": 0, // bumped by the chore's own gemValue the first time status becomes "done"
  "createdAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
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
  "addedAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
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
