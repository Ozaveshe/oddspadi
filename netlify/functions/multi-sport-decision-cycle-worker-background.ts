import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type LiveSport = "basketball" | "tennis";

export type MultiSportDecisionCycleWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  fixtureLimit?: string | null;
  aiReviewLimit?: string | null;
  horizonDays?: string | null;
  now?: Date;
  fetchImpl?: FetchLike;
};

type WorkerStage = {
  ok: boolean;
  status: number;
  body: unknown;
};

type MultiSportCycleResult = {
  date: string;
  sport: LiveSport;
  featureCapture: WorkerStage;
  decisionCycle: WorkerStage;
  aiBudgetRequested: number;
  aiCallsObserved: number;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function boundedInteger(value: string | null | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function observedAiCalls(body: unknown): number {
  const data = record(record(body).data);
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];
  const observedFromDecisions = decisions.filter((item) => {
    const ai = record(record(item).ai);
    return ai.requested === true && ai.status !== "reused";
  }).length;
  if (observedFromDecisions) return observedFromDecisions;
  const counts = record(data.counts);
  return (finiteInteger(counts.aiReviewed) ?? 0) + (finiteInteger(counts.aiFallbacks) ?? 0);
}

export function multiSportUtcDateWindow(now: Date, days: number): string[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function scheduledSportOrder(now: Date): LiveSport[] {
  return Math.floor(now.getUTCHours() / 2) % 2 === 0 ? ["basketball", "tennis"] : ["tennis", "basketball"];
}

async function callStage(fetchImpl: FetchLike, endpoint: URL, token: string, timeoutMs: number): Promise<WorkerStage> {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 504,
      body: { success: false, error: error instanceof Error ? error.message : "Scheduled multi-sport worker stage failed." }
    };
  }
}

export async function runMultiSportDecisionCycleWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  fixtureLimit,
  aiReviewLimit,
  horizonDays,
  now = new Date(),
  fetchImpl = fetch
}: MultiSportDecisionCycleWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const suppliedToken = clean(scheduleToken);
  if (!baseUrl || !token) return Response.json({ success: false, error: "Multi-sport decision cycle worker configuration is incomplete." }, { status: 503 });
  if (!suppliedToken || !tokenMatches(token, suppliedToken)) {
    return Response.json({ success: false, error: "Multi-sport decision cycle worker authorization failed." }, { status: 401 });
  }

  const dateWindow = multiSportUtcDateWindow(now, boundedInteger(horizonDays, 2, 1, 2));
  const boundedFixtureLimit = boundedInteger(fixtureLimit, 8, 1, 20);
  const totalAiBudget = boundedInteger(aiReviewLimit, 1, 0, 2);
  let remainingAiBudget = totalAiBudget;
  const sportOrder = scheduledSportOrder(now);
  const results: MultiSportCycleResult[] = [];

  for (const date of dateWindow) {
    for (const sport of sportOrder) {
      const featureEndpoint = new URL("/api/sports/decision/training/multi-sport-live-feature-storage-receipt", baseUrl);
      featureEndpoint.searchParams.set("sport", sport);
      featureEndpoint.searchParams.set("date", date);
      featureEndpoint.searchParams.set("limit", String(boundedFixtureLimit));
      featureEndpoint.searchParams.set("run", "1");
      featureEndpoint.searchParams.set("dryRun", "0");
      const featureCapture = await callStage(fetchImpl, featureEndpoint, token, 2 * 60_000);

      const aiBudgetRequested = remainingAiBudget;
      const decisionEndpoint = new URL("/api/sports/decision/autonomous-cycle", baseUrl);
      decisionEndpoint.searchParams.set("sport", sport);
      decisionEndpoint.searchParams.set("date", date);
      decisionEndpoint.searchParams.set("limit", String(boundedFixtureLimit));
      decisionEndpoint.searchParams.set("aiLimit", String(aiBudgetRequested));
      decisionEndpoint.searchParams.set("runAi", "1");
      decisionEndpoint.searchParams.set("persist", "1");
      const decisionCycle = await callStage(fetchImpl, decisionEndpoint, token, 3 * 60_000);
      const aiCallsObserved = decisionCycle.ok ? Math.min(aiBudgetRequested, observedAiCalls(decisionCycle.body)) : aiBudgetRequested;
      remainingAiBudget = Math.max(0, remainingAiBudget - aiCallsObserved);
      results.push({ date, sport, featureCapture, decisionCycle, aiBudgetRequested, aiCallsObserved });
    }
  }

  const success = results.every((result) => result.featureCapture.ok && result.decisionCycle.ok);
  const responseBody = {
    success,
    mode: "scheduled-multi-sport-intelligence-cycle",
    dateWindow,
    sportOrder,
    limits: {
      fixtureLimitPerSportDate: boundedFixtureLimit,
      totalAiReviewLimit: totalAiBudget,
      aiCallsObserved: totalAiBudget - remainingAiBudget
    },
    results
  };
  console.info(JSON.stringify({
    event: "oddspadi-scheduled-multi-sport-intelligence-cycle",
    success,
    dateWindow,
    sportOrder,
    aiCallsObserved: responseBody.limits.aiCallsObserved,
    failedStages: results.flatMap((result) => [result.featureCapture, result.decisionCycle]).filter((stage) => !stage.ok).length
  }));
  return Response.json(responseBody, { status: success ? 200 : 502 });
}

export default async function multiSportDecisionCycleWorker(request: Request, context: Context): Promise<Response> {
  return runMultiSportDecisionCycleWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    fixtureLimit: clean(Netlify.env.get("ODDSPADI_MULTISPORT_FIXTURE_LIMIT")),
    aiReviewLimit: clean(Netlify.env.get("ODDSPADI_MULTISPORT_AI_LIMIT")),
    horizonDays: clean(Netlify.env.get("ODDSPADI_MULTISPORT_HORIZON_DAYS"))
  });
}
