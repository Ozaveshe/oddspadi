import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import type { FootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import type { FootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";

export type FootballDataMarketLearningRoadmapStatus = "ready-provider-retest" | "blocked-market-prior" | "collect-more-data";
export type FootballDataMarketLearningRoadmapPhaseStatus = "done" | "current" | "blocked" | "locked";

export type FootballDataMarketLearningRoadmapPhase = {
  id:
    | "market-prior-diagnosis"
    | "threshold-segment-search"
    | "provider-enriched-retest"
    | "storage-and-memory"
    | "promotion-governance";
  label: string;
  status: FootballDataMarketLearningRoadmapPhaseStatus;
  evidence: string;
  requiredProof: string;
  proofUrl: string;
};

export type FootballDataMarketLearningRoadmap = {
  mode: "football-data-market-learning-roadmap";
  generatedAt: string;
  status: FootballDataMarketLearningRoadmapStatus;
  roadmapHash: string;
  summary: string;
  currentBlocker: string;
  benchmark: {
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"];
    matchedRows: number;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
  };
  segment: {
    status: FootballDataMarketSegmentRetest["status"];
    selectedId: string | null;
    minEdge: number | null;
    minModelProbability: number | null;
    pickCount: number | null;
  };
  phases: FootballDataMarketLearningRoadmapPhase[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: true;
    canRunProviderRetest: boolean;
    canPersistMemory: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function phase(input: FootballDataMarketLearningRoadmapPhase): FootballDataMarketLearningRoadmapPhase {
  return {
    ...input,
    evidence: input.evidence.replace(/\s+/g, " ").trim(),
    requiredProof: input.requiredProof.replace(/\s+/g, " ").trim()
  };
}

function statusFor(segmentRetest: FootballDataMarketSegmentRetest, thresholdSweep: FootballDataThresholdSweep): FootballDataMarketLearningRoadmapStatus {
  if (segmentRetest.status === "ready-provider-retest") return "ready-provider-retest";
  if (segmentRetest.status === "blocked-market-prior") return "blocked-market-prior";
  if (thresholdSweep.recommendation.action === "collect-more-data") return "collect-more-data";
  return "blocked-market-prior";
}

function nextPhase(phases: FootballDataMarketLearningRoadmapPhase[]): FootballDataMarketLearningRoadmapPhase {
  return phases.find((item) => item.status === "blocked") ?? phases.find((item) => item.status === "current") ?? phases.find((item) => item.status === "locked") ?? phases[0];
}

function nextActionFor(status: FootballDataMarketLearningRoadmapStatus, next: FootballDataMarketLearningRoadmapPhase): FootballDataMarketLearningRoadmap["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-market-learning-roadmap?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";
  return {
    label:
      status === "ready-provider-retest"
        ? "Prepare provider-enriched segment retest"
        : status === "collect-more-data"
          ? "Collect more public and provider evidence"
          : "Keep market prior dominant",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: next.requiredProof
  };
}

function summaryFor(status: FootballDataMarketLearningRoadmapStatus): string {
  if (status === "ready-provider-retest") return "A model segment is credible enough for provider-enriched retest, but cannot influence live picks yet.";
  if (status === "collect-more-data") return "The agent needs more evidence before it can identify a credible model-vs-market segment.";
  return "Market prior remains dominant because benchmark and segment evidence do not justify trusting raw model value.";
}

export function buildFootballDataMarketLearningRoadmap({
  benchmark,
  thresholdSweep,
  segmentRetest,
  now = new Date()
}: {
  benchmark: FootballDataMarketBenchmark;
  thresholdSweep: FootballDataThresholdSweep;
  segmentRetest: FootballDataMarketSegmentRetest;
  now?: Date;
}): FootballDataMarketLearningRoadmap {
  const selected = segmentRetest.selectedCandidate;
  const phases = [
    phase({
      id: "market-prior-diagnosis",
      label: "Market-prior diagnosis",
      status: benchmark.controls.canUseAsBenchmark ? "done" : "current",
      evidence: `${benchmark.corpus.matchedRows} matched holdout row(s); benchmark verdict ${benchmark.comparison.verdict}.`,
      requiredProof: "Run model-vs-no-vig-market benchmark on enough EPL holdout rows and compare Brier/log-loss.",
      proofUrl: "/api/sports/decision/training/football-data-market-benchmark"
    }),
    phase({
      id: "threshold-segment-search",
      label: "Threshold segment search",
      status:
        thresholdSweep.recommendation.action === "raise-thresholds"
          ? "done"
          : thresholdSweep.status === "completed"
            ? "blocked"
            : "current",
      evidence: `${thresholdSweep.request.profilesTested} threshold profile(s); recommendation ${thresholdSweep.recommendation.action}.`,
      requiredProof: "Find a threshold profile with enough picks, positive yield, acceptable calibration, and stable Brier/log-loss.",
      proofUrl: "/api/sports/decision/training/football-data-threshold-sweep"
    }),
    phase({
      id: "provider-enriched-retest",
      label: "Provider-enriched retest",
      status: segmentRetest.status === "ready-provider-retest" ? "current" : "blocked",
      evidence: selected
        ? `${selected.id} selected with ${selected.pickCount} pick(s), edge ${selected.minEdge}, probability ${selected.minModelProbability}.`
        : "No threshold segment is credible enough for provider-enriched retest.",
      requiredProof: segmentRetest.nextAction.expectedEvidence,
      proofUrl: "/api/sports/decision/training/football-data-market-segment-retest"
    }),
    phase({
      id: "storage-and-memory",
      label: "Storage and benchmark memory",
      status: "locked",
      evidence: "Persisted op_backtest_runs memory is required before benchmark learning can survive app restarts.",
      requiredProof: "Store benchmark and segment-retest receipts in OddsPadi Supabase with valid service-role credentials and read them back.",
      proofUrl: "/api/sports/decision/training/football-data-market-benchmark-memory"
    }),
    phase({
      id: "promotion-governance",
      label: "Promotion governance",
      status: "locked",
      evidence: "Answer promotion gate remains locked while market calibration is blocked or only in retest mode.",
      requiredProof: "Promotion gate must pass provider evidence, model reasoning, market value, market calibration, backtests, AI review, risk council, and public lock checks together.",
      proofUrl: "/api/sports/decision/answer-promotion-gate"
    })
  ];
  const status = statusFor(segmentRetest, thresholdSweep);
  const next = nextPhase(phases);

  return {
    mode: "football-data-market-learning-roadmap",
    generatedAt: now.toISOString(),
    status,
    roadmapHash: stableHash({
      status,
      benchmark: [benchmark.comparison.verdict, benchmark.corpus.matchedRows, benchmark.model.brierScore, benchmark.market.brierScore],
      sweep: [thresholdSweep.status, thresholdSweep.recommendation.action, thresholdSweep.request.profilesTested],
      segment: [segmentRetest.status, selected?.id ?? null],
      phases: phases.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    currentBlocker: next.requiredProof,
    benchmark: {
      verdict: benchmark.comparison.verdict,
      matchedRows: benchmark.corpus.matchedRows,
      modelBrierScore: benchmark.model.brierScore,
      marketBrierScore: benchmark.market.brierScore,
      modelLogLoss: benchmark.model.logLoss,
      marketLogLoss: benchmark.market.logLoss
    },
    segment: {
      status: segmentRetest.status,
      selectedId: selected?.id ?? null,
      minEdge: selected?.minEdge ?? null,
      minModelProbability: selected?.minModelProbability ?? null,
      pickCount: selected?.pickCount ?? null
    },
    phases,
    nextAction: nextActionFor(status, next),
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: true,
      canRunProviderRetest: status === "ready-provider-retest",
      canPersistMemory: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Market-learning roadmap is read-only and cannot apply thresholds, persist memory, publish picks, or stake.",
      "Provider-enriched retest must beat no-vig market consensus before model value can influence shadow probabilities.",
      "Stored benchmark memory requires valid OddsPadi Supabase credentials and explicit write receipts.",
      "Promotion governance remains locked until every answer-promotion gate passes together."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/football-data-market-learning-roadmap",
      ...benchmark.proofUrls,
      ...thresholdSweep.proofUrls,
      ...segmentRetest.proofUrls
    ])
  };
}
