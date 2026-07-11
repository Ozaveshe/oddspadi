import type { CalibrationSnapshot, DecisionCalibrationMetrics } from "@/lib/sports/prediction/decisionCalibration";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { Sport } from "@/lib/sports/types";

export type DecisionModelTrustStatus = "trusted-shadow" | "needs-evidence" | "blocked";
export type DecisionModelTrustGateStatus = "pass" | "watch" | "block";
export type DecisionModelTrustGateCategory = "governance" | "calibration" | "training" | "market" | "portfolio" | "runtime";

export type DecisionModelTrustGate = {
  id: string;
  category: DecisionModelTrustGateCategory;
  label: string;
  status: DecisionModelTrustGateStatus;
  score: number;
  detail: string;
  requiredAction: string | null;
};

export type DecisionModelTrust = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionModelTrustStatus;
  trustHash: string;
  trustScore: number;
  summary: string;
  confidenceBudget: {
    maxPublicConfidence: "low" | "medium" | "high";
    learnedGuardrailsAllowed: boolean;
    calibrationSampleSize: number;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    portfolioRiskBudgetUsed: number;
    marketAverageMargin: number | null;
  };
  gates: DecisionModelTrustGate[];
  counts: {
    pass: number;
    watch: number;
    block: number;
  };
  nextActions: string[];
  policy: {
    canRaiseConfidence: false;
    canUseLearnedWeights: false;
    canStake: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
  };
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

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function statusFromScore(score: number, hardBlock = false): DecisionModelTrustGateStatus {
  if (hardBlock || score < 45) return "block";
  if (score < 75) return "watch";
  return "pass";
}

function activeCalibration(calibration: CalibrationSnapshot): DecisionCalibrationMetrics | null {
  return calibration.currentMetrics ?? calibration.latestRun;
}

function calibrationSampleScore(metrics: DecisionCalibrationMetrics | null): number {
  if (!metrics) return 0;
  return clamp((metrics.settledSize / 30) * 100);
}

function calibrationAccuracyScore(metrics: DecisionCalibrationMetrics | null): number {
  if (
    !metrics ||
    metrics.brierScore === null ||
    metrics.logLoss === null ||
    metrics.expectedCalibrationError === null ||
    metrics.brierSkillScore === null
  ) {
    return 0;
  }
  const brier = clamp(100 - metrics.brierScore * 220);
  const logLoss = clamp(100 - (metrics.logLoss / Math.log(2)) * 100);
  const calibration = clamp(100 - metrics.expectedCalibrationError * 500);
  const skill = clamp(50 + metrics.brierSkillScore * 50);
  const closingCoverage = clamp((metrics.closingLineCoverage ?? 0) * 100);
  return clamp(brier * 0.25 + logLoss * 0.2 + calibration * 0.25 + skill * 0.15 + closingCoverage * 0.15);
}

function corpusScore(training: TrainingDataSnapshot): number {
  const minimum = training.readiness.minimumRecommendedFixtures;
  const fixtureScore = minimum > 0 ? (training.counts.realFinishedFixtures / minimum) * 55 : 0;
  const oddsScore = training.counts.realFinishedFixtures > 0 ? (training.counts.realOddsSnapshots / (training.counts.realFinishedFixtures * 2)) * 25 : 0;
  const backtestScore = training.latestBacktest?.status === "completed" ? 20 : training.counts.backtestRuns > 0 ? 10 : 0;
  return clamp(fixtureScore + oddsScore + backtestScore);
}

function marketScore(board: DecisionOddsBoard): number {
  const margin = board.totals.averageMargin;
  const marginScore = margin === null ? 25 : clamp(100 - Math.max(0, margin) * 450);
  const valueRatio = board.totals.selections > 0 ? (board.totals.value / board.totals.selections) * 100 : 0;
  const avoidPenalty = board.totals.selections > 0 ? (board.totals.avoid / board.totals.selections) * 30 : 30;
  return clamp(marginScore * 0.65 + valueRatio * 0.35 - avoidPenalty);
}

function portfolioScore(portfolio: DecisionPortfolioRisk): number {
  if (portfolio.status === "blocked") return 20;
  const cappedRatio = portfolio.totals.candidates > 0 ? portfolio.totals.capped / portfolio.totals.candidates : 1;
  const riskBudgetScore = clamp(100 - portfolio.budget.riskBudgetUsed * 600);
  return clamp(riskBudgetScore - cappedRatio * 35);
}

function gate(input: DecisionModelTrustGate): DecisionModelTrustGate {
  return input;
}

function buildGates({
  governance,
  calibration,
  training,
  board,
  portfolio
}: {
  governance: DecisionModelGovernance;
  calibration: CalibrationSnapshot;
  training: TrainingDataSnapshot;
  board: DecisionOddsBoard;
  portfolio: DecisionPortfolioRisk;
}): DecisionModelTrustGate[] {
  const metrics = activeCalibration(calibration);
  const sampleScore = calibrationSampleScore(metrics);
  const accuracyScore = calibrationAccuracyScore(metrics);
  const trainingScore = corpusScore(training);
  const marketQualityScore = marketScore(board);
  const exposureScore = portfolioScore(portfolio);

  return [
    gate({
      id: "governance-trust",
      category: "governance",
      label: "Model governance",
      status: governance.status === "approved" ? "pass" : governance.status === "shadow" ? "watch" : "block",
      score: governance.trustScore,
      detail: governance.summary,
      requiredAction: governance.status === "approved" ? null : governance.nextActions[0] ?? "Resolve model-governance blockers before raising trust."
    }),
    gate({
      id: "calibration-sample",
      category: "calibration",
      label: "Settled calibration sample",
      status: statusFromScore(sampleScore, !metrics || metrics.settledSize < 30),
      score: round(sampleScore, 1),
      detail: metrics ? `${metrics.settledSize}/30 settled outcomes are available for calibration.` : calibration.reason ?? "No calibration metrics are available.",
      requiredAction: metrics && metrics.settledSize >= 30 ? null : "Persist decisions, settle outcomes, and rerun calibration after at least 30 settled outcomes."
    }),
    gate({
      id: "calibration-accuracy",
      category: "calibration",
      label: "Calibration accuracy",
      status: statusFromScore(accuracyScore, !metrics || !metrics.promotionReadiness.eligibleForShadowReview),
      score: round(accuracyScore, 1),
      detail: !metrics
        ? "Calibration quality metrics are unavailable."
        : `Brier ${metrics.brierScore ?? "N/A"}, skill ${metrics.brierSkillScore ?? "N/A"}, log loss ${metrics.logLoss ?? "N/A"}, ECE ${
            metrics.expectedCalibrationError ?? "N/A"
          }, CLV coverage ${metrics.closingLineCoverage ?? "N/A"}; ${metrics.promotionReadiness.status}.`,
      requiredAction: metrics?.promotionReadiness.eligibleForShadowReview
        ? null
        : metrics?.promotionReadiness.blockers[0] ?? "Collect enough settled outcomes to prove Brier, log loss, calibration error, and CLV coverage."
    }),
    gate({
      id: "historical-corpus",
      category: "training",
      label: "Historical corpus",
      status: statusFromScore(trainingScore, !training.readiness.readyForTraining),
      score: round(trainingScore, 1),
      detail: `${training.counts.realFinishedFixtures}/${training.readiness.minimumRecommendedFixtures} real fixtures, ${training.counts.realOddsSnapshots} real odds snapshots, ${training.counts.backtestRuns} backtest run(s).`,
      requiredAction: training.readiness.readyForTraining ? null : training.readiness.detail
    }),
    gate({
      id: "market-quality",
      category: "market",
      label: "Market quality",
      status: statusFromScore(marketQualityScore, board.totals.selections === 0),
      score: round(marketQualityScore, 1),
      detail: `${board.totals.value} value, ${board.totals.watch} watch, ${board.totals.avoid} avoid selections; average margin ${
        board.totals.averageMargin === null ? "N/A" : board.totals.averageMargin
      }.`,
      requiredAction: marketQualityScore >= 75 ? null : "Prefer lower-margin markets and rerun after fresh bookmaker odds arrive."
    }),
    gate({
      id: "portfolio-pressure",
      category: "portfolio",
      label: "Portfolio pressure",
      status: statusFromScore(exposureScore, portfolio.status === "blocked"),
      score: round(exposureScore, 1),
      detail: `${portfolio.totals.capped} capped exposure candidates, ${portfolio.totals.excluded} excluded, ${portfolio.budget.suggestedPaperUnits} paper units.`,
      requiredAction: exposureScore >= 75 ? null : "Keep candidates paper-only and reduce concentration before trust rises."
    }),
    gate({
      id: "runtime-storage",
      category: "runtime",
      label: "Runtime storage",
      status: training.configured && training.status === "ready" ? "pass" : "block",
      score: training.configured && training.status === "ready" ? 100 : 0,
      detail: training.reason ?? training.readiness.detail,
      requiredAction: training.configured && training.status === "ready" ? null : "Fix OddsPadi Supabase credentials and schema reads before trusting learning state."
    })
  ];
}

function trustScore(gates: DecisionModelTrustGate[]): number {
  if (!gates.length) return 0;
  return round(gates.reduce((sum, item) => sum + item.score, 0) / gates.length, 1);
}

function statusFor(gates: DecisionModelTrustGate[], score: number): DecisionModelTrustStatus {
  if (gates.some((item) => item.status === "block" && (item.category === "training" || item.category === "runtime" || item.category === "calibration"))) {
    return "blocked";
  }
  if (score >= 75 && gates.every((item) => item.status !== "block")) return "trusted-shadow";
  return "needs-evidence";
}

function maxConfidence(status: DecisionModelTrustStatus, score: number): "low" | "medium" | "high" {
  if (status === "blocked" || score < 45) return "low";
  if (score < 80) return "medium";
  return "high";
}

function nextActions(gates: DecisionModelTrustGate[], governance: DecisionModelGovernance): string[] {
  const actions = gates
    .filter((item) => item.requiredAction)
    .sort((a, b) => {
      const rank = { block: 2, watch: 1, pass: 0 };
      return rank[b.status] - rank[a.status] || a.score - b.score;
    })
    .map((item) => `${item.label}: ${item.requiredAction}`);
  return Array.from(new Set([...actions, ...governance.nextActions])).slice(0, 7);
}

export function buildDecisionModelTrust({
  date,
  sport,
  governance,
  calibration,
  training,
  board,
  portfolio
}: {
  date: string;
  sport: Sport;
  governance: DecisionModelGovernance;
  calibration: CalibrationSnapshot;
  training: TrainingDataSnapshot;
  board: DecisionOddsBoard;
  portfolio: DecisionPortfolioRisk;
}): DecisionModelTrust {
  const gates = buildGates({ governance, calibration, training, board, portfolio });
  const score = trustScore(gates);
  const status = statusFor(gates, score);
  const pass = gates.filter((item) => item.status === "pass").length;
  const watch = gates.filter((item) => item.status === "watch").length;
  const block = gates.filter((item) => item.status === "block").length;
  const metrics = activeCalibration(calibration);
  const trustHash = stableHash({
    date,
    sport,
    status,
    score,
    gates: gates.map((item) => [item.id, item.status, item.score])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    trustHash,
    trustScore: score,
    summary:
      status === "trusted-shadow"
        ? `Model trust is shadow-approved at ${score}/100; learned weights still need operator-controlled activation.`
        : status === "needs-evidence"
          ? `Model trust needs more evidence at ${score}/100; ${watch} watch gate(s), ${block} block gate(s).`
          : `Model trust is blocked at ${score}/100; confidence cannot rise until calibration, corpus, and runtime gates improve.`,
    confidenceBudget: {
      maxPublicConfidence: maxConfidence(status, score),
      learnedGuardrailsAllowed: status === "trusted-shadow" && governance.learnedGuardrailsAllowed,
      calibrationSampleSize: metrics?.settledSize ?? 0,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots,
      portfolioRiskBudgetUsed: portfolio.budget.riskBudgetUsed,
      marketAverageMargin: board.totals.averageMargin
    },
    gates,
    counts: { pass, watch, block },
    nextActions: nextActions(gates, governance),
    policy: {
      canRaiseConfidence: false,
      canUseLearnedWeights: false,
      canStake: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: compact(
        "Model trust can lower or cap confidence only. It cannot raise public confidence, use learned weights, stake, persist, publish, or train until live provider data, calibration, corpus, and Supabase runtime gates pass."
      ),
      verificationUrl: `/api/sports/decision/model-trust?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
