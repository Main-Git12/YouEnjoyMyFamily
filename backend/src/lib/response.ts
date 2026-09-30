import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);
export const badRequest = (message: string) => json(400, { error: message });
export const unauthorized = (message = "Unauthorized") => json(401, { error: message });
export const notFound = (message = "Not found") => json(404, { error: message });
export const conflict = (message: string) => json(409, { error: message });

export function serverError(err: unknown): APIGatewayProxyStructuredResultV2 {
  console.error(err);
  return json(500, { error: "Internal server error" });
}
