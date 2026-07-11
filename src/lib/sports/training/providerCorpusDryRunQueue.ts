import { hasAnyConfiguredEnv } from "@/lib/env";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { syncHistoricalFootballProvider, type ProviderName, type ProviderSyncRequest, type ProviderSyncResult } from "@/lib/sports/training/providerSync";
import type { MultiSportCorpusPlan, TrainingCorpusSport, TrainingCorpusTarget } from "@/lib/sports/training/multiSportCorpusPlan";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (input: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export type ProviderCorpusDryRunCategory = "fixtures" | "odds";
export type ProviderCorpusDryRunJobStatus = "missing-env" | "ready" | "admin-required" | "passed" | "warning" | "failed" | "not-requested";
export type ProviderCorpusDryRunQueueStatus = "missing-env" | "ready-dry-run" | "admin-required" | "dry-run-passed" | "provider-warning" | "provider-error" | "safe-hold";

export type ProviderCorpusDryRunJob = {
  id: string;
  label: string;
  sport: TrainingCorpusSport;
  category: ProviderCorpusDryRunCategory;
  provider: ProviderName;
  target: string;
  status: ProviderCorpusDryRunJobStatus;
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  request: ProviderSyncRequest;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  runAttempted: boolean;
  result: {
    syncStatus: ProviderSyncResult["status"] | "not-run";
    fetched: number;
    normalized: number;
    endpoint: string | null;
    reason: string | null;
  };
  targetTables: string[];
  expectedEvidence: string;
  modelImpact: string;
  nextAction: string;
};

export type ProviderCorpusDryRunQueue = {
  mode: "provider-corpus-dry-run-queue";
  generatedAt: string;
  status: ProviderCorpusDryRunQueueStatus;
  queueHash: string;
  summary: string;
  runRequested: boolean;
  adminAuthorized: boolean;
  selectedJobId: string | null;
  window: {
    from: number;
    to: number;
    sports: number;
    estimatedHistoricalMatches: number;
    estimatedOddsSnapshots: number;
  };
  totals: {
    jobs: number;
    ready: number;
    missingEnv: number;
    adminRequired: number;
    passed: number;
    warning: number;
    failed: number;
    fetched: number;
    normalized: number;
  };
  jobs: ProviderCorpusDryRunJob[];
  nextJob: ProviderCorpusDryRunJob | null;
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    requiresRunParam: true;
    requiresAdminToken: true;
    canWriteProviderRows: false;
    canWriteRawPayloads: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function hasAnyEnv(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function missingEnv(env: EnvMap, keys: string[]): string[] {
  return hasAnyEnv(env, keys) ? [] : [keys.join(" or ")];
}

function statusForJob({
  configured,
  runRequested,
  adminAuthorized,
  selected,
  result
}: {
  configured: boolean;
  runRequested: boolean;
  adminAuthorized: boolean;
  selected: boolean;
  result: ProviderSyncResult | null;
}): ProviderCorpusDryRunJobStatus {
  if (!configured) return "missing-env";
  if (!runRequested || !selected) return "ready";
  if (!adminAuthorized) return "admin-required";
  if (!result) return "not-requested";
  if (result.status === "dry-run" && result.normalized > 0) return "passed";
  if (result.status === "dry-run" || result.status === "stored") return "warning";
  return "failed";
}

function resultSummary(result: ProviderSyncResult | null): ProviderCorpusDryRunJob["result"] {
  return {
    syncStatus: result?.status ?? "not-run",
    fetched: result?.fetched ?? 0,
    normalized: result?.normalized ?? 0,
    endpoint: result?.endpoint ?? null,
    reason: result?.reason ?? null
  };
}

function routeFor(request: ProviderSyncRequest, jobId: string): string {
  const query = new URLSearchParams();
  query.set("jobId", jobId);
  query.set("provider", request.provider);
  query.set("dryRun", "1");
  if (request.league) query.set("league", request.league);
  if (request.season) query.set("season", request.season);
  if (request.date) query.set("date", request.date);
  if (request.from) query.set("from", request.from);
  if (request.to) query.set("to", request.to);
  if (request.sportKey) query.set("sportKey", request.sportKey);
  if (request.regions) query.set("regions", request.regions);
  if (request.limit) query.set("limit", String(request.limit));
  if (request.includeContext) query.set("includeContext", "1");
  if (request.includeStandings) query.set("includeStandings", "1");
  if (request.includeAvailability) query.set("includeAvailability", "1");
  if (request.includeLineups) query.set("includeLineups", "1");
  if (request.includeWeather) query.set("includeWeather", "1");
  if (request.maxEventFixtures) query.set("maxEventFixtures", String(request.maxEventFixtures));
  if (request.maxContextFixtures) query.set("maxContextFixtures", String(request.maxContextFixtures));
  return `/api/sports/decision/training/provider-corpus-dry-run-queue?${query.toString()}`;
}

function seasonDate(season: number, monthDay: string): string {
  return `${season}-${monthDay}`;
}

function fixtureRequest(sport: TrainingCorpusSport, target: TrainingCorpusTarget, seasonTo: number): { provider: ProviderName; requiredEnv: string[]; request: ProviderSyncRequest } {
  if (sport === "basketball") {
    return {
      provider: "api-basketball",
      requiredEnv: ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      request: {
        provider: "api-basketball",
        dryRun: true,
        league: target.providerLeagueId ?? undefined,
        season: String(seasonTo),
        date: seasonDate(seasonTo, "01-15"),
        limit: 25
      }
    };
  }

  if (sport === "tennis") {
    return {
      provider: "api-tennis",
      requiredEnv: ["API_TENNIS_KEY", "SPORTS_API_KEY"],
      request: {
        provider: "api-tennis",
        dryRun: true,
        from: seasonDate(seasonTo, "01-01"),
        to: seasonDate(seasonTo, "01-07"),
        limit: 25
      }
    };
  }

  return {
    provider: "api-football",
    requiredEnv: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      request: {
        provider: "api-football",
        dryRun: true,
        league: target.providerLeagueId ?? "39",
        season: String(seasonTo),
        includeContext: true,
        includeStandings: true,
        includeAvailability: true,
        includeLineups: false,
        includeWeather: false,
        maxContextFixtures: 8,
        limit: 25
      }
    };
}

function oddsRequest(sport: TrainingCorpusSport, target: TrainingCorpusTarget, seasonTo: number): { provider: ProviderName; requiredEnv: string[]; request: ProviderSyncRequest } {
  return {
    provider: "the-odds-api",
    requiredEnv: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    request: {
      provider: "the-odds-api",
      dryRun: true,
      sportKey: target.oddsSportKey,
      date: `${seasonTo}-08-01T12:00:00Z`,
      regions: sport === "football" ? "uk,eu" : "us,uk,eu",
      limit: 25
    }
  };
}

function tablesFor(sport: TrainingCorpusSport, category: ProviderCorpusDryRunCategory): string[] {
  if (category === "odds") return ["op_odds_snapshots", "op_raw_provider_payloads", "op_provider_ingestion_runs"];
  if (sport === "football") {
    return [
      "op_leagues",
      "op_teams",
      "op_fixtures",
      "op_fixture_team_features",
      "op_standings_snapshots",
      "op_player_availability_snapshots",
      "op_raw_provider_payloads",
      "op_provider_ingestion_runs"
    ];
  }
  return ["op_leagues", "op_teams", "op_fixtures", "op_fixture_team_features", "op_raw_provider_payloads", "op_provider_ingestion_runs"];
}

function evidenceFor(sport: TrainingCorpusSport, category: ProviderCorpusDryRunCategory, target: TrainingCorpusTarget): string {
  if (category === "odds") return `Dry-run ${target.name} ${sport} historical odds and return fetched/normalized odds-linked rows without writing provider payloads.`;
  if (sport === "football") return `Dry-run ${target.name} football fixtures with standings and availability context, returning normalized rows without writes.`;
  if (sport === "basketball") return `Dry-run ${target.name} basketball games and scores, returning normalized team/game rows without writes.`;
  return `Dry-run ${target.name} tennis events, rounds, surface context, and results, returning normalized player/event rows without writes.`;
}

function modelImpactFor(sport: TrainingCorpusSport, category: ProviderCorpusDryRunCategory): string {
  if (category === "odds") return "Feeds no-vig probability, bookmaker margin, edge, expected value, and closing-line-value training labels.";
  if (sport === "football") return "Feeds Poisson expected goals, Elo/team strength, home advantage, form, availability, and lineup-aware features.";
  if (sport === "basketball") return "Feeds team rating, pace, offensive/defensive efficiency, rest-day, and home/away feature candidates.";
  return "Feeds player Elo, surface rating, tournament round, fatigue, form, and head-to-head feature candidates.";
}

function buildDefinitions(plan: MultiSportCorpusPlan): Array<{
  id: string;
  label: string;
  sport: TrainingCorpusSport;
  category: ProviderCorpusDryRunCategory;
  provider: ProviderName;
  target: string;
  requiredEnv: string[];
  request: ProviderSyncRequest;
  targetTables: string[];
  expectedEvidence: string;
  modelImpact: string;
}> {
  return plan.sports.flatMap((sportPlan) => {
    const target = sportPlan.targetCompetitions[0];
    if (!target) return [];
    return (["fixtures", "odds"] as const).map((category) => {
      const descriptor = category === "fixtures" ? fixtureRequest(sportPlan.sport, target, sportPlan.seasonTo) : oddsRequest(sportPlan.sport, target, sportPlan.seasonTo);
      return {
        id: `${sportPlan.sport}-${target.id}-${category}-${sportPlan.seasonTo}`,
        label: `${target.name} ${category} dry-run`,
        sport: sportPlan.sport,
        category,
        provider: descriptor.provider,
        target: target.name,
        requiredEnv: descriptor.requiredEnv,
        request: descriptor.request,
        targetTables: tablesFor(sportPlan.sport, category),
        expectedEvidence: evidenceFor(sportPlan.sport, category, target),
        modelImpact: modelImpactFor(sportPlan.sport, category)
      };
    });
  });
}

function nextActionFor(status: ProviderCorpusDryRunJobStatus, result: ProviderSyncResult | null): string {
  if (status === "passed") return "Inspect normalized dry-run rows, then keep writes locked until storage receipts and admin approval pass.";
  if (status === "warning") return result?.reason ?? "Provider returned dry-run evidence, but normalized counts need review before trust can rise.";
  if (status === "failed") return result?.reason ?? "Fix provider credentials, quota, parameters, or response normalization.";
  if (status === "admin-required") return "Re-run with run=1 and x-oddspadi-admin-token after confirming dry-run intent.";
  if (status === "ready") return "Run this dry-run job to collect provider count evidence without writing rows.";
  return "Configure the required provider key before this dry-run job can run.";
}

function queueStatus(jobs: ProviderCorpusDryRunJob[], runRequested: boolean, adminAuthorized: boolean): ProviderCorpusDryRunQueueStatus {
  if (jobs.some((job) => job.status === "failed")) return "provider-error";
  if (jobs.some((job) => job.status === "warning")) return "provider-warning";
  if (jobs.some((job) => job.status === "passed")) return "dry-run-passed";
  if (runRequested && !adminAuthorized) return "admin-required";
  if (jobs.some((job) => job.status === "missing-env")) return "missing-env";
  if (jobs.some((job) => job.status === "ready")) return "ready-dry-run";
  return "safe-hold";
}

function summaryFor(status: ProviderCorpusDryRunQueueStatus, totals: ProviderCorpusDryRunQueue["totals"]): string {
  if (status === "dry-run-passed") return `${totals.passed} historical provider dry-run job(s) returned normalized rows; writes and training remain locked.`;
  if (status === "provider-warning") return "Historical provider dry-run evidence returned, but counts or normalization need review.";
  if (status === "provider-error") return `${totals.failed} historical provider dry-run job(s) failed and need repair before ingestion can advance.`;
  if (status === "admin-required") return "Historical provider dry-run queue requires run=1 plus the server-only admin token.";
  if (status === "missing-env") return `${totals.missingEnv} historical provider dry-run job(s) are missing provider keys.`;
  if (status === "ready-dry-run") return `${totals.ready} historical provider dry-run job(s) are ready for supervised no-write execution.`;
  return "Historical provider dry-run queue is in safe hold.";
}

export async function buildProviderCorpusDryRunQueue({
  corpusPlan,
  env = process.env,
  runRequested = false,
  adminAuthorized = false,
  selectedJobId = null,
  origin = "http://127.0.0.1:3025",
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider,
  now = new Date()
}: {
  corpusPlan: MultiSportCorpusPlan;
  env?: EnvMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  selectedJobId?: string | null;
  origin?: string;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
  now?: Date;
}): Promise<ProviderCorpusDryRunQueue> {
  const definitions = buildDefinitions(corpusPlan);
  const defaultJobId = selectedJobId ?? definitions.find((job) => hasAnyEnv(env, job.requiredEnv))?.id ?? definitions[0]?.id ?? null;
  const jobs = await Promise.all(
    definitions.map(async (job): Promise<ProviderCorpusDryRunJob> => {
      const configured = hasAnyEnv(env, job.requiredEnv);
      const selected = job.id === defaultJobId;
      const shouldRun = configured && selected && runRequested && adminAuthorized;
      const result = shouldRun ? await syncImpl({ request: job.request, env, fetchImpl }) : null;
      const status = statusForJob({ configured, runRequested, adminAuthorized, selected, result });
      const verifyUrl = routeFor(job.request, job.id);
      return {
        ...job,
        status,
        configured,
        missingEnv: missingEnv(env, job.requiredEnv),
        command: `${decisionCurlCommand(verifyUrl)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
        verifyUrl,
        safeToRun: configured && (!runRequested || (selected && adminAuthorized)),
        runAttempted: shouldRun,
        result: resultSummary(result),
        nextAction: nextActionFor(status, result)
      };
    })
  );
  const totals = {
    jobs: jobs.length,
    ready: jobs.filter((job) => job.status === "ready").length,
    missingEnv: jobs.filter((job) => job.status === "missing-env").length,
    adminRequired: jobs.filter((job) => job.status === "admin-required").length,
    passed: jobs.filter((job) => job.status === "passed").length,
    warning: jobs.filter((job) => job.status === "warning").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    fetched: jobs.reduce((sum, job) => sum + job.result.fetched, 0),
    normalized: jobs.reduce((sum, job) => sum + job.result.normalized, 0)
  };
  const status = queueStatus(jobs, runRequested, adminAuthorized);
  const nextJob =
    jobs.find((job) => job.status === "failed") ??
    jobs.find((job) => job.status === "missing-env") ??
    jobs.find((job) => job.status === "admin-required") ??
    jobs.find((job) => job.id === defaultJobId) ??
    jobs[0] ??
    null;

  return {
    mode: "provider-corpus-dry-run-queue",
    generatedAt: now.toISOString(),
    status,
    queueHash: stableHash({
      status,
      runRequested,
      adminAuthorized,
      selectedJobId: defaultJobId,
      corpus: corpusPlan.id,
      jobs: jobs.map((job) => [job.id, job.status, job.result.syncStatus, job.result.fetched, job.result.normalized])
    }),
    summary: summaryFor(status, totals),
    runRequested,
    adminAuthorized,
    selectedJobId: defaultJobId,
    window: {
      from: corpusPlan.seasonFrom,
      to: corpusPlan.seasonTo,
      sports: corpusPlan.sportCount,
      estimatedHistoricalMatches: corpusPlan.totalEstimatedHistoricalMatches,
      estimatedOddsSnapshots: corpusPlan.totalEstimatedOddsSnapshots
    },
    totals,
    jobs,
    nextJob,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: jobs.some((job) => job.configured) && (!runRequested || adminAuthorized),
      requiresRunParam: true,
      requiresAdminToken: true,
      canWriteProviderRows: false,
      canWriteRawPayloads: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/provider-corpus-dry-run-queue",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/ten-year-corpus-execution",
      ...jobs.map((job) => job.verifyUrl)
    ]),
    locks: unique([
      "Provider corpus dry-run queue can only execute dryRun=1 provider sync jobs.",
      "run=1 and x-oddspadi-admin-token are required before any provider network call is attempted.",
      "No provider rows, raw payloads, training feature snapshots, backtest runs, public picks, or stakes can be written by this queue.",
      "Dry-run counts are readiness evidence only; storage receipts and settled outcomes remain separate gates."
    ])
  };
}
