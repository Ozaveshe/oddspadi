import type { DecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import type { DecisionOutcomeReplay, DecisionOutcomeReplayRow } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { DecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import type { DecisionShadowBacktestLedger } from "@/lib/sports/prediction/decisionShadowBacktestLedger";
import type { Sport } from "@/lib/sports/types";

export type DecisionCalibrationFeedbackStatus = "ready-shadow-feedback" | "waiting-labels" | "waiting-backtest" | "needs-storage" | "blocked";
export type DecisionCalibrationFeedbackAction = "grade-now" | "collect-label" | "run-backtest" | "quarantine-pattern";

export type DecisionCalibrationFeedbackRow = {
  id: string;
  matchId: string;
  match: string;
  market: string;
  selection: string;
  probabilityBucket: "low" | "medium" | "high";
  modelProbability: number;
  expectedBrier: number;
  expectedLogLoss: number;
  replayPressure: number;
  settlementStatus: DecisionOutcomeReplayRow["settlementPreview"]["status"];
  recommendedAction: DecisionCalibrationFeedbackAction;
  reason: string;
  calibrationTarget: {
    outcomeRequired: true;
    closingOddsRequired: true;
    brierTarget: number;
    logLossTarget: number;
    clvTarget: number | null;
    bucketMinimumSettled: number;
  };
  missingEvidence: string[];
  proofUrls: string[];
};

export type DecisionCalibrationFeedbackPacket = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-calibration-feedback-packet";
  status: DecisionCalibrationFeedbackStatus;
  feedbackHash: string;
  summary: string;
  rows: DecisionCalibrationFeedbackRow[];
  selectedRow: DecisionCalibrationFeedbackRow | null;
  totals: {
    rows: number;
    gradeNow: number;
    collectLabel: number;
    runBacktest: number;
    quarantinePattern: number;
    lowBucket: number;
    mediumBucket: number;
    highBucket: number;
    waitingSettlements: number;
    gradeableNow: number;
  };
  calibrationReadiness: {
    shadowBacktestStatus: DecisionShadowBacktestLedger["status"];
    promotionStatus: DecisionLearningPromotionGate["status"];
    settledCalibrationRows: number;
    requiredSettledRows: number;
    backtestSampleSize: number;
    backtestPickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    closingLineValue: number | null;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    command: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

const MIN_SETTLED_PER_BUCKET = 30;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function bucketFor(probability: number): DecisionCalibrationFeedbackRow["probabilityBucket"] {
  if (probability < 0.45) return "low";
  if (probability < 0.6) return "medium";
  return "high";
}

function expectedLogLoss(probability: number): number {
  const p = Math.max(0.001, Math.min(0.999, probability));
  return round(p * -Math.log(p) + (1 - p) * -Math.log(1 - p));
}

function actionFor({
  row,
  shadowBacktestLedger,
  promotionGate
}: {
  row: DecisionOutcomeReplayRow;
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  promotionGate: DecisionLearningPromotionGate;
}): DecisionCalibrationFeedbackAction {
  if (shadowBacktestLedger.status === "blocked" || promotionGate.status === "blocked" || row.action === "avoid") return "quarantine-pattern";
  if (!shadowBacktestLedger.historicalBacktest.backtestId) return "run-backtest";
  if (row.settlementPreview.status === "graded") return "grade-now";
  return "collect-label";
}

function reasonFor(action: DecisionCalibrationFeedbackAction, row: DecisionOutcomeReplayRow): string {
  if (action === "grade-now") return "Final score is available; review the settlement preview as a calibration label, but keep persistence locked.";
  if (action === "run-backtest") return "Historical backtest evidence is missing, so this label cannot calibrate model trust yet.";
  if (action === "quarantine-pattern") return "Replay, promotion, or action gates flag this pattern as unsafe for learned influence.";
  return `Collect final score and closing odds before this ${row.market} selection can become a calibration label.`;
}

function feedbackRow({
  row,
  settlementImpact,
  shadowBacktestLedger,
  promotionGate
}: {
  row: DecisionOutcomeReplayRow;
  settlementImpact: DecisionSettlementImpact;
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  promotionGate: DecisionLearningPromotionGate;
}): DecisionCalibrationFeedbackRow {
  const action = actionFor({ row, shadowBacktestLedger, promotionGate });
  const impact = settlementImpact.rows.find((item) => item.matchId === row.matchId && item.market === row.market && item.selection === row.selection);
  const missingEvidence = unique([
    row.settlementPreview.status === "waiting-final-score" ? "final score" : null,
    row.settlementPreview.requiredFields.includes("closingOdds") ? "closing odds" : null,
    shadowBacktestLedger.historicalBacktest.backtestId ? null : "historical backtest",
    shadowBacktestLedger.calibration.settledSize >= MIN_SETTLED_PER_BUCKET ? null : `${MIN_SETTLED_PER_BUCKET} settled outcomes per calibration bucket`,
    promotionGate.status === "eligible-shadow" ? null : promotionGate.selectedCheck?.requiredAction
  ]);

  return {
    id: `${row.id}:calibration-feedback`,
    matchId: row.matchId,
    match: row.match,
    market: row.market,
    selection: row.selection,
    probabilityBucket: bucketFor(row.modelProbability),
    modelProbability: row.modelProbability,
    expectedBrier: row.expectedBrier,
    expectedLogLoss: expectedLogLoss(row.modelProbability),
    replayPressure: row.replayPressure,
    settlementStatus: row.settlementPreview.status,
    recommendedAction: action,
    reason: reasonFor(action, row),
    calibrationTarget: {
      outcomeRequired: true,
      closingOddsRequired: true,
      brierTarget: row.expectedBrier,
      logLossTarget: expectedLogLoss(row.modelProbability),
      clvTarget: shadowBacktestLedger.historicalBacktest.closingLineValue,
      bucketMinimumSettled: MIN_SETTLED_PER_BUCKET
    },
    missingEvidence,
    proofUrls: unique([row.settlementPreview.previewUrl, impact?.settlementPreviewUrl, "/api/sports/decision/outcome-replay", "/api/sports/decision/settlement-impact"])
  };
}

function statusFor({
  rows,
  shadowBacktestLedger,
  promotionGate
}: {
  rows: DecisionCalibrationFeedbackRow[];
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  promotionGate: DecisionLearningPromotionGate;
}): DecisionCalibrationFeedbackStatus {
  if (shadowBacktestLedger.status === "needs-storage") return "needs-storage";
  if (shadowBacktestLedger.status === "blocked" || promotionGate.status === "blocked" || rows.some((row) => row.recommendedAction === "quarantine-pattern")) return "blocked";
  if (!shadowBacktestLedger.historicalBacktest.backtestId || rows.some((row) => row.recommendedAction === "run-backtest")) return "waiting-backtest";
  if (rows.some((row) => row.recommendedAction === "collect-label")) return "waiting-labels";
  return "ready-shadow-feedback";
}

function summaryFor(status: DecisionCalibrationFeedbackStatus, totals: DecisionCalibrationFeedbackPacket["totals"]): string {
  if (status === "ready-shadow-feedback") return `${totals.gradeNow} calibration label(s) are ready for shadow feedback review; writes remain locked.`;
  if (status === "waiting-labels") return `Calibration feedback is waiting on labels or closing odds for ${totals.collectLabel} candidate(s).`;
  if (status === "waiting-backtest") return "Calibration feedback needs a completed historical backtest before labels can influence trust.";
  if (status === "needs-storage") return "Calibration feedback needs Supabase storage proof before real calibration/backtest reads can be trusted.";
  return "Calibration feedback is blocked by quarantine pressure, promotion gates, or unsafe replay evidence.";
}

export function buildDecisionCalibrationFeedbackPacket({
  date,
  sport,
  outcomeReplay,
  settlementImpact,
  shadowBacktestLedger,
  learningPromotionGate,
  limit = 8,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  learningPromotionGate: DecisionLearningPromotionGate;
  limit?: number;
  now?: Date;
}): DecisionCalibrationFeedbackPacket {
  const rows = outcomeReplay.rows
    .slice(0, Math.max(1, limit))
    .map((row) => feedbackRow({ row, settlementImpact, shadowBacktestLedger, promotionGate: learningPromotionGate }));
  const totals = {
    rows: rows.length,
    gradeNow: rows.filter((row) => row.recommendedAction === "grade-now").length,
    collectLabel: rows.filter((row) => row.recommendedAction === "collect-label").length,
    runBacktest: rows.filter((row) => row.recommendedAction === "run-backtest").length,
    quarantinePattern: rows.filter((row) => row.recommendedAction === "quarantine-pattern").length,
    lowBucket: rows.filter((row) => row.probabilityBucket === "low").length,
    mediumBucket: rows.filter((row) => row.probabilityBucket === "medium").length,
    highBucket: rows.filter((row) => row.probabilityBucket === "high").length,
    waitingSettlements: settlementImpact.totals.waitingFinalScore,
    gradeableNow: settlementImpact.totals.gradeableNow
  };
  const status = statusFor({ rows, shadowBacktestLedger, promotionGate: learningPromotionGate });
  const selectedRow =
    rows.find((row) => row.recommendedAction === "quarantine-pattern") ??
    rows.find((row) => row.recommendedAction === "run-backtest") ??
    rows.find((row) => row.recommendedAction === "collect-label") ??
    rows[0] ??
    null;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-calibration-feedback-packet",
    status,
    feedbackHash: stableHash({
      date,
      sport,
      replay: outcomeReplay.replayHash,
      settlement: settlementImpact.impactHash,
      shadowBacktest: shadowBacktestLedger.ledgerHash,
      promotion: learningPromotionGate.promotionHash,
      rows: rows.map((row) => [row.id, row.recommendedAction, row.probabilityBucket, row.expectedBrier, row.expectedLogLoss])
    }),
    summary: summaryFor(status, totals),
    rows,
    selectedRow,
    totals,
    calibrationReadiness: {
      shadowBacktestStatus: shadowBacktestLedger.status,
      promotionStatus: learningPromotionGate.status,
      settledCalibrationRows: shadowBacktestLedger.calibration.settledSize,
      requiredSettledRows: MIN_SETTLED_PER_BUCKET,
      backtestSampleSize: shadowBacktestLedger.historicalBacktest.sampleSize,
      backtestPickCount: shadowBacktestLedger.historicalBacktest.pickCount,
      brierScore: shadowBacktestLedger.historicalBacktest.brierScore,
      logLoss: shadowBacktestLedger.historicalBacktest.logLoss,
      closingLineValue: shadowBacktestLedger.historicalBacktest.closingLineValue
    },
    controls: {
      canInspectReadOnly: true,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    nextAction: {
      label:
        status === "ready-shadow-feedback"
          ? "Review calibration labels"
          : status === "waiting-backtest"
            ? "Run historical backtest first"
            : status === "waiting-labels"
              ? "Collect settlement labels"
              : status === "needs-storage"
                ? "Restore storage proof"
                : "Quarantine unsafe calibration pattern",
      verifyUrl: "/api/sports/decision/calibration-feedback",
      command: null,
      safeToRun: false,
      expectedEvidence: selectedRow?.missingEvidence[0] ?? selectedRow?.reason ?? shadowBacktestLedger.nextSafeAction.expectedEvidence
    },
    proofUrls: unique([
      "/api/sports/decision/calibration-feedback",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/settlement-impact",
      "/api/sports/decision/shadow-backtest-ledger",
      "/api/sports/decision/learning-promotion-gate",
      ...outcomeReplay.proofUrls,
      ...settlementImpact.proofUrls,
      ...shadowBacktestLedger.proofUrls,
      ...learningPromotionGate.proofUrls
    ], 32),
    locks: unique([
      "Calibration feedback is read-only and cannot persist outcomes, run calibration, write training rows, train, publish, stake, or apply weights.",
      "Feedback rows are label targets only; they do not raise trust or change public probabilities.",
      "Closing-line value and settled outcomes are required before calibration evidence can influence shadow learning.",
      ...outcomeReplay.locks,
      ...shadowBacktestLedger.locks
    ], 32)
  };
}
