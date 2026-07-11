import { calculateExpectedValue, clampProbability } from "@/lib/sports/prediction/odds";
import type { DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionProbabilityFusionStatus = "ready-shadow" | "action-capped" | "needs-market" | "blocked";
export type DecisionProbabilityFusionVerdict = "supports-value" | "watch" | "avoid" | "blocked";

export type DecisionProbabilityFusionCandidate = {
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  selection: string | null;
  baseAction: DecisionAction;
  fusedAction: DecisionAction;
  verdict: DecisionProbabilityFusionVerdict;
  modelProbability: number | null;
  marketProbability: number | null;
  posteriorProbability: number | null;
  fusedProbability: number | null;
  fusedEdge: number | null;
  fusedExpectedValue: number | null;
  odds: number | null;
  dataQuality: number;
  weights: {
    model: number;
    market: number;
    posterior: number;
  };
  confidenceBand: {
    low: number | null;
    high: number | null;
  };
  blockers: string[];
  safeguards: string[];
  explanation: string;
};

export type DecisionProbabilityFusionAudit = {
  mode: "probability-fusion-audit";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProbabilityFusionStatus;
  auditHash: string;
  summary: string;
  formula: {
    id: "log-odds-fusion-v1";
    equation: string;
    notes: string[];
  };
  totals: {
    candidates: number;
    supportsValue: number;
    watch: number;
    avoid: number;
    blocked: number;
    actionCapped: number;
    averageFusedEdge: number | null;
    averageFusedExpectedValue: number | null;
  };
  topCandidate: DecisionProbabilityFusionCandidate | null;
  candidates: DecisionProbabilityFusionCandidate[];
  controls: {
    canInspectReadOnly: true;
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

function finiteProbability(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampProbability(value);
}

function logit(probability: number): number {
  const bounded = Math.min(0.995, Math.max(0.005, probability));
  return Math.log(bounded / (1 - bounded));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function weightedAverage(values: Array<{ value: number | null; weight: number }>): number | null {
  const usable = values.filter((entry) => entry.value !== null && entry.weight > 0) as Array<{ value: number; weight: number }>;
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;
  return usable.reduce((sum, entry) => sum + logit(entry.value) * entry.weight, 0) / totalWeight;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function weightsFor({
  dataQuality,
  hasMarket,
  hasPosterior
}: {
  dataQuality: number;
  hasMarket: boolean;
  hasPosterior: boolean;
}): DecisionProbabilityFusionCandidate["weights"] {
  const quality = clampProbability(dataQuality);
  const raw = {
    model: 0.44 + quality * 0.22,
    market: hasMarket ? 0.18 + (1 - quality) * 0.22 : 0,
    posterior: hasPosterior ? 0.2 : 0
  };
  const total = raw.model + raw.market + raw.posterior;
  return {
    model: round(raw.model / total) ?? 0,
    market: round(raw.market / total) ?? 0,
    posterior: round(raw.posterior / total) ?? 0
  };
}

function hardBlockers(row: DecisionRow): string[] {
  const decision = row.prediction.decision;
  return [
    ...decision.dataCoverage.requiredBeforeTrust.slice(0, 4),
    ...decision.actionability.blockers.slice(0, 4),
    decision.controlPolicy.publishAllowed ? "" : decision.controlPolicy.summary,
    decision.risk === "high" ? "High decision risk blocks probability promotion." : "",
    decision.robustness.status === "fragile" ? decision.robustness.summary : ""
  ].filter(Boolean).slice(0, 8);
}

function safeguards(row: DecisionRow): string[] {
  const trace = row.prediction.decision.probabilityTrace;
  return [
    ...trace.safeguards.slice(0, 4),
    ...trace.conflicts.slice(0, 3),
    "Fusion audit is shadow-only until provider rows, calibration, and backtests pass.",
    "Fused probability does not mutate the live prediction object."
  ].filter(Boolean).slice(0, 8);
}

function actionFromVerdict(verdict: DecisionProbabilityFusionVerdict): DecisionAction {
  if (verdict === "supports-value") return "consider";
  if (verdict === "watch") return "monitor";
  return "avoid";
}

function verdictFor({
  fusedEdge,
  fusedExpectedValue,
  marketProbability,
  dataQuality,
  blockers
}: {
  fusedEdge: number | null;
  fusedExpectedValue: number | null;
  marketProbability: number | null;
  dataQuality: number;
  blockers: string[];
}): DecisionProbabilityFusionVerdict {
  if (blockers.length >= 4) return "blocked";
  if (marketProbability === null || fusedEdge === null || fusedExpectedValue === null) return "blocked";
  if (blockers.length || dataQuality < 0.62) return "watch";
  if (fusedEdge >= 0.035 && fusedExpectedValue > 0.025) return "supports-value";
  if (fusedEdge > 0 && fusedExpectedValue > 0) return "watch";
  return "avoid";
}

function candidateFor(row: DecisionRow): DecisionProbabilityFusionCandidate {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const trace = decision.probabilityTrace;
  const belief = decision.beliefState;
  const modelProbability = finiteProbability(bestPick.hasValue ? bestPick.modelProbability : trace.modelProbability ?? belief.baseModelProbability);
  const marketProbability = finiteProbability(bestPick.hasValue ? bestPick.noVigImpliedProbability : belief.marketImpliedProbability);
  const posteriorProbability = finiteProbability(trace.posteriorProbability ?? belief.believedProbability);
  const dataQuality = clampProbability(decision.dataCoverage.score / 100);
  const weights = weightsFor({
    dataQuality,
    hasMarket: marketProbability !== null,
    hasPosterior: posteriorProbability !== null
  });
  const fusedLogOdds = weightedAverage([
    { value: modelProbability, weight: weights.model },
    { value: marketProbability, weight: weights.market },
    { value: posteriorProbability, weight: weights.posterior }
  ]);
  const rawFused = fusedLogOdds === null ? null : clampProbability(logistic(fusedLogOdds));
  const lowBand = finiteProbability(trace.confidenceBand.low ?? belief.confidenceInterval.low);
  const highBand = finiteProbability(trace.confidenceBand.high ?? belief.confidenceInterval.high);
  const fusedProbability =
    rawFused === null
      ? null
      : lowBand !== null && highBand !== null
        ? Math.min(highBand, Math.max(lowBand, rawFused))
        : rawFused;
  const odds = bestPick.hasValue ? bestPick.odds : null;
  const fusedEdge = fusedProbability !== null && marketProbability !== null ? fusedProbability - marketProbability : null;
  const fusedExpectedValue = fusedProbability !== null && odds !== null ? calculateExpectedValue(fusedProbability, odds) : null;
  const blockers = hardBlockers(row);
  const verdict = verdictFor({ fusedEdge, fusedExpectedValue, marketProbability, dataQuality, blockers });
  const fusedAction = blockers.length ? "avoid" : actionFromVerdict(verdict);

  return {
    matchId: row.match.id,
    match: matchLabel(row.match),
    sport: row.match.sport,
    league: row.match.league.name,
    selection: bestPick.hasValue ? bestPick.label : trace.selection ?? decision.recommendedSelection,
    baseAction: decision.action,
    fusedAction,
    verdict,
    modelProbability: round(modelProbability),
    marketProbability: round(marketProbability),
    posteriorProbability: round(posteriorProbability),
    fusedProbability: round(fusedProbability),
    fusedEdge: round(fusedEdge),
    fusedExpectedValue: round(fusedExpectedValue),
    odds,
    dataQuality: round(dataQuality) ?? 0,
    weights,
    confidenceBand: {
      low: round(lowBand),
      high: round(highBand)
    },
    blockers,
    safeguards: safeguards(row),
    explanation:
      fusedProbability === null
        ? "Fusion skipped because no usable probability inputs were present."
        : `Fused log-odds blend used model ${weights.model}, market ${weights.market}, and posterior ${weights.posterior}; final probability ${Math.round(
            fusedProbability * 100
          )}% stays shadow-only.`
  };
}

function candidateRank(candidate: DecisionProbabilityFusionCandidate): number {
  const actionScore = candidate.verdict === "supports-value" ? 300 : candidate.verdict === "watch" ? 150 : candidate.verdict === "blocked" ? -80 : 0;
  return actionScore + (candidate.fusedExpectedValue ?? -1) * 100 + (candidate.fusedEdge ?? -1) * 100 + candidate.dataQuality * 25;
}

function statusFor(candidates: DecisionProbabilityFusionCandidate[]): DecisionProbabilityFusionStatus {
  if (!candidates.length) return "blocked";
  if (candidates.every((candidate) => candidate.marketProbability === null)) return "needs-market";
  if (candidates.some((candidate) => candidate.verdict === "supports-value" && candidate.fusedAction === "consider")) return "ready-shadow";
  if (candidates.some((candidate) => candidate.blockers.length || candidate.fusedAction !== candidate.baseAction)) return "action-capped";
  return "needs-market";
}

export function buildDecisionProbabilityFusionAudit({
  rows,
  date,
  sport,
  limit = 8,
  now = new Date()
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
  now?: Date;
}): DecisionProbabilityFusionAudit {
  const candidates = rows
    .map(candidateFor)
    .sort((a, b) => candidateRank(b) - candidateRank(a))
    .slice(0, limit);
  const status = statusFor(candidates);
  const topCandidate = candidates[0] ?? null;
  const supportsValue = candidates.filter((candidate) => candidate.verdict === "supports-value").length;
  const watch = candidates.filter((candidate) => candidate.verdict === "watch").length;
  const avoid = candidates.filter((candidate) => candidate.verdict === "avoid").length;
  const blocked = candidates.filter((candidate) => candidate.verdict === "blocked").length;
  const actionCapped = candidates.filter((candidate) => candidate.baseAction !== candidate.fusedAction || candidate.blockers.length > 0).length;
  const auditHash = stableHash({
    date,
    sport,
    status,
    candidates: candidates.map((candidate) => [
      candidate.matchId,
      candidate.selection,
      candidate.fusedProbability,
      candidate.fusedEdge,
      candidate.verdict,
      candidate.fusedAction
    ])
  });

  return {
    mode: "probability-fusion-audit",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    auditHash,
    summary:
      status === "ready-shadow"
        ? `Probability fusion found ${supportsValue} shadow value candidate(s), with live action still capped by governance.`
        : status === "action-capped"
          ? `Probability fusion is mathematically available, but ${actionCapped} candidate(s) are capped by data, risk, control, or actionability gates.`
          : status === "needs-market"
            ? "Probability fusion needs priced no-vig market probabilities before edge and EV can be trusted."
            : "Probability fusion is blocked because no usable candidates or probability inputs are available.",
    formula: {
      id: "log-odds-fusion-v1",
      equation: "p_fused = sigmoid((w_model*logit(p_model) + w_market*logit(p_no_vig_market) + w_posterior*logit(p_posterior)) / sum(w))",
      notes: [
        "Model weight rises with data quality; market weight rises when data quality is lower.",
        "The fused result is clamped to the existing confidence band when one is available.",
        "Fused EV uses EV = p_fused * decimalOdds - 1.",
        "This audit never mutates live probabilities or unlocks public picks."
      ]
    },
    totals: {
      candidates: candidates.length,
      supportsValue,
      watch,
      avoid,
      blocked,
      actionCapped,
      averageFusedEdge: average(candidates.map((candidate) => candidate.fusedEdge)),
      averageFusedExpectedValue: average(candidates.map((candidate) => candidate.fusedExpectedValue))
    },
    topCandidate,
    candidates,
    controls: {
      canInspectReadOnly: true,
      canApplyToLiveProbabilities: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/probability-fusion-audit",
      "/api/sports/decision/model-reasoning-ledger",
      "/api/sports/decision/model-ensemble",
      "/api/sports/decision/odds-intelligence-proof"
    ],
    locks: [
      "Probability fusion audit is read-only and cannot apply fused probabilities to live predictions.",
      "Provider-backed data, stored historical labels, calibration, backtests, and governance must pass before fusion can become authoritative.",
      "Public picks, staking, persistence, training, and learned weights stay locked."
    ]
  };
}
