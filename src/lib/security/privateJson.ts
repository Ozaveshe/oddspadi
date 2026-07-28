/**
 * Response headers for anything derived from the visitor's Supabase session.
 *
 * These routes read cookie-scoped state — the viewer's likes, their poll
 * choice, their team search, their own posts — and previously returned it with
 * no cache directive at all. A shared cache in front of the origin is then free
 * to store one visitor's response and replay it to the next, and without
 * `Vary: Cookie` it would not even key on the session. The mutation helpers
 * already emitted `private, no-store`; the reads never did.
 */
export const PRIVATE_JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie"
});

/** `Response.json` for a session-scoped payload. */
export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...PRIVATE_JSON_HEADERS, ...(init.headers ?? {}) }
  });
}
