const { ulid } = require("ulid");
const { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, TABLE_NAME } = require("../lib/dynamoClient");
const { ok, created, badRequest, notFound, serverError } = require("../lib/response");

const taskKey = (familyId, taskId) => ({ PK: `FAMILY#${familyId}`, SK: `TASK#${taskId}` });

async function listTasks(familyId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "TASK#" },
    })
  );
  return result.Items ?? [];
}

async function createTask(familyId, body) {
  if (!body?.title) throw new Error("BAD_REQUEST:title is required");

  const taskId = ulid();
  const now = new Date().toISOString();
  const item = {
    ...taskKey(familyId, taskId),
    GSI1PK: `TASK#${taskId}`,
    GSI1SK: `DUE#${body.dueDate ?? "9999-12-31"}`,
    entityType: "TASK",
    familyId,
    taskId,
    title: body.title,
    assignedTo: body.assignedTo ?? null,
    dueDate: body.dueDate ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function updateTask(familyId, taskId, body) {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
  if (!existing.Item) return null;

  const updates = { ...existing.Item, ...body, updatedAt: new Date().toISOString() };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updates }));
  return updates;
}

async function deleteTask(familyId, taskId) {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
}

exports.handler = async (event) => {
  const { familyId, taskId } = event.pathParameters ?? {};
  const method = event.requestContext?.http?.method;

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listTasks(familyId));
      case "POST":
        return created(await createTask(familyId, JSON.parse(event.body ?? "{}")));
      case "PUT": {
        if (!taskId) return badRequest("taskId is required");
        const updated = await updateTask(familyId, taskId, JSON.parse(event.body ?? "{}"));
        return updated ? ok(updated) : notFound("Task not found");
      }
      case "DELETE":
        if (!taskId) return badRequest("taskId is required");
        await deleteTask(familyId, taskId);
        return ok({ deleted: taskId });
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err.message?.startsWith("BAD_REQUEST:")) return badRequest(err.message.split(":")[1]);
    return serverError(err);
  }
};
