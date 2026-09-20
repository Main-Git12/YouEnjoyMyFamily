import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "./dynamoClient";
import { unauthorized } from "./response";
import type { FamilyRecord } from "../types";

export const familyMetadataKey = (familyId: string): { PK: string; SK: "METADATA" } => ({
  PK: `FAMILY#${familyId}`,
  SK: "METADATA",
});

export function generateApiKey(): string {
  return `fk_${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function extractBearerToken(event: APIGatewayProxyEventV2): string | null {
  // API Gateway HTTP APIs (payload v2) normalise header names to lowercase.
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  const token = header?.match(/^Bearer (.+)$/)?.[1]?.trim();
  return token || null;
}

/**
 * Verifies the caller's `Authorization: Bearer <apiKey>` header against the
 * requested family's stored key hash. Every handler that reads or writes
 * `FAMILY#<familyId>` data calls this right after checking familyId is
 * present, and returns its result directly if non-null. See families.ts for
 * how a family gets its one and only key, and models/schema.md for the
 * Family entity this reads.
 */
export async function authenticateFamily(
  event: APIGatewayProxyEventV2,
  familyId: string
): Promise<APIGatewayProxyStructuredResultV2 | null> {
  const token = extractBearerToken(event);
  if (!token) return unauthorized();

  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: familyMetadataKey(familyId) }));
  const family = result.Item as FamilyRecord | undefined;
  if (!family) return unauthorized();

  // Both sides are hex SHA-256 digests (fixed 64 bytes), so this is safe
  // against timing attacks without needing a length check first — but
  // timingSafeEqual throws on mismatched lengths, so guard it anyway.
  const presented = Buffer.from(hashApiKey(token));
  const expected = Buffer.from(family.apiKeyHash);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return unauthorized();
  }

  return null;
}
