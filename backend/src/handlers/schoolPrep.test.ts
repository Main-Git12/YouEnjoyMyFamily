import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./schoolPrep";
import { mockFamilyAuth } from "../lib/authTestSupport";
import type { SchoolPrepItem } from "../types";

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

const PREP_KEY = { PK: "FAMILY#fam_1", SK: "SCHOOLPREP#2026-10-01#Parker" };
const LIBRARY = {
  subject: "Library",
  note: "Have your student bring in their library book to return.",
};

test("GET without familyId returns 400, and no Authorization is 401", async () => {
  assert.equal((await handler(makeEvent({ method: "GET", pathParameters: {} }))).statusCode, 400);
  assert.equal(
    (await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }))).statusCode,
    401
  );
});

test("GET ranges over dates, and an omitted range does not build one that matches nothing", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  const values = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues;
  // An omitted query param arrives as "", and `SCHOOLPREP#` alone sorts
  // below every real key — the range would be valid and return nothing.
  assert.equal(values?.[":from"], "SCHOOLPREP#0000-00-00");
  assert.equal(values?.[":to"], "SCHOOLPREP#9999-12-31#￿");
});

test("GET with a range uses it", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "GET",
      pathParameters: { familyId: "fam_1" },
      headers,
      queryStringParameters: { start: "2026-09-28", end: "2026-10-02" },
    })
  );

  const values = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues;
  assert.equal(values?.[":from"], "SCHOOLPREP#2026-09-28");
  assert.equal(values?.[":to"], "SCHOOLPREP#2026-10-02#￿");
});

/**
 * The three SCHOOL prefixes have to stay mutually exclusive. This is the
 * check rather than a comment claiming it, because the failure mode — a
 * prefix query returning a neighbouring entity's rows — reads as missing
 * data rather than as an error.
 */
test("none of the three SCHOOL sort-key prefixes is a prefix of another", () => {
  const keys = ["SCHOOL#Parker", "SCHOOLMENU#117559#2026-10", "SCHOOLPREP#2026-10-01#Parker"];
  const prefixes = ["SCHOOL#", "SCHOOLMENU#", "SCHOOLPREP#"];
  for (const prefix of prefixes) {
    const matched = keys.filter((key) => key.startsWith(prefix));
    assert.equal(matched.length, 1, `${prefix} should match exactly one of ${keys.join(", ")}`);
  }
});

test("PUT records what was ticked, copying the subject and note onto the row", async () => {
  ddbMock.on(GetCommand, { Key: PREP_KEY }).resolves({});
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers,
      body: JSON.stringify(LIBRARY),
    })
  );

  assert.equal(result.statusCode, 200);
  const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolPrepItem;
  assert.equal(item.SK, "SCHOOLPREP#2026-10-01#Parker");
  assert.equal(item.entityType, "SCHOOL_PREP");
  assert.equal(item.subject, "Library");
  // Copied, not looked up: a rotation edited in January must not rewrite
  // what December's ticks were about.
  assert.equal(item.note, LIBRARY.note);
  assert.ok(item.packedAt);
});

/**
 * Two taps on a kitchen screen, or the retry after a dropped response, must
 * not move the time somebody said it was done.
 */
test("PUT twice keeps the first packedAt", async () => {
  const already: Partial<SchoolPrepItem> = { ...PREP_KEY, packedAt: "2026-09-30T20:12:00.000Z" };
  ddbMock.on(GetCommand, { Key: PREP_KEY }).resolves({ Item: already });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers,
      body: JSON.stringify(LIBRARY),
    })
  );

  const item = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item as SchoolPrepItem;
  assert.equal(item.packedAt, "2026-09-30T20:12:00.000Z");
});

test("a malformed date is refused before anything is written", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  for (const date of ["tomorrow", "2026-10-1", ""]) {
    const result = await handler(
      makeEvent({
        method: "PUT",
        pathParameters: { familyId: "fam_1", memberId: "Parker", date },
        headers,
        body: JSON.stringify(LIBRARY),
      })
    );
    assert.equal(result.statusCode, 400, `expected 400 for date ${JSON.stringify(date)}`);
  }
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("a tick with no subject is refused — a record that cannot say what it was about is not one", async () => {
  ddbMock.on(GetCommand, { Key: PREP_KEY }).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers,
      body: JSON.stringify({ subject: "" }),
    })
  );

  assert.equal(result.statusCode, 400);
});

test("DELETE takes a tick back, and says so plainly when there was none", async () => {
  ddbMock.on(GetCommand, { Key: PREP_KEY }).resolves({ Item: { ...PREP_KEY } });
  ddbMock.on(DeleteCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const undone = await handler(
    makeEvent({
      method: "DELETE",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers,
    })
  );
  assert.equal(undone.statusCode, 200);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 1);

  ddbMock.reset();
  ddbMock.on(GetCommand, { Key: PREP_KEY }).resolves({});
  const headers2 = mockFamilyAuth(ddbMock, "fam_1");
  const missing = await handler(
    makeEvent({
      method: "DELETE",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers: headers2,
    })
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});

test("a method the route does not serve is refused", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1", memberId: "Parker", date: "2026-10-01" },
      headers,
    })
  );
  assert.equal(result.statusCode, 400);
});
