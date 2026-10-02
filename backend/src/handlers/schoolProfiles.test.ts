import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./schoolProfiles";
import { mockFamilyAuth } from "../lib/authTestSupport";
import type { SchoolProfileItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string; rawPath?: string }
): APIGatewayProxyEventV2 {
  const { method, rawPath = "/", ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...rest,
  } as APIGatewayProxyEventV2;
}

/** Mr Alder's sheet, as it is written on the paper on the fridge. */
const SPECIALS = [
  { dayOfWeek: 1, subject: "Art" },
  { dayOfWeek: 2, subject: "Gym", prepNote: "Have students wear closed toed shoes or bring in a pair to change into." },
  { dayOfWeek: 3, subject: "Technology", prepNote: "Make sure computers are fulled charged." },
  { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
  { dayOfWeek: 5, subject: "Music" },
];

const VIOLET_MENU = { provider: "myschoolmenus", organizationId: 40000, siteId: 40001, menuId: 40002 };

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("rejects a request with no Authorization header", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});

test("GET lists profiles under the SCHOOL# prefix, which does not catch the cached menus", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ memberId: "Parker", schoolName: "Maple Street Elementary" }] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  const prefix = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues?.[":prefix"];
  assert.equal(prefix, "SCHOOL#");
  // The trailing `#` is load-bearing: cached menus are `SCHOOLMENU#...`, and
  // a prefix of "SCHOOL" without it would list a year of lunches as if they
  // were children.
  assert.ok(!"SCHOOLMENU#40002#2026-10".startsWith(String(prefix)));
});

test("PUT stores the rotation and keeps the school's own wording for the prep notes", async () => {
  // The handler's own reads are registered before mockFamilyAuth, so the
  // family-record stub stays the most recent match for its own Key.
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SCHOOL#Parker" } }).resolves({});
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({
        schoolName: "Maple Street Elementary",
        teacher: "Mr Alder",
        specials: SPECIALS,
        menuSource: VIOLET_MENU,
      }),
    })
  );

  assert.equal(result.statusCode, 200);
  const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolProfileItem;
  assert.equal(item.SK, "SCHOOL#Parker");
  assert.equal(item.entityType, "SCHOOL_PROFILE");
  assert.equal(item.teacher, "Mr Alder");
  assert.equal(item.specials[3]?.subject, "Library");
  assert.equal(item.specials[3]?.prepNote, "Have your student bring in their library book to return.");
  // Days with no small print keep an explicit null, not an empty string.
  assert.equal(item.specials[0]?.prepNote, null);
  assert.deepEqual(item.menuSource, VIOLET_MENU);
});

test("PUT sorts the rotation by weekday and keeps one entry per day", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SCHOOL#Parker" } }).resolves({});
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({
        schoolName: "Maple Street Elementary",
        specials: [
          { dayOfWeek: 5, subject: "Music" },
          { dayOfWeek: 1, subject: "Gym" },
          { dayOfWeek: 1, subject: "Art" },
        ],
      }),
    })
  );

  const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolProfileItem;
  assert.deepEqual(
    item.specials.map((s) => [s.dayOfWeek, s.subject]),
    [
      [1, "Art"],
      [5, "Music"],
    ]
  );
});

test("PUT is an upsert: editing the sheet keeps the original createdAt", async () => {
  const existing: Partial<SchoolProfileItem> = {
    PK: "FAMILY#fam_1",
    SK: "SCHOOL#Parker",
    createdAt: "2025-08-20T12:00:00.000Z",
  };
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SCHOOL#Parker" } }).resolves({ Item: existing });
  ddbMock.on(PutCommand).resolves({});

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({ schoolName: "Maple Street Elementary", specials: SPECIALS }),
    })
  );

  const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolProfileItem;
  assert.equal(item.createdAt, "2025-08-20T12:00:00.000Z");
  assert.notEqual(item.updatedAt, "2025-08-20T12:00:00.000Z");
});

test("a rotation with a day outside 0-6, or an empty subject, is refused", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  for (const specials of [[{ dayOfWeek: 9, subject: "Art" }], [{ dayOfWeek: 1, subject: "" }]]) {
    const result = await handler(
      makeEvent({
        method: "PUT",
        pathParameters: { familyId: "fam_1", memberId: "Parker" },
        headers,
        body: JSON.stringify({ schoolName: "Maple Street Elementary", specials }),
      })
    );
    assert.equal(result.statusCode, 400);
  }
});

test("a menuSource naming its own URL is refused — only the three ids are accepted", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker" },
      headers,
      body: JSON.stringify({
        schoolName: "Maple Street Elementary",
        specials: SPECIALS,
        menuSource: { provider: "http://169.254.169.254/latest/meta-data/", organizationId: 1, siteId: 1, menuId: 1 },
      }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("DELETE on a child with no profile is a 404, not a silent success", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "SCHOOL#Nobody" } }).resolves({});

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", memberId: "Nobody" }, headers })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});
