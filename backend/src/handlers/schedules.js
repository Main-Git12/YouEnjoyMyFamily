const { ulid } = require("ulid");
const { PutCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLE_NAME } = require("../lib/dynamoClient");
const { ok, created, badRequest, serverError } = require("../lib/response");

const scheduleKey = (familyId, isoDate, entryId) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHEDULE#${isoDate}#${entryId}`,
});

async function listSchedules(familyId, start, end) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        ":from": `SCHEDULE#${start ?? "0000-00-00"}`,
        ":to": `SCHEDULE#${end ?? "9999-12-31"}#￿`,
      },
    })
  );
  return result.Items ?? [];
}

async function createSchedule(familyId, body) {
  if (!body?.date || !body?.title) throw new Error("BAD_REQUEST:date and title are required");

  const entryId = ulid();
  const now = new Date().toISOString();
  const item = {
    ...scheduleKey(familyId, body.date, entryId),
    entityType: "SCHEDULE",
    familyId,
    scheduleId: entryId,
    date: body.date,
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    title: body.title,
    memberIds: body.memberIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

exports.handler = async (event) => {
  const { familyId, scheduleId } = event.pathParameters ?? {};
  const method = event.requestContext?.http?.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listSchedules(familyId, query.start, query.end));
      case "POST":
        return created(await createSchedule(familyId, JSON.parse(event.body ?? "{}")));
      case "DELETE": {
        if (!scheduleId || !query.date) return badRequest("scheduleId and date query param are required");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: scheduleKey(familyId, query.date, scheduleId) })
        );
        return ok({ deleted: scheduleId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err.message?.startsWith("BAD_REQUEST:")) return badRequest(err.message.split(":")[1]);
    return serverError(err);
  }
};
