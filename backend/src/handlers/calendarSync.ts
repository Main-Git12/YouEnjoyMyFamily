import { google, calendar_v3 } from "googleapis";
import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import type { CalendarTokenRecord, CalendarEventItem } from "../types";

export interface CalendarSyncResult {
  synced: number;
  failed: number;
}

interface CalendarEventsListParams {
  calendarId: string;
  timeMin: string;
  maxResults: number;
  singleEvents: boolean;
  orderBy: string;
}

/** Only the slice of the real `calendar_v3.Calendar` this module actually calls — keeps test fakes simple. */
export interface MinimalCalendarClient {
  events: {
    list(params: CalendarEventsListParams): Promise<{ data: { items?: calendar_v3.Schema$Event[] } }>;
  };
}

export type CalendarClientFactory = (tokenRecord: CalendarTokenRecord) => MinimalCalendarClient;

export function createGoogleCalendarClient(tokenRecord: CalendarTokenRecord): MinimalCalendarClient {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({
    access_token: tokenRecord.accessToken,
    refresh_token: tokenRecord.refreshToken,
  });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  return { events: { list: (params) => calendar.events.list(params) } };
}

/**
 * Orchestrates the sync across all connected families. Exported separately
 * from `handler` (rather than taking the factory as a handler parameter) so
 * tests can inject a fake calendar client — Lambda always invokes `handler`
 * as `(event, context, callback)`, so a real invocation would otherwise
 * clobber a factory living in the handler's own parameter list.
 */
export async function runCalendarSync(
  calendarClientFactory: CalendarClientFactory = createGoogleCalendarClient
): Promise<CalendarSyncResult> {
  const families = await listFamiliesWithGoogleTokens();

  const results = await Promise.allSettled(families.map((family) => syncFamilyCalendar(family, calendarClientFactory)));

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    console.error(`CalendarSync: ${failures.length}/${families.length} families failed`, failures);
  }

  return { synced: families.length - failures.length, failed: failures.length };
}

/**
 * EventBridge-triggered handler (rate(15 minutes) by default, see template.yaml).
 * Pulls each connected family's Google Calendar and upserts events into the
 * single table, keyed by the Google event id so re-syncs are idempotent —
 * including when an event moves day, which changes its sort key.
 */
export const handler = async (): Promise<CalendarSyncResult> => runCalendarSync();

/** How many upcoming events one sync asks Google for. */
export const SYNC_MAX_RESULTS = 50;

export async function listFamiliesWithGoogleTokens(): Promise<CalendarTokenRecord[]> {
  return queryAll<CalendarTokenRecord>({
    TableName: TABLE_NAME,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": "PROVIDER#google" },
  });
}

export async function syncFamilyCalendar(
  tokenRecord: CalendarTokenRecord,
  calendarClientFactory: CalendarClientFactory = createGoogleCalendarClient
): Promise<void> {
  const calendar = calendarClientFactory(tokenRecord);
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: SYNC_MAX_RESULTS,
    singleEvents: true,
    orderBy: "startTime",
  });
  const events = (data.items ?? []).filter((event): event is calendar_v3.Schema$Event & { id: string } => !!event.id);

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const dateOf = (event: calendar_v3.Schema$Event) => (event.start?.date ?? event.start?.dateTime ?? now).slice(0, 10);
  const keyFor = (isoDate: string, externalId: string) => ({
    PK: `FAMILY#${tokenRecord.familyId}`,
    SK: `CALEVENT#${isoDate}#${externalId}`,
  });

  // Everything we already hold for this family, grouped by Google event id.
  // The date is part of the sort key (`CALEVENT#<date>#<externalId>`), so an
  // event moved from Tuesday to Wednesday writes a *new* row, and every
  // other row for that id has to go — not just the latest one, or a row left
  // behind by an earlier failed delete would sit on Tuesday for good. One
  // query per sync rather than one per event.
  const storedByExternalId = new Map<string, CalendarEventItem[]>();
  for (const item of await listSyncedCalendarEvents(tokenRecord.familyId)) {
    storedByExternalId.set(item.externalId, [...(storedByExternalId.get(item.externalId) ?? []), item]);
  }

  const writes = events.map(async (event) => {
    const isoDate = dateOf(event);
    const item: CalendarEventItem = {
      ...keyFor(isoDate, event.id),
      GSI1PK: `EXTID#${event.id}`,
      GSI1SK: `FAMILY#${tokenRecord.familyId}`,
      entityType: "CALENDAR_EVENT",
      familyId: tokenRecord.familyId,
      externalId: event.id,
      title: event.summary ?? "(untitled event)",
      date: isoDate,
      startTime: event.start?.dateTime ?? null,
      endTime: event.end?.dateTime ?? null,
      syncedAt: now,
    };

    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    const stale = (storedByExternalId.get(event.id) ?? []).filter((stored) => stored.SK !== item.SK);
    await Promise.all(
      stale.map((stored) => docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: stored.PK, SK: stored.SK } })))
    );
  });
  await Promise.all(writes);

  // Events cancelled or deleted in Google simply stop being returned, so a
  // stored upcoming event Google no longer lists is one to remove. Only
  // strictly future days are pruned: Google leaves out events that already
  // ended earlier today, and those shouldn't vanish from today's screen.
  // If Google's answer was cut off at SYNC_MAX_RESULTS, anything on or after
  // the last day it reached may just be beyond the cut, so it is kept.
  const returned = new Set(events.map((event) => event.id));
  const truncated = (data.items ?? []).length >= SYNC_MAX_RESULTS;
  const lastEvent = events[events.length - 1];
  // A cut-off answer with no usable event in it tells us nothing: prune nothing.
  if (truncated && !lastEvent) return;
  const horizon = truncated && lastEvent ? dateOf(lastEvent) : null;
  const vanished = [...storedByExternalId.values()]
    .flat()
    .filter((stored) => !returned.has(stored.externalId))
    .filter((stored) => stored.date > today && (horizon === null || stored.date < horizon));
  await Promise.all(
    vanished.map((stored) => docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: stored.PK, SK: stored.SK } })))
  );
}

/** Every calendar event this family has synced so far. */
export async function listSyncedCalendarEvents(familyId: string): Promise<CalendarEventItem[]> {
  return queryAll<CalendarEventItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "CALEVENT#" },
  });
}
