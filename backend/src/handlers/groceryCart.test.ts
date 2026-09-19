import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./groceryCart";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> & { method: string }): APIGatewayProxyEventV2 {
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

beforeEach(() => {
  ddbMock.reset();
  process.env.KROGER_CLIENT_ID = "test-client-id";
  process.env.KROGER_CLIENT_SECRET = "test-client-secret";
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ access_token: "token-123", expires_in: 1800 }), { status: 200 })
  );
});

test("GET lists cart items for a family", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ itemId: "i1", description: "Milk" }] });

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), [{ itemId: "i1", description: "Milk" }]);
});

test("POST rejects a body missing krogerProductId", async () => {
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ description: "Milk" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

// Runs before the "adds an item" test below: getKrogerAccessToken caches a
// valid token in module state once a call succeeds, which would otherwise
// make this 401 case unreachable for the rest of the process's lifetime.
test("POST surfaces a 500 when Kroger credentials are rejected", async () => {
  mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ krogerProductId: "0001111041700", description: "2% Milk, 1 Gallon" }),
    })
  );

  assert.equal(result.statusCode, 500);
});

test("POST adds an item after validating Kroger credentials", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ krogerProductId: "0001111041700", description: "2% Milk, 1 Gallon" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.krogerProductId, "0001111041700");
  assert.equal(body.quantity, 1);
});
