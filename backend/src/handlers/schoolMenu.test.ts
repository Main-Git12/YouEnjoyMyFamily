import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, getSchoolMenu } from "./schoolMenu";
import { mockFamilyAuth } from "../lib/authTestSupport";
import type { MenuFetch } from "../lib/schoolMenu";
import type { SchoolMenuMonthItem, SchoolProfileItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string }
): APIGatewayProxyEventV2 {
  const { method, ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...rest,
  } as APIGatewayProxyEventV2;
}

const PROFILE_KEY = { PK: "FAMILY#fam_1", SK: "SCHOOL#Parker" };
const OCTOBER_KEY = { PK: "FAMILY#fam_1", SK: "SCHOOLMENU#117559#2026-10" };
const SEPTEMBER_KEY = { PK: "FAMILY#fam_1", SK: "SCHOOLMENU#117559#2026-09" };

const profile = (menuSource: unknown = { provider: "myschoolmenus", organizationId: 2230, siteId: 13754, menuId: 117559 }): Partial<SchoolProfileItem> => ({
  ...PROFILE_KEY,
  entityType: "SCHOOL_PROFILE",
  memberId: "Parker",
  schoolName: "Violet Elementary",
  specials: [],
  menuSource: menuSource as SchoolProfileItem["menuSource"],
});

const cachedMonth = (month: string, dates: string[], ageMs: number): Partial<SchoolMenuMonthItem> => ({
  PK: "FAMILY#fam_1",
  SK: `SCHOOLMENU#117559#${month}`,
  entityType: "SCHOOL_MENU_MONTH",
  menuId: 117559,
  month,
  days: dates.map((date) => ({ date, groups: [{ heading: "Lunch Entree", items: [`Lunch for ${date}`] }] })),
  fetchedAt: new Date(Date.now() - ageMs).toISOString(),
});

/** A provider that answers, and records how many times it was asked. */
function countingFetch(dates: string[]): MenuFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: dates.map((date) => ({
            day: date,
            setting: JSON.stringify({
              current_display: [
                { type: "category", name: "Lunch Entree" },
                { type: "recipe", name: `Lunch for ${date}` },
              ],
            }),
          })),
        }),
    };
  }) as MenuFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const failingFetch: MenuFetch = async () => {
  throw new Error("ECONNRESET");
};

const HOUR = 60 * 60 * 1000;

test("a cache written within the TTL is served without touching the provider", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock
    .on(GetCommand, { Key: OCTOBER_KEY })
    .resolves({ Item: cachedMonth("2026-10", ["2026-10-01", "2026-10-02"], 2 * HOUR) });
  const fetchImpl = countingFetch([]);

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-10-01", "2026-10-31", fetchImpl);

  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(menu?.stale, false);
  assert.deepEqual(menu?.days.map((d) => d.date), ["2026-10-01", "2026-10-02"]);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("a cache older than the TTL is refreshed and written back", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock
    .on(GetCommand, { Key: OCTOBER_KEY })
    .resolves({ Item: cachedMonth("2026-10", ["2026-10-01"], 20 * HOUR) });
  ddbMock.on(PutCommand).resolves({});
  const fetchImpl = countingFetch(["2026-10-01", "2026-10-02"]);

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-10-01", "2026-10-31", fetchImpl);

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(menu?.stale, false);
  assert.deepEqual(menu?.days.map((d) => d.date), ["2026-10-01", "2026-10-02"]);
  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolMenuMonthItem;
  assert.equal(written.SK, "SCHOOLMENU#117559#2026-10");
  assert.equal(written.days.length, 2);
});

/**
 * The reason the cache exists at all. A school menu an hour out of date is
 * fine; a blank panel on a kitchen wall because somebody else's server is
 * down is not. The `stale` flag is how the screen can say which it is
 * showing rather than pretending the two are the same.
 */
test("when the provider cannot be reached, the last copy is served and flagged stale", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock
    .on(GetCommand, { Key: OCTOBER_KEY })
    .resolves({ Item: cachedMonth("2026-10", ["2026-10-01"], 30 * HOUR) });

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-10-01", "2026-10-31", failingFetch);

  assert.equal(menu?.stale, true);
  assert.deepEqual(menu?.days.map((d) => d.date), ["2026-10-01"]);
  assert.deepEqual(menu?.missingMonths, []);
  // Nothing is written when the refresh failed — a stale row must not have
  // its fetchedAt bumped, or it would look fresh for another twelve hours.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("a month with no cache and no provider is reported missing, not shown as a day with no lunch", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock.on(GetCommand, { Key: OCTOBER_KEY }).resolves({});

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-10-01", "2026-10-31", failingFetch);

  assert.deepEqual(menu?.days, []);
  assert.equal(menu?.stale, true);
  assert.deepEqual(menu?.missingMonths, ["2026-10"]);
  assert.equal(menu?.fetchedAt, null);
});

test("a range spanning two months reads both, and names only the one that failed", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock
    .on(GetCommand, { Key: SEPTEMBER_KEY })
    .resolves({ Item: cachedMonth("2026-09", ["2026-09-29", "2026-09-30"], 1 * HOUR) });
  ddbMock.on(GetCommand, { Key: OCTOBER_KEY }).resolves({});

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-09-29", "2026-10-02", failingFetch);

  assert.deepEqual(menu?.days.map((d) => d.date), ["2026-09-29", "2026-09-30"]);
  assert.deepEqual(menu?.missingMonths, ["2026-10"]);
  assert.equal(menu?.stale, true);
});

test("days outside the requested range are dropped, even though a whole month was cached", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock
    .on(GetCommand, { Key: OCTOBER_KEY })
    .resolves({
      Item: cachedMonth("2026-10", ["2026-10-01", "2026-10-05", "2026-10-06", "2026-10-30"], 1 * HOUR),
    });

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-10-05", "2026-10-06", countingFetch([]));

  assert.deepEqual(menu?.days.map((d) => d.date), ["2026-10-05", "2026-10-06"]);
});

test("fetchedAt reports the oldest month served, not the newest", async () => {
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile() });
  ddbMock.on(GetCommand, { Key: SEPTEMBER_KEY }).resolves({ Item: cachedMonth("2026-09", ["2026-09-30"], 10 * HOUR) });
  ddbMock.on(GetCommand, { Key: OCTOBER_KEY }).resolves({ Item: cachedMonth("2026-10", ["2026-10-01"], 1 * HOUR) });

  const menu = await getSchoolMenu("fam_1", "Parker", "2026-09-30", "2026-10-01", countingFetch([]));

  const age = Date.now() - Date.parse(menu?.fetchedAt ?? "");
  assert.ok(age > 9 * HOUR, `expected the 10-hour-old month to be reported, got ${age}ms`);
});

test("a child with no school profile, or one with no published menu, is a 404", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({});
  const noProfile = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { memberId: "Parker", start: "2026-10-01", end: "2026-10-31" },
    })
  );
  assert.equal(noProfile.statusCode, 404);

  ddbMock.reset();
  const headers2 = mockFamilyAuth(ddbMock, "fam_1");
  ddbMock.on(GetCommand, { Key: PROFILE_KEY }).resolves({ Item: profile(null) });
  const noMenu = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers: headers2,
      queryStringParameters: { memberId: "Parker", start: "2026-10-01", end: "2026-10-31" },
    })
  );
  assert.equal(noMenu.statusCode, 404);
});

test("the date range is required and validated rather than defaulted", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const cases = [
    {},
    { memberId: "Parker" },
    { memberId: "Parker", start: "2026-10-01" },
    { memberId: "Parker", start: "October", end: "2026-10-31" },
    { memberId: "Parker", start: "2026-10-31", end: "2026-10-01" },
  ];
  for (const queryStringParameters of cases) {
    const result = await handler(
      makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers, queryStringParameters })
    );
    assert.equal(result.statusCode, 400, `expected 400 for ${JSON.stringify(queryStringParameters)}`);
  }
});

test("rejects a request with no Authorization header, before reading anything", async () => {
  const result = await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      queryStringParameters: { memberId: "Parker", start: "2026-10-01", end: "2026-10-31" },
    })
  );
  assert.equal(result.statusCode, 401);
  assert.equal(ddbMock.commandCalls(GetCommand).filter((c) => c.args[0].input.Key?.SK === "SCHOOL#Parker").length, 0);
});

test("a method other than GET is refused", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({ method: "POST", pathParameters: { familyId: "fam_1" }, headers })
  );
  assert.equal(result.statusCode, 400);
});
