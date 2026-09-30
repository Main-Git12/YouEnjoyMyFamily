import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, notFound, serverError } from "../lib/response";
import { authenticateFamily, familyMetadataKey } from "../lib/auth";
import { searchPlaces, weatherAt, type WeatherAt, type WeatherFetch } from "../lib/weather";
import type { FamilyRecord, WeatherHourItem } from "../types";

/**
 * The weather at the hour the family leaves, read through a cache.
 *
 * The cache is not an optimisation here, it is the thing that makes the
 * feature possible at all. Every screen in the house re-reads the family's
 * data every thirty seconds; three devices doing that against a free
 * weather service is eight and a half thousand requests a day for a number
 * that changes hourly. Without this row the first thing the family would
 * meet is a rate limit — which is exactly what happened the first time this
 * library was pointed at the real service from a shared address.
 *
 * An hour old is fine for tomorrow's seven o'clock. A refresh that fails is
 * served from the last copy, flagged, and its `fetchedAt` is deliberately
 * not bumped — the same rule the school menu follows, and for the same
 * reason: a stale row that looks fresh is worse than one that admits it.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const weatherKey = (familyId: string, date: string, atTime: string) => ({
  PK: `FAMILY#${familyId}`,
  // Hour-resolution: a family asks about one or two hours a day, so this is
  // a handful of rows rather than one per request.
  SK: `WEATHER#${date}T${atTime.slice(0, 2)}`,
});

export interface WeatherResponse {
  date: string;
  atTime: string;
  weather: WeatherAt | null;
  /** True when this came from the cache because the service was unreachable. */
  stale: boolean;
  fetchedAt: string | null;
  label: string | null;
}

/**
 * Exported separately from `handler` so tests can inject a fetch — Lambda
 * calls `handler(event, context, callback)`, so a dependency in the
 * handler's own parameter list would be overwritten by a real invocation.
 */
export async function getWeather(
  familyId: string,
  date: string,
  atTime: string,
  fetchImpl: WeatherFetch = fetch
): Promise<WeatherResponse | null> {
  const stored = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: familyMetadataKey(familyId) })
  );
  const family = stored.Item as FamilyRecord | undefined;
  const location = family?.location;
  // No location means nobody has said where the house is. That is an
  // ordinary state, not a fault — the screen simply says nothing about the
  // weather until somebody does.
  if (!location) return null;

  const cached = (
    await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: weatherKey(familyId, date, atTime) }))
  ).Item as WeatherHourItem | undefined;
  const fresh = cached ? Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS : false;
  if (cached && fresh) {
    return { date, atTime, weather: cached.weather, stale: false, fetchedAt: cached.fetchedAt, label: location.label };
  }

  try {
    const weather = await weatherAt(
      { latitude: location.latitude, longitude: location.longitude, timeZone: location.timeZone, date, atTime },
      fetchImpl
    );
    const fetchedAt = new Date().toISOString();
    const item: WeatherHourItem = {
      ...weatherKey(familyId, date, atTime),
      entityType: "WEATHER_HOUR",
      familyId,
      date,
      atTime,
      weather,
      fetchedAt,
    };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return { date, atTime, weather, stale: false, fetchedAt, label: location.label };
  } catch (err) {
    console.error(`Weather: could not refresh ${date} ${atTime}`, err);
    if (cached) {
      return { date, atTime, weather: cached.weather, stale: true, fetchedAt: cached.fetchedAt, label: location.label };
    }
    return { date, atTime, weather: null, stale: true, fetchedAt: null, label: location.label };
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;
    if (method !== "GET") return badRequest(`Unsupported method: ${method}`);

    // The same function serves the place lookup, because it is the one place
    // in the API that already talks to this provider.
    if (event.rawPath.endsWith("/places")) {
      const q = query.q ?? "";
      return ok(await searchPlaces(q));
    }

    const { date, at } = query;
    if (!date || !ISO_DATE.test(date)) return badRequest("date must be YYYY-MM-DD");
    if (!at || !CLOCK_TIME.test(at)) return badRequest("at must be HH:MM");

    const result = await getWeather(familyId, date, at);
    return result ? ok(result) : notFound("No location is set for this family");
  } catch (err) {
    return serverError(err);
  }
};
