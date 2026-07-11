import type { DecisionEngineNextActionController } from "@/lib/sports/prediction/decisionEngineNextActionController";
import type { DecisionEnginePromotionFeedback } from "@/lib/sports/prediction/decisionEnginePromotionFeedback";
import type { DecisionMarketPriorBlockerResolver } from "@/lib/sports/prediction/decisionMarketPriorBlockerResolver";
import type { DecisionMarketPriorLoopReceipt } from "@/lib/sports/prediction/decisionMarketPriorLoopReceipt";
import type { DecisionMarketPriorResolutionTurn } from "@/lib/sports/prediction/decisionMarketPriorResolutionTurn";

export type DecisionMarketPriorAutopilotStatus = "ready-readonly" | "observed-capped" | "shadow-review" | "repair-required" | "holding";
export type DecisionMarketPriorAutopilotStageId = "sense" | "review" | "resolve" | "observe" | "learn";

export type DecisionMarketPriorAutopilotStage = {
  id: DecisionMarketPriorAutopilotStageId;
  label: string;
  status: "pass" | "watch" | "block";
  evidence: string[];
  conclusion: string;
  nextAction: string;
};

export type DecisionMarketPriorAutopilot = {
  mode: "market-prior-autopilot";
  generatedAt: string;
  date: string;
  sport: DecisionEngineNextActionController["sport"];
  status: DecisionMarketPriorAutopilotStatus;
  autopilotHash: string;
  summary: string;
  input: {
    controllerHash: string;
    promotionFeedbackHash: string;
    resolverHash: string;
    turnHash: string;
    loopHash: string;
    selectedControllerAction: DecisionEngineNextActionController["selectedAction"]["id"];
    promotionStatus: DecisionEnginePromotionFeedback["promotion"]["status"];
    resolverStatus: DecisionMarketPriorBlockerResolver["status"];
    turnStatus: DecisionMarketPriorResolutionTurn["status"];
    loopStatus: DecisionMarketPriorLoopReceipt["status"];
  };
  belief: {
    update: DecisionMarketPriorLoopReceipt["loop"]["beliefUpdate"];
    benchmarkVerdict: DecisionMarketPriorBlockerResolver["marketPrior"]["benchmarkVerdict"];
    confidenceEffect: DecisionMarketPriorLoopReceipt["loop"]["confidenceEffect"];
    publicActionEffect: DecisionMarketPriorLoopReceipt["loop"]["publicActionEffect"];
    currentBelief: string;
    currentDoubt: string;
    changeMindCondition: string;
  };
  selectedAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    canAutoRunReadOnly: boolean;
    reason: string;
    expectedEvidence: string;
  };
  stages: DecisionMarketPriorAutopilotStage[];
  memoryDraft: {
    canPersist: false;
    label: "market_prior_autopilot";
    evidenceHash: string;
    content: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedReadOnlyAction: boolean;
    canAutoRunOneReadOnlyProof: boolean;
    canCallOpenAI: false;
    canFetchProviders: false;
    canExecuteShell: false;
    canWriteSupabaseRows: false;
    canPersistMemory: false;
    canPersistDecisions: false;
    canPersistBacktestMemory: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
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

function compact(value: string | null | undefined, maxLength = 320): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
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

function statusFor(loopReceipt: DecisionMarketPriorLoopReceipt): DecisionMarketPriorAutopilotStatus {
  if (loopReceipt.status === "ready-next-proof") return "ready-readonly";
  if (loopReceipt.status === "observed-market-prior") return "observed-capped";
  if (loopReceipt.status === "observed-provider-plan") return "shadow-review";
  if (loopReceipt.status === "proof-failed" || loopReceipt.status === "blocked") return "repair-required";
  return "holding";
}

function stage(input: DecisionMarketPriorAutopilotStage): DecisionMarketPriorAutopilotStage {
  return {
    ...input,
    evidence: unique(input.evidence, 8),
    conclusion: compact(input.conclusion),
    nextAction: compact(input.nextAction)
  };
}

function stagesFor({
  controller,
  promotionFeedback,
  resolver,
  turn,
  loopReceipt
}: {
  controller: DecisionEngineNextActionController;
  promotionFeedback: DecisionEnginePromotionFeedback;
  resolver: DecisionMarketPriorBlockerResolver;
  turn: DecisionMarketPriorResolutionTurn;
  loopReceipt: DecisionMarketPriorLoopReceipt;
}): DecisionMarketPriorAutopilotStage[] {
  return [
    stage({
      id: "sense",
      label: "Sense controller state",
      status: controller.selectedAction.safeToRun ? "pass" : "block",
      evidence: [controller.controllerHash, controller.status, controller.selectedAction.id, `score:${controller.input.scorecardTotal}`],
      conclusion: controller.summary,
      nextAction: controller.selectedAction.expectedEvidence
    }),
    stage({
      id: "review",
      label: "Review promotion gate",
      status: promotionFeedback.status === "market-prior-dominant" ? "pass" : promotionFeedback.status === "blocked" ? "block" : "watch",
      evidence: [promotionFeedback.feedbackHash, promotionFeedback.status, promotionFeedback.promotion.status, `gates:${promotionFeedback.promotion.blockingGates.length}`],
      conclusion: promotionFeedback.summary,
      nextAction: promotionFeedback.nextAction.expectedEvidence
    }),
    stage({
      id: "resolve",
      label: "Resolve market-prior blockers",
      status: resolver.status === "market-prior-dominant" || resolver.status === "provider-evidence-plan-ready" ? "pass" : resolver.status === "blocked" ? "block" : "watch",
      evidence: [resolver.resolverHash, resolver.status, resolver.marketPrior.benchmarkVerdict ?? "no-benchmark", `steps:${resolver.rankedPlan.length}`],
      conclusion: resolver.summary,
      nextAction: resolver.nextAction.expectedEvidence
    }),
    stage({
      id: "observe",
      label: "Observe proof turn",
      status: turn.status === "observed" ? "pass" : turn.status === "proof-failed" || turn.status === "blocked" ? "block" : "watch",
      evidence: [turn.turnHash, turn.status, turn.selectedProof.stepId, turn.observation.proofHash ?? "no-proof"],
      conclusion: turn.summary,
      nextAction: turn.nextAction.expectedEvidence
    }),
    stage({
      id: "learn",
      label: "Integrate loop receipt",
      status: loopReceipt.status === "proof-failed" || loopReceipt.status === "blocked" ? "block" : loopReceipt.status === "ready-next-proof" ? "watch" : "pass",
      evidence: [loopReceipt.loopHash, loopReceipt.status, loopReceipt.loop.beliefUpdate, loopReceipt.loop.confidenceEffect],
      conclusion: loopReceipt.summary,
      nextAction: loopReceipt.nextAction.expectedEvidence
    })
  ];
}

export function buildDecisionMarketPriorAutopilot({
  controller,
  promotionFeedback,
  resolver,
  turn,
  loopReceipt,
  now = new Date()
}: {
  controller: DecisionEngineNextActionController;
  promotionFeedback: DecisionEnginePromotionFeedback;
  resolver: DecisionMarketPriorBlockerResolver;
  turn: DecisionMarketPriorResolutionTurn;
  loopReceipt: DecisionMarketPriorLoopReceipt;
  now?: Date;
}): DecisionMarketPriorAutopilot {
  const status = statusFor(loopReceipt);
  const stages = stagesFor({ controller, promotionFeedback, resolver, turn, loopReceipt });
  const selectedAction = {
    label: loopReceipt.nextAction.label,
    command: loopReceipt.nextAction.safeToRun ? loopReceipt.nextAction.command : null,
    verifyUrl: loopReceipt.nextAction.verifyUrl,
    safeToRun: loopReceipt.nextAction.safeToRun,
    canAutoRunReadOnly: loopReceipt.status === "ready-next-proof" && loopReceipt.controls.canRunNextProof,
    reason: compact(loopReceipt.reasoning.learned),
    expectedEvidence: loopReceipt.nextAction.expectedEvidence
  };
  const autopilotHash = stableHash({
    controller: [controller.controllerHash, controller.selectedAction.id],
    promotion: [promotionFeedback.feedbackHash, promotionFeedback.status, promotionFeedback.promotion.status],
    resolver: [resolver.resolverHash, resolver.status, resolver.marketPrior.benchmarkVerdict],
    turn: [turn.turnHash, turn.status, turn.observation.proofHash],
    loop: [loopReceipt.loopHash, loopReceipt.status, loopReceipt.loop.beliefUpdate],
    selectedAction: [selectedAction.verifyUrl, selectedAction.safeToRun],
    stages: stages.map((item) => [item.id, item.status])
  });
  const memoryContent = compact(
    [
      `status:${status}`,
      `belief:${loopReceipt.loop.beliefUpdate}`,
      `benchmark:${resolver.marketPrior.benchmarkVerdict ?? "none"}`,
      `confidence:${loopReceipt.loop.confidenceEffect}`,
      `public:${loopReceipt.loop.publicActionEffect}`,
      `next:${selectedAction.label}`
    ].join(" | "),
    460
  );

  return {
    mode: "market-prior-autopilot",
    generatedAt: now.toISOString(),
    date: controller.date,
    sport: controller.sport,
    status,
    autopilotHash,
    summary:
      status === "ready-readonly"
        ? `Market-prior autopilot is ready to run one read-only proof: ${selectedAction.label}.`
        : status === "observed-capped"
          ? "Market-prior autopilot observed evidence and kept trust capped by no-vig market consensus."
          : status === "shadow-review"
            ? "Market-prior autopilot observed evidence that can continue shadow provider review only."
            : status === "repair-required"
              ? "Market-prior autopilot requires repair before it can continue."
              : "Market-prior autopilot is holding without a stronger safe action.",
    input: {
      controllerHash: controller.controllerHash,
      promotionFeedbackHash: promotionFeedback.feedbackHash,
      resolverHash: resolver.resolverHash,
      turnHash: turn.turnHash,
      loopHash: loopReceipt.loopHash,
      selectedControllerAction: controller.selectedAction.id,
      promotionStatus: promotionFeedback.promotion.status,
      resolverStatus: resolver.status,
      turnStatus: turn.status,
      loopStatus: loopReceipt.status
    },
    belief: {
      update: loopReceipt.loop.beliefUpdate,
      benchmarkVerdict: resolver.marketPrior.benchmarkVerdict,
      confidenceEffect: loopReceipt.loop.confidenceEffect,
      publicActionEffect: loopReceipt.loop.publicActionEffect,
      currentBelief: compact(loopReceipt.reasoning.belief),
      currentDoubt: compact(loopReceipt.reasoning.doubt),
      changeMindCondition: compact(loopReceipt.reasoning.changeMindCondition)
    },
    selectedAction,
    stages,
    memoryDraft: {
      canPersist: false,
      label: "market_prior_autopilot",
      evidenceHash: autopilotHash,
      content: memoryContent
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedReadOnlyAction: selectedAction.safeToRun,
      canAutoRunOneReadOnlyProof: selectedAction.canAutoRunReadOnly,
      canCallOpenAI: false,
      canFetchProviders: false,
      canExecuteShell: false,
      canWriteSupabaseRows: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canPersistBacktestMemory: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/market-prior-autopilot",
      ...loopReceipt.proofUrls,
      ...turn.proofUrls,
      ...resolver.proofUrls,
      ...promotionFeedback.proofUrls,
      ...controller.proofUrls
    ]),
    locks: unique([
      "Market-prior autopilot orchestrates read-only proof receipts only.",
      "It cannot call OpenAI, fetch providers, execute shell, write Supabase rows, persist memory, persist decisions, persist training rows, train models, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, upgrade public action, or expose hidden chain-of-thought.",
      "Memory draft is response-local until storage, calibration, outcome, and promotion governance approve persistence.",
      ...loopReceipt.locks,
      ...turn.locks,
      ...resolver.locks,
      ...promotionFeedback.locks,
      ...controller.locks
    ])
  };
}
