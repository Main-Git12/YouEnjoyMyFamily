import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import { ok, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { SchoolPrepInput, type SchoolPrepItem } from "../types";

/**
 * "The library book is in the bag" — one row per child per day.
 *
 * There are now three sort-key prefixes beginning with the word SCHOOL, and
 * they have to be read carefully rather than trusted:
 *
 *   SCHOOL#<memberId>              the child's school and specials rotation
 *   SCHOOLMENU#<menuId>#<month>    a cached month of published lunches
 *   SCHOOLPREP#<isoDate>#<member>  this: what got ticked off, and when
 *
 * None of them is a prefix of another, because each ends its own word with
 * a `#` and the next byte in the others is a letter. That is checked by a
 * test rather than asserted here, since a prefix query that quietly returns
 * a neighbour's rows reads as missing data rather than as an error.
 *
 * Date first in the sort key, member second — the opposite of the profile
 * row. Reads here are always "what was ticked over this date range", the
 * same shape as task completions, and putting the date first is what makes
 * that a range query instead of a scan.
 */
const prepKey = (familyId: string, isoDate: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHOOLPREP#${isoDate}#${memberId}`,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bounded with `||` rather than `??`, because an omitted query parameter
 * arrives as an empty string, and `SCHOOLPREP#` with nothing after it sorts
 * below every real key — the range would be built correctly and return
 * nothing at all. The same trap the schedules and routine-run handlers note.
 */
async function listPrep(familyId: string, start?: string, end?: string): Promise<SchoolPrepItem[]> {
  return queryAll<SchoolPrepItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": `FAMILY#${familyId}`,
      ":from": `SCHOOLPREP#${start || "0000-00-00"}`,
      ":to": `SCHOOLPREP#${end || "9999-12-31"}#￿`,
    },
  });
}

/**
 * Idempotent, and deliberately keeps the first `packedAt` rather than
 * bumping it. Two taps on a kitchen screen — or a tap plus the retry after
 * a dropped response — must not move the time somebody said it was done.
 */
async function markPacked(
  familyId: string,
  memberId: string,
  date: string,
  input: SchoolPrepInput
): Promise<SchoolPrepItem> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: prepKey(familyId, date, memberId) })
  );
  const current = existing.Item as SchoolPrepItem | undefined;

  const item: SchoolPrepItem = {
    ...prepKey(familyId, date, memberId),
    entityType: "SCHOOL_PREP",
    familyId,
    memberId,
    date,
    subject: input.subject.trim(),
    note: input.note?.trim() || null,
    packedAt: current?.packedAt ?? new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId, date } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (method === "GET") return ok(await listPrep(familyId, query.start, query.end));

    if (!memberId) return badRequest("memberId is required");
    if (!date || !ISO_DATE.test(date)) return badRequest("date must be YYYY-MM-DD");

    switch (method) {
      case "PUT":
        return ok(await markPacked(familyId, memberId, date, parseBody(SchoolPrepInput, event.body)));
      case "DELETE": {
        // Un-ticking is a first-class action, not an edge case. Somebody will
        // tap it on the wrong child, and a screen that cannot take a tap back
        // is one people stop tapping.
        const existing = await docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: prepKey(familyId, date, memberId) })
        );
        if (!existing.Item) return notFound("Nothing was ticked off for that day");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: prepKey(familyId, date, memberId) })
        );
        return ok({ deleted: { memberId, date } });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
