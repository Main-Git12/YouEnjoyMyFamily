const { ulid } = require("ulid");
const { PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLE_NAME } = require("../lib/dynamoClient");
const { ok, created, badRequest, serverError } = require("../lib/response");

const KROGER_API_BASE_URL = process.env.KROGER_API_BASE_URL ?? "https://api.kroger.com/v1";

let cachedToken = null; // { accessToken, expiresAt } — per-container warm cache

/**
 * Client-credentials token for Kroger's product/cart APIs.
 * See: https://developer.kroger.com/reference (Authorization Server)
 */
async function getKrogerAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;

  const basicAuth = Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${KROGER_API_BASE_URL}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });

  if (!response.ok) throw new Error(`Kroger token request failed: ${response.status}`);

  const { access_token: accessToken, expires_in: expiresIn } = await response.json();
  cachedToken = { accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return accessToken;
}

async function listCartItems(familyId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "CARTITEM#" },
    })
  );
  return result.Items ?? [];
}

async function addCartItem(familyId, body) {
  if (!body?.krogerProductId || !body?.description) {
    throw new Error("BAD_REQUEST:krogerProductId and description are required");
  }

  // Ensures Kroger credentials are valid before we persist locally — surfaces
  // auth misconfiguration immediately rather than on the next delivery sync.
  await getKrogerAccessToken();

  const itemId = ulid();
  const item = {
    PK: `FAMILY#${familyId}`,
    SK: `CARTITEM#${itemId}`,
    entityType: "CART_ITEM",
    familyId,
    itemId,
    krogerProductId: body.krogerProductId,
    description: body.description,
    quantity: body.quantity ?? 1,
    addedBy: body.addedBy ?? null,
    addedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

exports.handler = async (event) => {
  const { familyId } = event.pathParameters ?? {};
  const method = event.requestContext?.http?.method;

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listCartItems(familyId));
      case "POST":
        return created(await addCartItem(familyId, JSON.parse(event.body ?? "{}")));
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err.message?.startsWith("BAD_REQUEST:")) return badRequest(err.message.split(":")[1]);
    return serverError(err);
  }
};
