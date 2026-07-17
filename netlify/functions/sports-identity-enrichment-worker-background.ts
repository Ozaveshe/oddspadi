import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { runUpcomingIdentityEnrichment } from "../../src/lib/sports/intelligence/identityEnrichment";

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

export default async function sportsIdentityEnrichmentWorker(request: Request, _context: Context): Promise<Response> {
  const expected = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!expected) return Response.json({ success: false, error: "Sports identity worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(expected, supplied)) return Response.json({ success: false, error: "Sports identity worker authorization failed." }, { status: 401 });

  const outcome = await runUpcomingIdentityEnrichment();
  console.info(JSON.stringify({ event: "oddspadi-sports-identity-enrichment", ...outcome }));
  if (outcome.skippedOverlap) {
    const unavailable = ["failed", "unavailable"].includes(outcome.run.status);
    return Response.json(outcome, { status: unavailable ? 503 : 409 });
  }
  return Response.json(outcome, { status: outcome.success ? 200 : outcome.run.status === "partial" ? 207 : 500 });
}
