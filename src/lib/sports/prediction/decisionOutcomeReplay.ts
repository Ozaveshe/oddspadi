import type { DecisionLearningConsolidator } from "@/lib/sports/prediction/decisionLearningConsolidator";
import { decisionCandidatePick } from "@/lib/sports/prediction/decisionCandidatePick";
import { buildDecisionOutcomeSettlement, type OutcomeSettlementPreview } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import type { Match, Prediction } from "@/lib/sports/types";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { inspectRuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";
import type { Sport } from "@/lib/sports/types";

type PredictionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionOutcomeReplayStatus = "ready-replay" | "waiting-outcomes" | "waiting-backtest" | "blocked";
export type DecisionOutcomeReplayAction = "reinforce-shadow" | "label-first" | "downgrade-until-settled" | "avoid";

export type DecisionOutcomeReplayRow = {
  id: string;
  matchId: string;
  match: string;
  league: string;
  market: string;
  selection: string;
  selectionId: string;
  modelProbability: number;
  impliedProbability: number;
  breakEvenProbability: number;
  noVigEdge: number;
  expectedValue: number;
  odds: number;
  brierIfWin: number;
  brierIfLoss: number;
  expectedBrier: number;
  logLossIfWin: number;
  logLossIfLoss: number;
  historicalBrier: number | null;
  historicalLogLoss: number | null;
  historicalRoiUnits: number | null;
  historicalClosingLineValue: number | null;
  replayPressure: number;
  action: DecisionOutcomeReplayAction;
  reason: string;
  settlementPreview: {
    status: "graded" | "waiting-final-score" | "unsupported";
    previewUrl: string;
    requiredFields: string[];
    result: OutcomeSettlementPreview["result"];
    outcomeInput: OutcomeSettlementPreview["outcomeInput"];
    roiUnits: number | null;
    brierScore: number | null;
    closingLineValue: number | null;
    canPersist: false;
  };
  outcomeTicket: {
    canPersist: false;
    fixtureExternalId: string;
    result: "pending";
    source: "decision-outcome-replay";
  };
};

export type DecisionOutcomeReplay = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-outcome-replay";
  status: DecisionOutcomeReplayStatus;
  replayHash: string;
  summary: string;
  rows: DecisionOutcomeReplayRow[];
  totals: {
    candidates: number;
    reinforceShadow: number;
    labelFirst: number;
    downgradeUntilSettled: number;
    avoid: number;
    pendingOutcomeTickets: number;
  };
  historicalSignal: {
    configured: boolean;
    status: TrainingDataSnapshot["status"];
    backtestId: string | null;
    sampleSize: number;
    pickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    roiUnits: number | null;
    yield: number | null;
    closingLineValue: number | null;
  };
  learningFeedback: {
    activeSignalId: string | null;
    replayFeedsConsolidator: boolean;
    nextEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistOutcomeTickets: false;
    canSettleOutcomes: false;
    canRunCalibration: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function safeProbability(value: number): number {
  return clamp(value, 0.001, 0.999);
}

function logLoss(probability: number, actual: 0 | 1): number {
  const p = safeProbability(probability);
  return actual === 1 ? -Math.log(p) : -Math.log(1 - p);
}

function encodeQuery(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function lineFromSelection(match: Match, marketId: string, selectionId: string): number | null {
  if (marketId === "over_under_25") return 2.5;
  const market = match.oddsMarkets.find((item) => item.id === marketId);
  const selection = market?.selections.find((item) => item.id === selectionId) ?? market?.selections[0] ?? null;
  const text = selection?.label ?? market?.selections.map((item) => item.label).join(" ") ?? "";
  const parsed = text.match(/[-+]?\d+(?:\.\d+)?/)?.[0];
  if (!parsed) return null;
  const value = Number(parsed);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

function settlementPreviewFor({
  row,
  marketId,
  selectionId,
  modelProbability,
  impliedProbability,
  valueEdge,
  odds
}: {
  row: PredictionRow;
  marketId: string;
  selectionId: string;
  modelProbability: number;
  impliedProbability: number;
  valueEdge: number;
  odds: number;
}): DecisionOutcomeReplayRow["settlementPreview"] {
  const line = lineFromSelection(row.match, marketId, selectionId);
  const baseParams = {
    fixtureExternalId: row.match.id,
    sport: row.match.sport,
    market: marketId,
    selection: selectionId,
    line,
    odds: round(odds, 4),
    modelProbability: round(modelProbability, 6),
    impliedProbability: round(impliedProbability, 6),
    valueEdge: round(valueEdge, 6)
  };
  const hasFinalScore = row.match.status === "finished" && typeof row.match.score?.home === "number" && typeof row.match.score?.away === "number";
  const previewUrl = `/api/sports/decision/outcome-settlement?${encodeQuery({
    ...baseParams,
    homeScore: hasFinalScore ? row.match.score?.home : null,
    awayScore: hasFinalScore ? row.match.score?.away : null
  })}`;

  if (!hasFinalScore) {
    return {
      status: "waiting-final-score",
      previewUrl,
      requiredFields: ["homeScore", "awayScore", "closingOdds"],
      result: null,
      outcomeInput: null,
      roiUnits: null,
      brierScore: null,
      closingLineValue: null,
      canPersist: false
    };
  }
  const finalScore = row.match.score as { home: number; away: number };

  const preview = buildDecisionOutcomeSettlement({
    fixtureExternalId: row.match.id,
    sport: row.match.sport,
    market: marketId,
    selection: selectionId,
    homeScore: finalScore.home,
    awayScore: finalScore.away,
    line,
    modelProbability,
    impliedProbability,
    valueEdge,
    odds,
    source: "decision-outcome-replay",
    metadata: {
      replayMatch: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
      replayMarket: marketId
    }
  });

  return {
    status: preview.status === "graded" ? "graded" : "unsupported",
    previewUrl,
    requiredFields: preview.status === "graded" ? ["closingOdds"] : ["supportedMarket", "supportedSelection"],
    result: preview.result,
    outcomeInput: preview.outcomeInput,
    roiUnits: preview.settlement.roiUnits,
    brierScore: preview.settlement.brierScore,
    closingLineValue: preview.settlement.closingLineValue,
    canPersist: false
  };
}

function replayAction({
  replayPressure,
  expectedValue,
  hasBacktest,
  pickCount,
  historicalRoi,
  historicalClv
}: {
  replayPressure: number;
  expectedValue: number;
  hasBacktest: boolean;
  pickCount: number;
  historicalRoi: number | null;
  historicalClv: number | null;
}): DecisionOutcomeReplayAction {
  if (!hasBacktest) return "label-first";
  if (expectedValue <= 0 || replayPressure >= 0.72) return "avoid";
  if (pickCount < 30 || replayPressure >= 0.54) return "downgrade-until-settled";
  if ((historicalRoi ?? 0) > 0 && (historicalClv ?? 0) >= 0 && expectedValue > 0.015) return "reinforce-shadow";
  return "label-first";
}

function reasonFor(action: DecisionOutcomeReplayAction, replayPressure: number): string {
  if (action === "reinforce-shadow") return "Current edge is positive and historical backtest evidence is not fighting the pick; keep it in shadow reinforcement only.";
  if (action === "downgrade-until-settled") return `Replay pressure ${replayPressure.toFixed(2)} is too high for an upgraded action before settled labels and calibration.`;
  if (action === "avoid") return `Replay pressure ${replayPressure.toFixed(2)} or expected value fails the replay gate; avoid until the model earns trust.`;
  return "Create or wait for settled outcome labels before the agent treats this as learned evidence.";
}

function rowFromPrediction({
  row,
  training
}: {
  row: PredictionRow;
  training: TrainingDataSnapshot;
}): DecisionOutcomeReplayRow | null {
  const pick = decisionCandidatePick(row.prediction);
  if (!pick.hasValue) return null;

  const probability = safeProbability(pick.modelProbability);
  const brierIfWin = (probability - 1) ** 2;
  const brierIfLoss = probability ** 2;
  const expectedBrier = probability * brierIfWin + (1 - probability) * brierIfLoss;
  const runtimeEvidence = inspectRuntimeBacktestEvidence(training.sport, training.latestBacktest);
  const comparableBacktest = runtimeEvidence.exactRuntimeParity ? training.latestBacktest : null;
  const historicalBrier = comparableBacktest?.brierScore ?? null;
  const historicalLogLoss = comparableBacktest?.logLoss ?? null;
  const historicalRoi = comparableBacktest?.roiUnits ?? null;
  const historicalClv = comparableBacktest?.closingLineValue ?? null;
  const hasBacktest = runtimeEvidence.exactRuntimeParity;
  const brierPressure = historicalBrier === null ? 0.42 : clamp((historicalBrier - expectedBrier) / 0.18 + 0.42, 0, 1);
  const logPressure = historicalLogLoss === null ? 0.36 : clamp((historicalLogLoss - 0.62) / 0.55 + 0.36, 0, 1);
  const roiPressure = historicalRoi === null ? 0.36 : historicalRoi >= 0 ? 0.18 : clamp(0.48 + Math.abs(historicalRoi) / 12, 0.48, 0.9);
  const clvPressure = historicalClv === null ? 0.32 : historicalClv >= 0 ? 0.16 : clamp(0.48 + Math.abs(historicalClv) * 8, 0.48, 0.88);
  const replayPressure = round(clamp(brierPressure * 0.34 + logPressure * 0.24 + roiPressure * 0.22 + clvPressure * 0.2, 0, 1));
  const action = replayAction({
    replayPressure,
    expectedValue: pick.expectedValue,
    hasBacktest,
    pickCount: training.latestBacktest?.pickCount ?? 0,
    historicalRoi,
    historicalClv
  });
  const settlementPreview = settlementPreviewFor({
    row,
    marketId: pick.marketId,
    selectionId: pick.selectionId,
    modelProbability: probability,
    impliedProbability: pick.noVigImpliedProbability,
    valueEdge: pick.edge,
    odds: pick.odds
  });

  return {
    id: `${row.match.id}:${pick.marketId}:${pick.selectionId}:outcome-replay`,
    matchId: row.match.id,
    match: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
    league: row.match.league.name,
    market: pick.marketId,
    selection: pick.label,
    selectionId: pick.selectionId,
    modelProbability: round(probability, 6),
    impliedProbability: round(pick.noVigImpliedProbability, 6),
    breakEvenProbability: round(1 / pick.odds, 6),
    noVigEdge: round(pick.edge, 6),
    expectedValue: round(pick.expectedValue, 6),
    odds: round(pick.odds, 4),
    brierIfWin: round(brierIfWin, 6),
    brierIfLoss: round(brierIfLoss, 6),
    expectedBrier: round(expectedBrier, 6),
    logLossIfWin: round(logLoss(probability, 1), 6),
    logLossIfLoss: round(logLoss(probability, 0), 6),
    historicalBrier,
    historicalLogLoss,
    historicalRoiUnits: historicalRoi,
    historicalClosingLineValue: historicalClv,
    replayPressure,
    action,
    reason: reasonFor(action, replayPressure),
    settlementPreview,
    outcomeTicket: {
      canPersist: false,
      fixtureExternalId: row.match.id,
      result: "pending",
      source: "decision-outcome-replay"
    }
  };
}

function statusFor(rows: DecisionOutcomeReplayRow[], training: TrainingDataSnapshot): DecisionOutcomeReplayStatus {
  if (training.status === "failed") return "blocked";
  if (!rows.length) return "waiting-outcomes";
  if (!inspectRuntimeBacktestEvidence(training.sport, training.latestBacktest).exactRuntimeParity) return "waiting-backtest";
  if (rows.some((row) => row.action === "downgrade-until-settled" || row.action === "avoid")) return "waiting-outcomes";
  return "ready-replay";
}

function summaryFor(status: DecisionOutcomeReplayStatus): string {
  if (status === "ready-replay") return "Outcome replay has counterfactual scoring and historical backtest support; learning remains shadow-only.";
  if (status === "waiting-backtest") return "Outcome replay produced pending labels, but historical backtest evidence is missing.";
  if (status === "waiting-outcomes") return "Outcome replay needs settled labels or lower replay pressure before the agent can trust this edge.";
  return "Outcome replay is blocked by failed training or historical evidence reads.";
}

export function buildDecisionOutcomeReplay({
  date,
  sport,
  rows,
  training,
  learningConsolidator,
  limit = 8,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  rows: PredictionRow[];
  training: TrainingDataSnapshot;
  learningConsolidator: DecisionLearningConsolidator;
  limit?: number;
  now?: Date;
}): DecisionOutcomeReplay {
  const replayRows = rows
    .map((row) => rowFromPrediction({ row, training }))
    .filter((row): row is DecisionOutcomeReplayRow => Boolean(row))
    .sort((a, b) => b.replayPressure - a.replayPressure || b.expectedValue - a.expectedValue)
    .slice(0, Math.max(1, limit));
  const status = statusFor(replayRows, training);
  const totals = {
    candidates: replayRows.length,
    reinforceShadow: replayRows.filter((row) => row.action === "reinforce-shadow").length,
    labelFirst: replayRows.filter((row) => row.action === "label-first").length,
    downgradeUntilSettled: replayRows.filter((row) => row.action === "downgrade-until-settled").length,
    avoid: replayRows.filter((row) => row.action === "avoid").length,
    pendingOutcomeTickets: replayRows.length
  };

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-outcome-replay",
    status,
    replayHash: stableHash({
      date,
      sport,
      training: training.latestBacktest?.id ?? training.status,
      learning: learningConsolidator.consolidatorHash,
      rows: replayRows.map((row) => [row.id, row.action, row.replayPressure, row.expectedBrier, row.settlementPreview.status, row.settlementPreview.result])
    }),
    summary: summaryFor(status),
    rows: replayRows,
    totals,
    historicalSignal: {
      configured: training.configured,
      status: training.status,
      backtestId: training.latestBacktest?.id ?? null,
      sampleSize: training.latestBacktest?.sampleSize ?? 0,
      pickCount: training.latestBacktest?.pickCount ?? 0,
      brierScore: training.latestBacktest?.brierScore ?? null,
      logLoss: training.latestBacktest?.logLoss ?? null,
      roiUnits: training.latestBacktest?.roiUnits ?? null,
      yield: training.latestBacktest?.yield ?? null,
      closingLineValue: training.latestBacktest?.closingLineValue ?? null
    },
    learningFeedback: {
      activeSignalId: learningConsolidator.activeSignal?.id ?? null,
      replayFeedsConsolidator: learningConsolidator.signals.some((signal) => signal.category === "outcome-label" || signal.category === "calibration"),
      nextEvidence:
        training.latestBacktest?.id
          ? "Settle pending outcome tickets and compare replay pressure against the next calibration run."
          : training.readiness.detail
    },
    controls: {
      canInspectReadOnly: true,
      canPersistOutcomeTickets: false,
      canSettleOutcomes: false,
      canRunCalibration: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/outcome-settlement",
      "/api/sports/decision/learning-consolidator",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/backfill",
      ...learningConsolidator.proofUrls
    ]),
    locks: unique([
      "Outcome replay computes pending labels and counterfactual scores only; it cannot write outcomes or settle results.",
      "Settlement previews can grade finished scores into op_prediction_outcomes payloads, but replay itself cannot persist them.",
      "Replay pressure can advise downgrade or shadow reinforcement, but it cannot publish picks, train models, or apply learned weights.",
      "Backtest and calibration metrics are evidence, not permission to stake or upgrade public action.",
      ...learningConsolidator.locks
    ])
  };
}
