import type { DecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import type { DecisionOutcomeReplay, DecisionOutcomeReplayRow } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { PredictionOutcomeResult } from "@/lib/sports/prediction/decisionOutcomes";
import type { Sport } from "@/lib/sports/types";

export type DecisionSettlementImpactStatus = "ready-scenarios" | "waiting-settlement" | "blocked";
export type DecisionSettlementImpactEffect = "reinforce-shadow" | "hold-shadow" | "downgrade-shadow" | "quarantine";

export type DecisionSettlementImpactScenario = {
  result: Extract<PredictionOutcomeResult, "won" | "lost" | "push">;
  roiUnits: number;
  brierScore: number | null;
  pressureAfter: number;
  trustDelta: number;
  effect: DecisionSettlementImpactEffect;
  detail: string;
};

export type DecisionSettlementImpactRow = {
  id: string;
  matchId: string;
  match: string;
  market: string;
  selection: string;
  replayAction: DecisionOutcomeReplayRow["action"];
  settlementStatus: DecisionOutcomeReplayRow["settlementPreview"]["status"];
  settlementPreviewUrl: string;
  requiredFields: string[];
  actualResult: PredictionOutcomeResult | null;
  expectedRoiUnits: number;
  expectedBrier: number;
  currentReplayPressure: number;
  scenarios: DecisionSettlementImpactScenario[];
  recommendedNext: string;
};

export type DecisionSettlementImpact = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-settlement-impact";
  status: DecisionSettlementImpactStatus;
  impactHash: string;
  summary: string;
  rows: DecisionSettlementImpactRow[];
  totals: {
    candidates: number;
    gradeableNow: number;
    waitingFinalScore: number;
    unsupported: number;
    positiveExpectedRoi: number;
    worstCaseQuarantines: number;
    bestCaseReinforces: number;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function effectFor({ result, pressureAfter, trustDelta }: { result: PredictionOutcomeResult; pressureAfter: number; trustDelta: number }): DecisionSettlementImpactEffect {
  if (result === "won" && pressureAfter <= 0.42 && trustDelta > 0) return "reinforce-shadow";
  if (result === "lost" && pressureAfter >= 0.62) return "quarantine";
  if (result === "lost" || trustDelta < -4) return "downgrade-shadow";
  return "hold-shadow";
}

function scenarioDetail(effect: DecisionSettlementImpactEffect, result: PredictionOutcomeResult): string {
  if (effect === "reinforce-shadow") return `${result} would support shadow memory only; public probabilities remain unchanged.`;
  if (effect === "quarantine") return `${result} would quarantine the pattern until more settled labels and calibration exist.`;
  if (effect === "downgrade-shadow") return `${result} would lower trust in this pattern for the next supervised cycle.`;
  return `${result} would hold the pattern in shadow review without raising trust.`;
}

function scenario(row: DecisionOutcomeReplayRow, result: Extract<PredictionOutcomeResult, "won" | "lost" | "push">): DecisionSettlementImpactScenario {
  const roiUnits = result === "won" ? round(row.odds - 1, 6) : result === "lost" ? -1 : 0;
  const brierScore = result === "won" ? row.brierIfWin : result === "lost" ? row.brierIfLoss : null;
  const brierPressure = brierScore === null ? row.replayPressure : clamp((brierScore - row.expectedBrier) / 0.24 + row.replayPressure, 0, 1);
  const roiPressure = roiUnits > 0 ? -0.08 : roiUnits < 0 ? 0.12 : 0;
  const pressureAfter = round(clamp(brierPressure + roiPressure, 0, 1), 6);
  const trustDelta = round((row.expectedBrier - (brierScore ?? row.expectedBrier)) * 35 + roiUnits * 3 - pressureAfter * 2, 4);
  const effect = effectFor({ result, pressureAfter, trustDelta });

  return {
    result,
    roiUnits,
    brierScore,
    pressureAfter,
    trustDelta,
    effect,
    detail: scenarioDetail(effect, result)
  };
}

function nextActionFor(row: DecisionSettlementImpactRow): string {
  if (row.settlementStatus === "graded") return "Review the graded settlement payload, then store it only through the admin-gated outcome flow.";
  if (row.settlementStatus === "unsupported") return "Map this market/selection to a supported settlement rule before it can feed calibration.";
  return `Wait for ${row.requiredFields.join(", ")} before this candidate can become a calibration label.`;
}

function impactRow(row: DecisionOutcomeReplayRow): DecisionSettlementImpactRow {
  const scenarios = [scenario(row, "won"), scenario(row, "lost"), scenario(row, "push")];
  const actualResult = row.settlementPreview.result;
  const expectedRoiUnits = round(row.expectedValue, 6);
  const impact: DecisionSettlementImpactRow = {
    id: `${row.id}:settlement-impact`,
    matchId: row.matchId,
    match: row.match,
    market: row.market,
    selection: row.selection,
    replayAction: row.action,
    settlementStatus: row.settlementPreview.status,
    settlementPreviewUrl: row.settlementPreview.previewUrl,
    requiredFields: row.settlementPreview.requiredFields,
    actualResult,
    expectedRoiUnits,
    expectedBrier: row.expectedBrier,
    currentReplayPressure: row.replayPressure,
    scenarios,
    recommendedNext: ""
  };
  return {
    ...impact,
    recommendedNext: nextActionFor(impact)
  };
}

function statusFor(rows: DecisionSettlementImpactRow[], promotionGate: DecisionLearningPromotionGate): DecisionSettlementImpactStatus {
  if (promotionGate.status === "blocked" || rows.some((row) => row.scenarios.every((item) => item.effect === "quarantine"))) return "blocked";
  if (rows.some((row) => row.settlementStatus === "waiting-final-score")) return "waiting-settlement";
  return "ready-scenarios";
}

function summaryFor(status: DecisionSettlementImpactStatus, totals: DecisionSettlementImpact["totals"]): string {
  if (status === "ready-scenarios") return `Settlement impact has ${totals.candidates} scenario set(s) ready for operator review.`;
  if (status === "waiting-settlement") return `Settlement impact is waiting on final scores or closing odds for ${totals.waitingFinalScore} candidate(s).`;
  return "Settlement impact is blocked by promotion-gate or quarantine pressure.";
}

export function buildDecisionSettlementImpact({
  date,
  sport,
  outcomeReplay,
  promotionGate,
  limit = 8,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  outcomeReplay: DecisionOutcomeReplay;
  promotionGate: DecisionLearningPromotionGate;
  limit?: number;
  now?: Date;
}): DecisionSettlementImpact {
  const rows = outcomeReplay.rows.slice(0, Math.max(1, limit)).map(impactRow);
  const totals = {
    candidates: rows.length,
    gradeableNow: rows.filter((row) => row.settlementStatus === "graded").length,
    waitingFinalScore: rows.filter((row) => row.settlementStatus === "waiting-final-score").length,
    unsupported: rows.filter((row) => row.settlementStatus === "unsupported").length,
    positiveExpectedRoi: rows.filter((row) => row.expectedRoiUnits > 0).length,
    worstCaseQuarantines: rows.filter((row) => row.scenarios.find((item) => item.result === "lost")?.effect === "quarantine").length,
    bestCaseReinforces: rows.filter((row) => row.scenarios.find((item) => item.result === "won")?.effect === "reinforce-shadow").length
  };
  const status = statusFor(rows, promotionGate);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-settlement-impact",
    status,
    impactHash: stableHash({
      date,
      sport,
      replay: outcomeReplay.replayHash,
      promotion: promotionGate.promotionHash,
      rows: rows.map((row) => [row.id, row.settlementStatus, row.expectedRoiUnits, row.scenarios.map((item) => [item.result, item.effect, item.trustDelta])])
    }),
    summary: summaryFor(status, totals),
    rows,
    totals,
    controls: {
      canInspectReadOnly: true,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/settlement-impact",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/outcome-settlement",
      "/api/sports/decision/learning-promotion-gate",
      ...outcomeReplay.proofUrls,
      ...promotionGate.proofUrls
    ]),
    locks: unique([
      "Settlement impact is read-only; it cannot persist outcomes, run calibration, train models, publish picks, or stake.",
      "Win/loss/push scenarios may downgrade or reinforce shadow memory only; public action remains locked.",
      "Actual outcome storage must go through the admin-gated op_prediction_outcomes flow.",
      ...outcomeReplay.locks,
      ...promotionGate.locks
    ], 30)
  };
}
