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

/**
 * Reads the body a chunk at a time and aborts as soon as the running byte count
 * passes the limit.
 *
 * `request.text()` buffers the whole body first and only then measures it, so a
 * chunked upload with no (or a lying) `Content-Length` was fully materialised in
 * function memory before being rejected — the declared-length check it was
 * paired with is trivially skipped by omitting the header.
 */
async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
  if (!body) return "";

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let received = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Releasing the lock lets the runtime discard whatever is still queued
    // instead of leaving the stream pinned after an early return.
    reader.releaseLock();
  }

  return text + decoder.decode();
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

  let body: string | null;
  try {
    body = await readCappedText(request, maxBytes);
  } catch {
    return jsonError("Request body could not be read.", 400);
  }
  if (body === null) return jsonError("Request body is too large.", 413);

  try {
    return { ok: true, value: JSON.parse(body) as T };
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
}
