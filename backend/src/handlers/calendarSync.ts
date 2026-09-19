import { google } from "googleapis";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import type { CalendarTokenRecord, CalendarEventItem } from "../types";

export interface CalendarSyncResult {
  synced: number;
  failed: number;
}

/**
 * EventBridge-triggered handler (rate(15 minutes) by default, see template.yaml).
 * Pulls each connected family's Google Calendar and upserts events into the
 * single table, keyed by the Google event id via GSI1 so re-syncs are idempotent.
 */
export const handler = async (): Promise<CalendarSyncResult> => {
  const families = await listFamiliesWithGoogleTokens();

  const results = await Promise.allSettled(families.map(syncFamilyCalendar));

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    console.error(`CalendarSync: ${failures.length}/${families.length} families failed`, failures);
  }

  return { synced: families.length - failures.length, failed: failures.length };
};

async function listFamiliesWithGoogleTokens(): Promise<CalendarTokenRecord[]> {
  // TODO: replace with a GSI query (e.g. GSI1PK = "PROVIDER#google") once
  // families opt in to calendar sync; scanning is a placeholder for scaffolding.
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "PROVIDER#google" },
    })
  );
  return (result.Items ?? []) as CalendarTokenRecord[];
}

async function syncFamilyCalendar(tokenRecord: CalendarTokenRecord): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({
    access_token: tokenRecord.accessToken,
    refresh_token: tokenRecord.refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 50,
    singleEvents: true,
    orderBy: "startTime",
  });

  const now = new Date().toISOString();
  const writes = (data.items ?? []).map((event) => {
    if (!event.id) return Promise.resolve();

    const isoDate = (event.start?.date ?? event.start?.dateTime ?? now).slice(0, 10);
    const item: CalendarEventItem = {
      PK: `FAMILY#${tokenRecord.familyId}`,
      SK: `CALEVENT#${isoDate}#${event.id}`,
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

    return docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  });

  await Promise.all(writes);
}
