import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionBrainState } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import type { DecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionSupervisedAgentRunner } from "@/lib/sports/prediction/decisionSupervisedAgentRunner";
import type { Sport } from "@/lib/sports/types";

export type DecisionAILiveCycleReceiptStatus =
  | "ready-readonly"
  | "ready-live-review"
  | "reviewed"
  | "waiting-openai"
  | "needs-evidence"
  | "blocked";

export type DecisionAILiveCycleStageId =
  | "runtime-key"
  | "review-contracts"
  | "live-review"
  | "operation-queue"
  | "cognitive-kernel"
  | "brain-state"
  | "cycle-receipt"
  | "supervised-runner"
  | "safety-locks";

export type DecisionAILiveCycleStage = {
  id: DecisionAILiveCycleStageId;
  label: string;
  status: "pass" | "watch" | "block";
  evidenceHash: string | null;
  detail: string;
  nextAction: string;
};

export type DecisionAILiveCycleReceipt = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-live-cycle-receipt";
  status: DecisionAILiveCycleReceiptStatus;
  receiptHash: string;
  summary: string;
  model: string;
  activeThesis: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    publicStance: DecisionBrainState["activeThesis"]["publicStance"];
    confidenceCeiling: DecisionBrainState["activeThesis"]["confidenceCeiling"];
  };
  latestRun: {
    openAiRequested: boolean;
    openAiStatus: DecisionOpenAILiveReviewReceipt["latestRun"]["status"];
    openAiProvider: DecisionOpenAILiveReviewReceipt["latestRun"]["provider"];
    reviewHash: string | null;
    supervisedRunnerStatus: DecisionSupervisedAgentRunner["status"];
    cycleReceiptStatus: DecisionCycleReceipt["status"];
  };
  nextSafeAction: {
    label: string;
    kind: DecisionBrainState["nextMove"]["kind"] | "live-review";
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
    safeToRun: boolean;
    blockedBy: string[];
  };
  stages: DecisionAILiveCycleStage[];
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canRequestLiveReview: boolean;
    requiresExplicitRunParam: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canPrintSecrets: false;
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

function compact(value: string | null | undefined, maxLength = 240): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function stage(input: DecisionAILiveCycleStage): DecisionAILiveCycleStage {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction, 220)
  };
}

function openAiStageStatus(status: DecisionOpenAILiveReviewReceipt["status"]): DecisionAILiveCycleStage["status"] {
  if (status === "reviewed") return "pass";
  if (status === "ready-to-request" || status === "contract-waiting") return "watch";
  return "block";
}

function statusFor({
  stages,
  openAiLiveReviewReceipt,
  brainState,
  nextSafeAction
}: {
  stages: DecisionAILiveCycleStage[];
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  brainState: DecisionBrainState;
  nextSafeAction: DecisionAILiveCycleReceipt["nextSafeAction"];
}): DecisionAILiveCycleReceiptStatus {
  if (stages.some((item) => item.status === "block")) {
    if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-openai";
    return "blocked";
  }
  if (openAiLiveReviewReceipt.status === "reviewed") return "reviewed";
  if (openAiLiveReviewReceipt.status === "ready-to-request") return "ready-live-review";
  if (brainState.status === "ready-readonly" || nextSafeAction.safeToRun) return "ready-readonly";
  return "needs-evidence";
}

function summaryFor(status: DecisionAILiveCycleReceiptStatus, nextSafeAction: DecisionAILiveCycleReceipt["nextSafeAction"]): string {
  if (status === "reviewed") return "AI live cycle has a reviewed OpenAI proof and remains locked to advisory, read-only behavior.";
  if (status === "ready-live-review") return "AI live cycle is ready for an explicit run=1 OpenAI review while persistence, training, and publishing remain locked.";
  if (status === "ready-readonly") return `AI live cycle has a safe read-only next action: ${nextSafeAction.label}.`;
  if (status === "waiting-openai") return "AI live cycle is waiting on OpenAI quota, billing, or provider availability before live review can complete.";
  if (status === "blocked") return "AI live cycle found a blocking proof gate; keep deterministic decisions and public action locked.";
  return "AI live cycle needs more evidence before it can raise trust or ask for a live review.";
}

function nextSafeAction({
  brainState,
  agentOperationQueue,
  openAiLiveReviewReceipt
}: {
  brainState: DecisionBrainState;
  agentOperationQueue: DecisionAgentOperationQueue;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionAILiveCycleReceipt["nextSafeAction"] {
  if (brainState.nextMove.safeToRun && brainState.nextMove.command) {
    return {
      label: brainState.nextMove.label,
      kind: brainState.nextMove.kind,
      command: brainState.nextMove.command,
      verifyUrl: brainState.nextMove.verifyUrl,
      expectedEvidence: brainState.nextMove.expectedEvidence,
      safeToRun: true,
      blockedBy: []
    };
  }

  if (agentOperationQueue.nextOperation?.safeToRun && agentOperationQueue.nextOperation.command) {
    return {
      label: agentOperationQueue.nextOperation.label,
      kind: agentOperationQueue.nextOperation.kind === "openai" ? "openai" : "operation",
      command: agentOperationQueue.nextOperation.command,
      verifyUrl: agentOperationQueue.nextOperation.verifyUrl,
      expectedEvidence: agentOperationQueue.nextOperation.expectedEvidence,
      safeToRun: true,
      blockedBy: []
    };
  }

  if (openAiLiveReviewReceipt.controls.canRequestLiveReview) {
    return {
      label: "Request guarded OpenAI live review",
      kind: "live-review",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/openai-live-review-receipt?date=${encodeURIComponent(brainState.date)}&sport=${encodeURIComponent(brainState.sport)}&limit=1&run=1"`,
      verifyUrl: "/api/sports/decision/openai-live-review-receipt?run=1&limit=1",
      expectedEvidence: openAiLiveReviewReceipt.nextAction,
      safeToRun: true,
      blockedBy: []
    };
  }

  return {
    label: brainState.nextMove.label,
    kind: brainState.nextMove.kind,
    command: null,
    verifyUrl: brainState.nextMove.verifyUrl,
    expectedEvidence: brainState.nextMove.expectedEvidence,
    safeToRun: false,
    blockedBy: unique([...brainState.nextMove.blockedBy, ...openAiLiveReviewReceipt.locks], 8)
  };
}

export function buildDecisionAILiveCycleReceipt({
  date,
  sport,
  aiReviewReadiness,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  agentOperationQueue,
  cognitiveKernel,
  brainState,
  cycleReceipt,
  supervisedAgentRunner,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  aiReviewReadiness: DecisionAIReviewReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  agentOperationQueue: DecisionAgentOperationQueue;
  cognitiveKernel: DecisionCognitiveKernel;
  brainState: DecisionBrainState;
  cycleReceipt: DecisionCycleReceipt;
  supervisedAgentRunner: DecisionSupervisedAgentRunner;
  now?: Date;
}): DecisionAILiveCycleReceipt {
  const nextAction = nextSafeAction({ brainState, agentOperationQueue, openAiLiveReviewReceipt });
  const stages = [
    stage({
      id: "runtime-key",
      label: "Runtime key",
      status: openAiKeyDiagnostic.status === "ready-to-request" ? "pass" : openAiKeyDiagnostic.status === "missing-key" ? "watch" : "block",
      evidenceHash: openAiKeyDiagnostic.diagnosticHash,
      detail: openAiKeyDiagnostic.summary,
      nextAction: openAiKeyDiagnostic.nextStep.label
    }),
    stage({
      id: "review-contracts",
      label: "Review contracts",
      status: aiReviewReadiness.status === "ready-to-run" ? "pass" : aiReviewReadiness.status === "needs-key" ? "watch" : "block",
      evidenceHash: aiReviewReadiness.readinessHash,
      detail: `${aiReviewReadiness.totals.readyLiveReview}/${aiReviewReadiness.totals.lanes} guarded AI lanes are live-review ready.`,
      nextAction: aiReviewReadiness.nextSafeCommand.label
    }),
    stage({
      id: "live-review",
      label: "Live review",
      status: openAiStageStatus(openAiLiveReviewReceipt.status),
      evidenceHash: openAiLiveReviewReceipt.receiptHash,
      detail: openAiLiveReviewReceipt.summary,
      nextAction: openAiLiveReviewReceipt.nextAction
    }),
    stage({
      id: "operation-queue",
      label: "Operation queue",
      status: agentOperationQueue.status === "blocked" ? "block" : agentOperationQueue.status === "ready-readonly" ? "pass" : "watch",
      evidenceHash: agentOperationQueue.queueHash,
      detail: agentOperationQueue.summary,
      nextAction: agentOperationQueue.nextOperation?.expectedEvidence ?? "Keep collecting proof before action."
    }),
    stage({
      id: "cognitive-kernel",
      label: "Cognitive kernel",
      status: cognitiveKernel.status === "blocked" ? "block" : cognitiveKernel.status === "ready-shadow" ? "pass" : "watch",
      evidenceHash: cognitiveKernel.kernelHash,
      detail: cognitiveKernel.summary,
      nextAction: cognitiveKernel.finalDirective.expectedEvidence
    }),
    stage({
      id: "brain-state",
      label: "Brain state",
      status: brainState.status === "blocked" ? "block" : brainState.status === "ready-readonly" ? "pass" : "watch",
      evidenceHash: brainState.brainHash,
      detail: brainState.summary,
      nextAction: brainState.nextMove.expectedEvidence
    }),
    stage({
      id: "cycle-receipt",
      label: "Cycle receipt",
      status: cycleReceipt.status === "verified" ? "pass" : cycleReceipt.status === "blocked" || cycleReceipt.status === "failed" ? "block" : "watch",
      evidenceHash: cycleReceipt.receiptHash,
      detail: cycleReceipt.summary,
      nextAction: cycleReceipt.verification.fallbackAction
    }),
    stage({
      id: "supervised-runner",
      label: "Supervised runner",
      status: supervisedAgentRunner.status === "observed" ? "pass" : supervisedAgentRunner.status === "blocked" || supervisedAgentRunner.status === "failed" ? "block" : "watch",
      evidenceHash: supervisedAgentRunner.runnerHash,
      detail: supervisedAgentRunner.summary,
      nextAction: supervisedAgentRunner.receipt.summary ?? "Request one selected read-only observation when the target is allowed."
    }),
    stage({
      id: "safety-locks",
      label: "Safety locks",
      status: "pass",
      evidenceHash: stableHash([openAiLiveReviewReceipt.controls, brainState.controls, supervisedAgentRunner.controls]),
      detail: "Persistence, publishing, training, staking, trust upgrades, secret printing, and hidden chain-of-thought are all disabled.",
      nextAction: "Keep AI output advisory until provider data, Supabase writes, backtests, and governance gates are separately proven."
    })
  ];
  const status = statusFor({ stages, openAiLiveReviewReceipt, brainState, nextSafeAction: nextAction });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "ai-live-cycle-receipt",
    status,
    receiptHash: stableHash({
      date,
      sport,
      model: openAiLiveReviewReceipt.model,
      stages: stages.map((item) => [item.id, item.status, item.evidenceHash]),
      nextAction: [nextAction.label, nextAction.safeToRun],
      latestRun: openAiLiveReviewReceipt.latestRun,
      supervised: supervisedAgentRunner.runnerHash
    }),
    summary: summaryFor(status, nextAction),
    model: openAiLiveReviewReceipt.model,
    activeThesis: {
      matchId: brainState.activeThesis.matchId,
      match: brainState.activeThesis.match,
      selection: brainState.activeThesis.selection,
      publicStance: brainState.activeThesis.publicStance,
      confidenceCeiling: brainState.activeThesis.confidenceCeiling
    },
    latestRun: {
      openAiRequested: openAiLiveReviewReceipt.latestRun.requested,
      openAiStatus: openAiLiveReviewReceipt.latestRun.status,
      openAiProvider: openAiLiveReviewReceipt.latestRun.provider,
      reviewHash: openAiLiveReviewReceipt.latestRun.reviewHash,
      supervisedRunnerStatus: supervisedAgentRunner.status,
      cycleReceiptStatus: cycleReceipt.status
    },
    nextSafeAction: nextAction,
    stages,
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: nextAction.safeToRun,
      canRequestLiveReview: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      requiresExplicitRunParam: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canPrintSecrets: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/ai-live-cycle-receipt",
      "/api/sports/decision/openai-live-review-receipt",
      "/api/sports/decision/cognitive-kernel",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/supervised-agent-runner"
    ],
    locks: [
      "AI live-cycle receipt is read-only.",
      "It summarizes public stage evidence and never exposes hidden chain-of-thought.",
      "It cannot persist decisions, publish picks, train models, stake, print secrets, or raise public trust.",
      "Any OpenAI call still requires an explicit run=1 guarded route."
    ]
  };
}
