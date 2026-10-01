import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler, householdSortKeys } from "./household";
import { mockFamilyAuth } from "../lib/authTestSupport";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string; path?: string }
): APIGatewayProxyEventV2 {
  const { method, path, ...rest } = overrides;
  const rawPath = path ?? "/families/fam_1/household";
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

test("the member and job namespaces cannot overlap, however the prefix is written", () => {
  // The trap this repo has already hit once: `begins_with` on a prefix that
  // is the leading run of another. Checked against the key builders, not a
  // comment about them.
  const member = householdSortKeys.memberKey("fam_1", "sheliah").SK;
  const job = householdSortKeys.jobKey("fam_1", "j1").SK;

  assert.ok(member.startsWith("MEMBER#"));
  assert.ok(job.startsWith("HOUSEJOB#"));
  assert.equal(job.startsWith("MEMBER"), false);
  assert.equal(member.startsWith("HOUSEJOB"), false);
});

test("GET returns the roster and the jobs together", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "MEMBER#" } }).resolves({
    Items: [
      { memberId: "parker", displayName: "Parker", role: "child", note: null },
      { memberId: "sheliah", displayName: "Sheliah", role: "adult", note: "Picks Parker up on Tuesdays" },
    ],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "HOUSEJOB#" } }).resolves({
    Items: [{ jobId: "j1", title: "Book the dentist", kind: "arranging", ownerId: null, note: null }],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.members.length, 2);
  assert.equal(body.jobs.length, 1);
});

test("the roster puts adults and children in separate runs rather than interleaving them", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "MEMBER#" } }).resolves({
    Items: [
      { memberId: "parker", displayName: "Parker", role: "child", note: null },
      { memberId: "sheliah", displayName: "Sheliah", role: "adult", note: null },
      { memberId: "andrew", displayName: "Andrew", role: "adult", note: null },
    ],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "HOUSEJOB#" } }).resolves({ Items: [] });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));
  const names = JSON.parse(result.body ?? "{}").members.map((m: { displayName: string }) => m.displayName);

  assert.deepEqual(names, ["Andrew", "Sheliah", "Parker"]);
});

test("a job nobody has taken is listed first, because it is the row asking for something", async () => {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "MEMBER#" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "FAMILY#fam_1", ":prefix": "HOUSEJOB#" } }).resolves({
    Items: [
      { jobId: "j1", title: "Cook on weeknights", kind: "doing", ownerId: "Paige", note: null },
      { jobId: "j2", title: "Notice when we're running low", kind: "arranging", ownerId: null, note: null },
      { jobId: "j3", title: "Bins", kind: "doing", ownerId: "Andrew", note: null },
    ],
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" }, headers }));
  const titles = JSON.parse(result.body ?? "{}").jobs.map((j: { title: string }) => j.title);

  assert.equal(titles[0], "Notice when we're running low");
});

test("PUT adds somebody to the house as an adult, not as another child", async () => {
  // The whole reason `role` exists. Typing a grandmother's name onto a chore
  // was the only way in before, and it handed her a gem balance and a place
  // in a children's game.
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1/household/members/sheliah",
      pathParameters: { familyId: "fam_1", memberId: "sheliah" },
      headers,
      body: JSON.stringify({ displayName: "Sheliah", role: "adult", note: "Picks Parker up on Tuesdays" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.role, "adult");
  assert.equal(written?.displayName, "Sheliah");
  assert.equal(written?.note, "Picks Parker up on Tuesdays");
  assert.equal(written?.entityType, "HOUSEHOLD_MEMBER");
});

test("PUT refuses a role the app doesn't have", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1/household/members/sheliah",
      pathParameters: { familyId: "fam_1", memberId: "sheliah" },
      headers,
      body: JSON.stringify({ displayName: "Sheliah", role: "grandparent" }),
    })
  );

  assert.equal(result.statusCode, 400);
});

test("editing somebody keeps the day they joined the household", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "MEMBER#sheliah" } }).resolves({
    Item: { memberId: "sheliah", displayName: "Shelia", role: "adult", createdAt: "2025-03-01T00:00:00.000Z" },
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1/household/members/sheliah",
      pathParameters: { familyId: "fam_1", memberId: "sheliah" },
      headers,
      body: JSON.stringify({ displayName: "Sheliah", role: "adult" }),
    })
  );

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.createdAt, "2025-03-01T00:00:00.000Z");
  assert.equal(written?.displayName, "Sheliah");
});

test("a job can be handed back to nobody, which is different from leaving it alone", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "HOUSEJOB#j1" } }).resolves({
    Item: { jobId: "j1", title: "Book the dentist", kind: "arranging", ownerId: "Paige", createdAt: "2025-01-01T00:00:00.000Z" },
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1/household/jobs/j1",
      pathParameters: { familyId: "fam_1", jobId: "j1" },
      headers,
      body: JSON.stringify({ title: "Book the dentist", kind: "arranging", ownerId: null }),
    })
  );

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.ownerId, null);
});

test("a job edit that says nothing about the owner leaves the owner alone", async () => {
  ddbMock.on(GetCommand, { Key: { PK: "FAMILY#fam_1", SK: "HOUSEJOB#j1" } }).resolves({
    Item: { jobId: "j1", title: "Book the dentist", kind: "arranging", ownerId: "Paige", createdAt: "2025-01-01T00:00:00.000Z" },
  });
  ddbMock.on(PutCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1/household/jobs/j1",
      pathParameters: { familyId: "fam_1", jobId: "j1" },
      headers,
      body: JSON.stringify({ title: "Book the dentist and the optician", kind: "arranging" }),
    })
  );

  const written = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
  assert.equal(written?.ownerId, "Paige");
  assert.equal(written?.title, "Book the dentist and the optician");
});

test("DELETE for somebody who isn't on the roster is a 404, not a silent success", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "DELETE",
      path: "/families/fam_1/household/members/nobody",
      pathParameters: { familyId: "fam_1", memberId: "nobody" },
      headers,
    })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(DeleteCommand).length, 0);
});

test("every route needs the family key", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 401);
});
