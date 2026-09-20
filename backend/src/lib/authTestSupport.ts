import type { AwsClientStub } from "aws-sdk-client-mock";
import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAME } from "./dynamoClient";
import { hashApiKey, familyMetadataKey } from "./auth";
import type { FamilyRecord } from "../types";

export const TEST_API_KEY = "fk_test_key";

/**
 * Registers the family-record GetCommand every handler's authenticateFamily()
 * call now makes, and returns the Authorization header to send alongside it.
 * Every other *.test.ts file uses this so its existing GetCommand mocks (for
 * the entity under test, not the family record) keep matching only their own
 * Key — aws-sdk-client-mock matches by exact input, so registering this one
 * first with its own Key never shadows a handler's own GetCommand mock.
 */
export function mockFamilyAuth(
  ddbMock: AwsClientStub<DynamoDBDocumentClient>,
  familyId: string,
  apiKey: string = TEST_API_KEY
): Record<string, string> {
  const family: FamilyRecord = {
    ...familyMetadataKey(familyId),
    entityType: "FAMILY",
    familyId,
    name: null,
    apiKeyHash: hashApiKey(apiKey),
    createdAt: "2025-01-01T00:00:00Z",
  };
  ddbMock.on(GetCommand, { TableName: TABLE_NAME, Key: familyMetadataKey(familyId) }).resolves({ Item: family });
  return { authorization: `Bearer ${apiKey}` };
}
