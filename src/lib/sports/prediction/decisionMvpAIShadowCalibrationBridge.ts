import type { DecisionMvpAIOutcomeLabelGate } from "@/lib/sports/prediction/decisionMvpAIOutcomeLabelGate";

export type DecisionMvpAIShadowCalibrationBridgeStatus = "waiting-labels" | "waiting-sample" | "shadow-calibration-ready" | "withheld";

export type DecisionMvpAIShadowCalibrationBridge = {
  mode: "decision-mvp-ai-shadow-calibration-bridge";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIOutcomeLabelGate["sport"];
  status: DecisionMvpAIShadowCalibrationBridgeStatus;
  bridgeHash: string;
  summary: string;
  calibrationCase: {
    caseId: string;
    sourceLabelGateHash: string;
    rowKey: string;
    sampleState: "missing-label" | "thin-sample" | "shadow-ready" | "withheld";
    requiredSettledRows: number;
    currentSettledRows: number;
    canEnterCalibrationSample: false;
    canAffectLiveConfidence: false;
  };
  mathChecks: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    formula: string;
    requiredFields: string[];
    detail: string;
  }>;
  calibrationBuckets: Array<{
    id: "low" | "medium" | "high";
    probabilityRange: string;
    minimumSettledRows: number;
    currentSettledRows: number;
    status: "pass" | "watch" | "block";
  }>;
  controls: {
    canInspectReadOnly: true;
    canStageShadowCalibration: boolean;
    canPersistCalibrationRun: false;
    canPersistOutcomeLabel: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  source: {
    labelGateHash: string;
    quarantineHash: string;
    handoffHash: string;
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    releaseHash: string;
    auditHash: string;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

const REQUIRED_SETTLED_ROWS = 30;
const REQUIRED_BUCKET_ROWS = 10;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string | null | undefined, maxLength = 320): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor(labelGate: DecisionMvpAIOutcomeLabelGate): DecisionMvpAIShadowCalibrationBridgeStatus {
  if (labelGate.status === "withheld") return "withheld";
  if (labelGate.status !== "ready-shadow-label") return "waiting-labels";
  return "waiting-sample";
}

function summaryFor(status: DecisionMvpAIShadowCalibrationBridgeStatus): string {
  if (status === "shadow-calibration-ready") return "MVP AI shadow calibration bridge can stage calibration math without public influence.";
  if (status === "waiting-sample") return "MVP AI shadow calibration bridge has a draft label shape but needs enough settled rows before calibration.";
  if (status === "waiting-labels") return "MVP AI shadow calibration bridge is waiting for settled labels, closing odds, and storage approval.";
  return "MVP AI shadow calibration bridge withholds calibration because the upstream case was withheld.";
}

function fieldStatus(labelGate: DecisionMvpAIOutcomeLabelGate, fields: string[]): "pass" | "watch" | "block" {
  const knownFields = new Set(labelGate.shadowTrainingRow.fields);
  if (!fields.every((field) => knownFields.has(field))) return "block";
  if (labelGate.status !== "ready-shadow-label") return "block";
  return "watch";
}

export function buildDecisionMvpAIShadowCalibrationBridge({
  outcomeLabelGate,
  now = new Date()
}: {
  outcomeLabelGate: DecisionMvpAIOutcomeLabelGate;
  now?: Date;
}): DecisionMvpAIShadowCalibrationBridge {
  const status = statusFor(outcomeLabelGate);
  const currentSettledRows = 0;
  const mathChecks = [
    {
      id: "brier-score",
      label: "Brier score",
      status: fieldStatus(outcomeLabelGate, ["market_result", "case_id"]),
      formula: "(model_probability - actual_outcome)^2",
      requiredFields: ["model_probability", "market_result"],
      detail: "Requires a binary settled outcome for the exact market and the model probability recorded at decision time."
    },
    {
      id: "log-loss",
      label: "Log loss",
      status: fieldStatus(outcomeLabelGate, ["market_result", "case_id"]),
      formula: "-log(model_probability) if won, -log(1 - model_probability) if lost",
      requiredFields: ["model_probability", "market_result"],
      detail: "Requires the same market-level settlement as Brier score, with probability bounded away from 0 and 1."
    },
    {
      id: "closing-line-value",
      label: "Closing-line value",
      status: fieldStatus(outcomeLabelGate, ["closing_decimal_odds"]),
      formula: "taken_decimal_odds / closing_decimal_odds - 1",
      requiredFields: ["taken_decimal_odds", "closing_decimal_odds"],
      detail: "Requires the price available when the decision was made and a verified closing bookmaker price."
    },
    {
      id: "roi-units",
      label: "ROI units",
      status: fieldStatus(outcomeLabelGate, ["market_result"]),
      formula: "won ? decimal_odds - 1 : lost ? -1 : 0",
      requiredFields: ["market_result", "taken_decimal_odds"],
      detail: "Requires settlement handling for win/loss/push/void before any performance claim is allowed."
    },
    {
      id: "calibration-buckets",
      label: "Calibration buckets",
      status: currentSettledRows >= REQUIRED_SETTLED_ROWS ? ("watch" as const) : ("block" as const),
      formula: "bucket by model_probability, then compare observed win rate to average predicted probability",
      requiredFields: ["model_probability", "market_result", "settled_at"],
      detail: `Requires at least ${REQUIRED_SETTLED_ROWS} settled rows overall and ${REQUIRED_BUCKET_ROWS} rows per active bucket before trusting bucket reliability.`
    }
  ];
  const buckets: DecisionMvpAIShadowCalibrationBridge["calibrationBuckets"] = [
    { id: "low", probabilityRange: "< 45%", minimumSettledRows: REQUIRED_BUCKET_ROWS, currentSettledRows: 0, status: "block" },
    { id: "medium", probabilityRange: "45% - 60%", minimumSettledRows: REQUIRED_BUCKET_ROWS, currentSettledRows: 0, status: "block" },
    { id: "high", probabilityRange: "> 60%", minimumSettledRows: REQUIRED_BUCKET_ROWS, currentSettledRows: 0, status: "block" }
  ];
  const blockedCheck = mathChecks.find((check) => check.status === "block") ?? null;
  const canStageShadowCalibration = status === "shadow-calibration-ready";

  return {
    mode: "decision-mvp-ai-shadow-calibration-bridge",
    generatedAt: now.toISOString(),
    date: outcomeLabelGate.date,
    sport: outcomeLabelGate.sport,
    status,
    bridgeHash: stableHash({
      status,
      labelGateHash: outcomeLabelGate.labelGateHash,
      mathChecks: mathChecks.map((check) => [check.id, check.status]),
      buckets: buckets.map((bucket) => [bucket.id, bucket.status])
    }),
    summary: summaryFor(status),
    calibrationCase: {
      caseId: outcomeLabelGate.case.caseId,
      sourceLabelGateHash: outcomeLabelGate.labelGateHash,
      rowKey: outcomeLabelGate.shadowTrainingRow.rowKey,
      sampleState: status === "withheld" ? "withheld" : status === "waiting-labels" ? "missing-label" : status === "waiting-sample" ? "thin-sample" : "shadow-ready",
      requiredSettledRows: REQUIRED_SETTLED_ROWS,
      currentSettledRows,
      canEnterCalibrationSample: false,
      canAffectLiveConfidence: false
    },
    mathChecks,
    calibrationBuckets: buckets,
    controls: {
      canInspectReadOnly: true,
      canStageShadowCalibration,
      canPersistCalibrationRun: false,
      canPersistOutcomeLabel: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    source: {
      labelGateHash: outcomeLabelGate.labelGateHash,
      quarantineHash: outcomeLabelGate.source.quarantineHash,
      handoffHash: outcomeLabelGate.source.handoffHash,
      critiqueLedgerHash: outcomeLabelGate.source.critiqueLedgerHash,
      decisionTurnHash: outcomeLabelGate.source.decisionTurnHash,
      releaseHash: outcomeLabelGate.source.releaseHash,
      auditHash: outcomeLabelGate.source.auditHash
    },
    nextAction: {
      label: blockedCheck?.label ?? "Stage shadow calibration",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-shadow-calibration-bridge",
      safeToRun: false,
      expectedEvidence: compact(blockedCheck ? `Blocked calibration math: ${blockedCheck.detail}` : "Keep calibration in shadow mode until promotion gates approve it.")
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-shadow-calibration-bridge",
      ...outcomeLabelGate.proofUrls
    ]),
    locks: unique([
      "MVP AI shadow calibration bridge computes readiness only; it cannot persist calibration, outcomes, training rows, learned weights, confidence, picks, stakes, or hidden chain-of-thought.",
      ...outcomeLabelGate.locks
    ])
  };
}
