import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DecisionCycleWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  fixtureLimit?: string | null;
  aiReviewLimit?: string | null;
  horizonDays?: string | null;
  featureLimit?: string | null;
  contextLimit?: string | null;
  footballLeagueIds?: string | null;
  now?: Date;
  fetchImpl?: FetchLike;
};

type WorkerStage = {
  ok: boolean;
  status: number;
  body: unknown;
};

type DecisionCycleDateResult = {
  date: string;
  contextCapture: WorkerStage;
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

export function utcDateWindow(now: Date, days: number): string[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function footballSeasonForDate(date: string): string {
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return String(new Date().getUTCFullYear());
  return String(month >= 7 ? year : year - 1);
}

function primaryLeagueId(value: string | null | undefined): string {
  const selected = value
    ?.split(",")
    .map((item) => item.trim())
    .find((item) => /^\d+$/.test(item));
  return selected ?? "39";
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
      body: { success: false, error: error instanceof Error ? error.message : "Scheduled worker stage failed." }
    };
  }
}

export async function runDecisionCycleWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  fixtureLimit,
  aiReviewLimit,
  horizonDays,
  featureLimit,
  contextLimit,
  footballLeagueIds,
  now = new Date(),
  fetchImpl = fetch
}: DecisionCycleWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const suppliedToken = clean(scheduleToken);
  if (!baseUrl || !token) return Response.json({ success: false, error: "Decision cycle worker configuration is incomplete." }, { status: 503 });
  if (!suppliedToken || !tokenMatches(token, suppliedToken)) {
    return Response.json({ success: false, error: "Decision cycle worker authorization failed." }, { status: 401 });
  }

  const dateWindow = utcDateWindow(now, boundedInteger(horizonDays, 3, 1, 3));
  const boundedFixtureLimit = boundedInteger(fixtureLimit, 12, 1, 20);
  const boundedFeatureLimit = boundedInteger(featureLimit, 20, 1, 100);
  const boundedContextLimit = boundedInteger(contextLimit, 8, 1, 20);
  const footballLeagueId = primaryLeagueId(footballLeagueIds);
  const totalAiBudget = boundedInteger(aiReviewLimit, 2, 0, 3);
  let remainingAiBudget = totalAiBudget;
  const results: DecisionCycleDateResult[] = [];

  for (const date of dateWindow) {
    const contextEndpoint = new URL("/api/sports/decision/training/provider-sync", baseUrl);
    contextEndpoint.searchParams.set("provider", "api-football");
    contextEndpoint.searchParams.set("league", footballLeagueId);
    contextEndpoint.searchParams.set("season", footballSeasonForDate(date));
    contextEndpoint.searchParams.set("date", date);
    contextEndpoint.searchParams.set("limit", String(boundedContextLimit));
    contextEndpoint.searchParams.set("maxContextFixtures", String(boundedContextLimit));
    contextEndpoint.searchParams.set("maxEventFixtures", String(boundedContextLimit));
    contextEndpoint.searchParams.set("includeEvents", date === dateWindow[0] ? "1" : "0");
    contextEndpoint.searchParams.set("includeStandings", "1");
    contextEndpoint.searchParams.set("includeAvailability", "1");
    contextEndpoint.searchParams.set("includeLineups", "1");
    contextEndpoint.searchParams.set("includeWeather", "1");
    contextEndpoint.searchParams.set("includeNews", "0");
    contextEndpoint.searchParams.set("dryRun", "0");
    const contextCapture = await callStage(fetchImpl, contextEndpoint, token, 3 * 60_000);

    const featureEndpoint = new URL("/api/sports/decision/training/football-provider-live-feature-storage-receipt", baseUrl);
    featureEndpoint.searchParams.set("date", date);
    featureEndpoint.searchParams.set("limit", String(boundedFeatureLimit));
    featureEndpoint.searchParams.set("run", "1");
    featureEndpoint.searchParams.set("dryRun", "0");
    const featureCapture = await callStage(fetchImpl, featureEndpoint, token, 2 * 60_000);

    const dateAiBudget = remainingAiBudget;
    const decisionEndpoint = new URL("/api/sports/decision/autonomous-cycle", baseUrl);
    decisionEndpoint.searchParams.set("date", date);
    decisionEndpoint.searchParams.set("sport", "football");
    decisionEndpoint.searchParams.set("limit", String(boundedFixtureLimit));
    decisionEndpoint.searchParams.set("aiLimit", String(dateAiBudget));
    decisionEndpoint.searchParams.set("runAi", "1");
    decisionEndpoint.searchParams.set("persist", "1");
    const decisionCycle = await callStage(fetchImpl, decisionEndpoint, token, 3 * 60_000);
    const aiCallsObserved = decisionCycle.ok ? Math.min(dateAiBudget, observedAiCalls(decisionCycle.body)) : dateAiBudget;
    remainingAiBudget = Math.max(0, remainingAiBudget - aiCallsObserved);
    results.push({ date, contextCapture, featureCapture, decisionCycle, aiBudgetRequested: dateAiBudget, aiCallsObserved });
  }

  const success = results.every((result) => result.contextCapture.ok && result.featureCapture.ok && result.decisionCycle.ok);
  const responseBody = {
    success,
    mode: "scheduled-football-intelligence-cycle",
    dateWindow,
    limits: {
      fixtureLimitPerDate: boundedFixtureLimit,
      featureLimitPerDate: boundedFeatureLimit,
      contextLimitPerDate: boundedContextLimit,
      footballLeagueId,
      totalAiReviewLimit: totalAiBudget,
      aiCallsObserved: totalAiBudget - remainingAiBudget
    },
    results
  };
  console.info(JSON.stringify({
    event: "oddspadi-scheduled-football-intelligence-cycle",
    success,
    dateWindow,
    aiCallsObserved: responseBody.limits.aiCallsObserved,
    failedStages: results.flatMap((result) => [result.contextCapture, result.featureCapture, result.decisionCycle]).filter((stage) => !stage.ok).length
  }));
  return Response.json(responseBody, { status: success ? 200 : 502 });
}

export default async function decisionCycleWorker(request: Request, context: Context): Promise<Response> {
  return runDecisionCycleWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    fixtureLimit: clean(Netlify.env.get("ODDSPADI_AUTONOMOUS_FIXTURE_LIMIT")),
    aiReviewLimit: clean(Netlify.env.get("ODDSPADI_AUTONOMOUS_AI_LIMIT")),
    horizonDays: clean(Netlify.env.get("ODDSPADI_AUTONOMOUS_HORIZON_DAYS")),
    featureLimit: clean(Netlify.env.get("ODDSPADI_LIVE_FEATURE_LIMIT")),
    contextLimit: clean(Netlify.env.get("ODDSPADI_LIVE_CONTEXT_LIMIT")),
    footballLeagueIds: clean(Netlify.env.get("API_FOOTBALL_LEAGUE_IDS"))
  });
}
