import { safeTokenMatches } from "./_shared/scheduleAuth";
import type { Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export default async function opsCaseSyncWorker(request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Case sync worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !safeTokenMatches(token, supplied)) return Response.json({ success: false, error: "Case sync worker authorization failed." }, { status: 401 });
  try {
    const response = await fetch(new URL("/api/ops/cases/sync", siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-oddspadi-admin-token": token },
      body: "{}",
      signal: AbortSignal.timeout(2 * 60_000)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Case sync run failed." }, { status: 504 });
  }
}
