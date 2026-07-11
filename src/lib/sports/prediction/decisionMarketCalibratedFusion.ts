import type { DecisionProbabilityFusionAudit, DecisionProbabilityFusionCandidate } from "@/lib/sports/prediction/decisionProbabilityFusionAudit";
import type { FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import type { Sport } from "@/lib/sports/types";

export type DecisionMarketCalibratedFusionStatus = "ready-shadow" | "waiting-benchmark" | "blocked";
export type DecisionMarketCalibratedFusionAction =
  | "defer-to-market-prior"
  | "allow-shadow-candidate-review"
  | "run-market-benchmark"
  | "keep-shadow-locked";
export type DecisionMarketCalibratedFusionVerdict = "market-capped" | "shadow-value" | "watch" | "avoid" | "blocked";

export type DecisionMarketCalibratedFusionCandidate = {
  matchId: string;
  match: string;
  selection: string | null;
  baseVerdict: DecisionProbabilityFusionCandidate["verdict"];
  calibratedVerdict: DecisionMarketCalibratedFusionVerdict;
  modelProbability: number | null;
  marketProbability: number | null;
  posteriorProbability: number | null;
  previousFusedProbability: number | null;
  calibratedProbability: number | null;
  calibratedEdge: number | null;
  calibratedExpectedValue: number | null;
  odds: number | null;
  weights: {
    model: number;
    market: number;
    posterior: number;
  };
  explanation: string;
  safeguards: string[];
};

export type DecisionMarketCalibratedFusion = {
  mode: "market-calibrated-fusion";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMarketCalibratedFusionStatus;
  action: DecisionMarketCalibratedFusionAction;
  fusionHash: string;
  summary: string;
  benchmark: {
    available: boolean;
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null;
    recommendation: FootballDataMarketBenchmark["recommendation"]["action"] | null;
    matchedRows: number;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
  };
  formula: {
    id: "market-calibrated-log-odds-v1";
    equation: string;
    notes: string[];
  };
  totals: {
    candidates: number;
    shadowValue: number;
    marketCapped: number;
    watch: number;
    avoid: number;
    blocked: number;
    averageCalibratedEdge: number | null;
    averageCalibratedExpectedValue: number | null;
  };
  topCandidate: DecisionMarketCalibratedFusionCandidate | null;
  candidates: DecisionMarketCalibratedFusionCandidate[];
  controls: {
    canInspectReadOnly: true;
    canUseAsShadowPrior: boolean;
    canApplyToLiveProbabilities: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function round(value: number | null | undefined, digits = 4): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function clampProbability(value: number): number {
  return Math.min(0.995, Math.max(0.005, value));
}

function logit(probability: number): number {
  const bounded = clampProbability(probability);
  return Math.log(bounded / (1 - bounded));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function finiteProbability(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clampProbability(value) : null;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function benchmarkSummary(benchmark: FootballDataMarketBenchmark | null | undefined): DecisionMarketCalibratedFusion["benchmark"] {
  return {
    available: Boolean(benchmark && (benchmark.status === "completed" || benchmark.status === "partial")),
    verdict: benchmark?.comparison.verdict ?? null,
    recommendation: benchmark?.recommendation.action ?? null,
    matchedRows: benchmark?.corpus.matchedRows ?? 0,
    modelBrierScore: benchmark?.model.brierScore ?? null,
    marketBrierScore: benchmark?.market.brierScore ?? null,
    modelLogLoss: benchmark?.model.logLoss ?? null,
    marketLogLoss: benchmark?.market.logLoss ?? null
  };
}

function weightsFor(verdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null): DecisionMarketCalibratedFusionCandidate["weights"] {
  if (verdict === "model-beats-market") return { model: 0.58, market: 0.24, posterior: 0.18 };
  if (verdict === "market-beats-model") return { model: 0.18, market: 0.68, posterior: 0.14 };
  if (verdict === "mixed") return { model: 0.3, market: 0.5, posterior: 0.2 };
  return { model: 0.24, market: 0.56, posterior: 0.2 };
}

function calibratedProbability(candidate: DecisionProbabilityFusionCandidate, weights: DecisionMarketCalibratedFusionCandidate["weights"]): number | null {
  const inputs = [
    { probability: finiteProbability(candidate.modelProbability), weight: weights.model },
    { probability: finiteProbability(candidate.marketProbability), weight: weights.market },
    { probability: finiteProbability(candidate.posteriorProbability), weight: weights.posterior }
  ].filter((input): input is { probability: number; weight: number } => input.probability !== null && input.weight > 0);
  const totalWeight = inputs.reduce((sum, input) => sum + input.weight, 0);
  if (!inputs.length || totalWeight <= 0) return null;
  return clampProbability(logistic(inputs.reduce((sum, input) => sum + logit(input.probability) * input.weight, 0) / totalWeight));
}

function verdictFor({
  benchmarkVerdict,
  candidate,
  calibratedEdge,
  calibratedExpectedValue
}: {
  benchmarkVerdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null;
  candidate: DecisionProbabilityFusionCandidate;
  calibratedEdge: number | null;
  calibratedExpectedValue: number | null;
}): DecisionMarketCalibratedFusionVerdict {
  if (candidate.blockers.length >= 4 || calibratedEdge === null || calibratedExpectedValue === null || candidate.marketProbability === null) return "blocked";
  if (benchmarkVerdict === "market-beats-model" && candidate.verdict === "supports-value") return "market-capped";
  if (calibratedEdge >= 0.035 && calibratedExpectedValue > 0.025 && benchmarkVerdict === "model-beats-market") return "shadow-value";
  if (calibratedEdge > 0 && calibratedExpectedValue > 0) return "watch";
  return "avoid";
}

function candidateFor(
  candidate: DecisionProbabilityFusionCandidate,
  benchmarkVerdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null
): DecisionMarketCalibratedFusionCandidate {
  const weights = weightsFor(benchmarkVerdict);
  const probability = calibratedProbability(candidate, weights);
  const marketProbability = finiteProbability(candidate.marketProbability);
  const calibratedEdge = probability !== null && marketProbability !== null ? probability - marketProbability : null;
  const calibratedExpectedValue = probability !== null && candidate.odds !== null ? probability * candidate.odds - 1 : null;
  const calibratedVerdict = verdictFor({ benchmarkVerdict, candidate, calibratedEdge, calibratedExpectedValue });

  return {
    matchId: candidate.matchId,
    match: candidate.match,
    selection: candidate.selection,
    baseVerdict: candidate.verdict,
    calibratedVerdict,
    modelProbability: round(candidate.modelProbability),
    marketProbability: round(marketProbability),
    posteriorProbability: round(candidate.posteriorProbability),
    previousFusedProbability: round(candidate.fusedProbability),
    calibratedProbability: round(probability),
    calibratedEdge: round(calibratedEdge),
    calibratedExpectedValue: round(calibratedExpectedValue),
    odds: candidate.odds,
    weights,
    explanation:
      calibratedVerdict === "market-capped"
        ? `The raw fusion liked this selection, but the historical benchmark favors market consensus, so market weight ${weights.market} caps it to shadow review.`
        : probability === null
          ? "Calibration skipped because model, market, or posterior probabilities were not usable."
          : `Market-calibrated log-odds blend used model ${weights.model}, market ${weights.market}, posterior ${weights.posterior}; result remains shadow-only.`,
    safeguards: [
      ...candidate.safeguards.slice(0, 4),
      "Historical market benchmark can only cap shadow confidence; it cannot publish or stake.",
      "Provider-enriched odds snapshots and closing-line value evidence are required before promotion."
    ]
  };
}

function rank(candidate: DecisionMarketCalibratedFusionCandidate): number {
  const verdictScore =
    candidate.calibratedVerdict === "shadow-value"
      ? 300
      : candidate.calibratedVerdict === "watch"
        ? 160
        : candidate.calibratedVerdict === "market-capped"
          ? 80
          : candidate.calibratedVerdict === "blocked"
            ? -80
            : 0;
  return verdictScore + (candidate.calibratedExpectedValue ?? -1) * 100 + (candidate.calibratedEdge ?? -1) * 100;
}

function statusFor(benchmark: FootballDataMarketBenchmark | null | undefined, candidates: DecisionMarketCalibratedFusionCandidate[]): DecisionMarketCalibratedFusionStatus {
  if (!benchmark || benchmark.status === "no-data" || benchmark.status === "failed") return "waiting-benchmark";
  if (!candidates.length || candidates.every((candidate) => candidate.calibratedVerdict === "blocked")) return "blocked";
  return "ready-shadow";
}

function actionFor(status: DecisionMarketCalibratedFusionStatus, benchmarkVerdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null): DecisionMarketCalibratedFusionAction {
  if (status === "waiting-benchmark") return "run-market-benchmark";
  if (benchmarkVerdict === "market-beats-model") return "defer-to-market-prior";
  if (benchmarkVerdict === "model-beats-market") return "allow-shadow-candidate-review";
  return "keep-shadow-locked";
}

export function buildDecisionMarketCalibratedFusion({
  date,
  sport,
  probabilityFusionAudit,
  benchmark = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  probabilityFusionAudit: DecisionProbabilityFusionAudit;
  benchmark?: FootballDataMarketBenchmark | null;
  now?: Date;
}): DecisionMarketCalibratedFusion {
  const benchmarkInfo = benchmarkSummary(benchmark);
  const candidates = probabilityFusionAudit.candidates
    .map((candidate) => candidateFor(candidate, benchmarkInfo.verdict))
    .sort((a, b) => rank(b) - rank(a));
  const status = statusFor(benchmark, candidates);
  const action = actionFor(status, benchmarkInfo.verdict);
  const shadowValue = candidates.filter((candidate) => candidate.calibratedVerdict === "shadow-value").length;
  const marketCapped = candidates.filter((candidate) => candidate.calibratedVerdict === "market-capped").length;
  const watch = candidates.filter((candidate) => candidate.calibratedVerdict === "watch").length;
  const avoid = candidates.filter((candidate) => candidate.calibratedVerdict === "avoid").length;
  const blocked = candidates.filter((candidate) => candidate.calibratedVerdict === "blocked").length;
  const fusionHash = stableHash({
    date,
    sport,
    benchmark: benchmarkInfo,
    candidates: candidates.map((candidate) => [
      candidate.matchId,
      candidate.selection,
      candidate.calibratedProbability,
      candidate.calibratedEdge,
      candidate.calibratedVerdict
    ])
  });

  return {
    mode: "market-calibrated-fusion",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    action,
    fusionHash,
    summary:
      action === "defer-to-market-prior"
        ? `Market-calibrated fusion capped ${marketCapped} raw value candidate(s) because historical evidence says no-vig market consensus beats the model.`
        : action === "allow-shadow-candidate-review"
          ? `Market-calibrated fusion found ${shadowValue} shadow candidate(s) after benchmark-aware weighting.`
          : status === "waiting-benchmark"
            ? "Market-calibrated fusion is waiting for a model-vs-market benchmark before it can weight market priors."
            : "Market-calibrated fusion remains locked because candidate evidence is insufficient.",
    benchmark: benchmarkInfo,
    formula: {
      id: "market-calibrated-log-odds-v1",
      equation: "p_calibrated = sigmoid((w_model*logit(p_model) + w_market*logit(p_no_vig_market) + w_posterior*logit(p_posterior)) / sum(w))",
      notes: [
        "When the historical benchmark says the market beats the model, market weight rises to 0.68 and value enthusiasm is capped.",
        "When the model beats market consensus on both Brier and log-loss, model weight rises to 0.58 for shadow review only.",
        "This layer never mutates live probabilities, writes decisions, publishes picks, or stakes."
      ]
    },
    totals: {
      candidates: candidates.length,
      shadowValue,
      marketCapped,
      watch,
      avoid,
      blocked,
      averageCalibratedEdge: average(candidates.map((candidate) => candidate.calibratedEdge)),
      averageCalibratedExpectedValue: average(candidates.map((candidate) => candidate.calibratedExpectedValue))
    },
    topCandidate: candidates[0] ?? null,
    candidates,
    controls: {
      canInspectReadOnly: true,
      canUseAsShadowPrior: status === "ready-shadow",
      canApplyToLiveProbabilities: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/market-calibrated-fusion",
      "/api/sports/decision/market-prior-governor",
      "/api/sports/decision/probability-fusion-audit",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/training/football-data-market-benchmark-memory"
    ],
    locks: [
      "Market-calibrated fusion is shadow-only and cannot alter the prediction payload.",
      "A market-favored benchmark caps raw value candidates until provider-enriched retests beat market consensus.",
      "Publishing, staking, persistence, and learned weights remain disabled."
    ]
  };
}
