import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  handler,
  runCalendarSync,
  syncFamilyCalendar,
  listFamiliesWithGoogleTokens,
  SYNC_MAX_RESULTS,
  type MinimalCalendarClient,
} from "./calendarSync";
import type { CalendarTokenRecord, CalendarEventItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const tokenRecord: CalendarTokenRecord = {
  PK: "FAMILY#fam_1",
  SK: "TOKEN#google",
  GSI1PK: "PROVIDER#google",
  GSI1SK: "FAMILY#fam_1",
  familyId: "fam_1",
  provider: "google",
  accessToken: "access-123",
  refreshToken: "refresh-123",
};

test("handler is a no-op when no families have connected Google Calendar", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  const result = await handler();
  assert.deepEqual(result, { synced: 0, failed: 0 });
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("runCalendarSync isolates a failing family instead of aborting the batch", async () => {
  const failingFamily = { ...tokenRecord, familyId: "fam_fails" };
  const okFamily = { ...tokenRecord, familyId: "fam_ok" };
  ddbMock.on(QueryCommand).resolves({ Items: [failingFamily, okFamily] });
  ddbMock.on(PutCommand).resolves({});

  const factory = (record: CalendarTokenRecord): MinimalCalendarClient => ({
    events: {
      list: async () => {
        if (record.familyId === "fam_fails") throw new Error("Google API rate limited");
        return { data: { items: [] } };
      },
    },
  });

  const result = await runCalendarSync(factory);
  assert.deepEqual(result, { synced: 1, failed: 1 });
});

test("syncFamilyCalendar upserts events keyed by external id via GSI1", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});

  const fakeFactory = (): MinimalCalendarClient => ({
    events: {
      list: async () => ({
        data: {
          items: [
            {
              id: "gcal-evt-1",
              summary: "Dentist",
              start: { dateTime: "2025-01-15T09:00:00Z" },
              end: { dateTime: "2025-01-15T10:00:00Z" },
            },
          ],
        },
      }),
    },
  });

  await syncFamilyCalendar(tokenRecord, fakeFactory);

  const puts = ddbMock.commandCalls(PutCommand);
  assert.equal(puts.length, 1);
  const item = puts[0]?.args[0].input.Item as Record<string, unknown>;
  assert.equal(item.GSI1PK, "EXTID#gcal-evt-1");
  assert.equal(item.SK, "CALEVENT#2025-01-15#gcal-evt-1");
  assert.equal(item.title, "Dentist");
});

test("syncFamilyCalendar skips events with no id and defaults an untitled summary", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});

  const fakeFactory = (): MinimalCalendarClient => ({
    events: {
      list: async () => ({
        data: {
          items: [
            { summary: "No id, should be skipped" },
            { id: "gcal-evt-2", start: { date: "2025-02-01" } },
          ],
        },
      }),
    },
  });

  await syncFamilyCalendar(tokenRecord, fakeFactory);

  const puts = ddbMock.commandCalls(PutCommand);
  assert.equal(puts.length, 1);
  const item = puts[0]?.args[0].input.Item as Record<string, unknown>;
  assert.equal(item.externalId, "gcal-evt-2");
  assert.equal(item.title, "(untitled event)");
});

test("syncFamilyCalendar propagates errors from the calendar client", async () => {
  const failingFactory = (): MinimalCalendarClient => ({
    events: {
      list: async () => {
        throw new Error("Google API rate limited");
      },
    },
  });

  await assert.rejects(() => syncFamilyCalendar(tokenRecord, failingFactory), /rate limited/);
});

test("an event moved to another day doesn't end up on both", async () => {
  // The date is part of the sort key, so a moved event writes a new row —
  // the old one has to go, or it sits on the family's calendar for good.
  ddbMock.on(QueryCommand).resolves({
    Items: [
      {
        PK: "FAMILY#fam_1",
        SK: "CALEVENT#2025-01-15#ev_1",
        GSI1PK: "EXTID#ev_1",
        GSI1SK: "FAMILY#fam_1",
        entityType: "CALENDAR_EVENT",
        familyId: "fam_1",
        externalId: "ev_1",
        title: "Dentist",
        date: "2025-01-15",
        startTime: null,
        endTime: null,
        syncedAt: "2025-01-01T00:00:00Z",
      },
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  const fakeFactory = (): MinimalCalendarClient => ({
    events: {
      list: async () => ({
        data: { items: [{ id: "ev_1", summary: "Dentist", start: { date: "2025-01-16" }, end: { date: "2025-01-16" } }] },
      }),
    },
  });

  await syncFamilyCalendar(tokenRecord, fakeFactory);

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.SK, "CALEVENT#2025-01-16#ev_1");
  const deleted = ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key;
  assert.deepEqual(deleted, { PK: "FAMILY#fam_1", SK: "CALEVENT#2025-01-15#ev_1" });
});

test("an event that hasn't moved is rewritten in place, with nothing deleted", async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [
      {
        PK: "FAMILY#fam_1",
        SK: "CALEVENT#2025-01-15#ev_1",
        GSI1PK: "EXTID#ev_1",
        GSI1SK: "FAMILY#fam_1",
        entityType: "CALENDAR_EVENT",
        familyId: "fam_1",
        externalId: "ev_1",
        title: "Dentist",
        date: "2025-01-15",
        startTime: null,
        endTime: null,
        syncedAt: "2025-01-01T00:00:00Z",
      },
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  const fakeFactory = (): MinimalCalendarClient => ({
    events: {
      list: async () => ({
        data: { items: [{ id: "ev_1", summary: "Dentist appointment", start: { date: "2025-01-15" }, end: { date: "2025-01-15" } }] },
      }),
    },
  });

  await syncFamilyCalendar(tokenRecord, fakeFactory);

  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
  assert.equal(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.title, "Dentist appointment");
});

/** A date `days` from today (UTC), YYYY-MM-DD — pruning only touches future days. */
function daysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function storedEvent(externalId: string, date: string): CalendarEventItem {
  return {
    PK: "FAMILY#fam_1",
    SK: `CALEVENT#${date}#${externalId}`,
    GSI1PK: `EXTID#${externalId}`,
    GSI1SK: "FAMILY#fam_1",
    entityType: "CALENDAR_EVENT",
    familyId: "fam_1",
    externalId,
    title: externalId,
    date,
    startTime: null,
    endTime: null,
    syncedAt: "2025-01-01T00:00:00Z",
  };
}

const googleReturning = (items: { id: string; date: string }[]) => (): MinimalCalendarClient => ({
  events: {
    list: async () => ({
      data: { items: items.map(({ id, date }) => ({ id, summary: id, start: { date }, end: { date } })) },
    }),
  },
});

const deletedSKs = () =>
  ddbMock
    .commandCalls(DeleteCommand)
    .map((call) => call.args[0].input.Key?.SK)
    .sort();

test("every leftover row for a moved event is deleted, not just the latest one", async () => {
  // Tuesday's row survived an earlier failed delete, so the event is held on
  // Tuesday *and* Wednesday. Google now says Wednesday: Tuesday has to go.
  ddbMock.on(QueryCommand).resolves({
    Items: [storedEvent("ev_1", "2025-01-14"), storedEvent("ev_1", "2025-01-15")],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  await syncFamilyCalendar(tokenRecord, googleReturning([{ id: "ev_1", date: "2025-01-15" }]));

  assert.deepEqual(deletedSKs(), ["CALEVENT#2025-01-14#ev_1"]);
});

test("an upcoming event cancelled in Google is removed; today's and past ones are left alone", async () => {
  const tomorrow = daysFromToday(1);
  const nextWeek = daysFromToday(7);
  ddbMock.on(QueryCommand).resolves({
    Items: [
      storedEvent("kept", nextWeek),
      storedEvent("cancelled", tomorrow),
      // Google leaves out events that already ended today — not a cancellation.
      storedEvent("ended_this_morning", daysFromToday(0)),
      storedEvent("last_month", daysFromToday(-30)),
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  await syncFamilyCalendar(tokenRecord, googleReturning([{ id: "kept", date: nextWeek }]));

  assert.deepEqual(deletedSKs(), [`CALEVENT#${tomorrow}#cancelled`]);
});

test("when Google's answer is cut off, nothing beyond the last day it reached is pruned", async () => {
  const lastDay = daysFromToday(10);
  const returned = Array.from({ length: SYNC_MAX_RESULTS }, (_, i) => ({
    id: `ev_${i}`,
    date: i === SYNC_MAX_RESULTS - 1 ? lastDay : daysFromToday(2),
  }));
  ddbMock.on(QueryCommand).resolves({
    Items: [
      storedEvent("gone_before_cut", daysFromToday(5)),
      storedEvent("maybe_beyond_cut", daysFromToday(20)),
      storedEvent("maybe_on_last_day", lastDay),
    ],
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  await syncFamilyCalendar(tokenRecord, googleReturning(returned));

  assert.deepEqual(deletedSKs(), [`CALEVENT#${daysFromToday(5)}#gone_before_cut`]);
});

test("stored events are read to the last page, so a long history doesn't hide upcoming rows", async () => {
  const tomorrow = daysFromToday(1);
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [storedEvent("old", "2025-01-01")], LastEvaluatedKey: { PK: "FAMILY#fam_1", SK: "x" } })
    .resolvesOnce({ Items: [storedEvent("ev_1", daysFromToday(3))] });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});

  // ev_1 moved to tomorrow; its old row is only on the second page.
  await syncFamilyCalendar(tokenRecord, googleReturning([{ id: "ev_1", date: tomorrow }]));

  assert.deepEqual(deletedSKs(), [`CALEVENT#${daysFromToday(3)}#ev_1`]);
});

test("every connected family is found, across pages of the GSI", async () => {
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [tokenRecord], LastEvaluatedKey: { GSI1PK: "PROVIDER#google", GSI1SK: "FAMILY#fam_1" } })
    .resolvesOnce({ Items: [{ ...tokenRecord, familyId: "fam_2", PK: "FAMILY#fam_2" }] });

  const families = await listFamiliesWithGoogleTokens();

  assert.deepEqual(
    families.map((family) => family.familyId),
    ["fam_1", "fam_2"]
  );
});
