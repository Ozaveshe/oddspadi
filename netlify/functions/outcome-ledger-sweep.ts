import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export default async function outcomeLedgerSweep(_request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Outcome ledger scheduling needs the site URL and admin token." }, { status: 503 });
  try {
    const response = await fetch(new URL("/.netlify/functions/outcome-ledger-worker-background", siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(10_000)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Outcome ledger worker request failed." }, { status: 504 });
  }
}

// :40 keeps clear of the decision cycles (:05/:35), results settlement (:15),
// sports intelligence (:25/:55), football settlement (:00/:30) and multi-sport
// settlement (:50), because the provider-run lock is global — a colliding
// start would just be skipped as "pipeline busy". The one overlap left is the
// daily corpus refresh at 03:40; a skipped pass there catches up at 04:40.
export const config: Config = { schedule: "40 * * * *" };
