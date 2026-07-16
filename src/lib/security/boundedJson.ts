type BoundedJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function jsonError(error: string, status: number): BoundedJsonResult<never> {
  return {
    ok: false,
    response: Response.json(
      { error },
      { status, headers: { "Cache-Control": "private, no-store" } }
    )
  };
}

/** Reads a small JSON request with both declared and measured byte limits. */
export async function readBoundedJson<T = unknown>(
  request: Request,
  maxBytes: number
): Promise<BoundedJsonResult<T>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return jsonError("Expected an application/json request.", 415);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return jsonError("Invalid Content-Length header.", 400);
    if (bytes > maxBytes) return jsonError("Request body is too large.", 413);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) return jsonError("Request body is too large.", 413);

  try {
    return { ok: true, value: JSON.parse(body) as T };
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
}
