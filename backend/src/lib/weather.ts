/**
 * What the weather will be doing at the moment the family leaves the house.
 *
 * Not a forecast panel. The app has no business showing a five-day outlook
 * on a kitchen wall — a phone does that better and everybody already has
 * one. The only weather question this app exists to answer is the one asked
 * at the door: is it cold enough for coats, wet enough for wellingtons,
 * dark enough to need the porch light on. So this fetches one hour — the
 * hour of the deadline — and says what changes because of it.
 *
 * Open-Meteo needs no key and no account, which is why it is used here: a
 * weather integration that made the family sign up for something would not
 * be worth the sentence it produces. The only thing sent is a coordinate
 * rounded to two decimal places — about a kilometre, enough for a forecast
 * and not enough to point at a house — and nothing identifying the family
 * ever leaves this Lambda.
 */

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

export class WeatherFetchError extends Error {}

/** Only the slice of `fetch` this module uses, so tests need no network. */
export type WeatherFetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface WeatherAt {
  /** The local hour this describes, as `YYYY-MM-DDTHH:MM`. */
  time: string;
  temperatureF: number;
  /** What it feels like with wind and damp — the number that decides coats. */
  feelsLikeF: number;
  chanceOfRain: number;
  /** A short phrase from the WMO code: "rain", "snow", "clear". */
  conditions: string;
  /** True when the sun is not up at that hour. */
  beforeSunrise: boolean;
  sunrise: string;
}

/**
 * WMO codes, collapsed to the distinctions a family acts on.
 *
 * Deliberately coarse. Nobody standing at a front door needs "moderate
 * drizzle" told apart from "light rain"; they need to know whether to pick
 * up a coat. Codes that mean the same thing at the door share a phrase.
 */
const CONDITIONS: [number[], string][] = [
  [[0, 1], "clear"],
  [[2], "partly cloudy"],
  [[3], "overcast"],
  [[45, 48], "fog"],
  [[51, 53, 55, 56, 57], "drizzle"],
  [[61, 63, 65, 80, 81, 82], "rain"],
  [[66, 67], "freezing rain"],
  [[71, 73, 75, 77, 85, 86], "snow"],
  [[95, 96, 99], "thunderstorms"],
];

export function describeCode(code: number): string {
  for (const [codes, phrase] of CONDITIONS) if (codes.includes(code)) return phrase;
  // An unknown code is not worth guessing at; the temperature still is.
  return "";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Two decimal places is about a kilometre — a forecast, not an address. */
export const roundCoordinate = (value: number): number => Math.round(value * 100) / 100;

export interface WeatherQuery {
  latitude: number;
  longitude: number;
  /** An IANA zone, so the hours come back local and no conversion is needed. */
  timeZone: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` — the deadline the family is actually planning around. */
  atTime: string;
}

/**
 * The weather at one hour of one day.
 *
 * Returns null when the provider has no row for that hour — a date outside
 * its forecast range, most often. That is an ordinary answer and not an
 * error: the screen simply says nothing about the weather, which is
 * better than a made-up number beside a real one.
 */
export async function weatherAt(
  query: WeatherQuery,
  fetchImpl: WeatherFetch = fetch
): Promise<WeatherAt | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw new WeatherFetchError(`date must be YYYY-MM-DD, got ${query.date}`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(query.atTime)) throw new WeatherFetchError(`atTime must be HH:MM, got ${query.atTime}`);

  const url =
    `${OPEN_METEO_BASE}?latitude=${roundCoordinate(query.latitude)}` +
    `&longitude=${roundCoordinate(query.longitude)}` +
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode" +
    "&daily=sunrise&temperature_unit=fahrenheit&forecast_days=7" +
    `&timezone=${encodeURIComponent(query.timeZone)}`;

  let response: Awaited<ReturnType<WeatherFetch>>;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new WeatherFetchError(`Could not reach the weather service: ${String(err)}`);
  }
  if (!response.ok) throw new WeatherFetchError(`Weather service returned ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new WeatherFetchError("Weather service did not return JSON");
  }
  if (!isRecord(payload) || !isRecord(payload.hourly)) {
    throw new WeatherFetchError("Weather service returned an unexpected shape");
  }

  const hourly = payload.hourly;
  const times = hourly.time;
  if (!Array.isArray(times)) throw new WeatherFetchError("Weather service returned no hours");

  // The forecast is hourly, so a 07:52 deadline is answered by the 07:00
  // row. Truncating rather than rounding is deliberate: it describes the
  // hour the family is actually in when they leave, not the one after.
  const wantedHour = `${query.date}T${query.atTime.slice(0, 2)}:00`;
  const index = times.indexOf(wantedHour);
  if (index === -1) return null;

  const numberAt = (key: string): number | null => {
    const column = hourly[key];
    if (!Array.isArray(column)) return null;
    const value = column[index];
    return typeof value === "number" ? value : null;
  };

  const temperatureF = numberAt("temperature_2m");
  if (temperatureF === null) return null;

  const daily = isRecord(payload.daily) ? payload.daily : null;
  const sunriseColumn = daily && Array.isArray(daily.sunrise) ? daily.sunrise : null;
  const dayIndex = daily && Array.isArray(daily.time) ? daily.time.indexOf(query.date) : -1;
  const sunrise =
    sunriseColumn && dayIndex >= 0 && typeof sunriseColumn[dayIndex] === "string"
      ? (sunriseColumn[dayIndex] as string)
      : "";

  const code = numberAt("weathercode");
  return {
    time: wantedHour,
    temperatureF: Math.round(temperatureF),
    feelsLikeF: Math.round(numberAt("apparent_temperature") ?? temperatureF),
    chanceOfRain: Math.round(numberAt("precipitation_probability") ?? 0),
    conditions: code === null ? "" : describeCode(code),
    // Compared as strings, which works because both are local `...THH:MM`
    // from the same request and the same zone — and avoids parsing a
    // timestamp whose offset this Lambda would otherwise have to guess.
    beforeSunrise: sunrise !== "" && `${query.date}T${query.atTime}` < sunrise,
    sunrise,
  };
}

// ---------------------------------------------------------------------------
// Finding where the house is, without asking anyone for a coordinate

const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  /** What to show in the list: "Springfield, Ohio, US". */
  label: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

/**
 * Towns matching a name, so a parent types their town instead of a
 * latitude.
 *
 * Asking a family for coordinates would be a small act of contempt, and a
 * timezone dropdown with four hundred entries not much better — the same
 * service that has the forecast also knows both, from a place name.
 *
 * Runs on the Lambda rather than in the browser so the household's screens
 * never talk to a third party directly. That is the same posture the school
 * menu takes, and it also sidesteps whatever the Echo Show's browser thinks
 * about cross-origin requests.
 */
export async function searchPlaces(
  name: string,
  fetchImpl: WeatherFetch = fetch
): Promise<Place[]> {
  const query = name.trim();
  if (query.length < 2) return [];

  const url = `${GEOCODING_BASE}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  let response: Awaited<ReturnType<WeatherFetch>>;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new WeatherFetchError(`Could not reach the place lookup: ${String(err)}`);
  }
  if (!response.ok) throw new WeatherFetchError(`Place lookup returned ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new WeatherFetchError("Place lookup did not return JSON");
  }
  // No match is an empty body rather than an empty array, so an absent
  // `results` is an ordinary "nothing found" and not a shape problem.
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];

  const places: Place[] = [];
  for (const row of payload.results) {
    if (!isRecord(row)) continue;
    const { name: placeName, latitude, longitude, timezone, admin1, country_code: country } = row;
    if (typeof placeName !== "string" || typeof latitude !== "number" || typeof longitude !== "number") continue;
    if (typeof timezone !== "string" || !timezone) continue;
    places.push({
      label: [placeName, typeof admin1 === "string" ? admin1 : null, typeof country === "string" ? country : null]
        .filter(Boolean)
        .join(", "),
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
      timeZone: timezone,
    });
  }
  return places;
}
