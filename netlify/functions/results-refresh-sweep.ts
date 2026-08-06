import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Scheduled halves receive no inbound headers, so there is no token here to
 * verify — checking one would reject every tick. Authorization belongs on the
 * worker half, which this calls with the schedule token. That split is not
 * stylistic: adding an inbound check to a sweep froze the projection refresh
 * for eight and a half hours on 2026-08-02.
 */
export default async function resultsRefreshSweep(_request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Results refresh scheduling needs the site URL and admin token." }, { status: 503 });
  try {
    const response = await fetch(new URL("/.netlify/functions/results-refresh-worker-background", siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(10_000)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Results refresh worker request failed." }, { status: 504 });
  }
}

// Four times a day, not hourly, and at :20 because the provider-run lock is
// global — :00/:30 football settlement, :05/:35 decision cycles, :15 results
// settlement, :25/:55 sports intelligence, :40 outcome ledger, :50 multi-sport
// settlement. A colliding start is simply skipped as "pipeline busy".
//
// Four rather than twenty-four is a quota decision. api-basketball's Free tier
// allows 100 requests a day and is the only real ceiling we have; a three-day
// lookback costs one call per (day, sport), so hourly would spend 72 basketball
// calls a day on this job alone. Four passes cost 12 and still pick up a match
// that finished at 23:00 within a few hours.
export const config: Config = { schedule: "20 2,8,14,20 * * *" };
