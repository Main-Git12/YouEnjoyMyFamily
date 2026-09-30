import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import { ok, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import { SchoolProfileInput, type SchoolProfileItem, type SchoolSpecial } from "../types";

/**
 * One row per child: the school, the specials rotation, and which published
 * menu is theirs. Everything on it was typed in by a parent off the sheet
 * the school sent home — nothing here is guessed, and nothing is fetched to
 * fill it in.
 *
 * The sort key is `SCHOOL#<memberId>`, and the cached menus next door are
 * `SCHOOLMENU#<menuId>#<month>`. Those two do not collide under
 * `begins_with`: the prefix "SCHOOL#" ends in a `#`, and "SCHOOLMENU#..."
 * has an `M` in that position. It is worth checking rather than assuming —
 * a prefix query that quietly returns a neighbouring entity's rows is the
 * sort of bug that reads as missing data rather than as an error.
 */
const profileKey = (familyId: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHOOL#${memberId}`,
});

/**
 * Sorted and de-duplicated on write, last-one-wins, exactly as
 * `RoutineInput.daysOfWeek` is. A rotation listing Tuesday twice would be
 * answered correctly by "what is on today" and read wrong by everything
 * else, and the screen that shows the week would show two Tuesdays.
 */
function toStoredSpecials(specials: SchoolProfileInput["specials"]): SchoolSpecial[] {
  const byDay = new Map<number, SchoolSpecial>();
  for (const special of specials) {
    const prepNote = special.prepNote?.trim();
    byDay.set(special.dayOfWeek, {
      dayOfWeek: special.dayOfWeek,
      subject: special.subject.trim(),
      // An empty note and no note are the same thing to a parent, and
      // storing "" would put an empty line under Friday on the screen.
      prepNote: prepNote ? prepNote : null,
    });
  }
  return [...byDay.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

async function listProfiles(familyId: string): Promise<SchoolProfileItem[]> {
  return queryAll<SchoolProfileItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "SCHOOL#" },
  });
}

/**
 * Upsert rather than create/update, because there is exactly one of these
 * per child and a parent editing the sheet is not creating a second school.
 * `createdAt` is carried over when one already exists.
 */
async function saveProfile(
  familyId: string,
  memberId: string,
  input: SchoolProfileInput
): Promise<SchoolProfileItem> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: profileKey(familyId, memberId) })
  );
  const current = existing.Item as SchoolProfileItem | undefined;
  const now = new Date().toISOString();

  const item: SchoolProfileItem = {
    ...profileKey(familyId, memberId),
    entityType: "SCHOOL_PROFILE",
    familyId,
    memberId,
    schoolName: input.schoolName.trim(),
    teacher: input.teacher?.trim() || null,
    gradeLabel: input.gradeLabel?.trim() || null,
    specials: toStoredSpecials(input.specials),
    menuSource: input.menuSource ?? null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    switch (method) {
      case "GET":
        return ok(await listProfiles(familyId));
      case "PUT": {
        if (!memberId) return badRequest("memberId is required");
        return ok(await saveProfile(familyId, memberId, parseBody(SchoolProfileInput, event.body)));
      }
      case "DELETE": {
        if (!memberId) return badRequest("memberId is required");
        const existing = await docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: profileKey(familyId, memberId) })
        );
        if (!existing.Item) return notFound("School profile not found");
        await docClient.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: profileKey(familyId, memberId) })
        );
        return ok({ deleted: memberId });
      }
      default:
        return badRequest(`Unsupported method: ${method}`);
    }
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(err.message);
    return serverError(err);
  }
};
