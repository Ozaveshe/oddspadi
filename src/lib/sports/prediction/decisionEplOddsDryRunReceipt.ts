import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionEplOddsMarketMap } from "@/lib/sports/prediction/decisionEplOddsMarketMap";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import {
  syncHistoricalFootballProvider,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type OddsSyncRunner = (input: {
  request: ProviderSyncRequest;
  env?: EnvMap;
}) => Promise<ProviderSyncResult>;

export type DecisionEplOddsDryRunReceiptStatus =
  | "not-run"
  | "verified"
  | "needs-odds-key"
  | "needs-admin-token"
  | "admin-blocked"
  | "market-map-blocked"
  | "provider-error"
  | "observed-warning"
  | "failed";

export type DecisionEplOddsDryRunReceiptObservation = {
  attempted: boolean;
  statusLabel: ProviderSyncResult["status"] | null;
  configured: boolean | null;
  provider: ProviderSyncResult["provider"] | null;
  dryRun: boolean | null;
  endpoint: string | null;
  fetchedEvents: number;
  normalizedOddsRows: number;
  responseHash: string | null;
  reason: string | null;
  signals: string[];
  error: string | null;
};

export type DecisionEplOddsDryRunReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-odds-dry-run-receipt";
  status: DecisionEplOddsDryRunReceiptStatus;
  receiptHash: string;
  oddsMapHash: string;
  summary: string;
  request: {
    provider: "the-odds-api";
    sportKey: string;
    date: string;
    regions: string;
    markets: string;
    dryRun: true;
    limit: number;
  };
  target: {
    allowed: boolean;
    method: "GET" | null;
    path: string;
    url: string;
    reason: string;
    requiresAdminHeader: true;
    adminTokenConfigured: boolean;
    oddsKeyConfigured: boolean;
    adminAuthorized: boolean;
  };
  observation: DecisionEplOddsDryRunReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canRunOddsDryRun: boolean;
    canExecuteShell: false;
    canWriteOddsSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const EPL_ODDS_DRY_RUN_PATH = "/api/sports/decision/epl-odds-dry-run-receipt";

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function defaultObservation(): DecisionEplOddsDryRunReceiptObservation {
  return {
    attempted: false,
    statusLabel: null,
    configured: null,
    provider: null,
    dryRun: null,
    endpoint: null,
    fetchedEvents: 0,
    normalizedOddsRows: 0,
    responseHash: null,
    reason: null,
    signals: [],
    error: null
  };
}

function observationFromResult(result: ProviderSyncResult): DecisionEplOddsDryRunReceiptObservation {
  const responseHash = stableHash(result);
  return {
    attempted: true,
    statusLabel: result.status,
    configured: result.configured,
    provider: result.provider,
    dryRun: result.dryRun,
    endpoint: result.endpoint,
    fetchedEvents: result.fetched,
    normalizedOddsRows: result.normalized,
    responseHash,
    reason: result.reason ? compact(result.reason) : null,
    signals: unique([
      `status:${result.status}`,
      `configured:${result.configured}`,
      `provider:${result.provider}`,
      `dryRun:${result.dryRun}`,
      `events:${result.fetched}`,
      `oddsRows:${result.normalized}`,
      `proof:${responseHash}`
    ]),
    error: result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response" ? result.reason ?? result.status : null
  };
}

function requestFor(map: DecisionEplOddsMarketMap): DecisionEplOddsDryRunReceipt["request"] {
  return {
    provider: "the-odds-api",
    sportKey: map.source.sportKey,
    date: `${map.selectedRow?.date ?? map.date}T12:00:00Z`,
    regions: map.dryRunPlan.regionsParam,
    markets: map.dryRunPlan.marketsParam,
    dryRun: true,
    limit: 50
  };
}

function shouldUseHistoricalOddsEndpoint(targetDate: string, now: Date): boolean {
  const target = new Date(targetDate);
  if (!Number.isFinite(target.getTime())) return false;
  const todayStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return target.getTime() < todayStartUtc;
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionEplOddsDryRunReceipt["target"];
  observation: DecisionEplOddsDryRunReceiptObservation;
}): DecisionEplOddsDryRunReceiptStatus {
  if (!target.oddsKeyConfigured) return "needs-odds-key";
  if (!target.adminTokenConfigured) return "needs-admin-token";
  if (requested && !target.adminAuthorized) return "admin-blocked";
  if (!target.allowed) return "market-map-blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "failed";
  if (observation.statusLabel === "dry-run" && observation.dryRun === true && observation.normalizedOddsRows > 0) return "verified";
  if (observation.statusLabel === "not-configured") return "needs-odds-key";
  if (observation.statusLabel === "provider-error") return "provider-error";
  if (observation.statusLabel === "stored") return "failed";
  if (observation.error) return "failed";
  return "observed-warning";
}

function summaryFor(status: DecisionEplOddsDryRunReceiptStatus, observation: DecisionEplOddsDryRunReceiptObservation): string {
  if (status === "verified") {
    return `EPL odds dry-run verified ${observation.normalizedOddsRows} normalized odds row(s) from ${observation.fetchedEvents} event(s) without writing snapshots.`;
  }
  if (status === "needs-odds-key") return "EPL odds dry-run needs THE_ODDS_API_KEY or ODDS_API_KEY.";
  if (status === "needs-admin-token") return "EPL odds dry-run needs ODDSPADI_ADMIN_TOKEN before an operator can run it.";
  if (status === "admin-blocked") return "EPL odds dry-run was requested but blocked because the admin header was missing or invalid.";
  if (status === "market-map-blocked") return "EPL odds dry-run is blocked until the EPL odds market map is ready.";
  if (status === "provider-error") return `EPL odds dry-run reached The Odds API but failed: ${observation.reason ?? observation.error ?? "provider error"}.`;
  if (status === "observed-warning") return "EPL odds dry-run completed with output that needs operator review before storage.";
  if (status === "failed") return `EPL odds dry-run failed: ${observation.reason ?? observation.error ?? "unknown failure"}.`;
  return "EPL odds dry-run is ready for an admin-authorized dry-run.";
}

export function buildDecisionEplOddsDryRunReceipt({
  oddsMap,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  observation,
  origin = decisionSiteOrigin(),
  now = new Date()
}: {
  oddsMap: DecisionEplOddsMarketMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  observation?: DecisionEplOddsDryRunReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionEplOddsDryRunReceipt {
  const request = requestFor(oddsMap);
  const oddsKeyConfigured = hasAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const adminTokenConfigured = hasAny(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const mapReady = oddsMap.controls.canRequestOddsDryRun;
  const allowed = mapReady && oddsKeyConfigured && adminTokenConfigured && (!runRequested || adminAuthorized);
  const observed = observation ?? defaultObservation();
  const target: DecisionEplOddsDryRunReceipt["target"] = {
    allowed,
    method: allowed ? "GET" : null,
    path: `${EPL_ODDS_DRY_RUN_PATH}?date=${encodeURIComponent(oddsMap.date)}&run=1`,
    url: new URL(`${EPL_ODDS_DRY_RUN_PATH}?date=${encodeURIComponent(oddsMap.date)}&run=1`, origin).toString(),
    reason: mapReady
      ? allowed
        ? "Approved admin-authorized The Odds API EPL dry-run."
        : "EPL odds dry-run is waiting for odds key, admin token, or a valid x-oddspadi-admin-token header."
      : "The EPL odds market map is not ready for a provider dry-run.",
    requiresAdminHeader: true,
    adminTokenConfigured,
    oddsKeyConfigured,
    adminAuthorized
  };
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const receiptHash = stableHash({
    date: oddsMap.date,
    oddsMap: oddsMap.mapHash,
    request,
    status,
    runRequested,
    target: [target.allowed, target.oddsKeyConfigured, target.adminTokenConfigured, target.adminAuthorized],
    observation: [observed.statusLabel, observed.responseHash, observed.fetchedEvents, observed.normalizedOddsRows]
  });

  return {
    generatedAt: now.toISOString(),
    date: oddsMap.date,
    sport: "football",
    mode: "decision-epl-odds-dry-run-receipt",
    status,
    receiptHash,
    oddsMapHash: oddsMap.mapHash,
    summary: summaryFor(status, observed),
    request,
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The request is admin-authorized with x-oddspadi-admin-token.",
        "The provider sync request is forced to The Odds API, soccer_epl, dryRun=true, server-only odds key usage, and the live odds endpoint for today/future fixtures.",
        "The result status is dry-run and normalized odds row counts are recorded without writing odds snapshots, decisions, training rows, published picks, or stakes."
      ],
      failureSignals: ["missing odds key", "missing or invalid admin header", "provider-error", "stored status", "dryRun=false", "zero normalized odds rows"],
      fallbackAction: "Keep EPL odds market map in read-only hold and configure odds/admin credentials before retrying the dry-run receipt."
    },
    controls: {
      canRunOddsDryRun: target.allowed,
      canExecuteShell: false,
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([EPL_ODDS_DRY_RUN_PATH, "/api/sports/decision/epl-odds-market-map", "/api/sports/decision/odds-intelligence-proof", ...oddsMap.proofUrls]),
    locks: unique([
      "EPL odds dry-run receipt requires a valid admin header before any provider call is made.",
      "The provider request is forced to The Odds API soccer_epl with dryRun=true.",
      "It cannot write odds snapshots, persist decisions, write training rows, train models, publish picks, stake, or upgrade public action.",
      "Observed output is normalized counts, provider status, response hash, and public signals only.",
      ...oddsMap.locks
    ])
  };
}

export async function observeDecisionEplOddsDryRunReceipt({
  oddsMap,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date(),
  syncImpl = syncHistoricalFootballProvider as OddsSyncRunner
}: {
  oddsMap: DecisionEplOddsMarketMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  origin?: string;
  now?: Date;
  syncImpl?: OddsSyncRunner;
}): Promise<DecisionEplOddsDryRunReceipt> {
  const preview = buildDecisionEplOddsDryRunReceipt({ oddsMap, runRequested, adminAuthorized, env, origin, now });
  if (!runRequested || !preview.target.allowed) return preview;

  try {
    const providerDate = shouldUseHistoricalOddsEndpoint(preview.request.date, now) ? preview.request.date : undefined;
    const result = await syncImpl({
      request: {
        provider: "the-odds-api",
        sportKey: preview.request.sportKey,
        date: providerDate,
        regions: preview.request.regions,
        dryRun: true,
        limit: preview.request.limit
      },
      env
    });
    return buildDecisionEplOddsDryRunReceipt({
      oddsMap,
      runRequested,
      adminAuthorized,
      env,
      observation: observationFromResult(result),
      origin,
      now
    });
  } catch (error) {
    const observation: DecisionEplOddsDryRunReceiptObservation = {
      ...defaultObservation(),
      attempted: true,
      error: error instanceof Error ? error.message : "EPL odds dry-run receipt failed."
    };
    return buildDecisionEplOddsDryRunReceipt({ oddsMap, runRequested, adminAuthorized, env, observation, origin, now });
  }
}
