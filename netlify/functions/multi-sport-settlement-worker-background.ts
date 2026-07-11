import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type LiveSport = "basketball" | "tennis";

export type MultiSportSettlementWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  limit?: string | null;
  fetchImpl?: FetchLike;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function bounded(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(250, parsed)) : 100;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function call(fetchImpl: FetchLike, endpoint: URL, token: string) {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(8 * 60_000)
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { ok: false, status: 504, body: { success: false, error: error instanceof Error ? error.message : "Settlement stage failed." } };
  }
}

export async function runMultiSportSettlementWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  limit,
  fetchImpl = fetch
}: MultiSportSettlementWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const supplied = clean(scheduleToken);
  if (!baseUrl || !token) return Response.json({ success: false, error: "Multi-sport settlement worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(token, supplied)) return Response.json({ success: false, error: "Multi-sport settlement worker authorization failed." }, { status: 401 });

  const safeLimit = bounded(limit);
  const sports: LiveSport[] = ["basketball", "tennis"];
  const results = [];
  for (const sport of sports) {
    const outcomeEndpoint = new URL("/api/sports/decision/autonomous-settlement", baseUrl);
    outcomeEndpoint.searchParams.set("sport", sport);
    outcomeEndpoint.searchParams.set("limit", String(safeLimit));
    const featureEndpoint = new URL("/api/sports/decision/training/multi-sport-live-settlement-label-receipt", baseUrl);
    featureEndpoint.searchParams.set("sport", sport);
    featureEndpoint.searchParams.set("limit", String(safeLimit));
    const autonomousOutcomes = await call(fetchImpl, outcomeEndpoint, token);
    const trainingLabels = await call(fetchImpl, featureEndpoint, token);
    results.push({ sport, autonomousOutcomes, trainingLabels });
  }
  const success = results.every((result) => result.autonomousOutcomes.ok && result.trainingLabels.ok);
  console.info(JSON.stringify({
    event: "oddspadi-scheduled-multi-sport-settlement",
    success,
    sports,
    failedStages: results.flatMap((result) => [result.autonomousOutcomes, result.trainingLabels]).filter((stage) => !stage.ok).length
  }));
  return Response.json(
    { success, mode: "scheduled-multi-sport-settlement", limit: safeLimit, results },
    { status: success ? 200 : 502 }
  );
}

export default async function multiSportSettlementWorker(request: Request, context: Context): Promise<Response> {
  return runMultiSportSettlementWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    limit: clean(Netlify.env.get("ODDSPADI_MULTISPORT_SETTLEMENT_LIMIT"))
  });
}
