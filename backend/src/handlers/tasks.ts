import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import {
  TaskInput,
  TaskPatch,
  DEFAULT_GEM_VALUE,
  type TaskItem,
  type TaskForDay,
  type TaskCompletionItem,
} from "../types";

const taskKey = (familyId: string, taskId: string) => ({ PK: `FAMILY#${familyId}`, SK: `TASK#${taskId}` });
const completionKey = (familyId: string, isoDate: string, taskId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `COMPLETION#${isoDate}#${taskId}`,
});

// A completed chore pays out its own gemValue — "sleep in my own bed" is
// worth more than "fill my water bottle".

/**
 * The day of the week for a date-only string, without going near local time.
 * `new Date("2026-09-23")` is parsed as UTC midnight but read back in the
 * runtime's zone, so west of UTC it reports the previous day — which would
 * put a weekday chore on a Sunday.
 */
function dayOfWeek(isoDate: string): number {
  const [year, month, day] = isoDate.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
}

const isWeekend = (isoDate: string): boolean => [0, 6].includes(dayOfWeek(isoDate));

/**
 * Whether a chore belongs on a given day.
 *
 * A one-off with no due date keeps appearing until someone actually does it
 * — an unfinished job shouldn't quietly vanish overnight — and then shows
 * only on the day it was done, so that day's list stays truthful.
 */
export function appliesOn(task: TaskItem, isoDate: string): boolean {
  switch (task.recurrence) {
    case "daily":
      return true;
    case "weekdays":
      return !isWeekend(isoDate);
    case "weekends":
      return isWeekend(isoDate);
    case "none":
      if (task.completedOn) return task.completedOn === isoDate;
      return task.dueDate === null || task.dueDate === isoDate;
  }
}

async function listTaskDefinitions(familyId: string): Promise<TaskItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "TASK#" },
    })
  );
  return (result.Items ?? []) as TaskItem[];
}

export async function listCompletions(familyId: string, startDate: string, endDate: string): Promise<TaskCompletionItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        ":from": `COMPLETION#${startDate}`,
        ":to": `COMPLETION#${endDate}#￿`,
      },
    })
  );
  return (result.Items ?? []) as TaskCompletionItem[];
}

/**
 * The chore as it stands on one day. The DynamoDB keys are deliberately not
 * copied across — the API's shape is the family's chore, not the table's.
 */
function toTaskForDay(task: TaskItem, isoDate: string, completion: TaskCompletionItem | undefined): TaskForDay {
  return {
    entityType: task.entityType,
    familyId: task.familyId,
    taskId: task.taskId,
    title: task.title,
    assignedTo: task.assignedTo,
    dueDate: task.dueDate,
    gemValue: task.gemValue,
    dueWindow: task.dueWindow,
    recurrence: task.recurrence,
    completedOn: task.completedOn,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    date: isoDate,
    status: completion ? "done" : "pending",
    gemsAwarded: completion?.gemsAwarded ?? 0,
  };
}

/** Every chore that belongs on `isoDate`, each carrying that day's state. */
export async function listTasksForDay(familyId: string, isoDate: string): Promise<TaskForDay[]> {
  const [definitions, completions] = await Promise.all([
    listTaskDefinitions(familyId),
    listCompletions(familyId, isoDate, isoDate),
  ]);
  const completionByTaskId = new Map(completions.map((completion) => [completion.taskId, completion]));

  return definitions
    .filter((task) => appliesOn(task, isoDate))
    .map((task) => toTaskForDay(task, isoDate, completionByTaskId.get(task.taskId)));
}

async function createTask(familyId: string, input: TaskInput, isoDate: string): Promise<TaskForDay> {
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
    gemValue: input.gemValue ?? DEFAULT_GEM_VALUE,
    dueWindow: input.dueWindow ?? "anytime",
    recurrence: input.recurrence ?? "none",
    completedOn: null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return toTaskForDay(item, isoDate, undefined);
}

async function readTask(familyId: string, taskId: string): Promise<TaskItem | null> {
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
  return (existing.Item as TaskItem | undefined) ?? null;
}

/** Records a chore as done on a day, and pays out its gems. Doing it twice pays once. */
async function completeTaskOnDay(familyId: string, task: TaskItem, isoDate: string): Promise<TaskForDay> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: completionKey(familyId, isoDate, task.taskId) })
  );
  if (existing.Item) return toTaskForDay(task, isoDate, existing.Item as TaskCompletionItem);

  const now = new Date().toISOString();
  const completion: TaskCompletionItem = {
    ...completionKey(familyId, isoDate, task.taskId),
    entityType: "TASK_COMPLETION",
    familyId,
    taskId: task.taskId,
    date: isoDate,
    title: task.title,
    memberId: task.assignedTo,
    gemsAwarded: task.gemValue,
    completedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: completion }));

  if (task.recurrence === "none") {
    const finished: TaskItem = { ...task, completedOn: isoDate, updatedAt: now };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: finished }));
    return toTaskForDay(finished, isoDate, completion);
  }
  return toTaskForDay(task, isoDate, completion);
}

/** Un-ticks a chore for a day — the gems go back with it. */
async function reopenTaskOnDay(familyId: string, task: TaskItem, isoDate: string): Promise<TaskForDay> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: completionKey(familyId, isoDate, task.taskId) }));

  if (task.recurrence === "none" && task.completedOn === isoDate) {
    const reopened: TaskItem = { ...task, completedOn: null, updatedAt: new Date().toISOString() };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: reopened }));
    return toTaskForDay(reopened, isoDate, undefined);
  }
  return toTaskForDay(task, isoDate, undefined);
}

/** Edits the chore itself — its title, value, who it's for, how often it comes back. */
async function updateDefinition(familyId: string, task: TaskItem, patch: TaskPatch, isoDate: string): Promise<TaskForDay> {
  // Merged field by field rather than spread: `assignedTo: null` means
  // "nobody in particular", which a `??` merge would read as "leave it".
  const updated: TaskItem = {
    ...task,
    title: patch.title ?? task.title,
    assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : task.assignedTo,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : task.dueDate,
    gemValue: patch.gemValue ?? task.gemValue,
    dueWindow: patch.dueWindow ?? task.dueWindow,
    recurrence: patch.recurrence ?? task.recurrence,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));

  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: completionKey(familyId, isoDate, task.taskId) })
  );
  return toTaskForDay(updated, isoDate, existing.Item as TaskCompletionItem | undefined);
}

async function deleteTask(familyId: string, taskId: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: taskKey(familyId, taskId) }));
}

/**
 * The day a request is about. Always the caller's own local date — a kitchen
 * screen in Ohio asking at 9pm means *its* today, not UTC's tomorrow. Falls
 * back to the UTC date only when a caller says nothing at all.
 */
function requestedDate(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, taskId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};
  const isCompletions = event.rawPath.endsWith("/task-completions");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    // What actually got done, over a range. This is where gem totals come
    // from — today's chore list says nothing about last week's gems.
    // `||`, not `??`: an omitted query param arrives as an empty string.
    if (isCompletions && method === "GET") {
      return ok(await listCompletions(familyId, query.start || "0000-00-00", query.end || "9999-12-31"));
    }

    switch (method) {
      case "GET":
        return ok(await listTasksForDay(familyId, requestedDate(query.date)));
      case "POST": {
        const input = parseBody(TaskInput, event.body);
        return created(await createTask(familyId, input, requestedDate(query.date)));
      }
      case "PUT": {
        if (!taskId) return badRequest("taskId is required");
        const patch = parseBody(TaskPatch, event.body);
        const task = await readTask(familyId, taskId);
        if (!task) return notFound("Task not found");

        const isoDate = requestedDate(patch.date ?? query.date);
        if (patch.status === "done") return ok(await completeTaskOnDay(familyId, task, isoDate));
        if (patch.status === "pending") return ok(await reopenTaskOnDay(familyId, task, isoDate));
        return ok(await updateDefinition(familyId, task, patch, isoDate));
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
