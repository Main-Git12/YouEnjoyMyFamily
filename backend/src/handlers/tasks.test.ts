import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./tasks";
import type { TaskItem } from "../types";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

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

test("GET without familyId returns 400", async () => {
  const result = await handler(makeEvent({ method: "GET", pathParameters: {} }));
  assert.equal(result.statusCode, 400);
});

test("GET lists tasks for a family", async () => {
  const items: TaskItem[] = [
    {
      PK: "FAMILY#fam_1",
      SK: "TASK#t1",
      GSI1PK: "TASK#t1",
      GSI1SK: "DUE#2025-01-01",
      entityType: "TASK",
      familyId: "fam_1",
      taskId: "t1",
      title: "Pack bag",
      assignedTo: null,
      dueDate: "2025-01-01",
      status: "pending",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ];
  ddbMock.on(QueryCommand).resolves({ Items: items });

  const result = await handler(makeEvent({ method: "GET", pathParameters: { familyId: "fam_1" } }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "[]"), items);
});

test("POST creates a task with a generated id", async () => {
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "POST",
      pathParameters: { familyId: "fam_1" },
      body: JSON.stringify({ title: "Pack soccer bag", dueDate: "2025-01-15" }),
    })
  );

  assert.equal(result.statusCode, 201);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.title, "Pack soccer bag");
  assert.equal(body.status, "pending");
  assert.ok(body.taskId);
});

test("POST rejects a missing title", async () => {
  const result = await handler(
    makeEvent({ method: "POST", pathParameters: { familyId: "fam_1" }, body: JSON.stringify({}) })
  );
  assert.equal(result.statusCode, 400);
});

test("PUT on a missing task returns 404", async () => {
  ddbMock.on(GetCommand).resolves({ Item: undefined });

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "missing" },
      body: JSON.stringify({ status: "done" }),
    })
  );
  assert.equal(result.statusCode, 404);
});

test("PUT preserves existing fields not present in the patch", async () => {
  const existing: TaskItem = {
    PK: "FAMILY#fam_1",
    SK: "TASK#t1",
    GSI1PK: "TASK#t1",
    GSI1SK: "DUE#2025-01-01",
    entityType: "TASK",
    familyId: "fam_1",
    taskId: "t1",
    title: "Pack bag",
    assignedTo: "member_1",
    dueDate: "2025-01-01",
    status: "pending",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
  ddbMock.on(GetCommand).resolves({ Item: existing });
  ddbMock.on(PutCommand).resolves({});

  const result = await handler(
    makeEvent({
      method: "PUT",
      pathParameters: { familyId: "fam_1", taskId: "t1" },
      body: JSON.stringify({ status: "done" }),
    })
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body ?? "{}");
  assert.equal(body.status, "done");
  assert.equal(body.title, "Pack bag");
  assert.equal(body.assignedTo, "member_1");
});

test("DELETE removes a task", async () => {
  ddbMock.on(DeleteCommand).resolves({});

  const result = await handler(
    makeEvent({ method: "DELETE", pathParameters: { familyId: "fam_1", taskId: "t1" } })
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body ?? "{}"), { deleted: "t1" });
});
