import { hasAnyConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { decisionCurlCommand, decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import {
  runHistoricalProviderBackfill,
  type HistoricalProviderBackfillRequest,
  type HistoricalProviderBackfillResult
} from "@/lib/sports/training/historicalBackfill";
import {
  readSupabaseTrainingCorpusCensus,
  type SupabaseTrainingCorpusCensus
} from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { ProviderName } from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type BackfillRunner = (input: { request: HistoricalProviderBackfillRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<HistoricalProviderBackfillResult>;
type CensusReader = (input: { env?: EnvMap; origin: string; now?: Date; fresh?: boolean }) => Promise<SupabaseTrainingCorpusCensus>;

export type HistoricalProviderStorageReceiptStatus =
  | "ready-to-run"
  | "dry-run-passed"
  | "stored"
  | "no-data"
  | "partial"
  | "waiting-admin"
  | "waiting-provider-env"
  | "waiting-supabase"
  | "invalid-request"
  | "provider-error"
  | "failed";

export type HistoricalProviderStorageObservation = {
  attempted: boolean;
  statusLabel: HistoricalProviderBackfillResult["status"] | "not-run";
  dryRun: boolean;
  plannedJobs: number;
  executedJobs: number;
  storedJobs: number;
  dryRunJobs: number;
  failedJobs: number;
  fetched: number;
  normalized: number;
  rowsWritten: number;
  counts: HistoricalProviderBackfillResult["counts"];
  warnings: string[];
  errors: string[];
  jobIds: string[];
  ingestionRunIds: string[];
  observationHash: string;
};

export type HistoricalProviderStorageReceipt = {
  mode: "historical-provider-storage-receipt";
  generatedAt: string;
  status: HistoricalProviderStorageReceiptStatus;
  receiptHash: string;
  summary: string;
  request: HistoricalProviderBackfillRequest & {
    dryRun: boolean;
    maxJobs: number;
  };
  target: {
    expectedProjectRef: typeof ODDSPADI_SUPABASE_PROJECT_REF;
    projectRef: string;
    targetMatchesExpected: boolean;
    serverWriteReady: boolean;
    providerConfigured: boolean;
    adminTokenConfigured: boolean;
    adminAuthorized: boolean;
    destructiveReplace: boolean;
    tables: string[];
  };
  observation: HistoricalProviderStorageObservation;
  readback: {
    before: Pick<SupabaseTrainingCorpusCensus, "status" | "censusHash" | "totals"> | null;
    after: Pick<SupabaseTrainingCorpusCensus, "status" | "censusHash" | "totals"> | null;
    checked: boolean;
    evidenceReady: boolean;
    fixturesVisible: number;
    oddsVisible: number;
    rawPayloadsVisible: number;
    featureSnapshotsVisible: number;
    errors: string[];
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: boolean;
    canWriteRawPayloads: boolean;
    canWriteFeatureSnapshots: boolean;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

const DEFAULT_PROVIDER: ProviderName = "api-football";
const DEFAULT_LEAGUE = "39";
const DEFAULT_SEASON = "2025";
const DEFAULT_MAX_JOBS = 1;
const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_EVENT_FIXTURES = 1;
const DEFAULT_MAX_CONTEXT_FIXTURES = 2;
const RECEIPT_PATH = "/api/sports/decision/training/historical-provider-storage-receipt";

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 60): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function providerEnvKeys(provider: ProviderName): string[] {
  if (provider === "the-odds-api") return ["THE_ODDS_API_KEY", "ODDS_API_KEY"];
  if (provider === "api-basketball") return ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];
  if (provider === "api-tennis") return ["API_TENNIS_KEY", "SPORTS_API_KEY"];
  return ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];
}

function targetTables(provider: ProviderName): string[] {
  if (provider === "the-odds-api") return ["op_odds_snapshots", "op_raw_provider_payloads", "op_provider_ingestion_runs"];
  return [
    "op_leagues",
    "op_teams",
    "op_fixtures",
    "op_fixture_team_features",
    "op_odds_snapshots",
    "op_live_match_events",
    "op_standings_snapshots",
    "op_player_availability_snapshots",
    "op_lineup_snapshots",
    "op_player_match_performances",
    "op_weather_snapshots",
    "op_news_signals",
    "op_training_feature_snapshots",
    "op_raw_provider_payloads",
    "op_provider_ingestion_runs"
  ];
}

function defaultRequest(input: Partial<HistoricalProviderBackfillRequest> = {}): HistoricalProviderStorageReceipt["request"] {
  const provider = input.provider ?? DEFAULT_PROVIDER;
  return {
    provider,
    dryRun: input.dryRun ?? true,
    league: input.league ?? (provider === "api-football" || provider === "api-basketball" ? DEFAULT_LEAGUE : undefined),
    seasons: input.seasons,
    seasonFrom: input.seasonFrom ?? (provider === "api-football" || provider === "api-basketball" ? DEFAULT_SEASON : undefined),
    seasonTo: input.seasonTo ?? (provider === "api-football" || provider === "api-basketball" ? DEFAULT_SEASON : undefined),
    dates: input.dates,
    from: input.from,
    to: input.to,
    intervalDays: input.intervalDays,
    sportKey: input.sportKey ?? (provider === "the-odds-api" ? "soccer_epl" : undefined),
    regions: input.regions ?? (provider === "the-odds-api" ? "uk,eu" : undefined),
    bookmakers: input.bookmakers,
    includeEvents: input.includeEvents ?? provider === "api-football",
    includeNews: input.includeNews ?? false,
    includeContext: input.includeContext ?? provider === "api-football",
    includeStandings: input.includeStandings ?? provider === "api-football",
    includeAvailability: input.includeAvailability ?? provider === "api-football",
    includeLineups: input.includeLineups ?? provider === "api-football",
    includePlayerStats: input.includePlayerStats ?? provider === "api-football",
    includeWeather: input.includeWeather ?? false,
    maxEventFixtures: input.maxEventFixtures ?? DEFAULT_MAX_EVENT_FIXTURES,
    maxContextFixtures: input.maxContextFixtures ?? DEFAULT_MAX_CONTEXT_FIXTURES,
    limit: input.limit ?? DEFAULT_LIMIT,
    maxJobs: input.maxJobs ?? DEFAULT_MAX_JOBS,
    stopOnError: input.stopOnError ?? true
  };
}

function emptyCounts(): HistoricalProviderBackfillResult["counts"] {
  return {
    fixtures: 0,
    oddsRows: 0,
    eventRows: 0,
    newsRows: 0,
    standingsRows: 0,
    availabilityRows: 0,
    lineupRows: 0,
    playerPerformanceRows: 0,
    playerPerformanceRowsVerified: 0,
    weatherRows: 0,
    featureSnapshots: 0
  };
}

function observationFromResult(result: HistoricalProviderBackfillResult | null): HistoricalProviderStorageObservation {
  if (!result) {
    return {
      attempted: false,
      statusLabel: "not-run",
      dryRun: true,
      plannedJobs: 0,
      executedJobs: 0,
      storedJobs: 0,
      dryRunJobs: 0,
      failedJobs: 0,
      fetched: 0,
      normalized: 0,
      rowsWritten: 0,
      counts: emptyCounts(),
      warnings: [],
      errors: [],
      jobIds: [],
      ingestionRunIds: [],
      observationHash: stableHash({ status: "not-run" })
    };
  }

  const ingestionRunIds = unique(result.jobs.map((job) => job.result.ingestion?.ingestionRunId ?? null));
  const rowsWritten = result.jobs.reduce((sum, job) => sum + (job.result.ingestion?.rowsWritten ?? 0), 0);
  const observation = {
    attempted: true,
    statusLabel: result.status,
    dryRun: result.dryRun,
    plannedJobs: result.plannedJobs,
    executedJobs: result.executedJobs,
    storedJobs: result.storedJobs,
    dryRunJobs: result.dryRunJobs,
    failedJobs: result.failedJobs,
    fetched: result.fetched,
    normalized: result.normalized,
    rowsWritten,
    counts: result.counts,
    warnings: result.warnings,
    errors: result.errors,
    jobIds: result.jobs.map((job) => job.job.id),
    ingestionRunIds,
    observationHash: ""
  };
  return {
    ...observation,
    observationHash: stableHash(observation)
  };
}

function compactCensus(census: SupabaseTrainingCorpusCensus | null): HistoricalProviderStorageReceipt["readback"]["before"] {
  if (!census) return null;
  return {
    status: census.status,
    censusHash: census.censusHash,
    totals: census.totals
  };
}

function statusFor({
  runRequested,
  adminAuthorized,
  request,
  providerConfigured,
  serverWriteReady,
  observation
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  request: HistoricalProviderStorageReceipt["request"];
  providerConfigured: boolean;
  serverWriteReady: boolean;
  observation: HistoricalProviderStorageObservation;
}): HistoricalProviderStorageReceiptStatus {
  if (!providerConfigured) return "waiting-provider-env";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  if (runRequested && !request.dryRun && !serverWriteReady) return "waiting-supabase";
  if (!runRequested) return "ready-to-run";
  if (observation.statusLabel === "invalid-request") return "invalid-request";
  if (observation.statusLabel === "not-configured") return "waiting-provider-env";
  if (observation.statusLabel === "stored" && !observation.dryRun && observation.rowsWritten > 0) return "stored";
  if (
    observation.statusLabel === "stored" &&
    !observation.dryRun &&
    observation.fetched === 0 &&
    observation.normalized === 0 &&
    observation.errors.length === 0
  ) return "no-data";
  if (observation.statusLabel === "partial") return "partial";
  if (observation.statusLabel === "dry-run" && observation.dryRun && observation.normalized > 0) return "dry-run-passed";
  if (observation.errors.length && observation.executedJobs > 0) return "provider-error";
  return observation.attempted ? "failed" : "ready-to-run";
}

function summaryFor(status: HistoricalProviderStorageReceiptStatus, observation: HistoricalProviderStorageObservation): string {
  if (status === "stored") return `Stored ${observation.rowsWritten} provider corpus row(s) from ${observation.executedJobs} capped historical job(s); training and public picks remain locked.`;
  if (status === "no-data") return "Historical provider refresh completed successfully, but the requested window contained no provider rows to store.";
  if (status === "dry-run-passed") return `Provider storage receipt dry-run normalized ${observation.normalized} fixture row(s) from ${observation.fetched} fetched provider item(s); write mode remains separate.`;
  if (status === "partial") return "Historical provider storage receipt partially completed; inspect failed jobs before continuing.";
  if (status === "waiting-admin") return "Historical provider storage receipt requires run=1 plus x-oddspadi-admin-token before spending provider credits or writing rows.";
  if (status === "waiting-provider-env") return "Historical provider storage receipt is waiting for the selected provider key.";
  if (status === "waiting-supabase") return "Historical provider storage write is waiting for OddsPadi Supabase service-role readiness.";
  if (status === "invalid-request") return observation.errors[0] ?? "Historical provider storage request is invalid.";
  if (status === "provider-error") return observation.errors[0] ?? "Historical provider storage receipt reached the provider but failed.";
  if (status === "failed") return observation.errors[0] ?? "Historical provider storage receipt failed.";
  return "Historical provider storage receipt is ready for an explicit capped dry-run or write run.";
}

function buildVerifyUrl(request: HistoricalProviderStorageReceipt["request"], dryRun: boolean, run: boolean): string {
  const params = new URLSearchParams();
  params.set("provider", request.provider);
  params.set("dryRun", dryRun ? "1" : "0");
  if (run) params.set("run", "1");
  if (request.league) params.set("league", request.league);
  if (request.seasonFrom) params.set("seasonFrom", String(request.seasonFrom));
  if (request.seasonTo) params.set("seasonTo", String(request.seasonTo));
  if (request.dates?.length) params.set("dates", request.dates.join(","));
  if (request.from) params.set("from", request.from);
  if (request.to) params.set("to", request.to);
  if (request.sportKey) params.set("sportKey", request.sportKey);
  if (request.regions) params.set("regions", request.regions);
  if (request.includeEvents) params.set("includeEvents", "1");
  if (request.includeContext) params.set("includeContext", "1");
  if (request.includeStandings) params.set("includeStandings", "1");
  if (request.includeAvailability) params.set("includeAvailability", "1");
  if (request.includeLineups) params.set("includeLineups", "1");
  if (request.includePlayerStats) params.set("includePlayerStats", "1");
  if (request.includeNews) params.set("includeNews", "1");
  if (request.includeWeather) params.set("includeWeather", "1");
  if (request.maxEventFixtures) params.set("maxEventFixtures", String(request.maxEventFixtures));
  if (request.maxContextFixtures) params.set("maxContextFixtures", String(request.maxContextFixtures));
  if (request.limit) params.set("limit", String(request.limit));
  if (request.maxJobs) params.set("maxJobs", String(request.maxJobs));
  if (request.stopOnError) params.set("stopOnError", "1");
  return `${RECEIPT_PATH}?${params.toString()}`;
}

function readbackReady({
  request,
  observation,
  after
}: {
  request: HistoricalProviderStorageReceipt["request"];
  observation: HistoricalProviderStorageObservation;
  after: SupabaseTrainingCorpusCensus | null;
}): boolean {
  if (!after || observation.statusLabel !== "stored" || request.dryRun) return false;
  if (request.provider === "the-odds-api") return after.totals.oddsSnapshots > 0 && after.totals.rawProviderPayloads > 0;
  return after.totals.fixtures > 0 && after.totals.rawProviderPayloads > 0 && after.totals.featureSnapshots > 0;
}

export async function observeHistoricalProviderStorageReceipt({
  request: requestInput,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin = decisionSiteOrigin(),
  now = new Date(),
  fetchImpl,
  backfillRunner = runHistoricalProviderBackfill,
  censusReader = readSupabaseTrainingCorpusCensus
}: {
  request?: Partial<HistoricalProviderBackfillRequest>;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  origin?: string;
  now?: Date;
  fetchImpl?: FetchLike;
  backfillRunner?: BackfillRunner;
  censusReader?: CensusReader;
} = {}): Promise<HistoricalProviderStorageReceipt> {
  const generatedAt = now.toISOString();
  const request = defaultRequest(requestInput);
  const runtime = getSupabaseRuntimeStatus(env);
  const providerConfigured = hasAny(env, providerEnvKeys(request.provider));
  const adminTokenConfigured = hasAny(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const canAttempt = runRequested && adminAuthorized && providerConfigured && (request.dryRun || runtime.serverWriteReady);
  const before = runtime.serverWriteReady ? await censusReader({ env, origin, now }).catch(() => null) : null;
  const result = canAttempt ? await backfillRunner({ request, env, fetchImpl }) : null;
  const observation = observationFromResult(result);
  const after = runtime.serverWriteReady && (canAttempt || before) ? await censusReader({ env, origin, now, fresh: canAttempt && !request.dryRun }).catch(() => null) : before;
  const status = statusFor({
    runRequested,
    adminAuthorized,
    request,
    providerConfigured,
    serverWriteReady: runtime.serverWriteReady,
    observation
  });
  const writeAllowed = Boolean(runRequested && adminAuthorized && !request.dryRun && runtime.serverWriteReady && providerConfigured);
  const verifyUrl = buildVerifyUrl(request, true, false);
  const dryRunUrl = buildVerifyUrl(request, true, true);
  const writeUrl = buildVerifyUrl(request, false, true);
  const commandUrl = request.dryRun ? dryRunUrl : writeUrl;
  const command = `${decisionCurlCommand(`${origin}${commandUrl}`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const target = {
    expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF as typeof ODDSPADI_SUPABASE_PROJECT_REF,
    projectRef: runtime.projectRef ?? runtime.urlProjectRef ?? "missing",
    targetMatchesExpected: runtime.targetMatchesExpected,
    serverWriteReady: runtime.serverWriteReady,
    providerConfigured,
    adminTokenConfigured,
    adminAuthorized,
    destructiveReplace: true,
    tables: targetTables(request.provider)
  };
  const evidenceReady = readbackReady({ request, observation, after });
  const readbackErrors = unique([
    ...(before?.readiness.errors ?? []),
    ...(after?.readiness.errors ?? []),
    runtime.serverWriteReady ? "" : "Supabase server-write/readback readiness is missing."
  ]);
  const receiptHash = stableHash({
    status,
    request,
    target,
    observation: observation.observationHash,
    before: before?.censusHash ?? null,
    after: after?.censusHash ?? null,
    evidenceReady
  });

  return {
    mode: "historical-provider-storage-receipt",
    generatedAt,
    status,
    receiptHash,
    summary: summaryFor(status, observation),
    request,
    target,
    observation,
    readback: {
      before: compactCensus(before),
      after: compactCensus(after),
      checked: Boolean(after),
      evidenceReady,
      fixturesVisible: after?.totals.fixtures ?? 0,
      oddsVisible: after?.totals.oddsSnapshots ?? 0,
      rawPayloadsVisible: after?.totals.rawProviderPayloads ?? 0,
      featureSnapshotsVisible: after?.totals.featureSnapshots ?? 0,
      errors: readbackErrors
    },
    nextAction: {
      label:
        status === "stored"
          ? "Generate feature/backtest readiness from stored corpus"
          : status === "no-data"
            ? "Wait for the next completed-fixture window"
            : request.dryRun
              ? "Run capped provider storage dry-run"
              : "Run capped provider storage write",
      command,
      verifyUrl,
      expectedEvidence:
        "Provider backfill result plus Supabase census readback show fixtures, odds/raw payloads, and feature snapshots visible while training, publishing, and staking remain locked."
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: providerConfigured && adminTokenConfigured,
      canWriteProviderRows: writeAllowed,
      canWriteRawPayloads: writeAllowed,
      canWriteFeatureSnapshots: writeAllowed && request.provider !== "the-odds-api",
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      RECEIPT_PATH,
      "/api/sports/decision/training/backfill",
      "/api/sports/decision/training/provider-corpus-dry-run-queue",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/provider-batch-manifest"
    ]),
    locks: unique([
      "Historical provider storage receipt is capped by maxJobs, limit, maxEventFixtures, and maxContextFixtures.",
      "run=1 and x-oddspadi-admin-token are required before provider calls or writes execute.",
      "dryRun=0 refreshes core fixture features and replaces only child datasets explicitly requested; omitted odds, events, and context evidence are preserved.",
      "Stored corpus rows do not unlock model training until settlement labels, feature-snapshot review, completed backtests, and promotion gates pass.",
      "No public picks, staking, learned weights, probability upgrades, or final-answer promotion can be triggered by this receipt."
    ])
  };
}
