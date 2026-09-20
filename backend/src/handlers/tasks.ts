import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { TaskInput, TaskPatch, type TaskItem } from "../types";

const taskKey = (familyId: string, taskId: string) => ({ PK: `FAMILY#${familyId}`, SK: `TASK#${taskId}` });

// Flat reward per completed task — no per-member ledger yet, so a task's own
// gemsAwarded (summed client-side) is the running total until one exists.
const GEMS_PER_COMPLETED_TASK = 10;

async function listTasks(familyId: string): Promise<TaskItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "TASK#" },
    })
  );
  return (result.Items ?? []) as TaskItem[];
}

async function createTask(familyId: string, input: TaskInput): Promise<TaskItem> {
  const taskId = ulid();
  const now = new Date().toISOString();
  const item: TaskItem = {
    ...taskKey(familyId, taskId),
    GSI1PK: `TASK#${taskId}`,
    GSI1SK: `DUE#${input.dueDate ?? "9999-12-31"}`,
    entityType: "TASK",
    familyId,
    taskId,
    title: input.title,
    assignedTo: input.assignedTo ?? null,
    dueDate: input.dueDate ?? null,
    status: "pending",
    gemsAwarded: 0,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function updateTask(familyId: string, taskId: string, patch: TaskPatch): Promise<TaskItem | null> {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
  if (!existing.Item) return null;

  const current = existing.Item as TaskItem;
  const nextStatus = patch.status ?? current.status;
  const justCompleted = nextStatus === "done" && current.status !== "done";

  const updated: TaskItem = {
    ...current,
    title: patch.title ?? current.title,
    assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : current.assignedTo,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : current.dueDate,
    status: nextStatus,
    gemsAwarded: justCompleted ? current.gemsAwarded + GEMS_PER_COMPLETED_TASK : current.gemsAwarded,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  return updated;
}

async function deleteTask(familyId: string, taskId: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, taskId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    switch (method) {
      case "GET":
        return ok(await listTasks(familyId));
      case "POST":
        return created(await createTask(familyId, parseBody(TaskInput, event.body)));
      case "PUT": {
        if (!taskId) return badRequest("taskId is required");
        const updated = await updateTask(familyId, taskId, parseBody(TaskPatch, event.body));
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
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
