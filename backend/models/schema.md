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
| Member gem stats    | `FAMILY#<familyId>`   | `STATS#<memberId>`          | —                       | —                          |
| Task               | `FAMILY#<familyId>`   | `TASK#<taskId>`             | `TASK#<taskId>`        | `DUE#<isoDate>`            |
| Schedule entry      | `FAMILY#<familyId>`   | `SCHEDULE#<isoDate>#<id>`   | —                       | —                          |
| Synced calendar evt | `FAMILY#<familyId>`   | `CALEVENT#<isoDate>#<id>`   | `EXTID#<googleEventId>`| `FAMILY#<familyId>`        |
| Grocery cart item   | `FAMILY#<familyId>`   | `CARTITEM#<itemId>`         | —                       | —                          |
| Substitution log     | `FAMILY#<familyId>`   | `SUBLOG#<store>#<original>#<substitute>` | —          | —                          |
| OAuth token set     | `FAMILY#<familyId>`   | `TOKEN#<provider>`          | —                       | —                          |

## Access patterns

- Get a family + all members: `Query PK = FAMILY#<familyId>`, filter/prefix on `SK`.
- List a family's tasks: `Query PK = FAMILY#<familyId>, SK begins_with TASK#`.
- List a family's schedule for a date range: `Query PK = FAMILY#<familyId>, SK between SCHEDULE#<start> and SCHEDULE#<end>`.
- Find a task by id across the table (e.g. Alexa deep link): `Query GSI1PK = TASK#<taskId>`.
- Upsert a synced Google Calendar event idempotently by external id: `Query GSI1PK = EXTID#<googleEventId>`.
- Look up a family's stored OAuth tokens for a provider (`google`): `GetItem PK = FAMILY#<familyId>, SK = TOKEN#<provider>`.
- Look up a member's gem total: `GetItem PK = FAMILY#<familyId>, SK = STATS#<memberId>` (defaults to zero if never written — see `memberStats.ts`).
- Rank past substitutes for an item at a store (most-chosen first, client-side sort): `Query PK = FAMILY#<familyId>, SK begins_with SUBLOG#<store>#<normalizedDescription>#`.

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
  "createdAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Grocery cart item
{
  "PK": "FAMILY#fam_123",
  "SK": "CARTITEM#01J...ULID",
  "entityType": "CART_ITEM",
  "familyId": "fam_123",
  "itemId": "01J...ULID",
  "store": "giant_eagle",
  "description": "2% Milk, 1 Gallon",
  "quantity": 1,
  "status": "needed",
  "addedBy": "member_456",
  "addedAt": "2025-01-10T12:00:00Z",
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Member gem stats — created on first task completion; ADD'd to
// atomically by tasks.ts so concurrent completions never lose a gem.
{
  "PK": "FAMILY#fam_123",
  "SK": "STATS#member_456",
  "entityType": "MEMBER_STATS",
  "familyId": "fam_123",
  "memberId": "member_456",
  "gems": 15,
  "tasksCompleted": 3,
  "updatedAt": "2025-01-10T12:00:00Z"
}

// Substitution log — one item per (store, original, substitute) triple;
// timesChosen only grows when a family member actually picks that swap
// after the original was marked unavailable, never from an external feed.
{
  "PK": "FAMILY#fam_123",
  "SK": "SUBLOG#giant_eagle#2% milk, 1 gallon#oat milk, 1 gallon",
  "entityType": "SUBSTITUTION_LOG",
  "familyId": "fam_123",
  "store": "giant_eagle",
  "originalDescription": "2% milk, 1 gallon",
  "substituteDescription": "Oat Milk, 1 Gallon",
  "timesChosen": 4,
  "lastChosenAt": "2025-01-10T12:00:00Z"
}
```
