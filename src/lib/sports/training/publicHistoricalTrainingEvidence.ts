import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";

export type PublicHistoricalTrainingEvidenceStatus =
  | "provider-retest-ready"
  | "market-prior-dominant"
  | "public-history-ready"
  | "insufficient-history"
  | "failed";

export type PublicHistoricalTrainingEvidence = {
  mode: "public-historical-training-evidence";
  generatedAt: string;
  status: PublicHistoricalTrainingEvidenceStatus;
  evidenceHash: string;
  summary: string;
  source: {
    label: "Football-Data public EPL CSV";
    league: "Premier League";
    seasons: string;
    providerEnriched: false;
    persisted: false;
  };
  diagnosticScore: number;
  scorecard: {
    seasonsLoaded: number;
    fixtures: number;
    oddsRows: number;
    bookmakerMarkets: number;
    averageBookmakerMargin: number | null;
    benchmarkRows: number;
    benchmarkVerdict: FootballDataHistoricalLearningDossier["scorecard"]["benchmarkVerdict"];
    thresholdAction: FootballDataHistoricalLearningDossier["scorecard"]["thresholdAction"];
    walkForwardAction: FootballDataHistoricalLearningDossier["scorecard"]["walkForwardAction"];
    learningScore: number;
  };
  failureDiagnosis: {
    status: "provider-retest" | "market-prior" | "insufficient" | "failed";
    headline: string;
    modelVsMarket: {
      modelBrierScore: number | null;
      marketBrierScore: number | null;
      modelLogLoss: number | null;
      marketLogLoss: number | null;
      modelBrierDelta: number | null;
      modelLogLossDelta: number | null;
      verdict: FootballDataHistoricalLearningDossier["scorecard"]["benchmarkVerdict"];
      interpretation: string;
    };
    threshold: {
      action: FootballDataHistoricalLearningDossier["scorecard"]["thresholdAction"];
      bestMinEdge: number | null;
      bestMinModelProbability: number | null;
      bestPickCount: number | null;
      bestYield: number | null;
      blocker: string;
    };
    walkForward: {
      action: FootballDataHistoricalLearningDossier["scorecard"]["walkForwardAction"];
      folds: number;
      passFolds: number;
      totalPicks: number;
      aggregateYield: number | null;
      stabilityScore: number;
      blocker: string;
    };
    providerRetestChecklist: Array<{
      id: "fixture-identity" | "odds-snapshots" | "context-features" | "feature-storage" | "market-gates";
      label: string;
      priority: number;
      requiredEvidence: string;
      proofUrl: string;
    }>;
  };
  contribution: {
    canCreditDiagnosticCorpus: boolean;
    mvpCorpusPercent: number;
    dataReadinessPercent: number;
    aiEvidenceValue: "high" | "medium" | "low" | "none";
    reason: string;
  };
  risks: string[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsAiEvidence: boolean;
    canCreditMvpDiagnosticProgress: boolean;
    canPersistTrainingRows: false;
    canPersistBacktestRun: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

function stableHash(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 20): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function statusFor(dossier: FootballDataHistoricalLearningDossier): PublicHistoricalTrainingEvidenceStatus {
  if (dossier.status === "failed") return "failed";
  if (dossier.status === "insufficient-history") return "insufficient-history";
  if (dossier.status === "ready-provider-retest") return "provider-retest-ready";
  if (dossier.status === "market-prior-dominant") return "market-prior-dominant";
  return "public-history-ready";
}

function diagnosticScoreFor(dossier: FootballDataHistoricalLearningDossier): number {
  const markets = dossier.artifacts.marketConsensus.totals.bookmakerMarkets;
  const margin = dossier.artifacts.marketConsensus.totals.averageMargin;
  const corpusScore = Math.min(dossier.scorecard.fixtures / 3800, 1) * 25;
  const oddsScore = Math.min(dossier.scorecard.oddsRows / 3800, 1) * 18;
  const marketDepthScore = Math.min(markets / 20000, 1) * 18;
  const benchmarkScore = Math.min(dossier.scorecard.benchmarkRows / 1000, 1) * 14;
  const learningScore = Math.min(dossier.scorecard.learningScore / 100, 1) * 15;
  const marginScore = margin !== null && margin > 0 && margin < 0.08 ? 5 : 0;
  const statusScore = dossier.status === "ready-provider-retest" ? 5 : dossier.status === "market-prior-dominant" ? 3 : dossier.status === "needs-provider-enrichment" ? 2 : 0;
  return clamp(corpusScore + oddsScore + marketDepthScore + benchmarkScore + learningScore + marginScore + statusScore);
}

function aiEvidenceValue(score: number, status: PublicHistoricalTrainingEvidenceStatus): PublicHistoricalTrainingEvidence["contribution"]["aiEvidenceValue"] {
  if (status === "failed") return "none";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score > 0) return "low";
  return "none";
}

function summaryFor(status: PublicHistoricalTrainingEvidenceStatus, score: number, fixtures: number, oddsRows: number): string {
  if (status === "provider-retest-ready") {
    return `Public EPL history provides ${fixtures.toLocaleString()} fixtures and ${oddsRows.toLocaleString()} odds rows; diagnostic score ${score}/100 and ready for provider-enriched retest.`;
  }
  if (status === "market-prior-dominant") {
    return `Public EPL history provides ${fixtures.toLocaleString()} fixtures and ${oddsRows.toLocaleString()} odds rows; market prior still beats the current model, so training remains locked.`;
  }
  if (status === "public-history-ready") {
    return `Public EPL history is usable as diagnostic evidence with score ${score}/100, but provider-enriched persistence is still required.`;
  }
  if (status === "insufficient-history") {
    return `Public EPL history evidence is incomplete; diagnostic score ${score}/100 is not enough to guide training.`;
  }
  return "Public historical training evidence failed; the agent cannot rely on this corpus proof.";
}

function diagnosisStatus(status: PublicHistoricalTrainingEvidenceStatus): PublicHistoricalTrainingEvidence["failureDiagnosis"]["status"] {
  if (status === "failed") return "failed";
  if (status === "insufficient-history") return "insufficient";
  if (status === "provider-retest-ready" || status === "public-history-ready") return "provider-retest";
  return "market-prior";
}

function metricInterpretation(dossier: FootballDataHistoricalLearningDossier): string {
  const benchmark = dossier.artifacts.marketBenchmark;
  if (benchmark.comparison.verdict === "market-beats-model") {
    return `No-vig market consensus is stronger: model Brier delta ${benchmark.comparison.modelBrierDelta ?? "n/a"} and log-loss delta ${
      benchmark.comparison.modelLogLossDelta ?? "n/a"
    } do not justify raw model value.`;
  }
  if (benchmark.comparison.verdict === "model-beats-market") {
    return "Model beats market on the public benchmark, but provider-enriched retest is still required before learned behavior can matter.";
  }
  if (benchmark.comparison.verdict === "mixed") {
    return "Model and market split the benchmark metrics, so the agent must keep shadow mode until provider evidence resolves the conflict.";
  }
  return "Benchmark evidence is insufficient for model-vs-market trust.";
}

function failureDiagnosisFor(
  dossier: FootballDataHistoricalLearningDossier,
  status: PublicHistoricalTrainingEvidenceStatus
): PublicHistoricalTrainingEvidence["failureDiagnosis"] {
  const benchmark = dossier.artifacts.marketBenchmark;
  const best = dossier.artifacts.thresholdSweep.bestProfile;
  const walkForward = dossier.artifacts.walkForward.validation;
  const thresholdBlocker =
    dossier.artifacts.thresholdSweep.recommendation.action === "raise-thresholds"
      ? "Threshold profile is promising but cannot be applied without provider-enriched persistence and promotion gates."
      : dossier.artifacts.thresholdSweep.recommendation.action === "keep-defaults"
        ? "Threshold sweep did not beat the default profile enough to justify learned thresholds."
        : "Threshold sweep needs more or richer evidence before any learned threshold can be proposed.";
  const walkForwardBlocker =
    dossier.artifacts.walkForward.recommendation.action === "eligible-for-provider-enriched-retest"
      ? "Walk-forward evidence can queue provider-enriched retest only; it cannot train or publish."
      : dossier.artifacts.walkForward.recommendation.action === "keep-shadow-locked"
        ? "Walk-forward yield or stability is not strong enough to unlock learned behavior."
        : "Walk-forward validation is too thin for a stable future-season signal.";

  return {
    status: diagnosisStatus(status),
    headline:
      status === "market-prior-dominant"
        ? "Market prior is currently the stronger teacher."
        : status === "provider-retest-ready"
          ? "Public history found a retest path, not a training unlock."
          : status === "insufficient-history"
            ? "Historical proof is too thin for learning."
            : status === "failed"
              ? "Historical proof failed and cannot guide learning."
              : "Public history is diagnostic only until provider enrichment lands.",
    modelVsMarket: {
      modelBrierScore: benchmark.model.brierScore,
      marketBrierScore: benchmark.market.brierScore,
      modelLogLoss: benchmark.model.logLoss,
      marketLogLoss: benchmark.market.logLoss,
      modelBrierDelta: benchmark.comparison.modelBrierDelta,
      modelLogLossDelta: benchmark.comparison.modelLogLossDelta,
      verdict: benchmark.comparison.verdict,
      interpretation: metricInterpretation(dossier)
    },
    threshold: {
      action: dossier.scorecard.thresholdAction,
      bestMinEdge: best?.minEdge ?? null,
      bestMinModelProbability: best?.minModelProbability ?? null,
      bestPickCount: best?.pickCount ?? null,
      bestYield: best?.yield ?? null,
      blocker: thresholdBlocker
    },
    walkForward: {
      action: dossier.scorecard.walkForwardAction,
      folds: walkForward.folds,
      passFolds: walkForward.passFolds,
      totalPicks: walkForward.totalPicks,
      aggregateYield: walkForward.aggregateYield,
      stabilityScore: walkForward.stabilityScore,
      blocker: walkForwardBlocker
    },
    providerRetestChecklist: [
      {
        id: "fixture-identity",
        label: "Provider fixture identity",
        priority: 1,
        requiredEvidence: "API-Football/APISports fixture IDs must map public EPL rows to real provider events.",
        proofUrl: "/api/sports/decision/epl-provider-fixture-map"
      },
      {
        id: "odds-snapshots",
        label: "Opening, pre-match, and closing odds snapshots",
        priority: 2,
        requiredEvidence: "The Odds API snapshots must preserve bookmaker, market, timestamp, and no-vig probability evidence.",
        proofUrl: "/api/sports/decision/odds-snapshot-storage-readiness"
      },
      {
        id: "context-features",
        label: "Lineups, injuries, news, weather, and xG context",
        priority: 3,
        requiredEvidence: "Provider context must explain whether the model can beat market consensus after richer football features.",
        proofUrl: "/api/sports/decision/training/football-provider-feature-intake-gap"
      },
      {
        id: "feature-storage",
        label: "Stored provider feature rows",
        priority: 4,
        requiredEvidence: "OddsPadi Supabase must contain normalized feature snapshots and raw provider payload receipts.",
        proofUrl: "/api/sports/decision/training/football-provider-feature-storage-receipt"
      },
      {
        id: "market-gates",
        label: "Provider-enriched market gates",
        priority: 5,
        requiredEvidence: "Retest must beat no-vig market Brier/log-loss, yield, calibration, sample, and CLV gates before promotion.",
        proofUrl: "/api/sports/decision/training/football-data-model-promotion-decision"
      }
    ]
  };
}

export function buildPublicHistoricalTrainingEvidence({
  dossier,
  now = new Date()
}: {
  dossier: FootballDataHistoricalLearningDossier;
  now?: Date;
}): PublicHistoricalTrainingEvidence {
  const status = statusFor(dossier);
  const diagnosticScore = diagnosticScoreFor(dossier);
  const bookmakerMarkets = dossier.artifacts.marketConsensus.totals.bookmakerMarkets;
  const averageBookmakerMargin = dossier.artifacts.marketConsensus.totals.averageMargin;
  const mvpCorpusPercent = status === "failed" || status === "insufficient-history" ? 0 : Math.min(55, diagnosticScore);
  const dataReadinessPercent = status === "failed" || status === "insufficient-history" ? 0 : Math.min(45, Math.round(diagnosticScore * 0.75));
  const canCreditDiagnosticCorpus = mvpCorpusPercent > 0;
  const verifyUrl =
    "/api/sports/decision/training/public-historical-training-evidence?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.02&minModelProbability=0.36&minPickCount=75&minTrainingSeasons=3&dryRun=1";
  const risks = unique([
    "Public CSV rows are not provider-enriched with injuries, lineups, xG, weather, or live event state.",
    "Bookmaker odds coverage is historical and diagnostic; it cannot prove current market availability or event mapping.",
    dossier.scorecard.benchmarkVerdict === "market-beats-model"
      ? "Historical benchmark says the market beats the current model, so market prior must remain dominant."
      : null,
    dossier.scorecard.walkForwardAction !== "eligible-for-provider-enriched-retest"
      ? `Walk-forward action is ${dossier.scorecard.walkForwardAction}; keep learned weights locked.`
      : null,
    "No rows are persisted by this receipt, and no thresholds or learned weights can influence live picks."
  ]);
  const failureDiagnosis = failureDiagnosisFor(dossier, status);

  return {
    mode: "public-historical-training-evidence",
    generatedAt: now.toISOString(),
    status,
    evidenceHash: stableHash({
      status,
      diagnosticScore,
      scorecard: dossier.scorecard,
      marketConsensus: dossier.artifacts.marketConsensus.totals,
      benchmark: dossier.artifacts.marketBenchmark.comparison,
      failureDiagnosis
    }),
    summary: summaryFor(status, diagnosticScore, dossier.scorecard.fixtures, dossier.scorecard.oddsRows),
    source: {
      label: "Football-Data public EPL CSV",
      league: "Premier League",
      seasons: `${dossier.request.seasonFrom}-${dossier.request.seasonTo}`,
      providerEnriched: false,
      persisted: false
    },
    diagnosticScore,
    scorecard: {
      seasonsLoaded: dossier.scorecard.seasonsLoaded,
      fixtures: dossier.scorecard.fixtures,
      oddsRows: dossier.scorecard.oddsRows,
      bookmakerMarkets,
      averageBookmakerMargin,
      benchmarkRows: dossier.scorecard.benchmarkRows,
      benchmarkVerdict: dossier.scorecard.benchmarkVerdict,
      thresholdAction: dossier.scorecard.thresholdAction,
      walkForwardAction: dossier.scorecard.walkForwardAction,
      learningScore: dossier.scorecard.learningScore
    },
    failureDiagnosis,
    contribution: {
      canCreditDiagnosticCorpus,
      mvpCorpusPercent,
      dataReadinessPercent,
      aiEvidenceValue: aiEvidenceValue(diagnosticScore, status),
      reason: canCreditDiagnosticCorpus
        ? "Credits diagnostic corpus progress only; provider-backed persistence, backtests, and training promotion remain locked."
        : "Does not credit corpus progress because the public-history proof is failed or insufficient."
    },
    risks,
    nextAction: {
      label: dossier.nextAction.label,
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      expectedEvidence: dossier.nextAction.expectedEvidence
    },
    controls: {
      canInspectReadOnly: true,
      canUseAsAiEvidence: dossier.controls.canUseAsAiEvidence && status !== "failed",
      canCreditMvpDiagnosticProgress: canCreditDiagnosticCorpus,
      canPersistTrainingRows: false,
      canPersistBacktestRun: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Public historical evidence can improve diagnostics but cannot write rows, train models, apply learned weights, publish picks, or stake.",
      "Provider-enriched fixtures, event IDs, odds snapshots, injuries, lineups, news, weather, and stored outcomes remain required before promotion.",
      "If market consensus beats the model, the agent must keep market-prior dominance until provider-enriched retests say otherwise."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/public-historical-training-evidence",
      "/api/sports/decision/training/football-data-historical-learning-dossier",
      ...dossier.proofUrls
    ])
  };
}
