import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import type { FootballDataThresholdProfile, FootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";

export type FootballDataMarketSegmentRetestStatus = "ready-provider-retest" | "needs-segment-proof" | "blocked-market-prior";

export type FootballDataMarketSegmentRetestCandidate = {
  id: string;
  rank: number;
  status: "provider-retest-candidate" | "watch" | "reject";
  minEdge: number;
  minModelProbability: number;
  pickCount: number;
  testSize: number;
  yield: number | null;
  brierScore: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  score: number;
  reason: string;
  requiredProviderEvidence: string[];
};

export type FootballDataMarketSegmentRetest = {
  mode: "football-data-market-segment-retest";
  generatedAt: string;
  status: FootballDataMarketSegmentRetestStatus;
  summary: string;
  benchmark: {
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"];
    matchedRows: number;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
  };
  sweep: {
    status: FootballDataThresholdSweep["status"];
    profilesTested: number;
    recommendation: FootballDataThresholdSweep["recommendation"]["action"];
    minPickCount: number;
  };
  candidates: FootballDataMarketSegmentRetestCandidate[];
  selectedCandidate: FootballDataMarketSegmentRetestCandidate | null;
  retestContract: {
    minHoldoutRows: number;
    requiredMetrics: string[];
    promotionRule: string;
    rejectionRule: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderRetest: boolean;
    canPersistSegment: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
};

function round(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function candidateStatus(profile: FootballDataThresholdProfile, benchmark: FootballDataMarketBenchmark): FootballDataMarketSegmentRetestCandidate["status"] {
  if (profile.status !== "candidate") return "reject";
  if ((profile.yield ?? -1) <= 0 || (profile.calibrationError ?? 1) > 0.12) return "watch";
  if (benchmark.comparison.verdict === "model-beats-market") return "provider-retest-candidate";
  if (benchmark.comparison.verdict === "market-beats-model" && profile.pickCount >= 100 && (profile.yield ?? -1) > 0.03) return "provider-retest-candidate";
  return "watch";
}

function candidateReason(profile: FootballDataThresholdProfile, benchmark: FootballDataMarketBenchmark, status: FootballDataMarketSegmentRetestCandidate["status"]): string {
  if (status === "provider-retest-candidate") {
    return `Profile edge >= ${profile.minEdge} and model probability >= ${profile.minModelProbability} has ${profile.pickCount} picks, yield ${profile.yield ?? "n/a"}, and calibration ${profile.calibrationError ?? "n/a"}; retest this segment with provider-enriched data before any promotion.`;
  }
  if (status === "watch") {
    return `Profile has some signal, but overall benchmark is ${benchmark.comparison.verdict}; keep it as a watch segment until provider-enriched retest beats market consensus.`;
  }
  return `Profile is not a usable segment because status is ${profile.status}, pick count is ${profile.pickCount}, yield is ${profile.yield ?? "n/a"}, and calibration is ${profile.calibrationError ?? "n/a"}.`;
}

function candidateFor(profile: FootballDataThresholdProfile, benchmark: FootballDataMarketBenchmark): FootballDataMarketSegmentRetestCandidate {
  const status = candidateStatus(profile, benchmark);
  return {
    id: `edge-${profile.minEdge}-prob-${profile.minModelProbability}`,
    rank: profile.rank,
    status,
    minEdge: profile.minEdge,
    minModelProbability: profile.minModelProbability,
    pickCount: profile.pickCount,
    testSize: profile.testSize,
    yield: round(profile.yield),
    brierScore: round(profile.brierScore),
    logLoss: round(profile.logLoss),
    calibrationError: round(profile.calibrationError),
    score: round(profile.score) ?? 0,
    reason: candidateReason(profile, benchmark, status),
    requiredProviderEvidence: [
      "Provider-backed fixtures with official IDs for the same EPL segment.",
      "No-vig opening and closing odds snapshots from at least two bookmakers.",
      "Lineups, injuries, suspensions, news, weather, rest, and venue context attached before kickoff.",
      "Brier score, log-loss, ROI, closing-line value, and calibration error compared against market consensus."
    ]
  };
}

function statusFor(candidates: FootballDataMarketSegmentRetestCandidate[], benchmark: FootballDataMarketBenchmark, sweep: FootballDataThresholdSweep): FootballDataMarketSegmentRetestStatus {
  if (candidates.some((candidate) => candidate.status === "provider-retest-candidate")) return "ready-provider-retest";
  if (benchmark.comparison.verdict === "market-beats-model" && sweep.recommendation.action !== "raise-thresholds") return "blocked-market-prior";
  return "needs-segment-proof";
}

function summaryFor(status: FootballDataMarketSegmentRetestStatus, selected: FootballDataMarketSegmentRetestCandidate | null, benchmark: FootballDataMarketBenchmark): string {
  if (status === "ready-provider-retest" && selected) {
    return `One threshold segment is credible enough for provider-enriched retest, but overall benchmark remains ${benchmark.comparison.verdict}; no public promotion is allowed.`;
  }
  if (status === "blocked-market-prior") {
    return "No credible threshold segment beat the market-prior concern; keep raw model value blocked and collect richer provider data.";
  }
  return "Threshold evidence is not strong enough yet; run a provider-enriched segment retest before trusting model value.";
}

function nextAction(status: FootballDataMarketSegmentRetestStatus, selected: FootballDataMarketSegmentRetestCandidate | null): FootballDataMarketSegmentRetest["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-market-segment-retest?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75";
  return {
    label: status === "ready-provider-retest" ? "Run provider-enriched segment retest" : "Find a credible model-vs-market segment",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence:
      status === "ready-provider-retest" && selected
        ? `Provider-enriched retest for edge >= ${selected.minEdge} and model probability >= ${selected.minModelProbability} proves Brier/log-loss and CLV beat market consensus.`
        : "Threshold sweep returns a candidate segment with enough picks, positive yield, acceptable calibration, and provider-enriched retest requirements."
  };
}

export function buildFootballDataMarketSegmentRetest({
  benchmark,
  thresholdSweep,
  now = new Date()
}: {
  benchmark: FootballDataMarketBenchmark;
  thresholdSweep: FootballDataThresholdSweep;
  now?: Date;
}): FootballDataMarketSegmentRetest {
  const candidates = thresholdSweep.profiles.map((profile) => candidateFor(profile, benchmark));
  const selectedCandidate = candidates.find((candidate) => candidate.status === "provider-retest-candidate") ?? null;
  const status = statusFor(candidates, benchmark, thresholdSweep);

  return {
    mode: "football-data-market-segment-retest",
    generatedAt: now.toISOString(),
    status,
    summary: summaryFor(status, selectedCandidate, benchmark),
    benchmark: {
      verdict: benchmark.comparison.verdict,
      matchedRows: benchmark.corpus.matchedRows,
      modelBrierScore: benchmark.model.brierScore,
      marketBrierScore: benchmark.market.brierScore,
      modelLogLoss: benchmark.model.logLoss,
      marketLogLoss: benchmark.market.logLoss
    },
    sweep: {
      status: thresholdSweep.status,
      profilesTested: thresholdSweep.request.profilesTested,
      recommendation: thresholdSweep.recommendation.action,
      minPickCount: thresholdSweep.request.minPickCount
    },
    candidates,
    selectedCandidate,
    retestContract: {
      minHoldoutRows: Math.max(150, thresholdSweep.request.minPickCount * 2),
      requiredMetrics: ["Brier score", "log-loss", "ROI", "closing-line value", "calibration error", "market disagreement"],
      promotionRule: "A segment can only influence shadow probabilities after provider-enriched holdout beats no-vig market consensus on Brier and log-loss with positive CLV.",
      rejectionRule: "If provider-enriched segment retest fails either Brier or log-loss against market consensus, keep market prior dominant and block public promotion."
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderRetest: status === "ready-provider-retest",
      canPersistSegment: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: nextAction(status, selectedCandidate),
    locks: [
      "Segment retest output is read-only and cannot apply thresholds to live picks.",
      "Provider-enriched retest must beat no-vig market consensus before model value can be promoted.",
      "Publishing, staking, persistence, and learned threshold activation remain disabled."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-market-segment-retest",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/training/football-data-threshold-sweep",
      "/api/sports/decision/market-calibrated-fusion",
      "/api/sports/decision/answer-promotion-gate"
    ]
  };
}
