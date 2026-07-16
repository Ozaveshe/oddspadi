type DatabaseErrorLike = { code?: unknown } | null | undefined;

function safeErrorCode(error: DatabaseErrorLike): string {
  const code = typeof error?.code === "string" ? error.code : "unknown";
  return /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
}

export function reportDatabaseError(operation: string, error: DatabaseErrorLike): void {
  console.error(`[database] ${operation} failed`, { code: safeErrorCode(error) });
}

export function databaseUnavailable(
  operation: string,
  error: DatabaseErrorLike,
  message: string
): Response {
  reportDatabaseError(operation, error);
  return Response.json(
    { error: message },
    { status: 503, headers: { "Cache-Control": "private, no-store" } }
  );
}
