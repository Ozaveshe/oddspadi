import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function resultsSettlementWorker(request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Results settlement worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(token, supplied)) return Response.json({ success: false, error: "Results settlement worker authorization failed." }, { status: 401 });
  try {
    const endpoint = new URL("/api/cron/settle-results", siteUrl);
    endpoint.searchParams.set("limit", clean(Netlify.env.get("ODDSPADI_RESULTS_SETTLEMENT_LIMIT")) ?? "500");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(8 * 60_000)
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Results settlement failed." }, { status: 504 });
  }
}
