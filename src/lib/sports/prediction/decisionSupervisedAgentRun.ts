import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import type { DecisionBrainState } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import type { DecisionCycleGovernor } from "@/lib/sports/prediction/decisionCycleGovernor";
import type { DecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import type { DecisionLearningConsolidator } from "@/lib/sports/prediction/decisionLearningConsolidator";
import type { DecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import type { DecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { Sport } from "@/lib/sports/types";

export type DecisionSupervisedAgentRunStatus = "ready-readonly" | "waiting-evidence" | "waiting-ai" | "waiting-outcomes" | "blocked";
export type DecisionSupervisedAgentRunStepStatus = "done" | "waiting" | "blocked";
export type DecisionSupervisedAgentRunStepId = "observe" | "reason" | "review" | "act" | "replay" | "learn" | "promote";

export type DecisionSupervisedAgentRunStep = {
  id: DecisionSupervisedAgentRunStepId;
  label: string;
  status: DecisionSupervisedAgentRunStepStatus;
  source: string;
  summary: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionSupervisedAgentRun = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-supervised-agent-run";
  status: DecisionSupervisedAgentRunStatus;
  runHash: string;
  summary: string;
  steps: DecisionSupervisedAgentRunStep[];
  activeStep: DecisionSupervisedAgentRunStep | null;
  finalDirective: {
    publicPosture: string;
    canShowAsPick: boolean;
    selectedIntent: string;
    selectedIntentSafe: boolean;
    receiptStatus: DecisionCycleReceipt["status"];
    learningScope: DecisionLearningPromotionGate["influencePlan"]["allowedScope"];
    nextAction: string;
  };
  trace: {
    brainHash: string;
    kernelHash: string;
    runnerHash: string;
    governorHash: string;
    receiptHash: string;
    replayHash: string;
    promotionHash: string;
    consolidatorHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunOneReadOnlyObservation: boolean;
    canAskOpenAI: boolean;
    canApplyAI: false;
    canPersist: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function step(input: DecisionSupervisedAgentRunStep): DecisionSupervisedAgentRunStep {
  return {
    ...input,
    summary: compact(input.summary),
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction)
  };
}

function buildSteps({
  brainState,
  cognitiveKernel,
  brainReviewRunner,
  cycleGovernor,
  cycleReceipt,
  outcomeReplay,
  learningPromotionGate,
  learningConsolidator
}: {
  brainState: DecisionBrainState;
  cognitiveKernel: DecisionCognitiveKernel;
  brainReviewRunner: DecisionBrainReviewRunner;
  cycleGovernor: DecisionCycleGovernor;
  cycleReceipt: DecisionCycleReceipt;
  outcomeReplay: DecisionOutcomeReplay;
  learningPromotionGate: DecisionLearningPromotionGate;
  learningConsolidator: DecisionLearningConsolidator;
}): DecisionSupervisedAgentRunStep[] {
  return [
    step({
      id: "observe",
      label: "Observe slate and evidence",
      status: brainState.status === "blocked" ? "blocked" : "done",
      source: "decision-brain-state",
      summary: brainState.summary,
      evidence: [
        brainState.brainHash,
        brainState.activeThesis.match ?? "no-active-match",
        brainState.activeThesis.selection ?? "no-active-selection",
        brainState.nextMove.verifyUrl ?? "no-verify-url"
      ],
      nextAction: brainState.nextMove.expectedEvidence
    }),
    step({
      id: "reason",
      label: "Reason over model, market, and risk",
      status: cognitiveKernel.finalDirective.publicStance === "avoid" ? "waiting" : "done",
      source: "cognitive-kernel",
      summary: cognitiveKernel.finalDirective.reason,
      evidence: [cognitiveKernel.kernelHash, cognitiveKernel.finalDirective.publicStance, cognitiveKernel.finalDirective.action],
      nextAction: cognitiveKernel.finalDirective.expectedEvidence
    }),
    step({
      id: "review",
      label: "Review with same-or-safer AI guard",
      status:
        brainReviewRunner.status === "reviewed"
          ? "done"
          : brainReviewRunner.status === "blocked" || brainReviewRunner.status === "auth-failed"
            ? "blocked"
            : "waiting",
      source: "decision-brain-review-runner",
      summary: brainReviewRunner.summary,
      evidence: [brainReviewRunner.runnerHash, brainReviewRunner.latestRun.status, brainReviewRunner.appliedReview.verdict],
      nextAction: brainReviewRunner.controls.canRequestOpenAI ? "Request guarded OpenAI review with run=1." : brainReviewRunner.latestRun.reason ?? brainReviewRunner.summary
    }),
    step({
      id: "act",
      label: "Select and observe one safe action",
      status: cycleReceipt.status === "verified" ? "done" : cycleReceipt.status === "blocked" || cycleGovernor.status === "blocked" ? "blocked" : "waiting",
      source: "decision-cycle-receipt",
      summary: cycleReceipt.summary,
      evidence: [cycleGovernor.governorHash, cycleReceipt.receiptHash, cycleGovernor.selectedIntent.id, String(cycleGovernor.selectedIntent.safeToRun)],
      nextAction: cycleGovernor.selectedIntent.safeToRun ? cycleGovernor.selectedIntent.expectedEvidence : cycleGovernor.summary
    }),
    step({
      id: "replay",
      label: "Replay candidate outcomes",
      status: outcomeReplay.status === "blocked" ? "blocked" : outcomeReplay.status === "ready-replay" ? "done" : "waiting",
      source: "decision-outcome-replay",
      summary: outcomeReplay.summary,
      evidence: [outcomeReplay.replayHash, outcomeReplay.status, String(outcomeReplay.totals.pendingOutcomeTickets)],
      nextAction: outcomeReplay.learningFeedback.nextEvidence
    }),
    step({
      id: "learn",
      label: "Draft learning signals",
      status: learningConsolidator.status === "blocked" ? "blocked" : learningConsolidator.status === "ready-draft" ? "done" : "waiting",
      source: "decision-learning-consolidator",
      summary: learningConsolidator.summary,
      evidence: [learningConsolidator.consolidatorHash, learningConsolidator.activeSignal?.id ?? "no-active-signal", learningConsolidator.status],
      nextAction: learningConsolidator.activeSignal?.learningImpact ?? learningConsolidator.summary
    }),
    step({
      id: "promote",
      label: "Gate learning promotion",
      status: learningPromotionGate.status === "blocked" ? "blocked" : learningPromotionGate.status === "eligible-shadow" ? "done" : "waiting",
      source: "decision-learning-promotion-gate",
      summary: learningPromotionGate.summary,
      evidence: [learningPromotionGate.promotionHash, learningPromotionGate.status, learningPromotionGate.influencePlan.allowedScope],
      nextAction: learningPromotionGate.influencePlan.nextShadowUse
    })
  ];
}

function statusFor({
  steps,
  brainReviewRunner,
  cycleGovernor,
  outcomeReplay,
  learningPromotionGate
}: {
  steps: DecisionSupervisedAgentRunStep[];
  brainReviewRunner: DecisionBrainReviewRunner;
  cycleGovernor: DecisionCycleGovernor;
  outcomeReplay: DecisionOutcomeReplay;
  learningPromotionGate: DecisionLearningPromotionGate;
}): DecisionSupervisedAgentRunStatus {
  if (steps.some((item) => item.status === "blocked")) return "blocked";
  if (brainReviewRunner.status === "quota-or-billing-blocked" || brainReviewRunner.status === "not-configured" || brainReviewRunner.status === "ready-to-run") {
    return "waiting-ai";
  }
  if (outcomeReplay.status === "waiting-outcomes" || learningPromotionGate.status === "waiting-outcomes") return "waiting-outcomes";
  if (cycleGovernor.status === "run-evidence" || cycleGovernor.status === "inspect-intervention") return "waiting-evidence";
  return "ready-readonly";
}

function summaryFor(status: DecisionSupervisedAgentRunStatus, activeStep: DecisionSupervisedAgentRunStep | null): string {
  if (status === "ready-readonly") return "Supervised agent run has a complete read-only trace; side effects remain locked.";
  if (status === "waiting-evidence") return `Supervised agent run is waiting on evidence: ${activeStep?.nextAction ?? "run the selected read-only observation."}`;
  if (status === "waiting-ai") return "Supervised agent run is waiting on a guarded AI review or usable OpenAI quota; deterministic fallback remains active.";
  if (status === "waiting-outcomes") return "Supervised agent run is waiting on settled outcome labels before learning can be trusted.";
  return `Supervised agent run is blocked at ${activeStep?.label ?? "a safety gate"}; no public action can be upgraded.`;
}

export function buildDecisionSupervisedAgentRun({
  date,
  sport,
  brainState,
  cognitiveKernel,
  brainReviewRunner,
  cycleGovernor,
  cycleReceipt,
  outcomeReplay,
  learningPromotionGate,
  learningConsolidator,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  cognitiveKernel: DecisionCognitiveKernel;
  brainReviewRunner: DecisionBrainReviewRunner;
  cycleGovernor: DecisionCycleGovernor;
  cycleReceipt: DecisionCycleReceipt;
  outcomeReplay: DecisionOutcomeReplay;
  learningPromotionGate: DecisionLearningPromotionGate;
  learningConsolidator: DecisionLearningConsolidator;
  now?: Date;
}): DecisionSupervisedAgentRun {
  const steps = buildSteps({
    brainState,
    cognitiveKernel,
    brainReviewRunner,
    cycleGovernor,
    cycleReceipt,
    outcomeReplay,
    learningPromotionGate,
    learningConsolidator
  });
  const activeStep = steps.find((item) => item.status === "blocked") ?? steps.find((item) => item.status === "waiting") ?? steps[steps.length - 1] ?? null;
  const status = statusFor({ steps, brainReviewRunner, cycleGovernor, outcomeReplay, learningPromotionGate });
  const trace = {
    brainHash: brainState.brainHash,
    kernelHash: cognitiveKernel.kernelHash,
    runnerHash: brainReviewRunner.runnerHash,
    governorHash: cycleGovernor.governorHash,
    receiptHash: cycleReceipt.receiptHash,
    replayHash: outcomeReplay.replayHash,
    promotionHash: learningPromotionGate.promotionHash,
    consolidatorHash: learningConsolidator.consolidatorHash
  };

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-supervised-agent-run",
    status,
    runHash: stableHash({
      date,
      sport,
      trace,
      steps: steps.map((item) => [item.id, item.status]),
      final: [brainState.activeThesis.publicStance, cycleGovernor.selectedIntent.id, learningPromotionGate.influencePlan.allowedScope]
    }),
    summary: summaryFor(status, activeStep),
    steps,
    activeStep,
    finalDirective: {
      publicPosture: brainState.activeThesis.publicStance,
      canShowAsPick: cognitiveKernel.finalDirective.canShowAsPick,
      selectedIntent: cycleGovernor.selectedIntent.id,
      selectedIntentSafe: cycleGovernor.selectedIntent.safeToRun,
      receiptStatus: cycleReceipt.status,
      learningScope: learningPromotionGate.influencePlan.allowedScope,
      nextAction: activeStep?.nextAction ?? cycleGovernor.selectedIntent.expectedEvidence
    },
    trace,
    controls: {
      canInspectReadOnly: true,
      canRunOneReadOnlyObservation: cycleReceipt.controls.canObserveSelectedIntent,
      canAskOpenAI: brainReviewRunner.controls.canRequestOpenAI,
      canApplyAI: false,
      canPersist: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/supervised-agent-run",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/cognitive-kernel",
      "/api/sports/decision/cycle-governor",
      "/api/sports/decision/cycle-receipt",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/learning-promotion-gate",
      ...brainState.proofUrls,
      ...cycleGovernor.proofUrls,
      ...cycleReceipt.proofUrls,
      ...outcomeReplay.proofUrls,
      ...learningPromotionGate.proofUrls
    ]),
    locks: unique([
      "Supervised agent run is an audit trace only; it cannot persist, train, publish, stake, or apply AI output.",
      "The trace uses public summaries and evidence hashes only; hidden chain-of-thought is not exposed or stored.",
      "At most one selected read-only observation can be requested through the cycle receipt path.",
      ...brainState.locks,
      ...cycleGovernor.locks,
      ...cycleReceipt.locks,
      ...outcomeReplay.locks,
      ...learningPromotionGate.locks
    ], 36)
  };
}
