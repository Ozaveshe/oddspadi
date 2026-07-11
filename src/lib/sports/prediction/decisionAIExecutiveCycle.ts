import type { DecisionAIExecutive } from "@/lib/sports/prediction/decisionAIExecutive";
import type { DecisionAIExecutiveFeedback } from "@/lib/sports/prediction/decisionAIExecutiveFeedback";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExecutiveCycleStatus = "awaiting-proof" | "proof-observed" | "learning-queued" | "repair-required" | "halted";
export type DecisionAIExecutiveCycleStepStatus = "pass" | "watch" | "block";
export type DecisionAIExecutiveCycleStepId = "perceive" | "align" | "decide" | "act" | "reduce" | "learn" | "halt";

export type DecisionAIExecutiveCycleStep = {
  id: DecisionAIExecutiveCycleStepId;
  label: string;
  status: DecisionAIExecutiveCycleStepStatus;
  inputHash: string;
  output: string;
  nextAction: string;
  evidence: string[];
};

export type DecisionAIExecutiveCycleCommand = {
  id: string;
  label: string;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  reason: string;
};

export type DecisionAIExecutiveCycle = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-executive-cycle";
  status: DecisionAIExecutiveCycleStatus;
  cycleHash: string;
  summary: string;
  currentStep: DecisionAIExecutiveCycleStepId;
  transition: {
    from: DecisionAIExecutiveCycleStepId;
    to: DecisionAIExecutiveCycleStepId;
    allowed: boolean;
    reason: string;
  };
  timeline: DecisionAIExecutiveCycleStep[];
  commandQueue: DecisionAIExecutiveCycleCommand[];
  state: {
    executiveStatus: DecisionAIExecutive["status"];
    policyStatus: DecisionAIExecutive["policy"]["status"];
    feedbackStatus: DecisionAIExecutiveFeedback["status"];
    publicAction: DecisionAIExecutive["activeDecision"]["executiveAction"];
    proofStatus: DecisionAIExecutive["proofReceipt"]["status"];
    learningStatus: DecisionAIExecutiveFeedback["input"]["learningStatus"];
    trust: DecisionAIExecutiveFeedback["statePatch"]["trust"];
    confidence: DecisionAIExecutiveFeedback["statePatch"]["confidence"];
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunNextCommand: boolean;
    canAskAIReview: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
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

function unique(values: Array<string | null | undefined>, limit = 20): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function cycleStatus(executive: DecisionAIExecutive, feedback: DecisionAIExecutiveFeedback): DecisionAIExecutiveCycleStatus {
  if (feedback.status === "ready-to-observe") return "awaiting-proof";
  if (feedback.status === "proof-reduced") return "proof-observed";
  if (feedback.status === "repair-required") return "repair-required";
  if (feedback.status === "learning-blocked" || feedback.statePatch.action === "queue-learning") return "learning-queued";
  if (executive.status === "blocked" || feedback.status === "blocked") return "halted";
  return "halted";
}

function step(input: Omit<DecisionAIExecutiveCycleStep, "evidence"> & { evidence: Array<string | null | undefined> }): DecisionAIExecutiveCycleStep {
  return {
    ...input,
    output: compact(input.output, 280),
    nextAction: compact(input.nextAction, 240),
    evidence: unique(input.evidence, 6)
  };
}

function buildTimeline(executive: DecisionAIExecutive, feedback: DecisionAIExecutiveFeedback, status: DecisionAIExecutiveCycleStatus): DecisionAIExecutiveCycleStep[] {
  const alignPhase = executive.phases.find((item) => item.id === "align");
  const proofPhase = feedback.phases.find((item) => item.id === "proof");
  const learnPhase = feedback.phases.find((item) => item.id === "learn");
  const rememberPhase = feedback.phases.find((item) => item.id === "remember");

  return [
    step({
      id: "perceive",
      label: "Perceive executive state",
      status: executive.status === "blocked" ? "watch" : "pass",
      inputHash: executive.executiveHash,
      output: executive.summary,
      nextAction: executive.phases.find((item) => item.status !== "pass")?.nextAction ?? "Keep the current executive context fresh.",
      evidence: [executive.executiveHash, executive.status, executive.activeDecision.match, executive.activeDecision.executiveAction]
    }),
    step({
      id: "align",
      label: "Align thought and proof",
      status: alignPhase?.status ?? "block",
      inputHash: executive.policy.policyHash,
      output: alignPhase?.signal ?? "Reasoning alignment is missing from the executive cycle.",
      nextAction: alignPhase?.nextAction ?? "Attach reasoning alignment before continuing the cycle.",
      evidence: alignPhase?.evidence ?? []
    }),
    step({
      id: "decide",
      label: "Apply policy",
      status: executive.policy.status === "approved-readonly" || executive.policy.status === "watch-proof" ? "pass" : executive.policy.status === "repair-first" ? "watch" : "block",
      inputHash: executive.policy.policyHash,
      output: executive.policy.decisionRule,
      nextAction: executive.policy.requiredProof[0] ?? executive.finalDirective.reason,
      evidence: [executive.policy.policyHash, executive.policy.status, executive.policy.action, `budget:${executive.policy.confidenceBudget.score}`]
    }),
    step({
      id: "act",
      label: "Act only by proof",
      status: proofPhase?.status ?? "block",
      inputHash: executive.proofReceipt.receiptHash,
      output: executive.proofReceipt.summary,
      nextAction: feedback.nextTurn.expectedEvidence,
      evidence: [executive.proofReceipt.receiptHash, executive.proofReceipt.status, executive.proofReceipt.target.path, executive.proofReceipt.observation.responseHash]
    }),
    step({
      id: "reduce",
      label: "Reduce feedback",
      status: status === "proof-observed" ? "pass" : status === "awaiting-proof" || status === "learning-queued" ? "watch" : "block",
      inputHash: feedback.feedbackHash,
      output: feedback.summary,
      nextAction: feedback.statePatch.action === "queue-learning" ? feedback.learningPlan.expectedLearningSignal : feedback.nextTurn.expectedEvidence,
      evidence: [feedback.feedbackHash, feedback.status, feedback.statePatch.action, feedback.statePatch.trust, feedback.statePatch.confidence]
    }),
    step({
      id: "learn",
      label: "Queue learning",
      status: learnPhase?.status ?? "block",
      inputHash: feedback.feedbackHash,
      output: feedback.learningPlan.expectedLearningSignal,
      nextAction: feedback.learningPlan.nextTaskTitle ?? learnPhase?.nextAction ?? "Wait for a learning task to become safe.",
      evidence: [feedback.input.learningStatus, feedback.learningPlan.nextTaskId, feedback.learningPlan.nextTaskStatus, ...feedback.learningPlan.blockedBy.slice(0, 3)]
    }),
    step({
      id: "halt",
      label: "Hold unsafe outputs",
      status: executive.controls.canPersist || executive.controls.canPublish || executive.controls.canTrain || feedback.controls.canPersist || feedback.controls.canPublish || feedback.controls.canTrain ? "block" : "pass",
      inputHash: stableHash([executive.controls, feedback.controls]),
      output: "Persist, publish, train, raise trust, and public-action upgrade controls remain locked.",
      nextAction: rememberPhase?.nextAction ?? "Keep memory as a draft until the dedicated storage gates pass.",
      evidence: [
        `persist:${executive.controls.canPersist || feedback.controls.canPersist}`,
        `publish:${executive.controls.canPublish || feedback.controls.canPublish}`,
        `train:${executive.controls.canTrain || feedback.controls.canTrain}`,
        `remember:${rememberPhase?.status ?? "missing"}`
      ]
    })
  ];
}

function currentStepFor(status: DecisionAIExecutiveCycleStatus): DecisionAIExecutiveCycleStepId {
  if (status === "awaiting-proof") return "act";
  if (status === "proof-observed") return "reduce";
  if (status === "learning-queued") return "learn";
  if (status === "repair-required") return "reduce";
  return "halt";
}

function transitionFor(status: DecisionAIExecutiveCycleStatus, currentStep: DecisionAIExecutiveCycleStepId, feedback: DecisionAIExecutiveFeedback): DecisionAIExecutiveCycle["transition"] {
  if (status === "awaiting-proof") {
    return {
      from: "act",
      to: "reduce",
      allowed: feedback.nextTurn.safeToRun,
      reason: feedback.nextTurn.expectedEvidence
    };
  }
  if (status === "proof-observed") {
    return {
      from: "reduce",
      to: "learn",
      allowed: true,
      reason: "Observed proof can be carried into the shadow learning queue without writes."
    };
  }
  if (status === "learning-queued") {
    return {
      from: "learn",
      to: "halt",
      allowed: false,
      reason: feedback.learningPlan.blockedBy[0] ?? "Learning remains queued until storage, outcomes, calibration, and training gates pass."
    };
  }
  return {
    from: currentStep,
    to: "halt",
    allowed: false,
    reason: feedback.learningPlan.blockedBy[0] ?? feedback.summary
  };
}

function buildCommandQueue(executive: DecisionAIExecutive, feedback: DecisionAIExecutiveFeedback): DecisionAIExecutiveCycleCommand[] {
  return [
    {
      id: "next-feedback-turn",
      label: feedback.nextTurn.label,
      command: feedback.nextTurn.command,
      verifyUrl: feedback.nextTurn.verifyUrl,
      safeToRun: feedback.nextTurn.safeToRun,
      reason: feedback.nextTurn.expectedEvidence
    },
    {
      id: "inspect-executive",
      label: "Inspect AI executive",
      command: decisionCurlCommand(`/api/sports/decision/ai-executive?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}`),
      verifyUrl: `/api/sports/decision/ai-executive?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}`,
      safeToRun: true,
      reason: "Refresh the executive, policy, feedback, and cycle state without writes."
    },
    {
      id: "inspect-learning",
      label: "Inspect learning queue",
      command: decisionCurlCommand(`/api/sports/decision/learning-queue?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}`),
      verifyUrl: `/api/sports/decision/learning-queue?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}`,
      safeToRun: true,
      reason: feedback.learningPlan.expectedLearningSignal
    }
  ].filter((item, index, items) => item.command || index === 0).filter((item, index, items) => {
    const key = `${item.command ?? item.verifyUrl ?? item.id}`;
    return items.findIndex((candidate) => `${candidate.command ?? candidate.verifyUrl ?? candidate.id}` === key) === index;
  });
}

function summaryFor(status: DecisionAIExecutiveCycleStatus, feedback: DecisionAIExecutiveFeedback): string {
  if (status === "awaiting-proof") return "Executive cycle is waiting on the selected read-only proof before reducing state.";
  if (status === "proof-observed") return "Executive cycle has proof and can carry a shadow feedback signal into learning.";
  if (status === "learning-queued") return "Executive cycle has reduced the turn, but learning remains queued behind locked gates.";
  if (status === "repair-required") return "Executive cycle needs repair before another proof or learning transition.";
  return "Executive cycle is halted because no safe transition is available.";
}

export function buildDecisionAIExecutiveCycle({
  executive,
  feedback,
  now = new Date()
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  now?: Date;
}): DecisionAIExecutiveCycle {
  const status = cycleStatus(executive, feedback);
  const timeline = buildTimeline(executive, feedback, status);
  const currentStep = currentStepFor(status);
  const transition = transitionFor(status, currentStep, feedback);
  const commandQueue = buildCommandQueue(executive, feedback);
  const cycleHash = stableHash({
    executive: executive.executiveHash,
    policy: executive.policy.policyHash,
    feedback: feedback.feedbackHash,
    proof: [executive.proofReceipt.status, executive.proofReceipt.receiptHash, executive.proofReceipt.observation.responseHash],
    state: [status, currentStep, transition.allowed],
    timeline: timeline.map((item) => [item.id, item.status])
  });
  const memoryContent = compact(
    `${summaryFor(status, feedback)} Current step ${currentStep}; transition ${transition.from}->${transition.to}; next ${commandQueue[0]?.label ?? "hold"}; trust ${feedback.statePatch.trust}; confidence ${feedback.statePatch.confidence}.`,
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: executive.date,
    sport: executive.sport,
    mode: "ai-executive-cycle",
    status,
    cycleHash,
    summary: summaryFor(status, feedback),
    currentStep,
    transition,
    timeline,
    commandQueue,
    state: {
      executiveStatus: executive.status,
      policyStatus: executive.policy.status,
      feedbackStatus: feedback.status,
      publicAction: executive.activeDecision.executiveAction,
      proofStatus: executive.proofReceipt.status,
      learningStatus: feedback.input.learningStatus,
      trust: feedback.statePatch.trust,
      confidence: feedback.statePatch.confidence
    },
    memoryDraft: {
      canPersist: false,
      label: `${executive.activeDecision.match ?? "Active executive decision"} executive cycle`,
      evidenceHash: cycleHash,
      content: memoryContent
    },
    controls: {
      canRunNextCommand: Boolean(commandQueue[0]?.safeToRun),
      canAskAIReview: executive.controls.canAskOpenAI && feedback.controls.canAskAIReview,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        "The executive cycle can only inspect, observe approved local proof, or queue learning evidence.",
        "The cycle cannot persist, publish, train, raise trust, or upgrade the public action.",
        ...executive.locks,
        ...feedback.locks
      ],
      24
    ),
    proofUrls: unique(
      [
        "/api/sports/decision/ai-executive",
        "/api/sports/decision/learning-queue",
        ...executive.proofUrls,
        ...feedback.proofUrls,
        ...commandQueue.map((item) => item.verifyUrl)
      ],
      30
    )
  };
}
