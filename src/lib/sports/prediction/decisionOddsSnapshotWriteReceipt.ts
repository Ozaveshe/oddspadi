import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionEplOddsMarketMap } from "@/lib/sports/prediction/decisionEplOddsMarketMap";
import type { DecisionOddsSnapshotStorageReadiness } from "@/lib/sports/prediction/decisionOddsSnapshotStorageReadiness";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import {
  syncHistoricalFootballProvider,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type OddsSnapshotSyncRunner = (input: {
  request: ProviderSyncRequest;
  env?: EnvMap;
}) => Promise<ProviderSyncResult>;

export type DecisionOddsSnapshotWriteReceiptStatus =
  | "blocked-readiness"
  | "needs-odds-key"
  | "needs-admin-token"
  | "admin-blocked"
  | "not-run"
  | "stored"
  | "provider-error"
  | "unsafe-dry-run"
  | "failed";

export type DecisionOddsSnapshotWriteReceiptObservation = {
  attempted: boolean;
  statusLabel: ProviderSyncResult["status"] | null;
  configured: boolean | null;
  provider: ProviderSyncResult["provider"] | null;
  dryRun: boolean | null;
  endpoint: string | null;
  fetchedEvents: number;
  normalizedFixtures: number;
  oddsRows: number;
  rowsWritten: number;
  ingestionRunId: string | null;
  responseHash: string | null;
  reason: string | null;
  error: string | null;
  signals: string[];
};

export type DecisionOddsSnapshotWriteReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-odds-snapshot-write-receipt";
  status: DecisionOddsSnapshotWriteReceiptStatus;
  receiptHash: string;
  storageReadinessHash: string;
  oddsMapHash: string;
  summary: string;
  request: {
    provider: "the-odds-api";
    sportKey: string;
    date: string;
    regions: string;
    markets: string;
    dryRun: false;
    limit: number;
  };
  target: {
    allowed: boolean;
    method: "GET" | null;
    path: string;
    url: string;
    reason: string;
    requiresAdminHeader: true;
    storageReady: boolean;
    oddsKeyConfigured: boolean;
    adminTokenConfigured: boolean;
    adminAuthorized: boolean;
    destructiveReplace: true;
  };
  observation: DecisionOddsSnapshotWriteReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canRequestAdminWrite: boolean;
    canExecuteProviderWrite: boolean;
    canWriteOddsSnapshots: boolean;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const ODDS_SNAPSHOT_WRITE_PATH = "/api/sports/decision/odds-snapshot-write-receipt";

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 36): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function defaultObservation(): DecisionOddsSnapshotWriteReceiptObservation {
  return {
    attempted: false,
    statusLabel: null,
    configured: null,
    provider: null,
    dryRun: null,
    endpoint: null,
    fetchedEvents: 0,
    normalizedFixtures: 0,
    oddsRows: 0,
    rowsWritten: 0,
    ingestionRunId: null,
    responseHash: null,
    reason: null,
    error: null,
    signals: []
  };
}

function observationFromResult(result: ProviderSyncResult): DecisionOddsSnapshotWriteReceiptObservation {
  const responseHash = stableHash(result);
  const oddsRows = result.ingestion?.counts.oddsRows ?? 0;
  const rowsWritten = result.ingestion?.rowsWritten ?? 0;
  return {
    attempted: true,
    statusLabel: result.status,
    configured: result.configured,
    provider: result.provider,
    dryRun: result.dryRun,
    endpoint: result.endpoint,
    fetchedEvents: result.fetched,
    normalizedFixtures: result.normalized,
    oddsRows,
    rowsWritten,
    ingestionRunId: result.ingestion?.ingestionRunId ?? null,
    responseHash,
    reason: result.reason ? compact(result.reason) : null,
    error: result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response" ? result.reason ?? result.status : null,
    signals: unique([
      `status:${result.status}`,
      `configured:${result.configured}`,
      `provider:${result.provider}`,
      `dryRun:${result.dryRun}`,
      `events:${result.fetched}`,
      `fixtures:${result.normalized}`,
      `oddsRows:${oddsRows}`,
      `rowsWritten:${rowsWritten}`,
      `proof:${responseHash}`
    ])
  };
}

function requestFor(oddsMap: DecisionEplOddsMarketMap): DecisionOddsSnapshotWriteReceipt["request"] {
  return {
    provider: "the-odds-api",
    sportKey: oddsMap.source.sportKey,
    date: `${oddsMap.selectedRow?.date ?? oddsMap.date}T12:00:00Z`,
    regions: oddsMap.dryRunPlan.regionsParam,
    markets: oddsMap.dryRunPlan.marketsParam,
    dryRun: false,
    limit: 50
  };
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionOddsSnapshotWriteReceipt["target"];
  observation: DecisionOddsSnapshotWriteReceiptObservation;
}): DecisionOddsSnapshotWriteReceiptStatus {
  if (!target.storageReady) return "blocked-readiness";
  if (!target.oddsKeyConfigured) return "needs-odds-key";
  if (!target.adminTokenConfigured) return "needs-admin-token";
  if (requested && !target.adminAuthorized) return "admin-blocked";
  if (!requested) return "not-run";
  if (!target.allowed) return "blocked-readiness";
  if (!observation.attempted) return "failed";
  if (observation.statusLabel === "stored" && observation.dryRun === false && observation.oddsRows > 0 && observation.rowsWritten > 0) return "stored";
  if (observation.statusLabel === "dry-run" || observation.dryRun === true) return "unsafe-dry-run";
  if (observation.statusLabel === "provider-error") return "provider-error";
  return "failed";
}

function summaryFor(status: DecisionOddsSnapshotWriteReceiptStatus, observation: DecisionOddsSnapshotWriteReceiptObservation): string {
  if (status === "stored") {
    return `Admin odds snapshot write stored ${observation.oddsRows} odds row(s) from ${observation.fetchedEvents} bookmaker event(s).`;
  }
  if (status === "blocked-readiness") return "Odds snapshot write is blocked until odds proof and storage readiness both pass.";
  if (status === "needs-odds-key") return "Odds snapshot write needs THE_ODDS_API_KEY or ODDS_API_KEY.";
  if (status === "needs-admin-token") return "Odds snapshot write needs ODDSPADI_ADMIN_TOKEN before an operator can run it.";
  if (status === "admin-blocked") return "Odds snapshot write was requested but blocked because the admin header was missing or invalid.";
  if (status === "not-run") return "Odds snapshot write receipt is ready for an explicit admin run, but has not executed.";
  if (status === "unsafe-dry-run") return "Odds snapshot write returned dry-run output instead of stored rows; keep writes locked and inspect provider sync configuration.";
  if (status === "provider-error") return `Odds snapshot write reached The Odds API but failed: ${observation.reason ?? observation.error ?? "provider error"}.`;
  return `Odds snapshot write failed: ${observation.reason ?? observation.error ?? "unknown failure"}.`;
}

export function buildDecisionOddsSnapshotWriteReceipt({
  oddsMap,
  storageReadiness,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  observation,
  origin = decisionSiteOrigin(),
  now = new Date()
}: {
  oddsMap: DecisionEplOddsMarketMap;
  storageReadiness: DecisionOddsSnapshotStorageReadiness;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  observation?: DecisionOddsSnapshotWriteReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionOddsSnapshotWriteReceipt {
  const request = requestFor(oddsMap);
  const oddsKeyConfigured = hasAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const adminTokenConfigured = hasAny(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const storageReady = storageReadiness.status === "ready-shadow-storage-review";
  const allowed = storageReady && oddsKeyConfigured && adminTokenConfigured && (!runRequested || adminAuthorized);
  const observed = observation ?? defaultObservation();
  const target: DecisionOddsSnapshotWriteReceipt["target"] = {
    allowed,
    method: allowed ? "GET" : null,
    path: `${ODDS_SNAPSHOT_WRITE_PATH}?date=${encodeURIComponent(oddsMap.date)}&run=1`,
    url: new URL(`${ODDS_SNAPSHOT_WRITE_PATH}?date=${encodeURIComponent(oddsMap.date)}&run=1`, origin).toString(),
    reason: storageReady
      ? allowed
        ? "Approved admin-authorized The Odds API odds snapshot write through the existing provider ingestion path."
        : "Odds snapshot write is waiting for odds key, admin token, or a valid x-oddspadi-admin-token header."
      : "Odds snapshot write is blocked by odds snapshot storage readiness gates.",
    requiresAdminHeader: true,
    storageReady,
    oddsKeyConfigured,
    adminTokenConfigured,
    adminAuthorized,
    destructiveReplace: true
  };
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const receiptHash = stableHash({
    date: oddsMap.date,
    oddsMap: oddsMap.mapHash,
    storage: storageReadiness.readinessHash,
    request,
    status,
    requested: runRequested,
    target: [target.storageReady, target.oddsKeyConfigured, target.adminTokenConfigured, target.adminAuthorized],
    observation: [observed.statusLabel, observed.responseHash, observed.oddsRows, observed.rowsWritten]
  });

  return {
    generatedAt: now.toISOString(),
    date: oddsMap.date,
    sport: "football",
    mode: "decision-odds-snapshot-write-receipt",
    status,
    receiptHash,
    storageReadinessHash: storageReadiness.readinessHash,
    oddsMapHash: oddsMap.mapHash,
    summary: summaryFor(status, observed),
    request,
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The request is admin-authorized with x-oddspadi-admin-token.",
        "Odds snapshot storage readiness is ready-shadow-storage-review.",
        "Provider sync is forced to The Odds API soccer_epl, dryRun=false, and server-only odds key usage.",
        "The stored result includes non-zero oddsRows and rowsWritten without persisting decisions, training rows, learned weights, published picks, or stakes."
      ],
      failureSignals: ["missing odds key", "missing or invalid admin header", "blocked storage readiness", "provider-error", "dryRun=true", "zero oddsRows", "zero rowsWritten"],
      fallbackAction: "Keep odds snapshot storage read-only and re-run dry-run/storage proof before any write retry."
    },
    controls: {
      canRequestAdminWrite: storageReady && oddsKeyConfigured && adminTokenConfigured,
      canExecuteProviderWrite: target.allowed && runRequested,
      canWriteOddsSnapshots: target.allowed && runRequested,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      ODDS_SNAPSHOT_WRITE_PATH,
      "/api/sports/decision/odds-snapshot-storage-readiness",
      "/api/sports/decision/epl-odds-dry-run-receipt",
      "/api/sports/decision/epl-odds-dry-run-interpreter",
      "/api/sports/decision/supabase-proof-binder",
      "/api/sports/decision/supabase-schema-manifest",
      ...storageReadiness.proofUrls
    ]),
    locks: unique([
      "Odds snapshot write receipt uses the existing provider ingestion path; no parallel writer is introduced.",
      "When executed with dryRun=false, ingestion may delete and replace prior The Odds API odds snapshots for the same fixture external IDs.",
      "It requires ready storage review, server-only odds key, ODDSPADI_ADMIN_TOKEN, valid admin header, and run=1.",
      "It cannot persist decisions, write training rows, train models, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...storageReadiness.locks
    ])
  };
}

export async function observeDecisionOddsSnapshotWriteReceipt({
  oddsMap,
  storageReadiness,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date(),
  syncImpl = syncHistoricalFootballProvider as OddsSnapshotSyncRunner
}: {
  oddsMap: DecisionEplOddsMarketMap;
  storageReadiness: DecisionOddsSnapshotStorageReadiness;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  origin?: string;
  now?: Date;
  syncImpl?: OddsSnapshotSyncRunner;
}): Promise<DecisionOddsSnapshotWriteReceipt> {
  const preview = buildDecisionOddsSnapshotWriteReceipt({ oddsMap, storageReadiness, runRequested, adminAuthorized, env, origin, now });
  if (!runRequested || !preview.target.allowed) return preview;

  try {
    const result = await syncImpl({
      request: {
        provider: "the-odds-api",
        sportKey: preview.request.sportKey,
        date: preview.request.date,
        regions: preview.request.regions,
        dryRun: false,
        limit: preview.request.limit
      },
      env
    });
    return buildDecisionOddsSnapshotWriteReceipt({
      oddsMap,
      storageReadiness,
      runRequested,
      adminAuthorized,
      env,
      observation: observationFromResult(result),
      origin,
      now
    });
  } catch (error) {
    const observation: DecisionOddsSnapshotWriteReceiptObservation = {
      ...defaultObservation(),
      attempted: true,
      error: error instanceof Error ? error.message : "Odds snapshot write receipt failed."
    };
    return buildDecisionOddsSnapshotWriteReceipt({ oddsMap, storageReadiness, runRequested, adminAuthorized, env, observation, origin, now });
  }
}
