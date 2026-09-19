import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { handler, runCalendarSync, syncFamilyCalendar, type MinimalCalendarClient } from "./calendarSync";
import type { CalendarTokenRecord } from "../types";

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
