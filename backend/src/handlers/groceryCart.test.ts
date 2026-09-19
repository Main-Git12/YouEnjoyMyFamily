import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./groceryCart";

const ddbMock = mockClient(DynamoDBDocumentClient);

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

beforeEach(() => {
  ddbMock.reset();
});

test("GET lists cart items for a family", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ itemId: "i1", description: "Milk" }] });

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), [{ itemId: "i1", description: "Milk" }]);
});

test("POST rejects a body missing store", async () => {
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ description: "Milk" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST rejects a store outside giant_eagle/aldi", async () => {
  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ store: "kroger", description: "2% Milk, 1 Gallon" }),
    })
  );
  assert.equal(result.statusCode, 400);
});

test("POST adds an item tagged to a store, defaulting quantity and status", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ store: "giant_eagle", description: "2% Milk, 1 Gallon" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.store, "giant_eagle");
  assert.equal(body.quantity, 1);
  assert.equal(body.status, "needed");
});

test("PATCH mark_unavailable 404s for an unknown item", async () => {
  ddbMock.on(GetCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "PATCH",
      pathParameters: { familyId: "fam_1", itemId: "missing" },
      body: JSON.stringify({ action: "mark_unavailable" }),
    })
  );
  assert.equal(result.statusCode, 404);
});

test("PATCH mark_unavailable flags the item and returns ranked past substitutes", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: { itemId: "i1", familyId: "fam_1", store: "aldi", description: "2% Milk", status: "needed" },
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({
    Items: [
      { substituteDescription: "Whole Milk", timesChosen: 1 },
      { substituteDescription: "Oat Milk", timesChosen: 4 },
    ],
  });

  const result = await handler(
    makeEvent({
      method: "PATCH",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      body: JSON.stringify({ action: "mark_unavailable" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.item.status, "unavailable");
  assert.deepEqual(body.suggestions, [
    { description: "Oat Milk", timesChosen: 4 },
    { description: "Whole Milk", timesChosen: 1 },
  ]);
});

test("PATCH mark_unavailable suggests nothing the first time (no prior substitution history)", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: { itemId: "i1", familyId: "fam_1", store: "aldi", description: "Rye bread", status: "needed" },
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });

  const result = await handler(
    makeEvent({
      method: "PATCH",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      body: JSON.stringify({ action: "mark_unavailable" }),
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}").suggestions, []);
});

test("PATCH substitute updates the item and logs the choice for future suggestions", async () => {
  ddbMock.on(GetCommand).resolves({
    Item: { itemId: "i1", familyId: "fam_1", store: "aldi", description: "2% Milk", status: "unavailable" },
  });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "PATCH",
      pathParameters: { familyId: "fam_1", itemId: "i1" },
      body: JSON.stringify({ action: "substitute", description: "Oat Milk" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.item.description, "Oat Milk");
  assert.equal(body.item.status, "needed");

  const updateCalls = ddbMock.commandCalls(UpdateCommand);
  assert.equal(updateCalls.length, 1);
  const updateCall = updateCalls.at(0);
  assert.ok(updateCall);
  assert.equal(updateCall.args[0].input.Key?.SK, "SUBLOG#aldi#2% milk#oat milk");
  assert.match(updateCall.args[0].input.UpdateExpression ?? "", /ADD timesChosen :one/);
});
