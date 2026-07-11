import { hasAnyConfiguredEnv } from "@/lib/env";
import { EPL_2026_OPENING_WINDOW } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import {
  syncHistoricalFootballProvider,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type ProviderSyncRunner = (input: {
  request: ProviderSyncRequest;
  env?: EnvMap;
}) => Promise<ProviderSyncResult>;

export type DecisionEplProviderDryRunReceiptStatus =
  | "not-run"
  | "verified"
  | "needs-provider"
  | "needs-admin-token"
  | "admin-blocked"
  | "rate-limited"
  | "provider-error"
  | "observed-warning"
  | "blocked"
  | "failed";

export type DecisionEplProviderDryRunReceiptCounts = {
  fixtures: number;
  events: number;
  standings: number;
  availability: number;
  lineups: number;
  news: number;
  weather: number;
  featureRows: number;
};

export type DecisionEplProviderDryRunReceiptObservation = {
  attempted: boolean;
  statusLabel: ProviderSyncResult["status"] | null;
  configured: boolean | null;
  provider: ProviderSyncResult["provider"] | null;
  dryRun: boolean | null;
  endpoint: string | null;
  fetched: number;
  normalized: number;
  counts: DecisionEplProviderDryRunReceiptCounts;
  responseHash: string | null;
  reason: string | null;
  signals: string[];
  error: string | null;
};

export type DecisionEplProviderDryRunReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-provider-dry-run-receipt";
  status: DecisionEplProviderDryRunReceiptStatus;
  receiptHash: string;
  intakeHash: string;
  summary: string;
  request: {
    provider: "api-football";
    league: "39";
    season: "2026";
    date: "2026-08-21";
    dryRun: true;
    includeContext: true;
    includeEvents: false;
    includeNews: false;
    includeWeather: false;
    fallback: {
      enabled: true;
      from: string;
      to: string;
      reason: string;
    };
  };
  target: {
    allowed: boolean;
    method: "GET" | null;
    path: string;
    url: string;
    reason: string;
    requiresAdminHeader: true;
    adminTokenConfigured: boolean;
    providerKeyConfigured: boolean;
    adminAuthorized: boolean;
  };
  observation: DecisionEplProviderDryRunReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canRunProviderDryRun: boolean;
    canExecuteShell: false;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const EPL_PROVIDER_DRY_RUN_PATH = "/api/sports/decision/epl-provider-dry-run-receipt";

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function isRateLimited(value: string | null | undefined): boolean {
  return /(?:http\s*)?429|too many requests|rate[- ]?limit|throttl/i.test(value ?? "");
}

function envReady(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function defaultCounts(): DecisionEplProviderDryRunReceiptCounts {
  return {
    fixtures: 0,
    events: 0,
    standings: 0,
    availability: 0,
    lineups: 0,
    news: 0,
    weather: 0,
    featureRows: 0
  };
}

function countsFromResult(result: ProviderSyncResult | null): DecisionEplProviderDryRunReceiptCounts {
  return {
    fixtures: result?.ingestion?.counts.fixtures ?? result?.normalized ?? 0,
    events: result?.ingestion?.counts.eventRows ?? result?.eventNormalized ?? 0,
    standings: result?.ingestion?.counts.standingsRows ?? result?.standingsNormalized ?? 0,
    availability: result?.ingestion?.counts.availabilityRows ?? result?.availabilityNormalized ?? 0,
    lineups: result?.ingestion?.counts.lineupRows ?? result?.lineupsNormalized ?? 0,
    news: result?.ingestion?.counts.newsRows ?? result?.newsNormalized ?? 0,
    weather: result?.ingestion?.counts.weatherRows ?? result?.weatherNormalized ?? 0,
    featureRows: result?.ingestion?.counts.featureRows ?? 0
  };
}

function defaultObservation(): DecisionEplProviderDryRunReceiptObservation {
  return {
    attempted: false,
    statusLabel: null,
    configured: null,
    provider: null,
    dryRun: null,
    endpoint: null,
    fetched: 0,
    normalized: 0,
    counts: defaultCounts(),
    responseHash: null,
    reason: null,
    signals: [],
    error: null
  };
}

function observationFromResult(result: ProviderSyncResult): DecisionEplProviderDryRunReceiptObservation {
  const text = JSON.stringify(result);
  const counts = countsFromResult(result);
  return {
    attempted: true,
    statusLabel: result.status,
    configured: result.configured,
    provider: result.provider,
    dryRun: result.dryRun,
    endpoint: result.endpoint,
    fetched: result.fetched,
    normalized: result.normalized,
    counts,
    responseHash: stableHash(text),
    reason: result.reason ? compact(result.reason) : null,
    signals: unique([
      `status:${result.status}`,
      `configured:${result.configured}`,
      `provider:${result.provider}`,
      `dryRun:${result.dryRun}`,
      `fetched:${result.fetched}`,
      `normalized:${result.normalized}`,
      `fixtures:${counts.fixtures}`,
      `events:${counts.events}`,
      `standings:${counts.standings}`,
      `availability:${counts.availability}`,
      `lineups:${counts.lineups}`,
      `news:${counts.news}`,
      `weather:${counts.weather}`,
      `featureRows:${counts.featureRows}`
    ]),
    error: result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response" ? result.reason ?? result.status : null
  };
}

function providerRequest(): DecisionEplProviderDryRunReceipt["request"] {
  const dates = EPL_2026_OPENING_WINDOW.map((fixture) => fixture.date).sort();
  return {
    provider: "api-football",
    league: "39",
    season: "2026",
    date: "2026-08-21",
    dryRun: true,
    includeContext: true,
    includeEvents: false,
    includeNews: false,
    includeWeather: false,
    fallback: {
      enabled: true,
      from: dates[0] ?? "2026-08-21",
      to: dates[dates.length - 1] ?? "2026-08-24",
      reason: "If the exact opener date returns zero fixtures, probe the full official opening-window date range before treating provider proof as weak."
    }
  };
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionEplProviderDryRunReceipt["target"];
  observation: DecisionEplProviderDryRunReceiptObservation;
}): DecisionEplProviderDryRunReceiptStatus {
  if (!target.providerKeyConfigured) return "needs-provider";
  if (!target.adminTokenConfigured) return "needs-admin-token";
  if (requested && !target.adminAuthorized) return "admin-blocked";
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (isRateLimited(observation.reason) || isRateLimited(observation.error)) return "rate-limited";
  if (observation.statusLabel === "dry-run" && observation.normalized > 0) return "verified";
  if (observation.statusLabel === "dry-run") return "observed-warning";
  if (observation.statusLabel === "not-configured") return "needs-provider";
  if (observation.statusLabel === "provider-error") return "provider-error";
  if (observation.statusLabel === "stored") return "failed";
  if (observation.error) return "failed";
  return "observed-warning";
}

function summaryFor(status: DecisionEplProviderDryRunReceiptStatus, observation: DecisionEplProviderDryRunReceiptObservation): string {
  if (status === "verified") return `EPL provider dry-run verified ${observation.normalized} normalized fixture(s) without writing rows.`;
  if (status === "needs-provider") return "EPL provider dry-run needs API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY.";
  if (status === "needs-admin-token") return "EPL provider dry-run needs ODDSPADI_ADMIN_TOKEN before an operator can run it.";
  if (status === "admin-blocked") return "EPL provider dry-run was requested but blocked because the admin header was missing or invalid.";
  if (status === "rate-limited") {
    return `EPL provider dry-run reached API-Football but was throttled: ${observation.reason ?? observation.error ?? "HTTP 429/rate limit"}.`;
  }
  if (status === "provider-error") return `EPL provider dry-run reached the provider but failed: ${observation.reason ?? observation.error ?? "provider error"}.`;
  if (status === "failed") return `EPL provider dry-run failed: ${observation.reason ?? observation.error ?? "unknown failure"}.`;
  if (status === "observed-warning") {
    return `EPL provider dry-run completed but normalized ${observation.normalized} fixture(s); operator review or provider entitlement repair is required.`;
  }
  if (status === "blocked") return "EPL provider dry-run is blocked until the selected EPL fixture task is ready.";
  return "EPL provider dry-run is ready for an admin-authorized dry-run.";
}

function fallbackActionFor(status: DecisionEplProviderDryRunReceiptStatus): string {
  if (status === "rate-limited") {
    return "Cool down until the API-Football throttle/quota window resets, then rerun one admin dry-run without repeated polling.";
  }
  return "Keep EPL intake in read-only hold and configure provider/admin credentials before retrying the dry-run receipt.";
}

export function buildDecisionEplProviderDryRunReceipt({
  intake,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  observation,
  origin = decisionSiteOrigin(),
  now = new Date()
}: {
  intake: DecisionEplFixtureIntake;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  observation?: DecisionEplProviderDryRunReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionEplProviderDryRunReceipt {
  const request = providerRequest();
  const providerKeyConfigured = envReady(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const adminTokenConfigured = envReady(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const selectedTask = intake.nextTask;
  const selectedTaskReady = Boolean(
    selectedTask?.id === "fetch-official-fixtures" &&
      selectedTask.status === "ready" &&
      selectedTask.verifyUrl.includes("provider=api-football") &&
      selectedTask.verifyUrl.includes("league=39") &&
      selectedTask.verifyUrl.includes("season=2026") &&
      selectedTask.verifyUrl.toLowerCase().includes("dryrun=1")
  );
  const allowed = selectedTaskReady && providerKeyConfigured && adminTokenConfigured && (!runRequested || adminAuthorized);
  const observed = observation ?? defaultObservation();
  const target: DecisionEplProviderDryRunReceipt["target"] = {
    allowed,
    method: allowed ? "GET" : null,
    path: `${EPL_PROVIDER_DRY_RUN_PATH}?date=${encodeURIComponent(intake.date)}&run=1`,
    url: new URL(`${EPL_PROVIDER_DRY_RUN_PATH}?date=${encodeURIComponent(intake.date)}&run=1`, origin).toString(),
    reason: selectedTaskReady
      ? allowed
        ? "Approved admin-authorized API-Football EPL 2026/27 dry-run."
        : "EPL provider dry-run is waiting for provider key, admin token, or a valid x-oddspadi-admin-token header."
      : "The selected EPL fixture task is not the ready API-Football 2026/27 dry-run task.",
    requiresAdminHeader: true,
    adminTokenConfigured,
    providerKeyConfigured,
    adminAuthorized
  };
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const receiptHash = stableHash({
    date: intake.date,
    intakeHash: intake.intakeHash,
    request,
    status,
    runRequested,
    target: [target.allowed, target.adminTokenConfigured, target.providerKeyConfigured, target.adminAuthorized],
    observation: [observed.statusLabel, observed.responseHash, observed.normalized, observed.counts]
  });

  return {
    generatedAt: now.toISOString(),
    date: intake.date,
    sport: "football",
    mode: "decision-epl-provider-dry-run-receipt",
    status,
    receiptHash,
    intakeHash: intake.intakeHash,
    summary: summaryFor(status, observed),
    request,
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The request is admin-authorized with x-oddspadi-admin-token.",
        "The provider sync request is forced to API-Football league 39, season 2026, first EPL fixture date, limit=1, and dryRun=true.",
        "If exact-date proof returns zero fixtures, the opening-window fallback remains dry-run-only and must normalize fixtures before proof is verified.",
        "The result status is dry-run and normalized fixture counts are recorded without writing rows, training models, publishing picks, or staking."
      ],
      failureSignals: ["missing provider key", "missing or invalid admin header", "rate-limited", "provider-error", "stored status", "dryRun=false", "non-EPL request"],
      fallbackAction: fallbackActionFor(status)
    },
    controls: {
      canRunProviderDryRun: target.allowed,
      canExecuteShell: false,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      EPL_PROVIDER_DRY_RUN_PATH,
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/epl-fixture-intake-receipt",
      selectedTask?.verifyUrl,
      ...intake.proofUrls
    ]),
    locks: unique([
      "EPL provider dry-run receipt requires a valid admin header before any provider call is made.",
      "The provider request is forced to API-Football league 39 season 2026 with dryRun=true.",
      "It cannot write fixtures, write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action.",
      "Observed output is normalized counts, provider status, response hash, and public signals only.",
      ...intake.locks
    ])
  };
}

export async function observeDecisionEplProviderDryRunReceipt({
  intake,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date(),
  syncImpl = syncHistoricalFootballProvider as ProviderSyncRunner
}: {
  intake: DecisionEplFixtureIntake;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  origin?: string;
  now?: Date;
  syncImpl?: ProviderSyncRunner;
}): Promise<DecisionEplProviderDryRunReceipt> {
  const preview = buildDecisionEplProviderDryRunReceipt({ intake, runRequested, adminAuthorized, env, origin, now });
  if (!runRequested || !preview.target.allowed) return preview;

  try {
    const primaryRequest: ProviderSyncRequest = {
      provider: "api-football",
      league: "39",
      season: "2026",
      date: "2026-08-21",
      dryRun: true,
      includeContext: true,
      includeEvents: false,
      includeNews: false,
      includeWeather: false,
      maxEventFixtures: 1,
      limit: 1
    };
    const primaryResult = await syncImpl({ request: primaryRequest, env });
    const needsOpeningWindowFallback = primaryResult.status === "dry-run" && primaryResult.normalized === 0;
    const result = needsOpeningWindowFallback
      ? await syncImpl({
          request: {
            provider: "api-football",
            league: "39",
            season: "2026",
            from: "2026-08-21",
            to: "2026-08-24",
            dryRun: true,
            includeContext: true,
            includeEvents: false,
            includeNews: false,
            includeWeather: false,
            maxEventFixtures: 1,
            limit: 1
          },
          env
        })
      : primaryResult;
    const observation = observationFromResult(result);
    if (needsOpeningWindowFallback) {
      observation.signals = unique(
        [
          ...observation.signals,
          "fallback:opening-window",
          `primaryFetched:${primaryResult.fetched}`,
          `primaryNormalized:${primaryResult.normalized}`
        ],
        30
      );
      observation.reason = observation.reason ?? primaryResult.reason ?? "Exact opener date returned zero fixtures; opening-window fallback was used.";
    }
    return buildDecisionEplProviderDryRunReceipt({ intake, runRequested, adminAuthorized, env, observation, origin, now });
  } catch (error) {
    const observation: DecisionEplProviderDryRunReceiptObservation = {
      ...defaultObservation(),
      attempted: true,
      error: error instanceof Error ? error.message : "EPL provider dry-run receipt failed."
    };
    return buildDecisionEplProviderDryRunReceipt({ intake, runRequested, adminAuthorized, env, observation, origin, now });
  }
}
