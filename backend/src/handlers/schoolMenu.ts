import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { ok, badRequest, notFound, serverError } from "../lib/response";
import { authenticateFamily } from "../lib/auth";
import { fetchMenuMonth, monthsBetween, type MenuFetch } from "../lib/schoolMenu";
import type { SchoolMenuDay, SchoolMenuMonthItem, SchoolProfileItem, SchoolMenuSourceInput } from "../types";

/**
 * The school lunch menu, read through a cache.
 *
 * The provider publishes a month at a time and changes it rarely, so this
 * reads DynamoDB first and only goes out to the network when what it has is
 * older than `CACHE_TTL_MS`. The cache is not a performance trick — it is
 * what makes the answer survive the provider being down, which for a screen
 * on a kitchen wall matters more than being an hour fresher. A month that
 * cannot be refreshed is served from the last copy and flagged `stale`, and
 * the screen says so rather than silently showing last month's Tuesday.
 */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const menuKey = (familyId: string, menuId: number, month: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHOOLMENU#${menuId}#${month}`,
});

const profileKey = (familyId: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `SCHOOL#${memberId}`,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SchoolMenuResponse {
  memberId: string;
  schoolName: string;
  menuId: number;
  /** School days only, within the requested range. Closed days are simply absent. */
  days: SchoolMenuDay[];
  /** True when any month served came from the cache because a refresh failed. */
  stale: boolean;
  /** The oldest read across the months served — how out of date the worst of it is. */
  fetchedAt: string | null;
  /** Months that could be neither fetched nor served from cache. */
  missingMonths: string[];
}

interface MonthOutcome {
  days: SchoolMenuDay[];
  fetchedAt: string | null;
  stale: boolean;
  missing: boolean;
}

/**
 * One month, preferring fresh and falling back to stored.
 *
 * Note the order: the stored row is read first, and the network is only
 * touched if it is missing or past its TTL. A provider that is merely slow
 * therefore costs nothing on the common path.
 */
async function monthFor(
  familyId: string,
  source: SchoolMenuSourceInput,
  month: string,
  fetchImpl: MenuFetch
): Promise<MonthOutcome> {
  const stored = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: menuKey(familyId, source.menuId, month) })
  );
  const cached = stored.Item as SchoolMenuMonthItem | undefined;
  const fresh = cached ? Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS : false;
  if (cached && fresh) {
    return { days: cached.days, fetchedAt: cached.fetchedAt, stale: false, missing: false };
  }

  try {
    const { days, closed, unreadable } = await fetchMenuMonth(source, month, fetchImpl);
    if (unreadable > 0) {
      // Not fatal — the readable days are still worth showing — but it means
      // the provider's shape has moved, and that is worth finding in a log
      // before it becomes every day rather than three.
      console.error(`SchoolMenu: ${unreadable} unreadable day(s) in menu ${source.menuId} ${month}`);
    }
    const fetchedAt = new Date().toISOString();
    const item: SchoolMenuMonthItem = {
      ...menuKey(familyId, source.menuId, month),
      entityType: "SCHOOL_MENU_MONTH",
      familyId,
      menuId: source.menuId,
      month,
      days,
      fetchedAt,
    };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`SchoolMenu: refreshed ${month} — ${days.length} days, ${closed} closed`);
    return { days, fetchedAt, stale: false, missing: false };
  } catch (err) {
    console.error(`SchoolMenu: could not refresh menu ${source.menuId} ${month}`, err);
    if (cached) return { days: cached.days, fetchedAt: cached.fetchedAt, stale: true, missing: false };
    return { days: [], fetchedAt: null, stale: true, missing: true };
  }
}

/**
 * Exported separately from `handler` so tests can inject a fake fetch —
 * Lambda invokes `handler` as `(event, context, callback)`, so a dependency
 * living in the handler's own parameter list would be overwritten by a real
 * invocation. Same reason `runCalendarSync` exists next door.
 */
export async function getSchoolMenu(
  familyId: string,
  memberId: string,
  start: string,
  end: string,
  fetchImpl: MenuFetch = fetch
): Promise<SchoolMenuResponse | null> {
  const stored = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: profileKey(familyId, memberId) })
  );
  const profile = stored.Item as SchoolProfileItem | undefined;
  if (!profile?.menuSource) return null;
  const source = profile.menuSource;

  const outcomes: MonthOutcome[] = [];
  for (const month of monthsBetween(start, end)) {
    outcomes.push(await monthFor(familyId, source, month, fetchImpl));
  }

  const days = outcomes
    .flatMap((outcome) => outcome.days)
    .filter((day) => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const fetchedAts = outcomes
    .map((outcome) => outcome.fetchedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    memberId,
    schoolName: profile.schoolName,
    menuId: source.menuId,
    days,
    stale: outcomes.some((outcome) => outcome.stale),
    fetchedAt: fetchedAts[0] ?? null,
    missingMonths: monthsBetween(start, end).filter((_, index) => outcomes[index]?.missing === true),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const query = event.queryStringParameters ?? {};

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;
    if (method !== "GET") return badRequest(`Unsupported method: ${method}`);

    const { memberId, start, end } = query;
    if (!memberId) return badRequest("memberId is required");
    // Required rather than defaulted, because a default range would be this
    // Lambda deciding what "the menu" means, and the caller already knows
    // which week it is showing.
    if (!start || !ISO_DATE.test(start)) return badRequest("start must be YYYY-MM-DD");
    if (!end || !ISO_DATE.test(end)) return badRequest("end must be YYYY-MM-DD");
    if (end < start) return badRequest("end must not be before start");

    const menu = await getSchoolMenu(familyId, memberId, start, end);
    return menu ? ok(menu) : notFound("No published menu is configured for this child");
  } catch (err) {
    return serverError(err);
  }
};
