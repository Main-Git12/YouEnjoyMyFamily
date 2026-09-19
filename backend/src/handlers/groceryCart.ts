import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { CartItemInput, type CartItem } from "../types";

const KROGER_API_BASE_URL = process.env.KROGER_API_BASE_URL ?? "https://api.kroger.com/v1";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null; // per-container warm cache

interface KrogerTokenResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Client-credentials token for Kroger's product/cart APIs.
 * See: https://developer.kroger.com/reference (Authorization Server)
 */
async function getKrogerAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;

  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Kroger client credentials are not configured");

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${KROGER_API_BASE_URL}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });

  if (!response.ok) throw new Error(`Kroger token request failed: ${response.status}`);

  const { access_token: accessToken, expires_in: expiresIn } = (await response.json()) as KrogerTokenResponse;
  cachedToken = { accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return accessToken;
}

async function listCartItems(familyId: string): Promise<CartItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "CARTITEM#" },
    })
  );
  return (result.Items ?? []) as CartItem[];
}

async function addCartItem(familyId: string, input: CartItemInput): Promise<CartItem> {
  // Ensures Kroger credentials are valid before we persist locally — surfaces
  // auth misconfiguration immediately rather than on the next delivery sync.
  await getKrogerAccessToken();

  const itemId = ulid();
  const item: CartItem = {
    PK: `FAMILY#${familyId}`,
    SK: `CARTITEM#${itemId}`,
    entityType: "CART_ITEM",
    familyId,
    itemId,
    krogerProductId: input.krogerProductId,
    description: input.description,
    quantity: input.quantity ?? 1,
    addedBy: input.addedBy ?? null,
    addedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listCartItems(familyId));
      case "POST":
        return created(await addCartItem(familyId, parseBody(CartItemInput, event.body)));
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
