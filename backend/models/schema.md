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
| OAuth token set     | `FAMILY#<familyId>`   | `TOKEN#<provider>`          | —                       | —                          |

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

## Item shape examples

```jsonc
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
  "status": "pending",
  "gemsAwarded": 0, // bumped by GEMS_PER_COMPLETED_TASK the first time status becomes "done"
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
  "status": "unavailable", // "pending" | "unavailable" | "substituted"
  "substituteDescription": null, // set only once the family confirms a pick
  "addedBy": "member_456",
  "addedAt": "2025-01-10T12:00:00Z",
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
