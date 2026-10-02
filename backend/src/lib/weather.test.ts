import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherAt, searchPlaces, describeCode, roundCoordinate, WeatherFetchError, type WeatherFetch } from "./weather";

const QUERY = {
  latitude: 39.884812345,
  longitude: -82.753789,
  timeZone: "America/New_York",
  date: "2026-10-01",
  atTime: "07:52",
};

function stub(body: unknown, init: { ok?: boolean; status?: number } = {}): WeatherFetch {
  return async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

const forecast = (over: Record<string, unknown> = {}) => ({
  hourly: {
    time: ["2026-10-01T06:00", "2026-10-01T07:00", "2026-10-01T08:00"],
    temperature_2m: [48.2, 51.6, 55.1],
    apparent_temperature: [44.9, 47.4, 52.0],
    precipitation_probability: [10, 80, 30],
    weathercode: [3, 63, 3],
  },
  daily: { time: ["2026-10-01"], sunrise: ["2026-10-01T07:27"] },
  ...over,
});

test("answers the hour the family is in when they leave, not the one after", async () => {
  const at = await weatherAt(QUERY, stub(forecast()));
  // 07:52 is answered by the 07:00 row.
  assert.equal(at?.time, "2026-10-01T07:00");
  assert.equal(at?.temperatureF, 52);
  assert.equal(at?.feelsLikeF, 47);
  assert.equal(at?.chanceOfRain, 80);
  assert.equal(at?.conditions, "rain");
});

test("knows when they will be leaving before the sun is up", async () => {
  // Bus at 07:52, sunrise 07:27 — light.
  assert.equal((await weatherAt(QUERY, stub(forecast())))?.beforeSunrise, false);
  // The same day in January: sunrise after the bus.
  const dark = forecast({ daily: { time: ["2026-10-01"], sunrise: ["2026-10-01T07:58"] } });
  assert.equal((await weatherAt(QUERY, stub(dark)))?.beforeSunrise, true);
});

test("says nothing rather than guessing when the hour is not in the forecast", async () => {
  const beyond = { ...QUERY, date: "2027-05-01" };
  assert.equal(await weatherAt(beyond, stub(forecast())), null);
});

test("sends a coordinate accurate to about a kilometre, and nothing else", async () => {
  const urls: string[] = [];
  const spy: WeatherFetch = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify(forecast()) };
  };
  await weatherAt(QUERY, spy);

  assert.equal(urls.length, 1);
  const url = urls[0] as string;
  assert.ok(url.includes("latitude=39.88"), url);
  assert.ok(url.includes("longitude=-82.75"), url);
  // The full-precision coordinate must not survive into the request.
  assert.ok(!url.includes("39.884812345"), "the exact coordinate was sent");
  assert.ok(!url.includes("-82.753789"), "the exact coordinate was sent");
  assert.equal(roundCoordinate(39.884812345), 39.88);
});

test("collapses the WMO codes to the distinctions somebody acts on at a door", () => {
  assert.equal(describeCode(0), "clear");
  assert.equal(describeCode(63), "rain");
  assert.equal(describeCode(82), "rain");
  assert.equal(describeCode(71), "snow");
  assert.equal(describeCode(86), "snow");
  assert.equal(describeCode(66), "freezing rain");
  assert.equal(describeCode(95), "thunderstorms");
  // An unknown code is left blank rather than guessed at.
  assert.equal(describeCode(404), "");
});

test("a malformed date or time is refused before anything is fetched", async () => {
  let called = false;
  const fetchImpl: WeatherFetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => "{}" };
  };
  await assert.rejects(() => weatherAt({ ...QUERY, date: "tomorrow" }, fetchImpl), WeatherFetchError);
  await assert.rejects(() => weatherAt({ ...QUERY, atTime: "7:52" }, fetchImpl), WeatherFetchError);
  assert.equal(called, false);
});

test("an upstream failure is an error, never a blank but confident answer", async () => {
  await assert.rejects(() => weatherAt(QUERY, stub({}, { ok: false, status: 503 })), WeatherFetchError);
  await assert.rejects(() => weatherAt(QUERY, stub("<html>down</html>")), WeatherFetchError);
  await assert.rejects(() => weatherAt(QUERY, stub({ nope: true })), WeatherFetchError);
  const boom: WeatherFetch = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(() => weatherAt(QUERY, boom), WeatherFetchError);
});

test("a forecast missing a column it should have does not invent one", async () => {
  const partial = forecast({
    hourly: { time: ["2026-10-01T07:00"], temperature_2m: [51.6] },
    daily: { time: ["2026-10-01"], sunrise: ["2026-10-01T07:27"] },
  });
  const at = await weatherAt(QUERY, stub(partial));
  assert.equal(at?.temperatureF, 52);
  // Feels-like falls back to the real temperature rather than to zero.
  assert.equal(at?.feelsLikeF, 52);
  assert.equal(at?.chanceOfRain, 0);
  assert.equal(at?.conditions, "");
});

test("no temperature at all means no answer", async () => {
  const noTemp = forecast({
    hourly: { time: ["2026-10-01T07:00"], temperature_2m: ["warm"] },
    daily: { time: ["2026-10-01"], sunrise: ["2026-10-01T07:27"] },
  });
  assert.equal(await weatherAt(QUERY, stub(noTemp)), null);
});

// --- finding a place without asking anyone for a coordinate ----------------

const geocoded = {
  results: [
    { name: "Springfield", admin1: "Ohio", country_code: "US", latitude: 39.884231, longitude: -82.753512, timezone: "America/New_York" },
    { name: "Springfield Ponds", admin1: "Ohio", country_code: "US", latitude: 39.88145, longitude: -82.7974, timezone: "America/New_York" },
  ],
};

test("finds a town by name and brings its timezone with it", async () => {
  const places = await searchPlaces("Springfield", stub(geocoded));
  assert.equal(places[0]?.label, "Springfield, Ohio, US");
  assert.equal(places[0]?.timeZone, "America/New_York");
  // Rounded here too, so a precise coordinate never even reaches the family's record.
  assert.equal(places[0]?.latitude, 39.88);
  assert.equal(places[0]?.longitude, -82.75);
});

test("does not go looking for one or two characters", async () => {
  let called = false;
  const spy: WeatherFetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => JSON.stringify(geocoded) };
  };
  assert.deepEqual(await searchPlaces("P", spy), []);
  assert.deepEqual(await searchPlaces("  ", spy), []);
  assert.equal(called, false);
});

test("no match is an empty list, not an error", async () => {
  // The service answers a miss with a body that simply has no `results`.
  assert.deepEqual(await searchPlaces("zzzzzzzz", stub({ generationtime_ms: 0.1 })), []);
});

test("a row missing what a place needs is skipped rather than half-built", async () => {
  const ragged = {
    results: [
      { name: "No coordinates", admin1: "Ohio", country_code: "US", timezone: "America/New_York" },
      { name: "No zone", latitude: 1, longitude: 2, country_code: "US" },
      { name: "Good", latitude: 3.456, longitude: 4.567, timezone: "Europe/London", country_code: "GB" },
    ],
  };
  // A two-character minimum applies, so this asks with a real-looking name.
  const places = await searchPlaces("Good", stub(ragged));
  assert.equal(places.length, 1);
  assert.equal(places[0]?.label, "Good, GB");
});

test("an upstream failure on the place lookup is an error, not an empty list", async () => {
  await assert.rejects(() => searchPlaces("Springfield", stub({}, { ok: false, status: 500 })), WeatherFetchError);
  await assert.rejects(() => searchPlaces("Springfield", stub("<html>")), WeatherFetchError);
});
