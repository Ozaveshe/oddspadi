type DatabaseErrorLike = { code?: unknown; message?: unknown } | null | undefined;

function safeErrorCode(error: DatabaseErrorLike): string {
  const code = typeof error?.code === "string" ? error.code : "unknown";
  return /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
}

export function reportDatabaseError(operation: string, error: DatabaseErrorLike): void {
  console.error(`[database] ${operation} failed`, { code: safeErrorCode(error) });
}

export function isMissingDatabaseRelation(error: DatabaseErrorLike): boolean {
  const code = safeErrorCode(error);
  if (code === "42P01" || code === "PGRST205") return true;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("could not find the table") || message.includes("relation") && message.includes("does not exist");
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
