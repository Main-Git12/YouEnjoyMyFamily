import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, created, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import {
  RoutineInput,
  RoutinePatch,
  RoutineRunInput,
  type RoutineItem,
  type RoutineRunItem,
  type RoutineStep,
  type RoutineStepInput,
} from "../types";

/**
 * Note the sort-key prefixes: `ROUTINE#` for definitions and `RUN#` for the
 * per-day records. The obvious pairing — `ROUTINE#` and `ROUTINERUN#` —
 * cannot be used, because `begins_with(SK, "ROUTINE#")` would match every
 * run row as well and a family's routine list would fill up with history.
 */
const routineKey = (familyId: string, routineId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `ROUTINE#${routineId}`,
});

const runKey = (familyId: string, isoDate: string, routineId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `RUN#${isoDate}#${routineId}`,
});

/** Step ids are assigned here; callers describe steps by title and duration. */
function toStoredSteps(steps: RoutineStepInput[]): RoutineStep[] {
  return steps.map((step) => ({
    stepId: ulid(),
    title: step.title,
    targetMinutes: step.targetMinutes,
    memberId: step.memberId ?? null,
  }));
}

async function listRoutines(familyId: string): Promise<RoutineItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "ROUTINE#" },
    })
  );
  return (result.Items ?? []) as RoutineItem[];
}

async function createRoutine(familyId: string, input: RoutineInput): Promise<RoutineItem> {
  const routineId = ulid();
  const now = new Date().toISOString();
  const item: RoutineItem = {
    ...routineKey(familyId, routineId),
    entityType: "ROUTINE",
    familyId,
    routineId,
    name: input.name,
    kind: input.kind,
    anchorTime: input.anchorTime,
    // Sorted and de-duplicated here rather than trusted as sent: the days a
    // routine runs on is asked as "does today's number appear", and a list
    // holding 1 twice would be answered right but read wrong everywhere else.
    daysOfWeek: [...new Set(input.daysOfWeek)].sort((a, b) => a - b),
    steps: toStoredSteps(input.steps),
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

/**
 * Merged field by field rather than spread — `active: false` means "stop
 * running this", and a `||` merge would quietly turn that back into `true`.
 * (`??` would be correct here, but only by luck: it stops being correct the
 * moment a falsy non-nullish value like `0` or `""` is a real answer, which
 * is why every field below is written the same explicit way.)
 */
async function updateRoutine(
  familyId: string,
  routineId: string,
  patch: RoutinePatch
): Promise<RoutineItem | null> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: routineKey(familyId, routineId) })
  );
  if (!existing.Item) return null;
  const current = existing.Item as RoutineItem;

  const updated: RoutineItem = {
    ...routineKey(familyId, routineId),
    entityType: "ROUTINE",
    familyId,
    routineId,
    name: patch.name ?? current.name,
    kind: patch.kind ?? current.kind,
    anchorTime: patch.anchorTime ?? current.anchorTime,
    daysOfWeek: patch.daysOfWeek
      ? [...new Set(patch.daysOfWeek)].sort((a, b) => a - b)
      : current.daysOfWeek,
    steps: patch.steps ? toStoredSteps(patch.steps) : current.steps,
    active: patch.active !== undefined ? patch.active : current.active,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));
  return updated;
}

/**
 * A date range of past runs — what the learned step durations are computed
 * from. Bounded the same way schedules are: `||` rather than `??`, because
 * an omitted query param arrives as an empty string and would build a range
 * that sorts below every real key and return nothing.
 */
async function listRuns(familyId: string, start?: string, end?: string): Promise<RoutineRunItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": `FAMILY#${familyId}`,
        ":from": `RUN#${start || "0000-00-00"}`,
        ":to": `RUN#${end || "9999-12-31"}#￿`,
      },
    })
  );
  return (result.Items ?? []) as RoutineRunItem[];
}

/**
 * One row per routine per day, replaced wholesale as the morning
 * progresses. Idempotent by construction: the screen sends the run as it
 * currently stands, so a retry after a dropped response writes the same
 * thing rather than double-recording a step.
 */
async function saveRun(
  familyId: string,
  routineId: string,
  input: RoutineRunInput
): Promise<RoutineRunItem> {
  const item: RoutineRunItem = {
    ...runKey(familyId, input.date, routineId),
    entityType: "ROUTINE_RUN",
    familyId,
    routineId,
    date: input.date,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    steps: input.steps.map((step) => ({
      stepId: step.stepId,
      title: step.title,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    })),
    updatedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, routineId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};
  // `/routines/{routineId}/runs` and `/routines/{routineId}` share a handler,
  // so the path decides which resource the verb applies to.
  const isRuns = event.rawPath.endsWith("/runs");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (isRuns) {
      if (!routineId) return badRequest("routineId is required");
      switch (method) {
        case "GET":
          return ok((await listRuns(familyId, query.start, query.end)).filter((run) => run.routineId === routineId));
        case "PUT":
          return ok(await saveRun(familyId, routineId, parseBody(RoutineRunInput, event.body)));
        default:
          return badRequest(`Unsupported method: ${method}`);
      }
    }

    switch (method) {
      case "GET":
        return ok(await listRoutines(familyId));
      case "POST":
        return created(await createRoutine(familyId, parseBody(RoutineInput, event.body)));
      case "PUT": {
        if (!routineId) return badRequest("routineId is required");
        const updated = await updateRoutine(familyId, routineId, parseBody(RoutinePatch, event.body));
        return updated ? ok(updated) : notFound("Routine not found");
      }
      case "DELETE": {
        if (!routineId) return badRequest("routineId is required");
        await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: routineKey(familyId, routineId) }));
        return ok({ deleted: routineId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
