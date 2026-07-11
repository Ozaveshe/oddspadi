import type { DecisionMarketAlternativeArbiter } from "@/lib/sports/prediction/decisionMarketAlternativeArbiter";
import type { DecisionProbabilityFusionAudit } from "@/lib/sports/prediction/decisionProbabilityFusionAudit";
import type { FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL } from "@/lib/sports/training/footballDataMarketBenchmark";
import type { Sport } from "@/lib/sports/types";

export type DecisionMarketPriorGovernorStatus = "market-prior-required" | "model-prior-eligible" | "mixed-evidence" | "waiting-benchmark";
export type DecisionMarketPriorGovernorAction =
  | "defer-to-market-prior"
  | "allow-provider-enriched-retest"
  | "keep-shadow-locked"
  | "run-market-benchmark";

export type DecisionMarketPriorGovernor = {
  mode: "market-prior-governor";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMarketPriorGovernorStatus;
  action: DecisionMarketPriorGovernorAction;
  governorHash: string;
  summary: string;
  benchmark: {
    available: boolean;
    mode: FootballDataMarketBenchmark["mode"] | null;
    status: FootballDataMarketBenchmark["status"] | null;
    matchedRows: number;
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"] | null;
    recommendation: FootballDataMarketBenchmark["recommendation"]["action"] | null;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
    modelBrierDelta: number | null;
    modelLogLossDelta: number | null;
  };
  fusionImpact: {
    fusionStatus: DecisionProbabilityFusionAudit["status"];
    candidates: number;
    supportsValueBeforeGovernor: number;
    actionCappedBeforeGovernor: number;
    alternativesReadyBeforeGovernor: number;
    candidatesCappedByHistoricalBenchmark: number;
  };
  decisionRules: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }>;
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsShadowPrior: boolean;
    canApplyMarketPrior: false;
    canMutateLiveProbabilities: false;
    canPersistBenchmark: false;
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

function statusFrom(benchmark: FootballDataMarketBenchmark | null | undefined): DecisionMarketPriorGovernorStatus {
  if (!benchmark || benchmark.status === "no-data" || benchmark.status === "failed") return "waiting-benchmark";
  if (benchmark.comparison.verdict === "market-beats-model") return "market-prior-required";
  if (benchmark.comparison.verdict === "model-beats-market") return "model-prior-eligible";
  return "mixed-evidence";
}

function actionFrom(status: DecisionMarketPriorGovernorStatus): DecisionMarketPriorGovernorAction {
  if (status === "market-prior-required") return "defer-to-market-prior";
  if (status === "model-prior-eligible") return "allow-provider-enriched-retest";
  if (status === "mixed-evidence") return "keep-shadow-locked";
  return "run-market-benchmark";
}

function summaryFor({
  status,
  benchmark,
  supportsValue
}: {
  status: DecisionMarketPriorGovernorStatus;
  benchmark: FootballDataMarketBenchmark | null | undefined;
  supportsValue: number;
}): string {
  if (status === "market-prior-required") {
    return `Historical benchmark says no-vig market consensus beats the model; ${supportsValue} fusion value candidate(s) remain capped until provider-enriched retests improve model evidence.`;
  }
  if (status === "model-prior-eligible") {
    return "Historical benchmark says the model beat the market baseline; provider-enriched retest can proceed, but live probability mutation remains locked.";
  }
  if (status === "mixed-evidence") {
    return "Historical benchmark evidence is mixed or thin; market prior and model prior both stay shadow-only.";
  }
  if (benchmark?.status === "failed") return "Market-prior governance needs a successful model-vs-market benchmark before it can trust fusion candidates.";
  return "Market-prior governance is waiting for the read-only public EPL model-vs-market benchmark.";
}

function benchmarkSummary(benchmark: FootballDataMarketBenchmark | null | undefined): DecisionMarketPriorGovernor["benchmark"] {
  return {
    available: Boolean(benchmark && (benchmark.status === "completed" || benchmark.status === "partial")),
    mode: benchmark?.mode ?? null,
    status: benchmark?.status ?? null,
    matchedRows: benchmark?.corpus.matchedRows ?? 0,
    verdict: benchmark?.comparison.verdict ?? null,
    recommendation: benchmark?.recommendation.action ?? null,
    modelBrierScore: benchmark?.model.brierScore ?? null,
    marketBrierScore: benchmark?.market.brierScore ?? null,
    modelLogLoss: benchmark?.model.logLoss ?? null,
    marketLogLoss: benchmark?.market.logLoss ?? null,
    modelBrierDelta: benchmark?.comparison.modelBrierDelta ?? null,
    modelLogLossDelta: benchmark?.comparison.modelLogLossDelta ?? null
  };
}

export function buildDecisionMarketPriorGovernor({
  date,
  sport,
  probabilityFusionAudit,
  marketAlternativeArbiter,
  benchmark = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  probabilityFusionAudit: DecisionProbabilityFusionAudit;
  marketAlternativeArbiter: DecisionMarketAlternativeArbiter;
  benchmark?: FootballDataMarketBenchmark | null;
  now?: Date;
}): DecisionMarketPriorGovernor {
  const status = statusFrom(benchmark);
  const action = actionFrom(status);
  const supportsValue = probabilityFusionAudit.totals.supportsValue;
  const cappedByBenchmark = status === "market-prior-required" ? probabilityFusionAudit.candidates.filter((candidate) => candidate.verdict === "supports-value" || candidate.verdict === "watch").length : 0;
  const rules = [
    {
      id: "historical-benchmark-present",
      passed: Boolean(benchmark && (benchmark.status === "completed" || benchmark.status === "partial")),
      detail: benchmark ? `${benchmark.status} benchmark with ${benchmark.corpus.matchedRows} matched holdout row(s).` : "No market benchmark has been attached to this governor run."
    },
    {
      id: "model-beats-market",
      passed: benchmark?.comparison.verdict === "model-beats-market",
      detail:
        benchmark?.comparison.verdict === "model-beats-market"
          ? "Model beat market consensus on Brier and log-loss."
          : "Model has not proved superiority over the no-vig market consensus."
    },
    {
      id: "market-prior-application-locked",
      passed: true,
      detail: "Market-prior evidence is diagnostic only; live probability mutation and publishing remain disabled."
    }
  ];
  const proofUrls = [
    "/api/sports/decision/market-prior-governor",
    "/api/sports/decision/market-calibrated-fusion",
    "/api/sports/decision/training/football-data-market-benchmark-memory",
    "/api/sports/decision/training/football-data-market-benchmark-persistence",
    "/api/sports/decision/training/football-data-market-benchmark",
    "/api/sports/decision/probability-fusion-audit",
    "/api/sports/decision/market-alternative-arbiter"
  ];
  const governorHash = stableHash({
    date,
    sport,
    status,
    benchmark: benchmarkSummary(benchmark),
    fusion: [probabilityFusionAudit.auditHash, probabilityFusionAudit.totals.supportsValue, probabilityFusionAudit.totals.actionCapped],
    alternatives: [marketAlternativeArbiter.arbiterHash, marketAlternativeArbiter.totals.preferSaferAlternative]
  });

  return {
    mode: "market-prior-governor",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    action,
    governorHash,
    summary: summaryFor({ status, benchmark, supportsValue }),
    benchmark: benchmarkSummary(benchmark),
    fusionImpact: {
      fusionStatus: probabilityFusionAudit.status,
      candidates: probabilityFusionAudit.totals.candidates,
      supportsValueBeforeGovernor: supportsValue,
      actionCappedBeforeGovernor: probabilityFusionAudit.totals.actionCapped,
      alternativesReadyBeforeGovernor: marketAlternativeArbiter.totals.preferSaferAlternative,
      candidatesCappedByHistoricalBenchmark: cappedByBenchmark
    },
    decisionRules: rules,
    nextAction: {
      label: "Run read-only market benchmark proof",
      verifyUrl: FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL,
      expectedEvidence: "Model Brier/log-loss compared against no-vig bookmaker consensus on the same EPL holdout fixtures."
    },
    controls: {
      canInspectReadOnly: true,
      canUseAsShadowPrior: status === "market-prior-required" || status === "model-prior-eligible",
      canApplyMarketPrior: false,
      canMutateLiveProbabilities: false,
      canPersistBenchmark: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls,
    locks: [
      "Historical model-vs-market evidence can cap shadow recommendations but cannot mutate live probabilities.",
      "Market priors cannot be applied until provider odds snapshots, stored backtests, CLV evidence, and promotion gates pass.",
      "If the market beats the model, value-pick enthusiasm is overruled until provider-enriched retests prove improvement."
    ]
  };
}
