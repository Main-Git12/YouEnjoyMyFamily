import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { queryAll } from "./queryAll";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

test("queryAll follows LastEvaluatedKey until the last page", async () => {
  ddbMock
    .on(QueryCommand)
    .resolvesOnce({ Items: [{ n: 1 }], LastEvaluatedKey: { SK: "a" } })
    .resolvesOnce({ Items: [{ n: 2 }], LastEvaluatedKey: { SK: "b" } })
    .resolvesOnce({ Items: [{ n: 3 }] });

  const items = await queryAll<{ n: number }>({ TableName: "t", KeyConditionExpression: "PK = :pk" });

  assert.deepEqual(items.map((item) => item.n), [1, 2, 3]);
  const startKeys = ddbMock.commandCalls(QueryCommand).map((call) => call.args[0].input.ExclusiveStartKey);
  assert.deepEqual(startKeys, [undefined, { SK: "a" }, { SK: "b" }]);
});

test("queryAll makes one call when everything fits on a page", async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ n: 1 }] });

  const items = await queryAll<{ n: number }>({ TableName: "t", KeyConditionExpression: "PK = :pk" });

  assert.equal(items.length, 1);
  assert.equal(ddbMock.commandCalls(QueryCommand).length, 1);
});
