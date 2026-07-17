import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export default async function sportsIntelligenceSweep(_request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Sports intelligence scheduling needs the published site URL and ODDSPADI_ADMIN_TOKEN." }, { status: 503 });
  try {
    const response = await fetch(new URL("/.netlify/functions/sports-intelligence-worker-background", siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(10_000)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Sports intelligence worker request failed." }, { status: 504 });
  }
}

// Public decisions reject basketball prices after 45 minutes (football and
// tennis after 60), so the odds + daily-decision cycle must run more often
// than the narrowest freshness boundary. The worker itself keeps fixture
// import and weekly generation idempotently bounded to one full cycle a day.
export const config: Config = { schedule: "25,55 * * * *" };
