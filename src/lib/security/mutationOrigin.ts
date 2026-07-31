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
 * The host the visitor's browser addressed, as recorded by the CDN.
 *
 * `request.url` is NOT that host behind Netlify's proxy — the function runtime
 * reconstructs it from internal routing, so an exact `Origin === request.url
 * origin` comparison rejected every legitimate browser write in production
 * (403 "Cross-site request blocked" on posts, comments, likes, tips and poll
 * votes — while curl requests without an Origin header sailed through on the
 * Fetch-Metadata branch). Browsers always send Origin on cookie-bearing
 * mutations, so the strictest-looking branch was the one silently killing the
 * community. `x-forwarded-host` is stamped by the CDN, not the client, which
 * makes it the right anchor: a cross-site attacker controls neither it nor
 * their own Origin header.
 */
function requestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded;
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (host) return host;
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Cookie-authenticated writes are browser-only APIs. Require the Origin header
 * to match the CDN-recorded request host (or same-origin Fetch Metadata) so
 * another site cannot submit a write with the visitor's session cookies.
 */
export function isTrustedMutationRequest(
  request: Request,
  mode: RuntimeMode = process.env.NODE_ENV as RuntimeMode
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  if (request.headers.has("origin")) {
    const suppliedOrigin = normalizedOrigin(request.headers.get("origin"));
    if (!suppliedOrigin) return false;
    // A production origin must be secure; HSTS makes plain-http same-host
    // origins an attack shape, not a user.
    if (mode === "production" && !suppliedOrigin.startsWith("https:")) return false;
    const host = requestHost(request);
    let suppliedHost: string;
    try {
      suppliedHost = new URL(suppliedOrigin).host.toLowerCase();
    } catch {
      return false;
    }
    return Boolean(host && suppliedHost === host);
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
