import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { authenticateFamily, generateApiKey, hashApiKey, familyMetadataKey } from "./auth";
import { mockFamilyAuth, TEST_API_KEY } from "./authTestSupport";
import { TABLE_NAME } from "./dynamoClient";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers,
    requestContext: {
      http: { method: "GET", path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

test("generateApiKey produces distinct, non-empty keys", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.ok(a.startsWith("fk_"));
  assert.notEqual(a, b);
});

test("hashApiKey is deterministic and looks like a sha256 hex digest", () => {
  const hash = hashApiKey("some-key");
  assert.equal(hash, hashApiKey("some-key"));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("rejects a request with no Authorization header", async () => {
  mockFamilyAuth(ddbMock, "fam_1");
  const result = await authenticateFamily(makeEvent(), "fam_1");
  assert.equal(result?.statusCode, 401);
});

test("rejects a malformed Authorization header", async () => {
  mockFamilyAuth(ddbMock, "fam_1");
  const result = await authenticateFamily(makeEvent({ authorization: "not-a-bearer-token" }), "fam_1");
  assert.equal(result?.statusCode, 401);
});

test("rejects a familyId with no Family record at all", async () => {
  ddbMock.on(GetCommand, { TableName: TABLE_NAME, Key: familyMetadataKey("fam_ghost") }).resolves({});
  const result = await authenticateFamily(makeEvent({ authorization: `Bearer ${TEST_API_KEY}` }), "fam_ghost");
  assert.equal(result?.statusCode, 401);
});

test("rejects the wrong API key for a real family", async () => {
  mockFamilyAuth(ddbMock, "fam_1");
  const result = await authenticateFamily(makeEvent({ authorization: "Bearer wrong-key" }), "fam_1");
  assert.equal(result?.statusCode, 401);
});

test("accepts the correct API key and returns null", async () => {
  const headers = mockFamilyAuth(ddbMock, "fam_1");
  const result = await authenticateFamily(makeEvent(headers), "fam_1");
  assert.equal(result, null);
});
