import type { ZodType } from "zod";

export class ValidationError extends Error {}

/** Parses and validates a Lambda event body against a zod schema, or throws ValidationError. */
export function parseBody<T>(schema: ZodType<T>, rawBody: string | undefined): T {
  let json: unknown;
  try {
    json = JSON.parse(rawBody ?? "{}");
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
