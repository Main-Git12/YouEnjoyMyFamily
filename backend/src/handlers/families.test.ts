import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./families";
import { hashApiKey } from "../lib/auth";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> & { method: string }): APIGatewayProxyEventV2 {
  const { method, ...rest } = overrides;
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/families",
    rawQueryString: "",
    headers: {},
    requestContext: {
      http: { method, path: "/families", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
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
