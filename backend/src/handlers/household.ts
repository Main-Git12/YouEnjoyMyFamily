import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "../lib/dynamoClient";
import { queryAll } from "../lib/queryAll";
import { ok, badRequest, notFound, serverError } from "../lib/response";
import { parseBody, ValidationError } from "../lib/validation";
import { authenticateFamily } from "../lib/auth";
import {
  HouseholdMemberInput,
  HouseholdJobInput,
  type HouseholdMemberItem,
  type HouseholdJobItem,
} from "../types";

/**
 * The household roster, and the standing jobs that keep the house running.
 *
 * One handler because they are one question asked twice — who is here, and
 * who carries what — and they are always read together.
 *
 * Sort-key prefixes are `MEMBER#` and `HOUSEJOB#`. Deliberately not
 * `HOUSEHOLD#` and `HOUSEHOLDJOB#`: a `begins_with` on the shorter of that
 * pair is one character away from matching the longer, and this repo has
 * already documented that trap once (see routines.ts). Two prefixes that
 * share no leading run of letters cannot collide however the query is
 * written.
 */
const memberKey = (familyId: string, memberId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `MEMBER#${memberId}`,
});

const jobKey = (familyId: string, jobId: string) => ({
  PK: `FAMILY#${familyId}`,
  SK: `HOUSEJOB#${jobId}`,
});

/** Exported so a test can check the two namespaces really cannot overlap. */
export const householdSortKeys = { memberKey, jobKey };

async function listMembers(familyId: string): Promise<HouseholdMemberItem[]> {
  const members = await queryAll<HouseholdMemberItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "MEMBER#" },
  });
  // Adults first, then children, each alphabetical. Not a ranking: the two
  // groups are read for different reasons, and a roster that interleaves
  // them makes the one thing `role` exists to say harder to see.
  return members.sort(
    (a, b) => a.role.localeCompare(b.role) || a.displayName.localeCompare(b.displayName)
  );
}

async function listJobs(familyId: string): Promise<HouseholdJobItem[]> {
  const jobs = await queryAll<HouseholdJobItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": `FAMILY#${familyId}`, ":prefix": "HOUSEJOB#" },
  });
  // Unclaimed jobs first. A job nobody has taken is the only row on this
  // list that is asking the family for something.
  return jobs.sort((a, b) => {
    if ((a.ownerId === null) !== (b.ownerId === null)) return a.ownerId === null ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Upsert, not create-then-update: there is one row per person and one per
 * job, and correcting a spelling is not adding a second grandmother.
 * `createdAt` survives an edit for the same reason it does everywhere else
 * in this codebase — it is the only record of when something entered the
 * household's life.
 */
async function saveMember(
  familyId: string,
  memberId: string,
  input: HouseholdMemberInput
): Promise<HouseholdMemberItem> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: memberKey(familyId, memberId) })
  );
  const current = existing.Item as HouseholdMemberItem | undefined;
  const now = new Date().toISOString();

  const item: HouseholdMemberItem = {
    ...memberKey(familyId, memberId),
    entityType: "HOUSEHOLD_MEMBER",
    familyId,
    memberId,
    displayName: input.displayName.trim(),
    role: input.role,
    note: input.note?.trim() || null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function saveJob(
  familyId: string,
  jobId: string,
  input: HouseholdJobInput
): Promise<HouseholdJobItem> {
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: jobKey(familyId, jobId) })
  );
  const current = existing.Item as HouseholdJobItem | undefined;
  const now = new Date().toISOString();

  const item: HouseholdJobItem = {
    ...jobKey(familyId, jobId),
    entityType: "HOUSEHOLD_JOB",
    familyId,
    jobId,
    title: input.title.trim(),
    kind: input.kind,
    // An explicit null is "nobody has this", which is different from the
    // field being absent, so it is checked against undefined rather than
    // merged with `??` — the same rule tasks.ts follows for assignedTo.
    ownerId: input.ownerId !== undefined ? input.ownerId?.trim() || null : (current?.ownerId ?? null),
    note: input.note?.trim() || null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const { familyId, memberId, jobId } = event.pathParameters ?? {};
  const method = event.requestContext.http.method;
  const isJobRoute = event.rawPath.includes("/household/jobs");

  try {
    if (!familyId) return badRequest("familyId is required");
    const authError = await authenticateFamily(event, familyId);
    if (authError) return authError;

    if (isJobRoute) {
      switch (method) {
        case "PUT": {
          if (!jobId) return badRequest("jobId is required");
          return ok(await saveJob(familyId, jobId, parseBody(HouseholdJobInput, event.body)));
        }
        case "DELETE": {
          if (!jobId) return badRequest("jobId is required");
          const existing = await docClient.send(
            new GetCommand({ TableName: TABLE_NAME, Key: jobKey(familyId, jobId) })
          );
          if (!existing.Item) return notFound("Job not found");
          await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: jobKey(familyId, jobId) }));
          return ok({ deleted: jobId });
        }
        default:
          return badRequest(`Unsupported method: ${method}`);
      }
    }

    switch (method) {
      case "GET": {
        // Read together because they are only ever useful together: a job
        // list without the roster cannot say whether "Sheliah" is somebody
        // in this house or a name somebody mistyped.
        const [members, jobs] = await Promise.all([listMembers(familyId), listJobs(familyId)]);
        return ok({ members, jobs });
      }
      case "PUT": {
        if (!memberId) return badRequest("memberId is required");
        return ok(await saveMember(familyId, memberId, parseBody(HouseholdMemberInput, event.body)));
      }
      case "DELETE": {
        if (!memberId) return badRequest("memberId is required");
        const existing = await docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: memberKey(familyId, memberId) })
        );
        if (!existing.Item) return notFound("Household member not found");
        await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: memberKey(familyId, memberId) }));
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
