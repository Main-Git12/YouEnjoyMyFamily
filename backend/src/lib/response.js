const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function ok(body) {
  return json(200, body);
}

function created(body) {
  return json(201, body);
}

function badRequest(message) {
  return json(400, { error: message });
}

function notFound(message = "Not found") {
  return json(404, { error: message });
}

function serverError(err) {
  console.error(err);
  return json(500, { error: "Internal server error" });
}

module.exports = { ok, created, badRequest, notFound, serverError };
