import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import type { FootballDataProviderLearningActivationReceipt } from "@/lib/sports/training/footballDataProviderLearningActivationReceipt";
import type { FootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import type { FootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";
import type { FootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";

export type FootballDataModelPromotionDecisionStatus =
  | "shadow-eligible"
  | "provider-retest-ready"
  | "waiting-provider-rows"
  | "demo-preview-only"
  | "blocked-market-prior"
  | "collect-more-data"
  | "blocked";

export type FootballDataModelPromotionDecisionGate = {
  id:
    | "walk-forward-stability"
    | "threshold-sweep"
    | "market-prior"
    | "provider-retest-contract"
    | "stored-provider-rows"
    | "runner-market-gates"
    | "promotion-locks";
  label: string;
  status: "pass" | "watch" | "block";
  evidence: string;
  requiredAction: string;
  proofUrl: string;
};

export type FootballDataModelPromotionDecision = {
  mode: "football-data-model-promotion-decision";
  generatedAt: string;
  status: FootballDataModelPromotionDecisionStatus;
  decisionHash: string;
  summary: string;
  verdict: {
    canUsePublicThresholds: false;
    canQueueProviderRetest: boolean;
    canQueueShadowComparison: boolean;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    reason: string;
  };
  publicEvidence: {
    walkForwardAction: FootballDataWalkForwardValidation["recommendation"]["action"];
    walkForwardFolds: number;
    walkForwardPassFolds: number;
    walkForwardYield: number | null;
    thresholdAction: FootballDataThresholdSweep["recommendation"]["action"];
    bestThreshold: {
      minEdge: number | null;
      minModelProbability: number | null;
      pickCount: number | null;
      yield: number | null;
      calibrationError: number | null;
    };
    marketVerdict: FootballDataMarketLearningRoadmap["benchmark"]["verdict"];
  };
  providerEvidence: {
    contractStatus: FootballDataProviderRetestContract["status"];
    activationStatus: FootballDataProviderLearningActivationReceipt["status"];
    storedFeatureRows: number;
    normalizedRows: number;
    runnerStatus: FootballDataProviderLearningActivationReceipt["runner"]["status"];
    runnerPickCount: number;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
  };
  gates: FootballDataModelPromotionDecisionGate[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: true;
    canQueueProviderRetest: boolean;
    canQueueShadowComparison: boolean;
    canPersistBacktestMemory: false;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function gate(input: FootballDataModelPromotionDecisionGate): FootballDataModelPromotionDecisionGate {
  return {
    ...input,
    evidence: input.evidence.replace(/\s+/g, " ").trim(),
    requiredAction: input.requiredAction.replace(/\s+/g, " ").trim()
  };
}

function statusFor({
  walkForward,
  marketLearningRoadmap,
  providerRetestContract,
  providerLearningActivation
}: {
  walkForward: FootballDataWalkForwardValidation;
  marketLearningRoadmap: FootballDataMarketLearningRoadmap;
  providerRetestContract: FootballDataProviderRetestContract;
  providerLearningActivation: FootballDataProviderLearningActivationReceipt;
}): FootballDataModelPromotionDecisionStatus {
  if (providerLearningActivation.status === "shadow-eligible") return "shadow-eligible";
  if (providerLearningActivation.status === "demo-preview-only") return "demo-preview-only";
  if (providerRetestContract.status === "ready-provider-retest-contract") return "provider-retest-ready";
  if (providerLearningActivation.status === "waiting-feature-storage") return "waiting-provider-rows";
  if (walkForward.recommendation.action === "collect-more-data" || marketLearningRoadmap.status === "collect-more-data") return "collect-more-data";
  if (marketLearningRoadmap.status === "blocked-market-prior" || providerLearningActivation.status === "blocked-market-gates") return "blocked-market-prior";
  return "blocked";
}

function summaryFor(status: FootballDataModelPromotionDecisionStatus): string {
  if (status === "shadow-eligible") return "Model promotion decision is shadow-eligible: stored provider rows passed retest gates, but live probabilities, public picks, and staking remain locked.";
  if (status === "provider-retest-ready") return "Model promotion decision can queue a provider-enriched retest, but cannot apply thresholds or publish picks.";
  if (status === "waiting-provider-rows") return "Model promotion decision is waiting for stored provider-enriched feature rows before retest metrics can run.";
  if (status === "demo-preview-only") return "Model promotion decision is demo-only; the math path works, but real stored provider rows are still required.";
  if (status === "collect-more-data") return "Model promotion decision needs more historical/provider evidence before a segment can challenge the market prior.";
  if (status === "blocked-market-prior") return "Model promotion decision keeps market prior dominant because public or provider evidence does not beat market gates.";
  return "Model promotion decision is blocked by incomplete calibration, market, provider, or promotion evidence.";
}

function reasonFor(status: FootballDataModelPromotionDecisionStatus, gates: FootballDataModelPromotionDecisionGate[]): string {
  const firstBlock = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch");
  if (status === "shadow-eligible") return "Stored provider rows passed the retest, but shadow comparison and promotion governance still need to approve any learned influence.";
  if (status === "provider-retest-ready") return "Public evidence found a possible segment; provider-enriched data must now prove it with fixture, odds, context, feature, and settlement rows.";
  return firstBlock?.requiredAction ?? "Keep learning locked until the promotion evidence chain passes.";
}

function buildGates({
  walkForward,
  thresholdSweep,
  marketLearningRoadmap,
  providerRetestContract,
  providerLearningActivation
}: {
  walkForward: FootballDataWalkForwardValidation;
  thresholdSweep: FootballDataThresholdSweep;
  marketLearningRoadmap: FootballDataMarketLearningRoadmap;
  providerRetestContract: FootballDataProviderRetestContract;
  providerLearningActivation: FootballDataProviderLearningActivationReceipt;
}): FootballDataModelPromotionDecisionGate[] {
  return [
    gate({
      id: "walk-forward-stability",
      label: "Walk-forward stability",
      status:
        walkForward.recommendation.action === "eligible-for-provider-enriched-retest"
          ? "pass"
          : walkForward.recommendation.action === "keep-shadow-locked"
            ? "watch"
            : "block",
      evidence: `${walkForward.validation.passFolds}/${walkForward.validation.folds} fold(s) passed; yield ${walkForward.validation.aggregateYield ?? "n/a"}; stability ${walkForward.validation.stabilityScore}/100.`,
      requiredAction: "Run season-by-season public EPL validation and require stable future-season evidence before provider retest.",
      proofUrl: "/api/sports/decision/training/football-data-walk-forward"
    }),
    gate({
      id: "threshold-sweep",
      label: "Threshold sweep",
      status: thresholdSweep.recommendation.action === "raise-thresholds" ? "pass" : thresholdSweep.recommendation.action === "keep-defaults" ? "watch" : "block",
      evidence: `${thresholdSweep.request.profilesTested} profile(s); recommendation ${thresholdSweep.recommendation.action}; best picks ${thresholdSweep.bestProfile?.pickCount ?? 0}.`,
      requiredAction: "Find a profile with enough picks, positive yield, acceptable calibration, and stable Brier/log-loss before thresholds become candidates.",
      proofUrl: "/api/sports/decision/training/football-data-threshold-sweep"
    }),
    gate({
      id: "market-prior",
      label: "Market prior comparison",
      status: marketLearningRoadmap.benchmark.verdict === "model-beats-market" ? "pass" : marketLearningRoadmap.status === "ready-provider-retest" ? "watch" : "block",
      evidence: `${marketLearningRoadmap.benchmark.verdict}; model Brier ${marketLearningRoadmap.benchmark.modelBrierScore ?? "n/a"} vs market ${marketLearningRoadmap.benchmark.marketBrierScore ?? "n/a"}.`,
      requiredAction: "Provider-enriched retest must beat no-vig market consensus before learned probabilities can challenge the market prior.",
      proofUrl: "/api/sports/decision/training/football-data-market-benchmark"
    }),
    gate({
      id: "provider-retest-contract",
      label: "Provider retest contract",
      status: providerRetestContract.controls.canQueueProviderRetest ? "pass" : providerRetestContract.status === "waiting-provider-data" ? "watch" : "block",
      evidence: `${providerRetestContract.status}; selected segment ${providerRetestContract.segment.selectedId ?? "none"}; min holdout ${providerRetestContract.segment.minHoldoutRows}.`,
      requiredAction: "Attach fixture identity, odds, team strength, availability, news/weather, live settlement, feature snapshots, and backtest memory requirements.",
      proofUrl: "/api/sports/decision/training/football-data-provider-retest-contract"
    }),
    gate({
      id: "stored-provider-rows",
      label: "Stored provider rows",
      status: providerLearningActivation.bridge.normalizedRows >= providerLearningActivation.contract.minHoldoutRows ? "pass" : providerLearningActivation.bridge.normalizedRows > 0 ? "watch" : "block",
      evidence: `${providerLearningActivation.bridge.normalizedRows}/${providerLearningActivation.contract.minHoldoutRows} normalized row(s); ${providerLearningActivation.bridge.rejectedRows} rejected; source ${providerLearningActivation.source}.`,
      requiredAction: "Store provider-enriched op_training_feature_snapshots rows and read them back from OddsPadi Supabase before running promotion metrics.",
      proofUrl: "/api/sports/decision/training/football-data-provider-retest-bridge"
    }),
    gate({
      id: "runner-market-gates",
      label: "Runner market gates",
      status: providerLearningActivation.runner.status === "passed-shadow-retest" ? "pass" : providerLearningActivation.runner.status === "failed-market-gates" ? "block" : "watch",
      evidence: `${providerLearningActivation.runner.status}; runner picks ${providerLearningActivation.runner.pickCount}; gates blocked ${providerLearningActivation.runner.gatesBlocked}.`,
      requiredAction: "Provider-enriched runner must pass sample, Brier, log-loss, CLV, yield, calibration, and market-disagreement gates.",
      proofUrl: "/api/sports/decision/training/football-data-provider-retest-runner"
    }),
    gate({
      id: "promotion-locks",
      label: "Promotion locks",
      status: "pass",
      evidence: "Public thresholds, live probabilities, picks, staking, and learned weights remain locked by this receipt.",
      requiredAction: "Run separate shadow comparison and answer-promotion receipts before any learned influence can be considered.",
      proofUrl: "/api/sports/decision/learning-promotion-gate"
    })
  ];
}

function nextActionFor(status: FootballDataModelPromotionDecisionStatus): FootballDataModelPromotionDecision["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-model-promotion-decision?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";
  return {
    label:
      status === "shadow-eligible"
        ? "Run shadow comparison"
        : status === "provider-retest-ready"
          ? "Store provider-enriched retest rows"
          : status === "waiting-provider-rows"
            ? "Materialize provider feature snapshots"
            : "Keep model promotion locked",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence:
      status === "shadow-eligible"
        ? "Shadow comparison reads stored backtest and calibration proof before learned weights can influence any public probability."
        : "Walk-forward, threshold, market benchmark, provider row, and runner gates explain why promotion remains locked."
  };
}

export function buildFootballDataModelPromotionDecision({
  walkForward,
  thresholdSweep,
  marketLearningRoadmap,
  providerRetestContract,
  providerLearningActivation,
  now = new Date()
}: {
  walkForward: FootballDataWalkForwardValidation;
  thresholdSweep: FootballDataThresholdSweep;
  marketLearningRoadmap: FootballDataMarketLearningRoadmap;
  providerRetestContract: FootballDataProviderRetestContract;
  providerLearningActivation: FootballDataProviderLearningActivationReceipt;
  now?: Date;
}): FootballDataModelPromotionDecision {
  const gates = buildGates({
    walkForward,
    thresholdSweep,
    marketLearningRoadmap,
    providerRetestContract,
    providerLearningActivation
  });
  const status = statusFor({
    walkForward,
    marketLearningRoadmap,
    providerRetestContract,
    providerLearningActivation
  });
  const canQueueProviderRetest = providerRetestContract.controls.canQueueProviderRetest && status !== "demo-preview-only";
  const canQueueShadowComparison = providerLearningActivation.controls.canQueueShadowComparison && status === "shadow-eligible";
  const reason = reasonFor(status, gates);

  return {
    mode: "football-data-model-promotion-decision",
    generatedAt: now.toISOString(),
    status,
    decisionHash: stableHash({
      status,
      walkForward: [walkForward.status, walkForward.recommendation.action, walkForward.validation.passFolds, walkForward.validation.aggregateYield],
      threshold: [thresholdSweep.status, thresholdSweep.recommendation.action, thresholdSweep.bestProfile?.rank ?? null],
      roadmap: [marketLearningRoadmap.status, marketLearningRoadmap.roadmapHash],
      contract: [providerRetestContract.status, providerRetestContract.contractHash],
      activation: [providerLearningActivation.status, providerLearningActivation.activationHash],
      gates: gates.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    verdict: {
      canUsePublicThresholds: false,
      canQueueProviderRetest,
      canQueueShadowComparison,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      reason
    },
    publicEvidence: {
      walkForwardAction: walkForward.recommendation.action,
      walkForwardFolds: walkForward.validation.folds,
      walkForwardPassFolds: walkForward.validation.passFolds,
      walkForwardYield: walkForward.validation.aggregateYield,
      thresholdAction: thresholdSweep.recommendation.action,
      bestThreshold: {
        minEdge: thresholdSweep.bestProfile?.minEdge ?? null,
        minModelProbability: thresholdSweep.bestProfile?.minModelProbability ?? null,
        pickCount: thresholdSweep.bestProfile?.pickCount ?? null,
        yield: thresholdSweep.bestProfile?.yield ?? null,
        calibrationError: thresholdSweep.bestProfile?.calibrationError ?? null
      },
      marketVerdict: marketLearningRoadmap.benchmark.verdict
    },
    providerEvidence: {
      contractStatus: providerRetestContract.status,
      activationStatus: providerLearningActivation.status,
      storedFeatureRows: providerLearningActivation.bridge.storedFeatureRows,
      normalizedRows: providerLearningActivation.bridge.normalizedRows,
      runnerStatus: providerLearningActivation.runner.status,
      runnerPickCount: providerLearningActivation.runner.pickCount,
      modelBrierScore: providerLearningActivation.runner.brierScore,
      marketBrierScore: providerLearningActivation.runner.marketBrierScore,
      modelLogLoss: providerLearningActivation.runner.logLoss,
      marketLogLoss: providerLearningActivation.runner.marketLogLoss
    },
    gates,
    nextAction: nextActionFor(status),
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: true,
      canQueueProviderRetest,
      canQueueShadowComparison,
      canPersistBacktestMemory: false,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Model promotion decision is read-only and cannot persist backtests, apply learned weights, promote live probabilities, publish picks, or stake.",
      "Public Football-Data evidence can propose provider retests only; it cannot train production weights or change public answers.",
      "Stored provider rows must beat no-vig market gates before shadow comparison is allowed.",
      "Shadow eligibility still requires separate promotion governance before any learned influence can be considered."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/football-data-model-promotion-decision",
      ...walkForward.proofUrls,
      ...thresholdSweep.proofUrls,
      ...marketLearningRoadmap.proofUrls,
      ...providerRetestContract.proofUrls,
      ...providerLearningActivation.proofUrls
    ])
  };
}
