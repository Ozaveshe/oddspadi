import type { DecisionEnginePromotionFeedback } from "@/lib/sports/prediction/decisionEnginePromotionFeedback";
import type { DecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMarketPriorBlockerResolverStatus =
  | "market-prior-dominant"
  | "provider-evidence-plan-ready"
  | "waiting-provider-rows"
  | "waiting-benchmark"
  | "not-required"
  | "blocked";

export type DecisionMarketPriorBlockerResolverStepStatus = "ready" | "waiting" | "blocked" | "locked";

export type DecisionMarketPriorBlockerResolverStep = {
  id:
    | "rerun-market-benchmark"
    | "raise-threshold-quality"
    | "stabilize-walk-forward"
    | "store-provider-feature-rows"
    | "run-provider-retest"
    | "prove-closing-line-value"
    | "promotion-governance";
  label: string;
  status: DecisionMarketPriorBlockerResolverStepStatus;
  priority: number;
  evidence: string;
  requiredProof: string;
  verifyUrl: string;
  command: string | null;
  unlocks: string;
};

export type DecisionMarketPriorBlockerResolver = {
  generatedAt: string;
  date: string;
  sport: DecisionEnginePromotionFeedback["sport"];
  mode: "market-prior-blocker-resolver";
  status: DecisionMarketPriorBlockerResolverStatus;
  resolverHash: string;
  summary: string;
  marketPrior: {
    governorHash: string | null;
    governorStatus: DecisionMarketPriorGovernor["status"] | null;
    governorAction: DecisionMarketPriorGovernor["action"] | null;
    benchmarkVerdict: DecisionMarketPriorGovernor["benchmark"]["verdict"] | null;
    matchedRows: number;
    modelBrierScore: number | null;
    marketBrierScore: number | null;
    modelLogLoss: number | null;
    marketLogLoss: number | null;
    modelBrierDelta: number | null;
    modelLogLossDelta: number | null;
  };
  promotion: {
    feedbackHash: string;
    feedbackStatus: DecisionEnginePromotionFeedback["status"];
    promotionStatus: DecisionEnginePromotionFeedback["promotion"]["status"];
    blockingGateCount: number;
    blockingGateIds: string[];
  };
  rankedPlan: DecisionMarketPriorBlockerResolverStep[];
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    expectedEvidence: string;
  };
  reasoning: {
    whyMarketDominates: string;
    weakestModelProof: string;
    counterfactualToChangeMind: string;
    riskIfIgnored: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextReadOnlyProof: boolean;
    canCallOpenAI: false;
    canFetchProviders: false;
    canWriteSupabaseRows: false;
    canPersistBacktestMemory: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 56): string[] {
  return Array.from(new Set(values.map((value) => compact(value)).filter((value) => value !== "No evidence available."))).slice(0, limit);
}

function safeApiUrl(value: string): boolean {
  if (!value.toLowerCase().startsWith("/api/sports/decision/")) return false;
  let url: URL;
  try {
    url = new URL(value, "http://127.0.0.1:3025");
  } catch {
    return false;
  }
  const blockedParams = ["persist", "publish", "train", "stake", "run", "openAiRun"];
  for (const param of blockedParams) {
    const normalized = url.searchParams.get(param)?.toLowerCase();
    if (normalized === "1" || normalized === "true") return false;
  }
  const dryRun = url.searchParams.get("dryRun")?.toLowerCase();
  return dryRun !== "0" && dryRun !== "false";
}

function gateEvidence(feedback: DecisionEnginePromotionFeedback, id: string): string | null {
  return feedback.promotion.blockingGates.find((gate) => gate.id === id)?.evidence ?? null;
}

function statusFor(feedback: DecisionEnginePromotionFeedback, governor: DecisionMarketPriorGovernor | null): DecisionMarketPriorBlockerResolverStatus {
  if (feedback.status === "not-required") return "not-required";
  if (governor?.status === "waiting-benchmark") return "waiting-benchmark";
  if (feedback.status === "waiting-provider-rows") return "waiting-provider-rows";
  if (feedback.status === "ready-provider-retest-review") return "provider-evidence-plan-ready";
  if (feedback.status === "market-prior-dominant") return "market-prior-dominant";
  if (feedback.status === "collect-more-data" || feedback.status === "blocked") return "blocked";
  return "provider-evidence-plan-ready";
}

function step({
  id,
  label,
  status,
  priority,
  evidence,
  requiredProof,
  verifyUrl,
  unlocks
}: Omit<DecisionMarketPriorBlockerResolverStep, "command">): DecisionMarketPriorBlockerResolverStep {
  return {
    id,
    label,
    status,
    priority,
    evidence: compact(evidence),
    requiredProof: compact(requiredProof),
    verifyUrl,
    command: safeApiUrl(verifyUrl) ? decisionCurlCommand(verifyUrl) : null,
    unlocks: compact(unlocks)
  };
}

function buildPlan({
  feedback,
  governor
}: {
  feedback: DecisionEnginePromotionFeedback;
  governor: DecisionMarketPriorGovernor | null;
}): DecisionMarketPriorBlockerResolverStep[] {
  const benchmarkVerdict = governor?.benchmark.verdict ?? null;
  const isMarketDominant = feedback.status === "market-prior-dominant" || benchmarkVerdict === "market-beats-model";
  const hasProviderRows = !feedback.promotion.blockingGates.some((gate) => gate.id === "stored-provider-rows" && gate.status === "block");
  const hasContract = !feedback.promotion.blockingGates.some((gate) => gate.id === "provider-retest-contract" && gate.status === "block");
  const steps = [
    step({
      id: "rerun-market-benchmark",
      label: "Re-run model-vs-market benchmark",
      status: governor?.benchmark.available ? "ready" : "waiting",
      priority: isMarketDominant ? 100 : 60,
      evidence:
        benchmarkVerdict === "market-beats-model"
          ? `No-vig market beats model: Brier ${governor?.benchmark.modelBrierScore ?? "n/a"} model vs ${governor?.benchmark.marketBrierScore ?? "n/a"} market; log-loss ${governor?.benchmark.modelLogLoss ?? "n/a"} model vs ${governor?.benchmark.marketLogLoss ?? "n/a"} market.`
          : governor?.summary ?? "Market benchmark must exist before model evidence can challenge the market prior.",
      requiredProof: "Same-fixture holdout benchmark where the model beats no-vig market consensus on Brier and log-loss, or a clearly isolated segment justifies provider retest.",
      verifyUrl: "/api/sports/decision/market-prior-governor?benchmark=1",
      unlocks: "Allows only shadow provider-retest review; it still cannot publish picks or alter probabilities."
    }),
    step({
      id: "raise-threshold-quality",
      label: "Improve threshold sweep quality",
      status: feedback.promotion.blockingGates.some((gate) => gate.id === "threshold-sweep" && gate.status === "block") ? "ready" : "waiting",
      priority: gateEvidence(feedback, "threshold-sweep") ? 95 : 50,
      evidence: gateEvidence(feedback, "threshold-sweep") ?? "Threshold sweep did not identify a robust enough value segment.",
      requiredProof: "A threshold profile with enough picks, positive yield, acceptable calibration error, and stable Brier/log-loss.",
      verifyUrl: "/api/sports/decision/training/football-data-threshold-sweep?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75",
      unlocks: "Can nominate a segment for provider-enriched retest, not learned weights."
    }),
    step({
      id: "stabilize-walk-forward",
      label: "Stabilize season-by-season walk-forward proof",
      status: feedback.promotion.blockingGates.some((gate) => gate.id === "walk-forward-stability") ? "ready" : "waiting",
      priority: gateEvidence(feedback, "walk-forward-stability") ? 90 : 45,
      evidence: gateEvidence(feedback, "walk-forward-stability") ?? "Walk-forward proof must show the model survives future-season splits.",
      requiredProof: "Multiple future-season folds pass with positive aggregate yield and acceptable stability.",
      verifyUrl: "/api/sports/decision/training/football-data-walk-forward?seasonFrom=2016&seasonTo=2025&maxSeasons=10",
      unlocks: "Raises confidence in the retest candidate while keeping live action locked."
    }),
    step({
      id: "store-provider-feature-rows",
      label: "Store provider-enriched feature rows",
      status: hasContract ? (hasProviderRows ? "waiting" : "ready") : "blocked",
      priority: hasProviderRows ? 40 : 85,
      evidence: gateEvidence(feedback, "stored-provider-rows") ?? "Provider feature rows must be read from OddsPadi Supabase before retest metrics count.",
      requiredProof: "Stored fixture identity, team strength, odds, availability, news/weather context, feature snapshot, and settlement rows for the selected segment.",
      verifyUrl: "/api/sports/decision/training/football-provider-feature-storage-receipt?dryRun=1",
      unlocks: "Feeds provider retest proof only; no production model weights are trained."
    }),
    step({
      id: "run-provider-retest",
      label: "Run provider-enriched retest",
      status: hasProviderRows ? "ready" : "waiting",
      priority: 80,
      evidence: gateEvidence(feedback, "runner-market-gates") ?? "Provider runner must pass market gates before learned influence can be discussed.",
      requiredProof: "Provider-enriched runner passes sample, Brier, log-loss, CLV, yield, calibration, and market-disagreement gates.",
      verifyUrl: "/api/sports/decision/training/football-data-provider-retest-runner",
      unlocks: "Can open shadow comparison only if it beats market gates."
    }),
    step({
      id: "prove-closing-line-value",
      label: "Attach closing-line value proof",
      status: "waiting",
      priority: 72,
      evidence: "Market-prior dominance cannot be overturned by backtest yield alone; closing-line value must show the model beats available prices before kickoff.",
      requiredProof: "Opening and closing odds snapshots prove the selected segment beats or avoids adverse closing movement after removing bookmaker margin.",
      verifyUrl: "/api/sports/decision/odds-intelligence-proof",
      unlocks: "Strengthens market-disagreement proof while staying shadow-only."
    }),
    step({
      id: "promotion-governance",
      label: "Run promotion governance",
      status: feedback.status === "ready-shadow-review" ? "ready" : "locked",
      priority: feedback.status === "ready-shadow-review" ? 70 : 20,
      evidence: feedback.summary,
      requiredProof: "Separate learning-promotion and answer-promotion gates agree that learned influence is safe after shadow comparison.",
      verifyUrl: "/api/sports/decision/learning-promotion-gate",
      unlocks: "Only governance can consider learned influence; this resolver cannot unlock it."
    })
  ];

  return steps.sort((a, b) => b.priority - a.priority);
}

function nextActionFor(steps: DecisionMarketPriorBlockerResolverStep[]): DecisionMarketPriorBlockerResolver["nextAction"] {
  const selected = steps.find((item) => item.status === "ready") ?? steps.find((item) => item.status === "waiting") ?? steps[0];
  return {
    label: selected?.label ?? "Hold market-prior resolver",
    command: selected?.command ?? null,
    verifyUrl: selected?.verifyUrl ?? "/api/sports/decision/market-prior-blocker-resolver?dryRun=1",
    expectedEvidence: selected?.requiredProof ?? "Read-only evidence explains why market prior remains dominant."
  };
}

export function buildDecisionMarketPriorBlockerResolver({
  promotionFeedback,
  marketPriorGovernor = null,
  now = new Date()
}: {
  promotionFeedback: DecisionEnginePromotionFeedback;
  marketPriorGovernor?: DecisionMarketPriorGovernor | null;
  now?: Date;
}): DecisionMarketPriorBlockerResolver {
  const status = statusFor(promotionFeedback, marketPriorGovernor);
  const rankedPlan = buildPlan({ feedback: promotionFeedback, governor: marketPriorGovernor });
  const nextAction = nextActionFor(rankedPlan);
  const marketPrior = {
    governorHash: marketPriorGovernor?.governorHash ?? null,
    governorStatus: marketPriorGovernor?.status ?? null,
    governorAction: marketPriorGovernor?.action ?? null,
    benchmarkVerdict: marketPriorGovernor?.benchmark.verdict ?? null,
    matchedRows: marketPriorGovernor?.benchmark.matchedRows ?? 0,
    modelBrierScore: marketPriorGovernor?.benchmark.modelBrierScore ?? null,
    marketBrierScore: marketPriorGovernor?.benchmark.marketBrierScore ?? null,
    modelLogLoss: marketPriorGovernor?.benchmark.modelLogLoss ?? null,
    marketLogLoss: marketPriorGovernor?.benchmark.marketLogLoss ?? null,
    modelBrierDelta: marketPriorGovernor?.benchmark.modelBrierDelta ?? null,
    modelLogLossDelta: marketPriorGovernor?.benchmark.modelLogLossDelta ?? null
  };
  const blockingGateIds = promotionFeedback.promotion.blockingGates.map((gate) => gate.id);
  const resolverHash = stableHash({
    status,
    feedback: [promotionFeedback.feedbackHash, promotionFeedback.status, promotionFeedback.promotion.status, blockingGateIds],
    marketPrior,
    plan: rankedPlan.map((item) => [item.id, item.status, item.priority])
  });

  return {
    generatedAt: now.toISOString(),
    date: promotionFeedback.date,
    sport: promotionFeedback.sport,
    mode: "market-prior-blocker-resolver",
    status,
    resolverHash,
    summary:
      status === "market-prior-dominant"
        ? "Market-prior blocker resolver ranked the evidence needed before the model can challenge no-vig market consensus."
        : status === "provider-evidence-plan-ready"
          ? "Market-prior blocker resolver has a provider-evidence plan ready for shadow review."
          : status === "waiting-provider-rows"
            ? "Market-prior blocker resolver is waiting for stored provider rows before retest evidence can count."
            : status === "waiting-benchmark"
              ? "Market-prior blocker resolver is waiting for a successful model-vs-market benchmark."
              : status === "not-required"
                ? "Market-prior blocker resolver is not required for the current controller action."
                : "Market-prior blocker resolver is blocked by incomplete or contradictory promotion evidence.",
    marketPrior,
    promotion: {
      feedbackHash: promotionFeedback.feedbackHash,
      feedbackStatus: promotionFeedback.status,
      promotionStatus: promotionFeedback.promotion.status,
      blockingGateCount: blockingGateIds.length,
      blockingGateIds
    },
    rankedPlan,
    nextAction,
    reasoning: {
      whyMarketDominates:
        marketPrior.benchmarkVerdict === "market-beats-model"
          ? `Market consensus beats the model on the attached benchmark; model Brier delta ${marketPrior.modelBrierDelta ?? "n/a"} and log-loss delta ${marketPrior.modelLogLossDelta ?? "n/a"} keep the market prior dominant.`
          : compact(marketPriorGovernor?.summary ?? promotionFeedback.promotion.reason),
      weakestModelProof: compact(
        promotionFeedback.promotion.blockingGates.find((gate) => gate.status === "block")?.requiredAction ??
          "The model must beat no-vig market consensus on stable holdout and provider-enriched evidence."
      ),
      counterfactualToChangeMind:
        "The resolver would change posture only if walk-forward, threshold sweep, provider retest, closing-line value, and promotion governance show the model beats market consensus without overfitting.",
      riskIfIgnored: "Ignoring the market-prior block would let raw model enthusiasm overrule a stronger bookmaker-consensus baseline, increasing false positive value picks."
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextReadOnlyProof: safeApiUrl(nextAction.verifyUrl),
      canCallOpenAI: false,
      canFetchProviders: false,
      canWriteSupabaseRows: false,
      canPersistBacktestMemory: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/market-prior-blocker-resolver",
      "/api/sports/decision/engine-promotion-feedback",
      "/api/sports/decision/market-prior-governor?benchmark=1",
      nextAction.verifyUrl,
      ...promotionFeedback.proofUrls,
      ...(marketPriorGovernor?.proofUrls ?? [])
    ]),
    locks: unique([
      "Market-prior blocker resolver is read-only and cannot call OpenAI, fetch providers, write Supabase rows, persist backtests, persist training rows, train models, apply learned weights, adjust probabilities, publish picks, stake, or use hidden chain-of-thought.",
      "Resolver steps describe proof needed to change model trust; they do not execute provider writes or training.",
      "No public pick can be upgraded while no-vig market consensus beats the model benchmark.",
      ...promotionFeedback.locks,
      ...(marketPriorGovernor?.locks ?? [])
    ])
  };
}
