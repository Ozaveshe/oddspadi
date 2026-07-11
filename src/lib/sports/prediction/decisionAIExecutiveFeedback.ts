import type { DecisionAIExecutive } from "@/lib/sports/prediction/decisionAIExecutive";
import type { DecisionLearningQueue, DecisionLearningTask } from "@/lib/sports/prediction/decisionLearningQueue";
import type { DecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExecutiveFeedbackStatus = "ready-to-observe" | "proof-reduced" | "repair-required" | "learning-blocked" | "blocked";
export type DecisionAIExecutiveFeedbackPhaseStatus = "pass" | "watch" | "block";
export type DecisionAIExecutiveFeedbackPatchAction = "observe-proof" | "record-shadow-feedback" | "repair-proof" | "queue-learning" | "hold";

export type DecisionAIExecutiveFeedbackPhase = {
  id: "policy" | "proof" | "reduce" | "learn" | "remember";
  label: string;
  status: DecisionAIExecutiveFeedbackPhaseStatus;
  evidence: string[];
  nextAction: string;
};

export type DecisionAIExecutiveFeedback = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-executive-feedback";
  status: DecisionAIExecutiveFeedbackStatus;
  feedbackHash: string;
  summary: string;
  input: {
    executiveHash: string;
    policyHash: string;
    proofReceiptHash: string;
    proofStatus: DecisionAIExecutive["proofReceipt"]["status"];
    learningStatus: DecisionLearningQueue["status"];
    providerIngestionStatus: DecisionProviderIngestionEvidence["status"] | "not-attached";
    supabaseIsolationStatus: DecisionSupabaseProjectIsolation["status"];
  };
  statePatch: {
    action: DecisionAIExecutiveFeedbackPatchAction;
    confidence: "keep-capped" | "cap-low";
    trust: "hold" | "reduce";
    publicAction: "no-upgrade";
    learning: "queue-only" | "blocked";
    memory: "draft-only";
    mayObserveProof: boolean;
    mayAskAIReview: boolean;
    mayPersist: false;
    mayPublish: false;
    mayTrain: false;
    mayRaiseTrust: false;
    mayUpgradePublicAction: false;
  };
  phases: DecisionAIExecutiveFeedbackPhase[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
    safeToRun: boolean;
  };
  learningPlan: {
    nextTaskId: string | null;
    nextTaskTitle: string | null;
    nextTaskStatus: DecisionLearningTask["status"] | null;
    blockedBy: string[];
    expectedLearningSignal: string;
    questions: string[];
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunReadOnly: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function command(date: string, sport: Sport, suffix: string): string {
  return decisionCurlCommand(`/api/sports/decision/ai-executive?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}${suffix}`);
}

function feedbackStatus({
  executive,
  learningQueue
}: {
  executive: DecisionAIExecutive;
  learningQueue: DecisionLearningQueue;
}): DecisionAIExecutiveFeedbackStatus {
  if (executive.proofReceipt.status === "not-run" && executive.proofReceipt.target.allowed) return "ready-to-observe";
  if (executive.proofReceipt.status === "observed" && executive.policy.status !== "blocked") return "proof-reduced";
  if (executive.proofReceipt.status === "failed" || executive.proofReceipt.status === "observed-warning" || executive.policy.status === "repair-first") return "repair-required";
  if (learningQueue.status === "blocked" || executive.policy.status === "blocked") return "learning-blocked";
  return "blocked";
}

function stateAction(status: DecisionAIExecutiveFeedbackStatus): DecisionAIExecutiveFeedbackPatchAction {
  if (status === "ready-to-observe") return "observe-proof";
  if (status === "proof-reduced") return "record-shadow-feedback";
  if (status === "repair-required") return "repair-proof";
  if (status === "learning-blocked") return "queue-learning";
  return "hold";
}

function phase(input: Omit<DecisionAIExecutiveFeedbackPhase, "evidence"> & { evidence: Array<string | null | undefined> }): DecisionAIExecutiveFeedbackPhase {
  return {
    ...input,
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction, 240)
  };
}

function buildPhases({
  executive,
  learningQueue,
  providerIngestionEvidence,
  supabaseIsolation,
  status
}: {
  executive: DecisionAIExecutive;
  learningQueue: DecisionLearningQueue;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  status: DecisionAIExecutiveFeedbackStatus;
}): DecisionAIExecutiveFeedbackPhase[] {
  return [
    phase({
      id: "policy",
      label: "Read executive policy",
      status: executive.policy.status === "approved-readonly" || executive.policy.status === "watch-proof" ? "pass" : executive.policy.status === "repair-first" ? "watch" : "block",
      evidence: [executive.policy.policyHash, executive.policy.status, executive.policy.action, `score:${executive.policy.confidenceBudget.score}`],
      nextAction: executive.policy.decisionRule
    }),
    phase({
      id: "proof",
      label: "Observe selected proof",
      status: executive.proofReceipt.status === "observed" ? "pass" : executive.proofReceipt.target.allowed ? "watch" : "block",
      evidence: [executive.proofReceipt.receiptHash, executive.proofReceipt.status, executive.proofReceipt.target.path, executive.proofReceipt.observation.responseHash],
      nextAction:
        executive.proofReceipt.status === "observed"
          ? "Use the observed proof hash as the current executive receipt."
          : executive.proofReceipt.target.allowed
            ? "Call the executive route with observe=1 to fetch the selected local proof."
            : executive.proofReceipt.target.reason
    }),
    phase({
      id: "reduce",
      label: "Reduce feedback state",
      status: status === "proof-reduced" ? "pass" : status === "ready-to-observe" || status === "learning-blocked" ? "watch" : "block",
      evidence: [status, executive.activeDecision.executiveAction, executive.policy.selectedProof.source, executive.finalDirective.action],
      nextAction:
        status === "proof-reduced"
          ? "Keep the proof as shadow feedback and rebuild the executive before any future trust move."
          : status === "ready-to-observe"
            ? "Observe proof first; do not reduce trust or confidence from an unobserved receipt."
            : "Keep the state conservative and route the next turn to repair or learning blockers."
    }),
    phase({
      id: "learn",
      label: "Queue learning only",
      status: learningQueue.status === "ready" ? "watch" : learningQueue.status === "waiting" ? "watch" : "block",
      evidence: [learningQueue.status, learningQueue.nextTask?.id, learningQueue.nextTask?.status, providerIngestionEvidence?.status ?? "not-attached"],
      nextAction:
        learningQueue.nextTask?.expectedEvidence ??
        providerIngestionEvidence?.nextProviderSignal?.expectedEvidence ??
        "Keep the feedback loop queued until outcome, calibration, training, and provider gates produce proof."
    }),
    phase({
      id: "remember",
      label: "Draft memory",
      status: supabaseIsolation.locks.canWriteDecisionMemory ? "watch" : "block",
      evidence: [supabaseIsolation.isolationHash, supabaseIsolation.status, `memory:${supabaseIsolation.locks.canWriteDecisionMemory}`],
      nextAction: supabaseIsolation.locks.canWriteDecisionMemory
        ? "Memory remains draft-only here; persistence still requires the dedicated admin route."
        : supabaseIsolation.nextAction
    })
  ];
}

function nextTurnFor(executive: DecisionAIExecutive): DecisionAIExecutiveFeedback["nextTurn"] {
  if (executive.proofReceipt.target.allowed && executive.proofReceipt.status !== "observed") {
    return {
      label: "Observe executive proof",
      command: command(executive.date, executive.sport, "&observe=1"),
      verifyUrl: `/api/sports/decision/ai-executive?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}&observe=1`,
      expectedEvidence: "Executive proof receipt changes from not-run to observed with a response hash.",
      safeToRun: true
    };
  }

  if (executive.controls.canAskOpenAI) {
    return {
      label: "Run guarded executive review",
      command: command(executive.date, executive.sport, "&run=1"),
      verifyUrl: `/api/sports/decision/ai-executive?date=${encodeURIComponent(executive.date)}&sport=${encodeURIComponent(executive.sport)}&run=1`,
      expectedEvidence: "Executive AI review returns same-or-safer action and never permissions.",
      safeToRun: true
    };
  }

  return {
    label: executive.policy.selectedProof.label,
    command: executive.finalDirective.command.command,
    verifyUrl: executive.finalDirective.command.verifyUrl,
    expectedEvidence: executive.policy.requiredProof[0] ?? executive.finalDirective.command.expectedEvidence,
    safeToRun: executive.finalDirective.command.safeToRun
  };
}

function summaryFor(status: DecisionAIExecutiveFeedbackStatus, executive: DecisionAIExecutive): string {
  if (status === "ready-to-observe") return `Executive feedback is ready to observe ${executive.policy.selectedProof.label} before reducing state.`;
  if (status === "proof-reduced") return "Executive feedback has observed proof and can record a shadow-only learning signal.";
  if (status === "repair-required") return "Executive feedback needs proof repair before it can reduce the next state.";
  if (status === "learning-blocked") return "Executive feedback is queued, but learning and memory gates remain blocked.";
  return "Executive feedback is holding because no safe next state transition is available.";
}

export function buildDecisionAIExecutiveFeedback({
  executive,
  learningQueue,
  providerIngestionEvidence = null,
  supabaseIsolation,
  now = new Date()
}: {
  executive: DecisionAIExecutive;
  learningQueue: DecisionLearningQueue;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  now?: Date;
}): DecisionAIExecutiveFeedback {
  const status = feedbackStatus({ executive, learningQueue });
  const phases = buildPhases({ executive, learningQueue, providerIngestionEvidence, supabaseIsolation, status });
  const nextTurn = nextTurnFor(executive);
  const blockedBy = unique([
    ...executive.policy.vetoes,
    ...phases.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.nextAction}`),
    ...(learningQueue.nextTask?.missingEnv ?? []),
    ...(providerIngestionEvidence?.supabase.missingForStorage ?? [])
  ]);
  const feedbackHash = stableHash({
    executive: executive.executiveHash,
    policy: executive.policy.policyHash,
    proof: [executive.proofReceipt.status, executive.proofReceipt.receiptHash, executive.proofReceipt.observation.responseHash],
    learning: [learningQueue.status, learningQueue.nextTask?.id, learningQueue.readyTasks, learningQueue.blockedTasks],
    provider: providerIngestionEvidence ? [providerIngestionEvidence.evidenceHash, providerIngestionEvidence.status] : null,
    supabase: [supabaseIsolation.isolationHash, supabaseIsolation.status],
    phases: phases.map((item) => [item.id, item.status]),
    status
  });
  const memoryContent = compact(
    `${summaryFor(status, executive)} Policy ${executive.policy.status}/${executive.policy.action}; next ${nextTurn.label}; learning ${learningQueue.status}; blockers ${blockedBy.join("; ") || "none"}.`,
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: executive.date,
    sport: executive.sport,
    mode: "ai-executive-feedback",
    status,
    feedbackHash,
    summary: summaryFor(status, executive),
    input: {
      executiveHash: executive.executiveHash,
      policyHash: executive.policy.policyHash,
      proofReceiptHash: executive.proofReceipt.receiptHash,
      proofStatus: executive.proofReceipt.status,
      learningStatus: learningQueue.status,
      providerIngestionStatus: providerIngestionEvidence?.status ?? "not-attached",
      supabaseIsolationStatus: supabaseIsolation.status
    },
    statePatch: {
      action: stateAction(status),
      confidence: status === "blocked" || status === "repair-required" ? "cap-low" : "keep-capped",
      trust: status === "blocked" || status === "repair-required" ? "reduce" : "hold",
      publicAction: "no-upgrade",
      learning: learningQueue.status === "blocked" ? "blocked" : "queue-only",
      memory: "draft-only",
      mayObserveProof: Boolean(executive.proofReceipt.target.allowed && executive.proofReceipt.status !== "observed"),
      mayAskAIReview: executive.controls.canAskOpenAI,
      mayPersist: false,
      mayPublish: false,
      mayTrain: false,
      mayRaiseTrust: false,
      mayUpgradePublicAction: false
    },
    phases,
    nextTurn,
    learningPlan: {
      nextTaskId: learningQueue.nextTask?.id ?? null,
      nextTaskTitle: learningQueue.nextTask?.title ?? null,
      nextTaskStatus: learningQueue.nextTask?.status ?? null,
      blockedBy,
      expectedLearningSignal:
        learningQueue.nextTask?.learningImpact ??
        providerIngestionEvidence?.training.detail ??
        "The next learning signal is unavailable until provider, outcome, calibration, or training gates are configured.",
      questions: learningQueue.learningQuestions.slice(0, 6)
    },
    memoryDraft: {
      canPersist: false,
      label: `${executive.activeDecision.match ?? "Active executive decision"} feedback state`,
      evidenceHash: feedbackHash,
      content: memoryContent
    },
    controls: {
      canRunReadOnly: nextTurn.safeToRun,
      canAskAIReview: executive.controls.canAskOpenAI,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        "Executive feedback is shadow-only and cannot persist, publish, train, raise trust, or upgrade public action.",
        "Observe proof before reducing state from an executive policy.",
        "Treat learning tasks as queued evidence, not as active training permission.",
        ...executive.locks,
        ...(providerIngestionEvidence?.controls.forbiddenActions ?? []),
        ...supabaseIsolation.proof.forbiddenActions
      ],
      24
    ),
    proofUrls: unique(
      [
        "/api/sports/decision/ai-executive",
        "/api/sports/decision/learning-queue",
        "/api/sports/decision/provider-ingestion-evidence",
        "/api/sports/decision/supabase-project-isolation",
        nextTurn.verifyUrl,
        executive.proofReceipt.target.path,
        ...executive.proofUrls.slice(0, 12),
        ...(providerIngestionEvidence?.proofUrls ?? [])
      ],
      24
    )
  };
}
