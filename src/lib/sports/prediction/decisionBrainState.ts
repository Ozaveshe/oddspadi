import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionAgentThoughtBoard } from "@/lib/sports/prediction/decisionAgentThoughtBoard";
import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionBrainStateStatus = "ready-readonly" | "thinking" | "waiting-ai-quota" | "needs-evidence" | "blocked";
export type DecisionBrainStateTrustCeiling = "candidate" | "monitor" | "shadow" | "none";
export type DecisionBrainStateLoopStatus = "pass" | "watch" | "block";
export type DecisionBrainStateLoopId = "observe" | "orient" | "model" | "challenge" | "choose" | "act" | "learn";

export type DecisionBrainStateLoop = {
  id: DecisionBrainStateLoopId;
  label: string;
  status: DecisionBrainStateLoopStatus;
  signal: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionBrainState = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-brain-state";
  status: DecisionBrainStateStatus;
  brainHash: string;
  summary: string;
  activeThesis: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    baselineAction: DecisionAction | "hold";
    publicStance: DecisionCognitiveKernel["finalDirective"]["publicStance"];
    confidenceCeiling: DecisionBrainStateTrustCeiling;
    posteriorProbability: number | null;
    expectedValue: number | null;
    reason: string;
  };
  pressure: {
    evidenceDebt: number;
    contradictionCount: number;
    blockerCount: number;
    watchCount: number;
    consensusScore: number;
    readinessScore: number;
  };
  nextMove: {
    label: string;
    kind: "evidence" | "operation" | "openai" | "hold";
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
    safeToRun: boolean;
    blockedBy: string[];
  };
  loops: DecisionBrainStateLoop[];
  selfCritique: string[];
  memory: {
    beliefLedgerHash: string;
    cognitiveKernelHash: string;
    providerLearningState: DecisionCognitiveKernel["state"]["providerLearningState"];
    corpusMemoryState: DecisionCognitiveKernel["state"]["corpusMemoryState"];
    acquisitionPlannerHash: string;
    operationQueueHash: string;
    openAiReceiptHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function loop(input: Omit<DecisionBrainStateLoop, "evidence"> & { evidence: Array<string | null | undefined> }): DecisionBrainStateLoop {
  return {
    ...input,
    signal: compact(input.signal, 240),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction, 220)
  };
}

function statusFromLoop(loops: DecisionBrainStateLoop[], openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt): DecisionBrainStateStatus {
  if (loops.some((item) => item.status === "block")) return "blocked";
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-ai-quota";
  if (loops.some((item) => item.status === "watch")) return "needs-evidence";
  return "ready-readonly";
}

function statusFromScore(score: number): DecisionBrainStateLoopStatus {
  if (score >= 70) return "pass";
  if (score >= 38) return "watch";
  return "block";
}

function nextMove({
  evidenceAcquisitionPlanner,
  agentOperationQueue,
  openAiLiveReviewReceipt
}: {
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentOperationQueue: DecisionAgentOperationQueue;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionBrainState["nextMove"] {
  const acquisition = evidenceAcquisitionPlanner.nextCandidate;
  if (acquisition) {
    return {
      label: acquisition.label,
      kind: acquisition.source === "openai-proof" ? "openai" : "evidence",
      command: acquisition.safeToRun ? acquisition.command : null,
      verifyUrl: acquisition.verifyUrl,
      expectedEvidence: acquisition.expectedEvidence,
      safeToRun: acquisition.safeToRun,
      blockedBy: unique([...acquisition.missingEnv, ...acquisition.blockers], 8)
    };
  }

  const operation = agentOperationQueue.nextOperation;
  if (operation) {
    return {
      label: operation.label,
      kind: operation.kind === "openai" ? "openai" : "operation",
      command: operation.safeToRun ? operation.command : null,
      verifyUrl: operation.verifyUrl,
      expectedEvidence: operation.expectedEvidence,
      safeToRun: operation.safeToRun,
      blockedBy: operation.blockedBy
    };
  }

  return {
    label: "Hold decision state",
    kind: openAiLiveReviewReceipt.controls.canRequestLiveReview ? "openai" : "hold",
    command: null,
    verifyUrl: null,
    expectedEvidence: openAiLiveReviewReceipt.nextAction,
    safeToRun: false,
    blockedBy: openAiLiveReviewReceipt.locks
  };
}

function selfCritique({
  dataAuthority,
  beliefLedger,
  cognitiveKernel,
  evidenceAcquisitionPlanner,
  openAiLiveReviewReceipt,
  requirementPulse
}: {
  dataAuthority: DecisionDataAuthority;
  beliefLedger: DecisionBayesianBeliefLedger;
  cognitiveKernel: DecisionCognitiveKernel;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  requirementPulse: DecisionRequirementPulse;
}): string[] {
  return unique(
    [
      dataAuthority.status === "blocked" ? dataAuthority.summary : null,
      beliefLedger.activeBelief?.falsifier,
      cognitiveKernel.state.strongestObjection,
      evidenceAcquisitionPlanner.nextCandidate?.ifMissing,
      openAiLiveReviewReceipt.status === "reviewed" ? null : openAiLiveReviewReceipt.nextAction,
      requirementPulse.topGap?.nextAction,
      "The brain state cannot reveal hidden chain-of-thought, persist decisions, publish picks, train models, stake, or upgrade public action."
    ],
    8
  );
}

export function buildDecisionBrainState({
  date,
  sport,
  dataAuthority,
  beliefLedger,
  evidenceAcquisitionPlanner,
  agentThoughtBoard,
  agentOperationQueue,
  cognitiveKernel,
  openAiLiveReviewReceipt,
  requirementPulse,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataAuthority: DecisionDataAuthority;
  beliefLedger: DecisionBayesianBeliefLedger;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentThoughtBoard: DecisionAgentThoughtBoard;
  agentOperationQueue: DecisionAgentOperationQueue;
  cognitiveKernel: DecisionCognitiveKernel;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  requirementPulse: DecisionRequirementPulse;
  now?: Date;
}): DecisionBrainState {
  const activeBelief = beliefLedger.activeBelief;
  const move = nextMove({ evidenceAcquisitionPlanner, agentOperationQueue, openAiLiveReviewReceipt });
  const blockerCount =
    agentThoughtBoard.counts.block +
    beliefLedger.totals.block +
    agentOperationQueue.totals.blocked +
    requirementPulse.counts.blocked +
    (dataAuthority.status === "blocked" ? 1 : 0);
  const watchCount = agentThoughtBoard.counts.watch + beliefLedger.totals.watch + agentOperationQueue.totals.waiting + requirementPulse.counts.watch;
  const readinessScore = clamp(
    dataAuthority.trustScore * 0.22 +
      (100 - cognitiveKernel.state.evidenceDebt) * 0.26 +
      cognitiveKernel.state.consensusScore * 0.22 +
      Math.max(0, 100 - blockerCount * 12 - watchCount * 4) * 0.2 +
      (move.safeToRun ? 10 : 0)
  );
  const loops = [
    loop({
      id: "observe",
      label: "Observe data",
      status: statusFromScore(dataAuthority.trustScore),
      signal: dataAuthority.summary,
      evidence: [`trust ${dataAuthority.trustScore}/100`, dataAuthority.input.providerIngestionStatus, dataAuthority.topFamily?.expectedEvidence],
      nextAction: dataAuthority.nextCommand.expectedEvidence
    }),
    loop({
      id: "orient",
      label: "Orient belief",
      status: beliefLedger.status === "supported" ? "pass" : beliefLedger.status === "blocked" ? "block" : "watch",
      signal: beliefLedger.summary,
      evidence: [
        beliefLedger.ledgerHash,
        activeBelief ? `posterior ${activeBelief.posteriorProbability ?? "n/a"}` : null,
        activeBelief ? `revision ${activeBelief.revisionPressure}/100` : null
      ],
      nextAction: activeBelief?.nextObservation ?? "Build a belief before selecting a proof target."
    }),
    loop({
      id: "model",
      label: "Model thesis",
      status: cognitiveKernel.state.confidenceCeiling === "candidate" ? "pass" : cognitiveKernel.state.confidenceCeiling === "none" ? "block" : "watch",
      signal: cognitiveKernel.state.workingHypothesis,
      evidence: [
        cognitiveKernel.kernelHash,
        `consensus ${cognitiveKernel.state.consensusScore}/100`,
        `debt ${cognitiveKernel.state.evidenceDebt}/100`
      ],
      nextAction: cognitiveKernel.finalDirective.expectedEvidence
    }),
    loop({
      id: "challenge",
      label: "Challenge",
      status: cognitiveKernel.state.contradictionCount > 2 || blockerCount > 0 ? "block" : watchCount > 0 ? "watch" : "pass",
      signal: cognitiveKernel.state.strongestObjection,
      evidence: [`blockers ${blockerCount}`, `watch ${watchCount}`, openAiLiveReviewReceipt.status],
      nextAction: selfCritique({
        dataAuthority,
        beliefLedger,
        cognitiveKernel,
        evidenceAcquisitionPlanner,
        openAiLiveReviewReceipt,
        requirementPulse
      })[0] ?? "Keep challenging the active thesis."
    }),
    loop({
      id: "choose",
      label: "Choose posture",
      status: cognitiveKernel.finalDirective.publicStance === "avoid" ? "block" : cognitiveKernel.finalDirective.publicStance === "monitor-only" ? "watch" : "pass",
      signal: `${cognitiveKernel.finalDirective.publicStance.replaceAll("-", " ")} because ${cognitiveKernel.finalDirective.reason}`,
      evidence: [cognitiveKernel.finalDirective.action, cognitiveKernel.finalDirective.verifyUrl, cognitiveKernel.finalDirective.expectedEvidence],
      nextAction: cognitiveKernel.finalDirective.expectedEvidence
    }),
    loop({
      id: "act",
      label: "Act read-only",
      status: move.safeToRun ? "pass" : move.blockedBy.length ? "block" : "watch",
      signal: `${move.label}: ${move.expectedEvidence}`,
      evidence: [move.kind, move.verifyUrl, move.command],
      nextAction: move.expectedEvidence
    }),
    loop({
      id: "learn",
      label: "Learn later",
      status: requirementPulse.groups.find((item) => item.id === "training-data")?.status === "ready" ? "watch" : "block",
      signal: requirementPulse.groups.find((item) => item.id === "training-data")?.evidence ?? "Training data gate is missing.",
      evidence: ["Learning remains shadow-only.", requirementPulse.groups.find((item) => item.id === "training-data")?.status, openAiLiveReviewReceipt.summary],
      nextAction: requirementPulse.groups.find((item) => item.id === "training-data")?.nextAction ?? "Prove the historical corpus before training."
    })
  ];
  const status = statusFromLoop(loops, openAiLiveReviewReceipt);
  const thesisReason =
    activeBelief?.summary ??
    cognitiveKernel.state.workingHypothesis ??
    "No active belief is strong enough to become a decision.";
  const brainHash = stableHash({
    date,
    sport,
    status,
    activeBelief: activeBelief ? [activeBelief.id, activeBelief.posteriorProbability, activeBelief.revisionPressure] : null,
    kernel: cognitiveKernel.kernelHash,
    acquisition: evidenceAcquisitionPlanner.plannerHash,
    operation: agentOperationQueue.queueHash,
    openAi: openAiLiveReviewReceipt.receiptHash,
    loops: loops.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-brain-state",
    status,
    brainHash,
    summary:
      status === "ready-readonly"
        ? `Brain state can run the next read-only evidence step: ${move.label}.`
        : status === "waiting-ai-quota"
          ? "Brain state has deterministic reasoning ready, but OpenAI quota or billing blocks live critique."
          : status === "blocked"
            ? `Brain state blocks public action with ${blockerCount} blocker(s) and evidence debt ${cognitiveKernel.state.evidenceDebt}/100.`
            : "Brain state is thinking through evidence gaps before trust can rise.",
    activeThesis: {
      matchId: activeBelief?.matchId ?? cognitiveKernel.focus.matchId,
      match: activeBelief?.match ?? cognitiveKernel.focus.match,
      selection: activeBelief?.selection ?? cognitiveKernel.focus.selection,
      baselineAction: cognitiveKernel.focus.action,
      publicStance: cognitiveKernel.finalDirective.publicStance,
      confidenceCeiling: cognitiveKernel.state.confidenceCeiling,
      posteriorProbability: activeBelief?.posteriorProbability ?? null,
      expectedValue: activeBelief?.posteriorExpectedValue ?? null,
      reason: compact(thesisReason, 360)
    },
    pressure: {
      evidenceDebt: cognitiveKernel.state.evidenceDebt,
      contradictionCount: cognitiveKernel.state.contradictionCount,
      blockerCount,
      watchCount,
      consensusScore: cognitiveKernel.state.consensusScore,
      readinessScore
    },
    nextMove: move,
    loops,
    selfCritique: selfCritique({
      dataAuthority,
      beliefLedger,
      cognitiveKernel,
      evidenceAcquisitionPlanner,
      openAiLiveReviewReceipt,
      requirementPulse
    }),
    memory: {
      beliefLedgerHash: beliefLedger.ledgerHash,
      cognitiveKernelHash: cognitiveKernel.kernelHash,
      providerLearningState: cognitiveKernel.state.providerLearningState,
      corpusMemoryState: cognitiveKernel.state.corpusMemoryState,
      acquisitionPlannerHash: evidenceAcquisitionPlanner.plannerHash,
      operationQueueHash: agentOperationQueue.queueHash,
      openAiReceiptHash: openAiLiveReviewReceipt.receiptHash
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: move.safeToRun,
      canAskOpenAI: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/brain-state",
      ...beliefLedger.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...agentThoughtBoard.proofUrls,
      ...agentOperationQueue.proofUrls,
      ...cognitiveKernel.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls
    ]),
    locks: unique([
      "Brain state exposes bounded public reasoning only; hidden chain-of-thought remains disabled.",
      "Brain state cannot persist decisions, publish picks, train models, stake, or upgrade public action.",
      ...beliefLedger.locks,
      ...evidenceAcquisitionPlanner.locks,
      ...agentOperationQueue.locks,
      ...cognitiveKernel.locks,
      ...openAiLiveReviewReceipt.locks
    ])
  };
}
