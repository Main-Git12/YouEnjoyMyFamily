import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { TaskInput, TaskPatch, type TaskItem } from "../types";

const GEMS_PER_TASK = 5;

const taskKey = (familyId: string, taskId: string) => ({ PK: `FAMILY#${familyId}`, SK: `TASK#${taskId}` });
const memberStatsKey = (familyId: string, memberId: string) => ({ PK: `FAMILY#${familyId}`, SK: `STATS#${memberId}` });

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
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

/** Awards gems exactly once per pending/in_progress -> done transition, to whoever the task is assigned to. */
async function awardGemsIfJustCompleted(familyId: string, previous: TaskItem, updated: TaskItem): Promise<number> {
  const justCompleted = updated.status === "done" && previous.status !== "done";
  if (!justCompleted || !updated.assignedTo) return 0;

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: memberStatsKey(familyId, updated.assignedTo),
      UpdateExpression:
        "SET entityType = :type, familyId = :familyId, memberId = :memberId, updatedAt = :now " +
        "ADD gems :gems, tasksCompleted :one",
      ExpressionAttributeValues: {
        ":type": "MEMBER_STATS",
        ":familyId": familyId,
        ":memberId": updated.assignedTo,
        ":now": updated.updatedAt,
        ":gems": GEMS_PER_TASK,
        ":one": 1,
      },
    })
  );
  return GEMS_PER_TASK;
}

async function updateTask(
  familyId: string,
  taskId: string,
  patch: TaskPatch
): Promise<{ task: TaskItem; gemsAwarded: number } | null> {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
  if (!existing.Item) return null;

  const current = existing.Item as TaskItem;
  const updated: TaskItem = {
    ...current,
    title: patch.title ?? current.title,
    assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : current.assignedTo,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : current.dueDate,
    status: patch.status ?? current.status,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));

  const gemsAwarded = await awardGemsIfJustCompleted(familyId, current, updated);
  return { task: updated, gemsAwarded };
}

async function deleteTask(familyId: string, taskId: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, taskId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");

    switch (method) {
      case "GET":
        return ok(await listTasks(familyId));
      case "POST":
        return created(await createTask(familyId, parseBody(TaskInput, event.body)));
      case "PUT": {
        if (!taskId) return badRequest("taskId is required");
        const result = await updateTask(familyId, taskId, parseBody(TaskPatch, event.body));
        return result ? ok({ ...result.task, gemsAwarded: result.gemsAwarded }) : notFound("Task not found");
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
