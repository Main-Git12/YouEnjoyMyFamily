const { GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLE_NAME } = require("../lib/dynamoClient");
const { ok, badRequest, notFound, serverError } = require("../lib/response");

const DEFAULT_PREFERENCES = {
  theme: "olive",
  notificationsEnabled: true,
  quietHours: { start: "20:00", end: "07:00" },
};

const prefsKey = (familyId, memberId) => ({ PK: `FAMILY#${familyId}`, SK: `PREFS#${memberId}` });

exports.handler = async (event) => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext?.http?.method;

  try {
    if (!familyId || !memberId) return badRequest("familyId and memberId are required");

    if (method === "GET") {
      const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: prefsKey(familyId, memberId) }));
      return result.Item ? ok(result.Item) : ok({ ...DEFAULT_PREFERENCES, familyId, memberId });
    }

    if (method === "PUT") {
      const body = JSON.parse(event.body ?? "{}");
      const item = {
        ...prefsKey(familyId, memberId),
        entityType: "PREFERENCES",
        familyId,
        memberId,
        ...DEFAULT_PREFERENCES,
        ...body,
        updatedAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return ok(item);
    }

    return badRequest(`Unsupported method: ${method}`);
  } catch (err) {
    return serverError(err);
  }
};
