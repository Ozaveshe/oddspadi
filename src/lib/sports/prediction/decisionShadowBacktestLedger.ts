import type { CalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import type { DecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { DecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import type { Sport } from "@/lib/sports/types";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export type DecisionShadowBacktestLedgerStatus = "ready-shadow" | "needs-settlement" | "needs-backtest" | "needs-storage" | "blocked";
export type DecisionShadowBacktestGateStatus = "pass" | "watch" | "block";

export type DecisionShadowBacktestGate = {
  id: "prediction-sample" | "settlement-labels" | "historical-backtest" | "calibration-sample" | "learning-lock";
  label: string;
  status: DecisionShadowBacktestGateStatus;
  detail: string;
  nextAction: string;
};

export type DecisionShadowBacktestBucket = {
  id: "low" | "medium" | "high";
  minProbability: number;
  maxProbability: number;
  candidates: number;
  averageProbability: number | null;
  averageExpectedBrier: number | null;
  averageReplayPressure: number | null;
};

export type DecisionShadowBacktestLedger = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "shadow-backtest-ledger";
  status: DecisionShadowBacktestLedgerStatus;
  ledgerHash: string;
  summary: string;
  sample: {
    candidates: number;
    averageModelProbability: number | null;
    averageExpectedBrier: number | null;
    averageReplayPressure: number | null;
    averageExpectedValue: number | null;
    averageNoVigEdge: number | null;
    expectedRoiUnits: number | null;
    waitingSettlements: number;
    gradeableNow: number;
  };
  historicalBacktest: {
    configured: boolean;
    status: TrainingDataSnapshot["status"];
    backtestId: string | null;
    sampleSize: number;
    pickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    roiUnits: number | null;
    closingLineValue: number | null;
    calibrationError: number | null;
  };
  calibration: {
    status: CalibrationSnapshot["status"];
    configured: boolean;
    sampleSize: number;
    settledSize: number;
    brierScore: number | null;
    winRate: number | null;
    averageClosingLineValue: number | null;
    notes: string[];
  };
  buckets: DecisionShadowBacktestBucket[];
  gates: DecisionShadowBacktestGate[];
  nextSafeAction: {
    label: string;
    command: string | null;
    expectedEvidence: string;
    safeToRun: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canStoreBacktest: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function round(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values: Array<number | null | undefined>, digits = 6): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, digits);
}

function sum(values: Array<number | null | undefined>, digits = 6): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((total, value) => total + value, 0), digits);
}

function compact(value: string | null | undefined, maxLength = 240): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function bucketFor(id: DecisionShadowBacktestBucket["id"], minProbability: number, maxProbability: number, replay: DecisionOutcomeReplay): DecisionShadowBacktestBucket {
  const rows = replay.rows.filter((row) => row.modelProbability >= minProbability && row.modelProbability < maxProbability);
  return {
    id,
    minProbability,
    maxProbability,
    candidates: rows.length,
    averageProbability: average(rows.map((row) => row.modelProbability)),
    averageExpectedBrier: average(rows.map((row) => row.expectedBrier)),
    averageReplayPressure: average(rows.map((row) => row.replayPressure))
  };
}

function gate(input: DecisionShadowBacktestGate): DecisionShadowBacktestGate {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction, 220)
  };
}

function statusFor(gates: DecisionShadowBacktestGate[], training: TrainingDataSnapshot, calibration: CalibrationSnapshot): DecisionShadowBacktestLedgerStatus {
  if (gates.some((item) => item.status === "block")) {
    if (training.status === "not-configured" || calibration.status === "not-configured") return "needs-storage";
    return "blocked";
  }
  if (!training.latestBacktest) return "needs-backtest";
  if (gates.some((item) => item.id === "settlement-labels" && item.status === "watch")) return "needs-settlement";
  if (gates.some((item) => item.status === "watch")) return "needs-settlement";
  return "ready-shadow";
}

function summaryFor(status: DecisionShadowBacktestLedgerStatus, sample: DecisionShadowBacktestLedger["sample"]): string {
  if (status === "ready-shadow") return `Shadow backtest ledger can score ${sample.candidates} candidate(s) against historical and calibration evidence; learning remains locked.`;
  if (status === "needs-backtest") return "Shadow backtest ledger has current prediction replay, but no completed historical backtest is available.";
  if (status === "needs-storage") return "Shadow backtest ledger needs Supabase storage proof before real backtests and calibration can be read.";
  if (status === "blocked") return "Shadow backtest ledger is blocked by failed training, calibration, or replay evidence.";
  return `Shadow backtest ledger is waiting on settlement labels for ${sample.waitingSettlements} candidate(s).`;
}

export function buildDecisionShadowBacktestLedger({
  date,
  sport,
  outcomeReplay,
  settlementImpact,
  training,
  calibration,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  training: TrainingDataSnapshot;
  calibration: CalibrationSnapshot;
  now?: Date;
}): DecisionShadowBacktestLedger {
  const sample = {
    candidates: outcomeReplay.rows.length,
    averageModelProbability: average(outcomeReplay.rows.map((row) => row.modelProbability)),
    averageExpectedBrier: average(outcomeReplay.rows.map((row) => row.expectedBrier)),
    averageReplayPressure: average(outcomeReplay.rows.map((row) => row.replayPressure)),
    averageExpectedValue: average(outcomeReplay.rows.map((row) => row.expectedValue)),
    averageNoVigEdge: average(outcomeReplay.rows.map((row) => row.noVigEdge)),
    expectedRoiUnits: sum(outcomeReplay.rows.map((row) => row.expectedValue)),
    waitingSettlements: settlementImpact.totals.waitingFinalScore,
    gradeableNow: settlementImpact.totals.gradeableNow
  };
  const historicalBacktest = {
    configured: training.configured,
    status: training.status,
    backtestId: training.latestBacktest?.id ?? null,
    sampleSize: training.latestBacktest?.sampleSize ?? 0,
    pickCount: training.latestBacktest?.pickCount ?? 0,
    brierScore: training.latestBacktest?.brierScore ?? null,
    logLoss: training.latestBacktest?.logLoss ?? null,
    roiUnits: training.latestBacktest?.roiUnits ?? null,
    closingLineValue: training.latestBacktest?.closingLineValue ?? null,
    calibrationError: training.latestBacktest?.calibrationError ?? null
  };
  const currentCalibration = calibration.currentMetrics ?? calibration.latestRun;
  const calibrationSummary = {
    status: calibration.status,
    configured: calibration.configured,
    sampleSize: currentCalibration?.sampleSize ?? 0,
    settledSize: currentCalibration?.settledSize ?? 0,
    brierScore: currentCalibration?.brierScore ?? null,
    winRate: currentCalibration?.winRate ?? null,
    averageClosingLineValue: currentCalibration?.averageClosingLineValue ?? null,
    notes: currentCalibration?.notes ?? (calibration.reason ? [calibration.reason] : [])
  };
  const buckets = [
    bucketFor("low", 0, 0.45, outcomeReplay),
    bucketFor("medium", 0.45, 0.6, outcomeReplay),
    bucketFor("high", 0.6, 1.001, outcomeReplay)
  ];
  const gates = [
    gate({
      id: "prediction-sample",
      label: "Prediction replay sample",
      status: sample.candidates > 0 ? "pass" : "block",
      detail:
        sample.candidates > 0
          ? `${sample.candidates} current candidate(s), average expected Brier ${sample.averageExpectedBrier ?? "N/A"}, pressure ${sample.averageReplayPressure ?? "N/A"}.`
          : "No current positive-value candidates are available for replay scoring.",
      nextAction: sample.candidates > 0 ? "Keep current candidates in shadow replay." : "Wait for priced candidates with model probabilities and odds."
    }),
    gate({
      id: "settlement-labels",
      label: "Settlement labels",
      status: settlementImpact.totals.gradeableNow > 0 ? "pass" : settlementImpact.totals.waitingFinalScore > 0 ? "watch" : "block",
      detail: settlementImpact.summary,
      nextAction: settlementImpact.rows[0]?.recommendedNext ?? "Collect final scores, closing odds, and settlement outcomes."
    }),
    gate({
      id: "historical-backtest",
      label: "Historical backtest",
      status: training.latestBacktest?.status === "completed" ? "pass" : training.configured ? "watch" : "block",
      detail: training.latestBacktest
        ? `Latest backtest ${training.latestBacktest.status}: sample ${training.latestBacktest.sampleSize}, Brier ${training.latestBacktest.brierScore ?? "N/A"}, ROI ${training.latestBacktest.roiUnits}.`
        : training.readiness.detail,
      nextAction: training.latestBacktest ? "Compare replay pressure against the next calibration run." : "Run a real-data backtest after the historical corpus is imported."
    }),
    gate({
      id: "calibration-sample",
      label: "Calibration sample",
      status: calibrationSummary.settledSize >= 30 ? "pass" : calibrationSummary.settledSize > 0 ? "watch" : calibration.configured ? "watch" : "block",
      detail:
        calibrationSummary.settledSize > 0
          ? `${calibrationSummary.settledSize}/${calibrationSummary.sampleSize} settled calibration rows; Brier ${calibrationSummary.brierScore ?? "N/A"}.`
          : calibration.reason ?? "No settled calibration sample is available yet.",
      nextAction: calibrationSummary.settledSize >= 30 ? "Use calibration as shadow evidence only." : "Settle at least 30 outcomes before trusting calibration buckets."
    }),
    gate({
      id: "learning-lock",
      label: "Learning lock",
      status: "pass",
      detail: "Backtest ledger is read-only and cannot store backtests, persist outcomes, train, apply learned weights, publish picks, or stake.",
      nextAction: "Unlock learning only after corpus, settlement, calibration, CLV, and governance receipts pass."
    })
  ];
  const status = statusFor(gates, training, calibration);
  const nextGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? gates[0];

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "shadow-backtest-ledger",
    status,
    ledgerHash: stableHash({
      date,
      sport,
      replay: outcomeReplay.replayHash,
      settlement: settlementImpact.impactHash,
      training: training.latestBacktest?.id ?? training.status,
      calibration: [calibration.status, calibrationSummary.sampleSize, calibrationSummary.settledSize],
      gates: gates.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, sample),
    sample,
    historicalBacktest,
    calibration: calibrationSummary,
    buckets,
    gates,
    nextSafeAction: {
      label: nextGate.label,
      command: null,
      expectedEvidence: nextGate.nextAction,
      safeToRun: false
    },
    controls: {
      canInspectReadOnly: true,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canStoreBacktest: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/shadow-backtest-ledger",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/settlement-impact",
      "/api/sports/decision/calibration",
      "/api/sports/decision/training/readiness"
    ],
    locks: [
      "Shadow backtest ledger is read-only.",
      "It cannot persist outcomes, store backtests, run calibration, train models, apply learned weights, publish picks, or stake.",
      "Backtest and calibration evidence can influence only shadow review until governance and operator approval pass."
    ]
  };
}
