import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * The scheduled entrypoint. It holds no privileged logic and reaches nothing.
 *
 * A previous version of this file did the refresh itself *and* required an
 * inbound `x-oddspadi-schedule-token`. Netlify's scheduler invokes a scheduled
 * function with no such header — there is no caller to set one — so every tick
 * returned 401 before touching the database. Production stopped refreshing its
 * projections at the minute that check deployed and stayed frozen for eight and
 * a half hours, serving payloads built just before the deploy while the pages
 * reading them had no way to know.
 *
 * The security intent behind that check was right and is kept: the work is
 * authenticated in code, not merely shielded by the platform refusing external
 * invocation. It just belongs on the worker, which has a real caller to
 * authenticate. This half only forwards, exactly like the other ten sweeps.
 */
export default async function projectionRefreshSweep(_request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) {
    return Response.json(
      { success: false, error: "Projection refresh scheduling needs the site URL and admin token." },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(new URL("/.netlify/functions/projection-refresh-worker-background", siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(10_000)
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Projection refresh worker request failed." },
      { status: 504 }
    );
  }
}

// Every 5 minutes: fast enough that the live board stays inside its 3-minute
// freshness threshold most of the time, cheap enough to be irrelevant to load
// (the whole refresh measured ~416 ms).
export const config: Config = { schedule: "*/5 * * * *" };
