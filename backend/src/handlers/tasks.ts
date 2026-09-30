import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, conflict, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { queryAll } from "../lib/queryAll";
import { listRewardClaims, readLedgerVersion, bumpLedgerVersion } from "../lib/gemLedger";
import {
  TaskInput,
  TaskPatch,
  IsoDate,
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

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** The request can't be honoured as things stand — surfaced as a 409. */
class TaskConflict extends Error {}
/** The chore was deleted out from under the request — surfaced as a 404. */
class TaskGone extends Error {}

// Matched by name, not instanceof: a bundled SDK can load the error class
// twice, and instanceof then silently fails.
const isTransactionCanceled = (err: unknown): boolean =>
  err instanceof Error && err.name === "TransactionCanceledException";
const isConditionFailed = (err: unknown): boolean =>
  err instanceof Error && err.name === "ConditionalCheckFailedException";

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
  return queryAll<TaskItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "TASK#" },
  });
}

/**
 * Every completion in a date range — paged to the end, because an all-time
 * range is exactly what gem balances ask for, and a single page stops at
 * about a year of a busy family's chores.
 */
export async function listCompletions(
  familyId: string,
  startDate: string,
  endDate: string,
  consistent = false
): Promise<TaskCompletionItem[]> {
  return queryAll<TaskCompletionItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":from": `COMPLETION#${startDate}`,
      ":to": `COMPLETION#${endDate}#￿`,
    },
    ConsistentRead: consistent,
  });
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

async function readCompletion(familyId: string, isoDate: string, taskId: string): Promise<TaskCompletionItem | undefined> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: completionKey(familyId, isoDate, taskId), ConsistentRead: true })
  );
  return existing.Item as TaskCompletionItem | undefined;
}

/**
 * Records a chore as done on a day, and pays out its gems. Doing it twice
 * pays once — and a one-off pays once, full stop, not once per date.
 */
async function completeTaskOnDay(familyId: string, task: TaskItem, isoDate: string): Promise<TaskForDay> {
  // A screen loaded before midnight still shows yesterday's finished
  // one-off as pending; tapping it after midnight sends today's date. The
  // completion key is per date, so without this it would pay a second time.
  if (task.recurrence === "none" && task.completedOn && task.completedOn !== isoDate) {
    throw new TaskConflict(`That chore was already done on ${task.completedOn}`);
  }

  const existing = await readCompletion(familyId, isoDate, task.taskId);
  if (existing) return toTaskForDay(task, isoDate, existing);

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

  // The completion row and the one-off's completedOn go in one transaction:
  // written separately, a failure between them left the chore showing as
  // pending with its gems already paid, ready to pay again. Only the
  // fields that change are written, so a parent's concurrent edit survives,
  // and a chore deleted meanwhile stays deleted.
  const taskWrite: TransactItem =
    task.recurrence === "none"
      ? {
          Update: {
            TableName: TABLE_NAME,
            Key: taskKey(familyId, task.taskId),
            UpdateExpression: "SET completedOn = :date, updatedAt = :now",
            ConditionExpression:
              "attribute_exists(PK) AND (attribute_not_exists(completedOn) OR attribute_type(completedOn, :nullType) OR completedOn = :date)",
            ExpressionAttributeValues: { ":date": isoDate, ":now": now, ":nullType": "NULL" },
          },
        }
      : {
          ConditionCheck: {
            TableName: TABLE_NAME,
            Key: taskKey(familyId, task.taskId),
            ConditionExpression: "attribute_exists(PK)",
          },
        };

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE_NAME, Item: completion, ConditionExpression: "attribute_not_exists(PK)" } },
          taskWrite,
        ],
      })
    );
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
    // Lost a race. A double-tap on the same day is still "done, paid once";
    // anything else is a change we shouldn't paper over.
    const [current, winner] = await Promise.all([
      readTask(familyId, task.taskId),
      readCompletion(familyId, isoDate, task.taskId),
    ]);
    if (winner) return toTaskForDay(current ?? task, isoDate, winner);
    if (!current) throw new TaskGone();
    throw new TaskConflict("That chore was just changed on another screen");
  }

  if (task.recurrence === "none") {
    return toTaskForDay({ ...task, completedOn: isoDate, updatedAt: now }, isoDate, completion);
  }
  return toTaskForDay(task, isoDate, completion);
}

/** What one child has right now: everything earned minus everything claimed. Read strongly consistent. */
async function memberBalance(familyId: string, memberId: string): Promise<number> {
  const [completions, claims] = await Promise.all([
    listCompletions(familyId, "0000-00-00", "9999-12-31", true),
    listRewardClaims(familyId, true),
  ]);
  const earned = completions
    .filter((completion) => completion.memberId === memberId)
    .reduce((sum, completion) => sum + completion.gemsAwarded, 0);
  const spent = claims.filter((claim) => claim.memberId === memberId).reduce((sum, claim) => sum + claim.gemCost, 0);
  return earned - spent;
}

/**
 * Un-ticks a chore for a day — the gems go back with it. Refused if those
 * gems have already been spent: a prize claimed with them can't be
 * un-claimed, and the balance must not go below zero.
 */
async function reopenTaskOnDay(familyId: string, task: TaskItem, isoDate: string): Promise<TaskForDay> {
  const done = await readCompletion(familyId, isoDate, task.taskId);
  const reopensOneOff = task.recurrence === "none" && task.completedOn === isoDate;
  if (!done && !reopensOneOff) return toTaskForDay(task, isoDate, undefined);

  const now = new Date().toISOString();
  const writes: TransactItem[] = [];
  if (done) {
    writes.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: completionKey(familyId, isoDate, task.taskId),
        ConditionExpression: "attribute_exists(PK)",
      },
    });
    if (done.memberId && done.gemsAwarded > 0) {
      // Version first, then balance: the version bump below is what makes a
      // prize claimed between this check and the delete cancel one of them.
      const version = await readLedgerVersion(familyId, done.memberId);
      const balance = await memberBalance(familyId, done.memberId);
      if (balance - done.gemsAwarded < 0) {
        throw new TaskConflict("Those gems have already been spent on a prize, so this chore can't be un-ticked");
      }
      writes.push(bumpLedgerVersion(familyId, done.memberId, version));
    }
  }
  if (reopensOneOff) {
    writes.push({
      Update: {
        TableName: TABLE_NAME,
        Key: taskKey(familyId, task.taskId),
        UpdateExpression: "SET completedOn = :null, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK) AND completedOn = :date",
        ExpressionAttributeValues: { ":null": null, ":now": now, ":date": isoDate },
      },
    });
  }

  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: writes }));
  } catch (err) {
    if (isTransactionCanceled(err)) throw new TaskConflict("That chore was just changed on another screen");
    throw err;
  }

  if (reopensOneOff) return toTaskForDay({ ...task, completedOn: null, updatedAt: now }, isoDate, undefined);
  return toTaskForDay(task, isoDate, undefined);
}

/**
 * Edits the chore itself — its title, value, who it's for, how often it
 * comes back. Writes only the fields being changed, never the whole item
 * from an earlier read: a whole-item put would reset completedOn under a
 * child who just ticked the chore off (so it pays again), undo a
 * concurrent edit, or bring back a chore deleted a moment ago.
 */
async function updateDefinition(familyId: string, task: TaskItem, patch: TaskPatch, isoDate: string): Promise<TaskForDay> {
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  const assign = (field: keyof TaskItem, value: unknown) => {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  };
  // Checked against undefined rather than merged with `??`: `assignedTo:
  // null` means "nobody in particular", which a `??` merge would read as
  // "leave it".
  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.assignedTo !== undefined) assign("assignedTo", patch.assignedTo);
  if (patch.dueDate !== undefined) assign("dueDate", patch.dueDate);
  if (patch.gemValue !== undefined) assign("gemValue", patch.gemValue);
  if (patch.dueWindow !== undefined) assign("dueWindow", patch.dueWindow);
  if (patch.recurrence !== undefined) assign("recurrence", patch.recurrence);

  let updated: TaskItem;
  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: taskKey(familyId, task.taskId),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    if (!result.Attributes) throw new TaskGone();
    updated = result.Attributes as TaskItem;
  } catch (err) {
    if (isConditionFailed(err)) throw new TaskGone();
    throw err;
  }

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
 * back to the UTC date only when a caller says nothing at all. A date that
 * isn't a real one ("2026-02-31") is refused rather than guessed at.
 */
function requestedDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = IsoDate.safeParse(value);
  if (!parsed.success) throw new ValidationError("date must be a real calendar date (YYYY-MM-DD)");
  return parsed.data;
}

function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days)).toISOString().slice(0, 10);
}

/**
 * Why a chore can't be ticked off on this date, if it can't. The screen
 * always sends its own today; anything else is a stale or hand-built
 * request. A day either side of the UTC dates is allowed, because the
 * caller's local date can sit a day off UTC in either direction.
 */
function tickDateProblem(task: TaskItem, isoDate: string): string | null {
  if (isoDate < shiftDate(task.createdAt.slice(0, 10), -1)) return "That chore didn't exist yet on that day";
  if (isoDate > shiftDate(new Date().toISOString().slice(0, 10), 1)) return "That day hasn't happened yet";
  return null;
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
        if (patch.status === "done") {
          const problem = tickDateProblem(task, isoDate);
          if (problem) return badRequest(problem);
          return ok(await completeTaskOnDay(familyId, task, isoDate));
        }
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
    if (err instanceof TaskConflict) return conflict(err.message);
    if (err instanceof TaskGone) return notFound("Task not found");
    return serverError(err);
  }
};
