import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export default async function publicationSweep(_request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) {
    return Response.json({ success: false, error: "Publication scheduling needs the site URL and admin token." }, { status: 503 });
  }
  try {
    const response = await fetch(new URL("/.netlify/functions/publication-worker-background", siteUrl), {
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
      { success: false, error: error instanceof Error ? error.message : "Publication worker request failed." },
      { status: 504 }
    );
  }
}

// Hourly, at :10. Fixtures kick off all day, so publishing has to run all day:
// a pick is only a forecast while its kickoff is still ahead, and the ledger
// went four days without a row because nothing ever invoked the publisher.
//
// :10 is the free slot between the decision cycle (:05/:35) and results
// settlement (:15), which is the useful order — publish from the decisions the
// cycle has just written. The publisher never takes the global provider-run
// lock, so it cannot be skipped as "pipeline busy", but keeping out of the
// pipeline's minutes leaves the database quiet for the jobs that do.
export const config: Config = { schedule: "10 * * * *" };
