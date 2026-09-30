import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, getWeather } from "./weather";
import { mockFamilyAuth, TEST_API_KEY } from "../lib/authTestSupport";
import { familyMetadataKey, hashApiKey } from "../lib/auth";
import type { WeatherFetch } from "../lib/weather";
import type { FamilyRecord, WeatherHourItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddbMock.reset());

function makeEvent(over: Partial<APIGatewayProxyEventV2> & { method: string }): APIGatewayProxyEventV2 {
  const { method, ...rest } = over;
  return {
    version: "2.0", routeKey: "$default", rawPath: "/", rawQueryString: "", headers: {},
    requestContext: { http: { method, path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "t" } } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false, ...rest,
  } as APIGatewayProxyEventV2;
}

const WEATHER_KEY = { PK: "FAMILY#fam_1", SK: "WEATHER#2026-10-01T07" };
const HOUR = 60 * 60 * 1000;

const family = (location: unknown = { latitude: 39.88, longitude: -82.75, timeZone: "America/New_York", label: "Home" }) =>
  ({
    ...familyMetadataKey("fam_1"), entityType: "FAMILY", familyId: "fam_1", name: "The Peals",
    apiKeyHash: hashApiKey(TEST_API_KEY), createdAt: "2026-01-01T00:00:00.000Z",
    location,
  }) as unknown as FamilyRecord;

const cached = (ageMs: number, temperatureF = 41): Partial<WeatherHourItem> => ({
  ...WEATHER_KEY, entityType: "WEATHER_HOUR", familyId: "fam_1", date: "2026-10-01", atTime: "07:52",
  weather: { time: "2026-10-01T07:00", temperatureF, feelsLikeF: temperatureF - 4, chanceOfRain: 80, conditions: "rain", beforeSunrise: false, sunrise: "2026-10-01T07:27" },
  fetchedAt: new Date(Date.now() - ageMs).toISOString(),
});

function countingFetch(temperatureF: number) {
  const calls: string[] = [];
  const impl: WeatherFetch = async (url) => {
    calls.push(url);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        hourly: { time: ["2026-10-01T07:00"], temperature_2m: [temperatureF], apparent_temperature: [temperatureF - 5], precipitation_probability: [10], weathercode: [0] },
        daily: { time: ["2026-10-01"], sunrise: ["2026-10-01T07:27"] },
      }),
    };
  };
  return Object.assign(impl, { calls });
}

const failing: WeatherFetch = async () => { throw new Error("ECONNRESET"); };

test("a family that has not said where it lives gets no weather, and that is not an error", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({ Item: family(null) });
  assert.equal(await getWeather("fam_1", "2026-10-01", "07:52", countingFetch(50)), null);
});

/**
 * The reason this cache exists. Every screen in the house re-reads every
 * thirty seconds; without a cached row that is thousands of requests a day
 * to a free service for a number that changes hourly.
 */
test("a cached hour inside the TTL is served without going near the network", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({ Item: family() });
  ddbMock.on(GetCommand, { Key: WEATHER_KEY }).resolves({ Item: cached(10 * 60 * 1000) });
  const fetchImpl = countingFetch(99);

  const result = await getWeather("fam_1", "2026-10-01", "07:52", fetchImpl);

  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result?.weather?.temperatureF, 41);
  assert.equal(result?.stale, false);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("an hour older than the TTL is refreshed and written back", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({ Item: family() });
  ddbMock.on(GetCommand, { Key: WEATHER_KEY }).resolves({ Item: cached(3 * HOUR) });
  ddbMock.on(PutCommand).resolves({});
  const fetchImpl = countingFetch(55);

  const result = await getWeather("fam_1", "2026-10-01", "07:52", fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(result?.weather?.temperatureF, 55);
  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as WeatherHourItem;
  assert.equal(written.SK, "WEATHER#2026-10-01T07");
});

test("when the service is unreachable the last copy is served, flagged, and not re-stamped", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({ Item: family() });
  const stale = cached(5 * HOUR);
  ddbMock.on(GetCommand, { Key: WEATHER_KEY }).resolves({ Item: stale });

  const result = await getWeather("fam_1", "2026-10-01", "07:52", failing);

  assert.equal(result?.stale, true);
  assert.equal(result?.weather?.temperatureF, 41);
  assert.equal(result?.fetchedAt, stale.fetchedAt);
  // Nothing written: a bumped fetchedAt would make it look fresh for another hour.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("no cache and no service means no weather, never a confident blank", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({ Item: family() });
  ddbMock.on(GetCommand, { Key: WEATHER_KEY }).resolves({});

  const result = await getWeather("fam_1", "2026-10-01", "07:52", failing);

  assert.equal(result?.weather, null);
  assert.equal(result?.stale, true);
});

test("the coordinate is stored rounded, so the request cannot leak a precise one", async () => {
  ddbMock.on(GetCommand, { Key: familyMetadataKey("fam_1") }).resolves({
    Item: family({ latitude: 39.88, longitude: -82.75, timeZone: "America/New_York", label: null }),
  });
  ddbMock.on(GetCommand, { Key: WEATHER_KEY }).resolves({});
  ddbMock.on(PutCommand).resolves({});
  const fetchImpl = countingFetch(50);

  await getWeather("fam_1", "2026-10-01", "07:52", fetchImpl);

  assert.ok(fetchImpl.calls[0]?.includes("latitude=39.88"));
  assert.ok(!fetchImpl.calls[0]?.includes("39.884"));
});

test("the route needs a key, a valid date and a valid time", async () => {
  const noAuth = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, queryStringParameters: { date: "2026-10-01", at: "07:52" } }));
  assert.equal(noAuth.statusCode, 401);

  const headers = mockFamilyAuth(ddbMock, "fam_1");
  for (const queryStringParameters of [{}, { date: "2026-10-01" }, { date: "nope", at: "07:52" }, { date: "2026-10-01", at: "7:52" }]) {
    const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers, queryStringParameters }));
    assert.equal(result.statusCode, 400, JSON.stringify(queryStringParameters));
  }
});

test("a method other than GET is refused", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(makeEvent({ method: "POST", pathParameters: { familyId: "fam_1" }, headers }));
  assert.equal(result.statusCode, 400);
});
