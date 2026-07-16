type RuntimeMode = "development" | "production" | "test";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizedOrigin(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Cookie-authenticated writes are browser-only APIs. Require an exact Origin
 * match (or same-origin Fetch Metadata) so another site cannot submit a write
 * with the visitor's Supabase session cookies.
 */
export function isTrustedMutationRequest(
  request: Request,
  mode: RuntimeMode = process.env.NODE_ENV as RuntimeMode
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const requestOrigin = normalizedOrigin(request.url);
  const suppliedOrigin = normalizedOrigin(request.headers.get("origin"));
  if (request.headers.has("origin")) {
    return Boolean(requestOrigin && suppliedOrigin && requestOrigin === suppliedOrigin);
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite) return fetchSite === "same-origin";

  // Browsers send Origin or Sec-Fetch-Site for these fetch mutations. Keep
  // headerless test/dev requests usable, but fail closed in production.
  return mode !== "production";
}

export function rejectCrossSiteMutation(request: Request): Response | null {
  if (isTrustedMutationRequest(request)) return null;
  return Response.json(
    { error: "Cross-site request blocked." },
    { status: 403, headers: { "Cache-Control": "private, no-store" } }
  );
}
