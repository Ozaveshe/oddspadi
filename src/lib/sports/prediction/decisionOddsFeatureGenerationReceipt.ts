import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionOddsFeatureReadiness } from "@/lib/sports/prediction/decisionOddsFeatureReadiness";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

type EnvMap = Record<string, string | undefined>;

export type DecisionOddsFeatureGenerationReceiptStatus =
  | "waiting-odds-write"
  | "blocked-readiness"
  | "needs-admin-token"
  | "admin-blocked"
  | "not-run"
  | "generated-preview"
  | "empty-preview"
  | "failed";

export type DecisionOddsFeatureGenerationPreviewResult = {
  status: "generated-preview" | "empty-preview" | "failed";
  sourceOddsRows: number;
  candidateFeatureRows: number;
  generatedFeatureRows: number;
  formulaHash: string;
  reason: string | null;
  error: string | null;
  signals: string[];
};

export type DecisionOddsFeatureGenerationReceiptObservation = {
  attempted: boolean;
  statusLabel: DecisionOddsFeatureGenerationPreviewResult["status"] | null;
  sourceOddsRows: number;
  candidateFeatureRows: number;
  generatedFeatureRows: number;
  rowsWritten: number;
  formulaHash: string | null;
  reason: string | null;
  error: string | null;
  signals: string[];
};

export type DecisionOddsFeatureGenerationReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-odds-feature-generation-receipt";
  status: DecisionOddsFeatureGenerationReceiptStatus;
  receiptHash: string;
  readinessHash: string;
  summary: string;
  request: {
    sourceTable: "op_odds_snapshots";
    targetTable: "op_training_feature_snapshots";
    dryRun: true;
    formulas: number;
  };
  target: {
    allowed: boolean;
    method: "GET" | null;
    path: string;
    url: string;
    reason: string;
    requiresAdminHeader: true;
    readinessStatus: DecisionOddsFeatureReadiness["status"];
    adminTokenConfigured: boolean;
    adminAuthorized: boolean;
  };
  observation: DecisionOddsFeatureGenerationReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestAdminPreview: boolean;
    canExecuteFeaturePreview: boolean;
    canGenerateFeaturePreview: boolean;
    canWriteFeatureSnapshots: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

type FeaturePreviewRunner = (input: { readiness: DecisionOddsFeatureReadiness }) => Promise<DecisionOddsFeatureGenerationPreviewResult>;

const ODDS_FEATURE_GENERATION_PATH = "/api/sports/decision/odds-feature-generation-receipt";

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function formulaHashFor(readiness: DecisionOddsFeatureReadiness): string {
  return stableHash(readiness.features.map((feature) => [feature.id, feature.formula, feature.requiredFor]));
}

function defaultObservation(readiness: DecisionOddsFeatureReadiness): DecisionOddsFeatureGenerationReceiptObservation {
  return {
    attempted: false,
    statusLabel: null,
    sourceOddsRows: readiness.input.oddsRows,
    candidateFeatureRows: readiness.input.candidateFeatureRows,
    generatedFeatureRows: 0,
    rowsWritten: 0,
    formulaHash: formulaHashFor(readiness),
    reason: null,
    error: null,
    signals: []
  };
}

function observationFromResult(result: DecisionOddsFeatureGenerationPreviewResult): DecisionOddsFeatureGenerationReceiptObservation {
  return {
    attempted: true,
    statusLabel: result.status,
    sourceOddsRows: result.sourceOddsRows,
    candidateFeatureRows: result.candidateFeatureRows,
    generatedFeatureRows: result.generatedFeatureRows,
    rowsWritten: 0,
    formulaHash: result.formulaHash,
    reason: result.reason,
    error: result.error,
    signals: unique([
      `status:${result.status}`,
      `sourceOddsRows:${result.sourceOddsRows}`,
      `candidateFeatureRows:${result.candidateFeatureRows}`,
      `generatedFeatureRows:${result.generatedFeatureRows}`,
      `formula:${result.formulaHash}`,
      ...result.signals
    ])
  };
}

function statusFor({
  requested,
  target,
  observation,
  readiness
}: {
  requested: boolean;
  target: DecisionOddsFeatureGenerationReceipt["target"];
  observation: DecisionOddsFeatureGenerationReceiptObservation;
  readiness: DecisionOddsFeatureReadiness;
}): DecisionOddsFeatureGenerationReceiptStatus {
  if (readiness.status === "waiting-odds-write") return "waiting-odds-write";
  if (readiness.status === "blocked-training-proof") return "blocked-readiness";
  if (!target.adminTokenConfigured) return "needs-admin-token";
  if (requested && !target.adminAuthorized) return "admin-blocked";
  if (!requested) return "not-run";
  if (!target.allowed) return "blocked-readiness";
  if (!observation.attempted) return "failed";
  if (observation.statusLabel === "generated-preview" && observation.generatedFeatureRows > 0) return "generated-preview";
  if (observation.statusLabel === "empty-preview") return "empty-preview";
  return "failed";
}

function summaryFor(status: DecisionOddsFeatureGenerationReceiptStatus, observation: DecisionOddsFeatureGenerationReceiptObservation): string {
  if (status === "generated-preview") {
    return `Generated a read-only preview of ${observation.generatedFeatureRows} odds feature row(s); persistence remains locked.`;
  }
  if (status === "empty-preview") return "Feature preview ran but no model-ready odds feature rows were generated.";
  if (status === "waiting-odds-write") return "Odds feature generation is waiting for stored bookmaker odds snapshots.";
  if (status === "blocked-readiness") return "Odds feature generation is blocked by training/schema/corpus readiness proof.";
  if (status === "needs-admin-token") return "Odds feature preview needs ODDSPADI_ADMIN_TOKEN before an operator can request it.";
  if (status === "admin-blocked") return "Odds feature preview was requested but blocked because the admin header was missing or invalid.";
  if (status === "not-run") return "Odds feature preview is ready for an explicit admin run, but has not executed.";
  return `Odds feature preview failed: ${observation.reason ?? observation.error ?? "unknown failure"}.`;
}

function targetFor({
  readiness,
  runRequested,
  adminAuthorized,
  adminTokenConfigured,
  origin
}: {
  readiness: DecisionOddsFeatureReadiness;
  runRequested: boolean;
  adminAuthorized: boolean;
  adminTokenConfigured: boolean;
  origin: string;
}): DecisionOddsFeatureGenerationReceipt["target"] {
  const readinessAllowsPreview =
    readiness.controls.canUseStoredOddsForFeatureReview &&
    (readiness.status === "needs-training-corpus" || readiness.status === "ready-feature-shadow-review");
  const allowed = readinessAllowsPreview && adminTokenConfigured && (!runRequested || adminAuthorized);
  return {
    allowed,
    method: allowed ? "GET" : null,
    path: `${ODDS_FEATURE_GENERATION_PATH}?date=${encodeURIComponent(readiness.date)}&run=1`,
    url: new URL(`${ODDS_FEATURE_GENERATION_PATH}?date=${encodeURIComponent(readiness.date)}&run=1`, origin).toString(),
    reason: readinessAllowsPreview
      ? allowed
        ? "Approved admin-authorized dry-run feature preview from stored odds snapshots."
        : "Feature preview is waiting for ODDSPADI_ADMIN_TOKEN or a valid x-oddspadi-admin-token header."
      : "Feature preview is blocked until stored odds and training feature readiness pass.",
    requiresAdminHeader: true,
    readinessStatus: readiness.status,
    adminTokenConfigured,
    adminAuthorized
  };
}

export function buildDecisionOddsFeatureGenerationReceipt({
  readiness,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  observation,
  origin = decisionSiteOrigin(),
  now = new Date()
}: {
  readiness: DecisionOddsFeatureReadiness;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  observation?: DecisionOddsFeatureGenerationReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionOddsFeatureGenerationReceipt {
  const adminTokenConfigured = hasAny(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const target = targetFor({ readiness, runRequested, adminAuthorized, adminTokenConfigured, origin });
  const observed = observation ?? defaultObservation(readiness);
  const status = statusFor({ requested: runRequested, target, observation: observed, readiness });
  const request: DecisionOddsFeatureGenerationReceipt["request"] = {
    sourceTable: "op_odds_snapshots",
    targetTable: "op_training_feature_snapshots",
    dryRun: true,
    formulas: readiness.features.length
  };
  const receiptHash = stableHash({
    date: readiness.date,
    readiness: readiness.readinessHash,
    status,
    requested: runRequested,
    target: [target.allowed, target.adminTokenConfigured, target.adminAuthorized],
    observation: [observed.statusLabel, observed.sourceOddsRows, observed.candidateFeatureRows, observed.generatedFeatureRows, observed.formulaHash]
  });

  return {
    generatedAt: now.toISOString(),
    date: readiness.date,
    sport: "football",
    mode: "decision-odds-feature-generation-receipt",
    status,
    receiptHash,
    readinessHash: readiness.readinessHash,
    summary: summaryFor(status, observed),
    request,
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "Stored bookmaker odds exist and odds feature readiness allows shadow feature review.",
        "The request is admin-authorized with x-oddspadi-admin-token.",
        "Feature formulas are generated as a dry-run preview only.",
        "No rows are written to op_training_feature_snapshots until a separate feature-storage receipt is introduced."
      ],
      failureSignals: ["waiting-odds-write", "blocked-training-proof", "missing admin token", "invalid admin header", "zero candidateFeatureRows", "formula mismatch"],
      fallbackAction: "Keep feature snapshots locked and return to odds snapshot write/storage readiness proof."
    },
    controls: {
      canInspectReadOnly: true,
      canRequestAdminPreview: readiness.controls.canUseStoredOddsForFeatureReview && adminTokenConfigured,
      canExecuteFeaturePreview: target.allowed && runRequested,
      canGenerateFeaturePreview: target.allowed && runRequested,
      canWriteFeatureSnapshots: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canUseLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      ODDS_FEATURE_GENERATION_PATH,
      "/api/sports/decision/odds-feature-readiness",
      "/api/sports/decision/odds-snapshot-write-receipt",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/corpus-proof",
      ...readiness.proofUrls
    ]),
    locks: unique([
      "Odds feature generation receipt is a dry-run preview and cannot write op_training_feature_snapshots.",
      "Feature rows cannot train models or influence public probabilities until feature storage, backtests, calibration, and promotion gates pass.",
      "Expected value and CLV features require real model probabilities plus opening, pre-kickoff, and closing snapshots for the same market.",
      "No decision persistence, training-row write, learned-weight use, probability adjustment, confidence raise, public pick, stake, or public-action upgrade is allowed.",
      ...readiness.locks
    ])
  };
}

async function defaultFeaturePreview({ readiness }: { readiness: DecisionOddsFeatureReadiness }): Promise<DecisionOddsFeatureGenerationPreviewResult> {
  const formulaHash = formulaHashFor(readiness);
  const candidateFeatureRows = readiness.input.candidateFeatureRows;
  const sourceOddsRows = readiness.input.oddsRows;
  if (!sourceOddsRows || !candidateFeatureRows) {
    return {
      status: "empty-preview",
      sourceOddsRows,
      candidateFeatureRows,
      generatedFeatureRows: 0,
      formulaHash,
      reason: "Stored odds rows or candidate feature rows are unavailable.",
      error: null,
      signals: ["dryRun:true", "rowsWritten:0"]
    };
  }
  return {
    status: "generated-preview",
    sourceOddsRows,
    candidateFeatureRows,
    generatedFeatureRows: candidateFeatureRows,
    formulaHash,
    reason: null,
    error: null,
    signals: ["dryRun:true", "rowsWritten:0", "featureWriteLocked:true"]
  };
}

export async function observeDecisionOddsFeatureGenerationReceipt({
  readiness,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date(),
  previewImpl = defaultFeaturePreview
}: {
  readiness: DecisionOddsFeatureReadiness;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvMap;
  origin?: string;
  now?: Date;
  previewImpl?: FeaturePreviewRunner;
}): Promise<DecisionOddsFeatureGenerationReceipt> {
  const preview = buildDecisionOddsFeatureGenerationReceipt({ readiness, runRequested, adminAuthorized, env, origin, now });
  if (!runRequested || !preview.target.allowed) return preview;

  try {
    const result = await previewImpl({ readiness });
    return buildDecisionOddsFeatureGenerationReceipt({
      readiness,
      runRequested,
      adminAuthorized,
      env,
      observation: observationFromResult(result),
      origin,
      now
    });
  } catch (error) {
    const observation: DecisionOddsFeatureGenerationReceiptObservation = {
      ...defaultObservation(readiness),
      attempted: true,
      statusLabel: "failed",
      error: error instanceof Error ? error.message : "Odds feature preview failed."
    };
    return buildDecisionOddsFeatureGenerationReceipt({ readiness, runRequested, adminAuthorized, env, observation, origin, now });
  }
}
