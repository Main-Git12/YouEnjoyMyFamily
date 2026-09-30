import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./families";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { hashApiKey } from "../lib/auth";
import { mockFamilyAuth, TEST_API_KEY } from "../lib/authTestSupport";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & { method: string; path?: string }
): APIGatewayProxyEventV2 {
  const { method, path, ...rest } = overrides;
  const rawPath = path ?? "/families";
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

test("POST creates a family and returns the raw API key exactly once", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(makeEvent({ method: "POST", body: JSON.stringify({ name: "The Peals" }) }));

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.ok(body.familyId.startsWith("fam_"));
  assert.ok(body.apiKey.startsWith("fk_"));

  // The stored item must hold only the hash, never the raw key.
  const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
  assert.equal(put?.Item?.apiKeyHash, hashApiKey(body.apiKey));
  assert.equal(JSON.stringify(put?.Item).includes(body.apiKey), false);
});

test("POST works without a name", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(makeEvent({ method: "POST", body: JSON.stringify({}) }));
  assert.equal(result.statusCode, 201);
});

test("POST rejects a name that's too long", async () => {
  const result = await handler(
    makeEvent({ method: "POST", body: JSON.stringify({ name: "x".repeat(101) }) })
  );
  assert.equal(result.statusCode, 400);
});

test("rejects non-POST methods", async () => {
  const result = await handler(makeEvent({ method: "GET" }));
  assert.equal(result.statusCode, 400);
});

// --- Reading and editing the family record ------------------------------

test("GET returns the family, and never the thing that unlocks it", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "GET", path: "/families/fam_1", pathParameters: { familyId: "fam_1" }, headers })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.familyId, "fam_1");
  assert.equal("apiKeyHash" in body, false);
  assert.equal((result.body ?? "").includes(hashApiKey(TEST_API_KEY)), false);
});

test("PUT never names the family's credential, so no edit can erase it", async () => {
  // The point is structural, not a promise a comment makes: apiKeyHash is
  // unrecoverable and losing it locks every screen in the house out at once,
  // so the write must not be capable of touching it.
  ddbMock.on(UpdateCommand).resolves({ Attributes: { familyId: "fam_1", name: "The Peals" } });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ name: "The Peals" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.equal(written?.UpdateExpression, "SET #name = :name");
  assert.equal(JSON.stringify(written).includes("apiKeyHash"), false);
  assert.equal(JSON.stringify(written).includes("createdAt"), false);
  // And a Put of a whole rebuilt record is exactly what must not happen.
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("PUT names `name` through an expression attribute, being a reserved word", async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { familyId: "fam_1" } });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ name: "The Peals" }),
    })
  );

  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  assert.equal(written?.ExpressionAttributeNames?.["#name"], "name");
});

test("PUT rounds the house's coordinates before they are ever stored", async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { familyId: "fam_1" } });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({
        location: { latitude: 39.8848391, longitude: -82.7538812, timeZone: "America/New_York", label: " Home " },
      }),
    })
  );

  const stored = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues?.[":location"];
  assert.deepEqual(stored, {
    latitude: 39.88,
    longitude: -82.75,
    timeZone: "America/New_York",
    label: "Home",
  });
});

test("PUT on a family deleted mid-edit is a 404, not a resurrection", async () => {
  // The fake rejects only a write that actually asked to be checked: DynamoDB
  // would land an unconditional one, so dropping the condition has to show up
  // here as an edit that succeeded against a family that isn't there.
  ddbMock.on(UpdateCommand).callsFake((input: { ConditionExpression?: string }) => {
    if (!input.ConditionExpression?.includes("attribute_exists(PK)")) return { Attributes: { familyId: "fam_1" } };
    throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
  });
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({ name: "The Peals" }),
    })
  );

  assert.equal(result.statusCode, 404);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

test("PUT with nothing in it writes nothing at all", async () => {
  // "SET " with no assignments is a malformed UpdateExpression, so an empty
  // patch has to be answered as a read.
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "PUT",
      path: "/families/fam_1",
      pathParameters: { familyId: "fam_1" },
      headers,
      body: JSON.stringify({}),
    })
  );

  assert.equal(result.statusCode, 200);
  assert.equal(ddbMock.commandCalls(UpdateCommand).length, 0);
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

// --- Replacing a key that has got out -----------------------------------

test("POST /key issues a new key and retires the old one", async () => {
  ddbMock.on(UpdateCommand).resolves({});
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "POST", path: "/families/fam_1/key", pathParameters: { familyId: "fam_1" }, headers })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.ok(body.apiKey.startsWith("fk_"));
  assert.notEqual(body.apiKey, TEST_API_KEY);

  const written = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
  // Only the hash is stored, and it is the hash of the key just handed back.
  assert.equal(written?.ExpressionAttributeValues?.[":next"], hashApiKey(body.apiKey));
  assert.equal(JSON.stringify(written).includes(body.apiKey), false);
  // Conditioned on the key that was actually presented, so two rotations
  // racing can't both answer with a key while only one of them works.
  assert.equal(written?.ExpressionAttributeValues?.[":current"], hashApiKey(TEST_API_KEY));
  assert.match(written?.ConditionExpression ?? "", /apiKeyHash = :current/);
});

test("POST /key without a key at all is rejected before anything is written", async () => {
  const result = await handler(
    makeEvent({ method: "POST", path: "/families/fam_1/key", pathParameters: { familyId: "fam_1" } })
  );

  assert.equal(result.statusCode, 401);
  assert.equal(ddbMock.commandCalls(UpdateCommand).length, 0);
});

test("POST /key that loses the race rotates nothing and says so", async () => {
  ddbMock.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }));
  const headers = mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({ method: "POST", path: "/families/fam_1/key", pathParameters: { familyId: "fam_1" }, headers })
  );

  assert.equal(result.statusCode, 409);
  assert.equal((result.body ?? "").includes("fk_"), false);
});

test("a wrong key cannot rotate a key", async () => {
  mockFamilyAuth(ddbMock, "fam_1");

  const result = await handler(
    makeEvent({
      method: "POST",
      path: "/families/fam_1/key",
      pathParameters: { familyId: "fam_1" },
      headers: { authorization: "Bearer fk_not_the_key" },
    })
  );

  assert.equal(result.statusCode, 401);
  assert.equal(ddbMock.commandCalls(UpdateCommand).length, 0);
});
