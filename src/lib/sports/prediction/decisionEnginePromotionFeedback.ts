import type { DecisionEngineNextActionController } from "@/lib/sports/prediction/decisionEngineNextActionController";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataModelPromotionDecision, FootballDataModelPromotionDecisionGate } from "@/lib/sports/training/footballDataModelPromotionDecision";

export type DecisionEnginePromotionFeedbackStatus =
  | "ready-shadow-review"
  | "ready-provider-retest-review"
  | "waiting-provider-rows"
  | "market-prior-dominant"
  | "collect-more-data"
  | "blocked"
  | "not-required";

export type DecisionEnginePromotionFeedback = {
  generatedAt: string;
  date: string;
  sport: DecisionEngineNextActionController["sport"];
  mode: "decision-engine-promotion-feedback";
  status: DecisionEnginePromotionFeedbackStatus;
  feedbackHash: string;
  summary: string;
  controller: {
    controllerHash: string;
    status: DecisionEngineNextActionController["status"];
    selectedActionId: DecisionEngineNextActionController["selectedAction"]["id"];
    selectedActionLabel: string;
    selectedActionSafeToRun: boolean;
    scorecardTotal: number;
    corpusStatus: DecisionEngineNextActionController["input"]["corpusStatus"];
  };
  promotion: {
    decisionHash: string;
    status: FootballDataModelPromotionDecision["status"];
    reason: string;
    canQueueProviderRetest: boolean;
    canQueueShadowComparison: boolean;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    canPublishPicks: false;
    canStake: false;
    blockingGates: Array<{
      id: string;
      label: string;
      status: "watch" | "block";
      evidence: string;
      requiredAction: string;
      proofUrl: string;
    }>;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedReadOnlyAction: boolean;
    canCallOpenAI: false;
    canFetchProviders: false;
    canWriteSupabaseRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
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

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 48): string[] {
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

function statusFor(
  controller: DecisionEngineNextActionController,
  promotion: FootballDataModelPromotionDecision
): DecisionEnginePromotionFeedbackStatus {
  if (controller.selectedAction.id !== "review-shadow-backtest") return "not-required";
  if (promotion.status === "shadow-eligible") return "ready-shadow-review";
  if (promotion.status === "provider-retest-ready") return "ready-provider-retest-review";
  if (promotion.status === "waiting-provider-rows" || promotion.status === "demo-preview-only") return "waiting-provider-rows";
  if (promotion.status === "blocked-market-prior") return "market-prior-dominant";
  if (promotion.status === "collect-more-data") return "collect-more-data";
  return "blocked";
}

function summaryFor(status: DecisionEnginePromotionFeedbackStatus, promotion: FootballDataModelPromotionDecision): string {
  if (status === "not-required") return "Promotion feedback was built, but the controller did not select promotion-gate review as the next action.";
  if (status === "ready-shadow-review") return "Promotion feedback found stored provider rows are shadow-eligible, but learned weights, public probabilities, picks, and staking remain locked.";
  if (status === "ready-provider-retest-review") return "Promotion feedback found a provider-retest candidate; it can be reviewed, but it cannot change live probabilities or public picks.";
  if (status === "waiting-provider-rows") return "Promotion feedback is waiting for real stored provider feature rows before retest evidence can challenge the market prior.";
  if (status === "market-prior-dominant") return "Promotion feedback keeps the market prior dominant because model evidence has not beaten market gates.";
  if (status === "collect-more-data") return "Promotion feedback needs more historical/provider evidence before any promotion path can continue.";
  return compact(promotion.verdict.reason);
}

function nextActionFor(
  status: DecisionEnginePromotionFeedbackStatus,
  controller: DecisionEngineNextActionController,
  promotion: FootballDataModelPromotionDecision
): DecisionEnginePromotionFeedback["nextAction"] {
  const resolverUrl = `/api/sports/decision/market-prior-blocker-resolver?date=${controller.date}&sport=${controller.sport}&limit=8&dryRun=1`;
  if (status === "market-prior-dominant") {
    const safeToRun = controller.selectedAction.safeToRun && safeApiUrl(resolverUrl);
    return {
      label: "Resolve market-prior blockers",
      command: safeToRun ? decisionCurlCommand(resolverUrl) : null,
      verifyUrl: resolverUrl,
      safeToRun,
      expectedEvidence: "Ranked read-only evidence plan explains which benchmark, threshold, walk-forward, provider-row, runner, CLV, and promotion gates must pass before the model can challenge the market prior."
    };
  }
  const safeToRun = controller.selectedAction.safeToRun && safeApiUrl(promotion.nextAction.verifyUrl);
  return {
    label: promotion.nextAction.label,
    command: safeToRun ? decisionCurlCommand(promotion.nextAction.verifyUrl) : null,
    verifyUrl: promotion.nextAction.verifyUrl,
    safeToRun,
    expectedEvidence: compact(promotion.nextAction.expectedEvidence)
  };
}

function isBlockingGate(
  gate: FootballDataModelPromotionDecisionGate
): gate is FootballDataModelPromotionDecisionGate & { status: "watch" | "block" } {
  return gate.status === "watch" || gate.status === "block";
}

export function buildDecisionEnginePromotionFeedback({
  controller,
  promotion,
  now = new Date()
}: {
  controller: DecisionEngineNextActionController;
  promotion: FootballDataModelPromotionDecision;
  now?: Date;
}): DecisionEnginePromotionFeedback {
  const status = statusFor(controller, promotion);
  const blockingGates = promotion.gates
    .filter(isBlockingGate)
    .map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      evidence: compact(item.evidence, 220),
      requiredAction: compact(item.requiredAction, 260),
      proofUrl: item.proofUrl
    }));
  const nextAction = nextActionFor(status, controller, promotion);
  const feedbackHash = stableHash({
    controller: [controller.controllerHash, controller.selectedAction.id, controller.input.scorecardTotal, controller.input.corpusStatus],
    promotion: [promotion.decisionHash, promotion.status, promotion.gates.map((item) => [item.id, item.status])],
    status,
    safeToRun: nextAction.safeToRun
  });

  return {
    generatedAt: now.toISOString(),
    date: controller.date,
    sport: controller.sport,
    mode: "decision-engine-promotion-feedback",
    status,
    feedbackHash,
    summary: summaryFor(status, promotion),
    controller: {
      controllerHash: controller.controllerHash,
      status: controller.status,
      selectedActionId: controller.selectedAction.id,
      selectedActionLabel: controller.selectedAction.label,
      selectedActionSafeToRun: controller.selectedAction.safeToRun,
      scorecardTotal: controller.input.scorecardTotal,
      corpusStatus: controller.input.corpusStatus
    },
    promotion: {
      decisionHash: promotion.decisionHash,
      status: promotion.status,
      reason: compact(promotion.verdict.reason),
      canQueueProviderRetest: promotion.verdict.canQueueProviderRetest,
      canQueueShadowComparison: promotion.verdict.canQueueShadowComparison,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false,
      blockingGates
    },
    nextAction,
    controls: {
      canInspectReadOnly: true,
      canRunSelectedReadOnlyAction: nextAction.safeToRun,
      canCallOpenAI: false,
      canFetchProviders: false,
      canWriteSupabaseRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/engine-promotion-feedback",
      "/api/sports/decision/engine-next-action-controller",
      "/api/sports/decision/market-prior-blocker-resolver",
      "/api/sports/decision/training/football-data-model-promotion-decision?dryRun=1",
      controller.selectedAction.verifyUrl,
      promotion.nextAction.verifyUrl,
      nextAction.verifyUrl,
      ...controller.proofUrls,
      ...promotion.proofUrls
    ]),
    locks: unique([
      "Engine promotion feedback is read-only and cannot call OpenAI, fetch providers, write Supabase rows, persist decisions, persist training rows, train models, apply learned weights, promote live probabilities, publish picks, stake, or use hidden chain-of-thought.",
      "Promotion feedback explains the selected proof result; it does not execute the proof or unlock model influence.",
      ...controller.locks,
      ...promotion.locks
    ])
  };
}
