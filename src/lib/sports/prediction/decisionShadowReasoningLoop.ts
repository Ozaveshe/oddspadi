import type { DecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import type { DecisionShadowWorkingMemory } from "@/lib/sports/prediction/decisionShadowWorkingMemory";

export type DecisionShadowReasoningLoopStatus = "awaiting-observation" | "thinking-shadow" | "repair-required" | "halted";
export type DecisionShadowReasoningLoopPhaseStatus = "pass" | "watch" | "block";
export type DecisionShadowReasoningLoopPhaseId = "sense" | "remember" | "question" | "criticize" | "decide" | "act" | "learn";

export type DecisionShadowReasoningLoopPhase = {
  id: DecisionShadowReasoningLoopPhaseId;
  label: string;
  status: DecisionShadowReasoningLoopPhaseStatus;
  thought: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowReasoningLoop = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowWorkingMemory["sport"];
  mode: "decision-shadow-reasoning-loop";
  status: DecisionShadowReasoningLoopStatus;
  loopHash: string;
  summary: string;
  cycleBudget: {
    maxReadOnlyTurns: 3;
    usedReadOnlyTurns: number;
    remainingReadOnlyTurns: number;
    stopReason: string | null;
  };
  focus: {
    memoryHash: string;
    interpreterHash: string;
    proofHash: string | null;
    currentBelief: string;
    primaryDoubt: string;
    decisiveUnknown: string;
  };
  phases: DecisionShadowReasoningLoopPhase[];
  decision: {
    nextMove: "observe-receipt" | "ask-next-question" | "repair-proof" | "hold";
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    reason: string;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  controls: {
    canRunOneReadOnlyTurn: boolean;
    canUseWorkingMemoryForPlanning: boolean;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function phase(input: DecisionShadowReasoningLoopPhase): DecisionShadowReasoningLoopPhase {
  return {
    ...input,
    thought: compact(input.thought),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function statusFor(memory: DecisionShadowWorkingMemory, interpreter: DecisionShadowNextCycleInterpreter): DecisionShadowReasoningLoopStatus {
  if (memory.status === "blocked" || interpreter.status === "blocked") return "halted";
  if (memory.status === "needs-repair" || interpreter.status === "needs-repair") return "repair-required";
  if (memory.status === "waiting-observation" || interpreter.status === "waiting-observation") return "awaiting-observation";
  return "thinking-shadow";
}

function usedTurns(memory: DecisionShadowWorkingMemory, interpreter: DecisionShadowNextCycleInterpreter): number {
  return [memory.focus.proofHash, interpreter.input.proofHash, interpreter.status === "observed-proof" ? "observed" : null].filter(Boolean).length ? 1 : 0;
}

function buildPhases({
  memory,
  interpreter,
  status
}: {
  memory: DecisionShadowWorkingMemory;
  interpreter: DecisionShadowNextCycleInterpreter;
  status: DecisionShadowReasoningLoopStatus;
}): DecisionShadowReasoningLoopPhase[] {
  return [
    phase({
      id: "sense",
      label: "Sense proof state",
      status: interpreter.input.proofHash ? "pass" : status === "awaiting-observation" ? "watch" : "block",
      thought: interpreter.input.proofHash ? "A public proof hash is available for this shadow cycle." : "No proof hash is available yet.",
      evidence: unique([interpreter.input.receiptHash, interpreter.input.proofHash, interpreter.input.receiptStatus]),
      nextAction: interpreter.input.proofHash ? "Use the proof hash as the observed input." : "Observe the selected receipt once."
    }),
    phase({
      id: "remember",
      label: "Read working memory",
      status: memory.counts.cells > 0 ? "pass" : "block",
      thought: memory.attention.currentBelief,
      evidence: [memory.memoryHash, `cells:${memory.counts.cells}`, `doubts:${memory.counts.doubts}`, `blocked:${memory.counts.blocked}`],
      nextAction: memory.attention.safestNextAction
    }),
    phase({
      id: "question",
      label: "Choose next question",
      status: memory.controls.canPlanNextReadOnlyStep ? "pass" : "watch",
      thought: memory.attention.decisiveUnknown,
      evidence: unique([memory.focus.selectedStepId, memory.attention.primaryDoubt, memory.policy.verificationUrl]),
      nextAction: interpreter.nextTurn.label
    }),
    phase({
      id: "criticize",
      label: "Challenge the loop",
      status: memory.counts.blocked > 0 || status === "repair-required" ? "block" : memory.counts.doubts > 0 ? "watch" : "pass",
      thought: memory.attention.primaryDoubt,
      evidence: [`blocked:${memory.counts.blocked}`, `doubts:${memory.counts.doubts}`, interpreter.interpretation.risk],
      nextAction: memory.counts.blocked > 0 ? "Repair blocked memory cells before continuing." : "Keep the doubt visible while planning the next proof."
    }),
    phase({
      id: "decide",
      label: "Select loop move",
      status: status === "halted" || status === "repair-required" ? "block" : "pass",
      thought:
        status === "awaiting-observation"
          ? "The best move is to observe the approved receipt."
          : status === "thinking-shadow"
            ? "The best move is to ask the next read-only proof question."
            : "The loop must stop or repair.",
      evidence: [status, interpreter.nextTurn.verifyUrl, String(interpreter.nextTurn.safeToRun)],
      nextAction: interpreter.nextTurn.label
    }),
    phase({
      id: "act",
      label: "Run only safe action",
      status: interpreter.nextTurn.safeToRun && status !== "halted" && status !== "repair-required" ? "pass" : "block",
      thought: interpreter.nextTurn.command ?? "No safe command is available.",
      evidence: unique([interpreter.nextTurn.command, interpreter.nextTurn.verifyUrl, String(interpreter.nextTurn.safeToRun)]),
      nextAction: interpreter.nextTurn.safeToRun ? "Run one read-only turn if requested by the operator." : "Hold until a safe read-only route is available."
    }),
    phase({
      id: "learn",
      label: "Keep learning draft-only",
      status: "watch",
      thought: memory.memoryDraft.content,
      evidence: unique([memory.memoryDraft.evidenceHash, interpreter.memoryDraft.evidenceHash, memory.memoryHash]),
      nextAction: "Keep shadow learning as draft memory until outcome and governance gates explicitly allow promotion."
    })
  ];
}

function decisionFor({
  status,
  interpreter,
  memory
}: {
  status: DecisionShadowReasoningLoopStatus;
  interpreter: DecisionShadowNextCycleInterpreter;
  memory: DecisionShadowWorkingMemory;
}): DecisionShadowReasoningLoop["decision"] {
  if (status === "awaiting-observation" && interpreter.nextTurn.safeToRun) {
    return {
      nextMove: "observe-receipt",
      label: interpreter.nextTurn.label,
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "The loop needs one public receipt hash before it can ask another question."
    };
  }
  if (status === "thinking-shadow" && interpreter.nextTurn.safeToRun && memory.policy.canUseForPlanning) {
    return {
      nextMove: "ask-next-question",
      label: interpreter.nextTurn.label,
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "The loop has observed proof and can ask the next read-only proof question."
    };
  }
  if (status === "repair-required") {
    return {
      nextMove: "repair-proof",
      label: "Repair proof route",
      command: null,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: false,
      reason: "The latest proof or memory cell requires repair before the loop can continue."
    };
  }
  return {
    nextMove: "hold",
    label: "Hold shadow loop",
    command: null,
    verifyUrl: memory.policy.verificationUrl,
    safeToRun: false,
    reason: "The loop is halted or lacks a safe read-only turn."
  };
}

function summaryFor(status: DecisionShadowReasoningLoopStatus, decision: DecisionShadowReasoningLoop["decision"]): string {
  if (status === "thinking-shadow") return `Shadow reasoning loop can continue with ${decision.label}.`;
  if (status === "awaiting-observation") return `Shadow reasoning loop is waiting to observe one receipt: ${decision.label}.`;
  if (status === "repair-required") return "Shadow reasoning loop requires proof repair before continuing.";
  return "Shadow reasoning loop is halted by blocked proof or memory state.";
}

export function buildDecisionShadowReasoningLoop({
  memory,
  interpreter,
  now = new Date()
}: {
  memory: DecisionShadowWorkingMemory;
  interpreter: DecisionShadowNextCycleInterpreter;
  now?: Date;
}): DecisionShadowReasoningLoop {
  const status = statusFor(memory, interpreter);
  const usedReadOnlyTurns = usedTurns(memory, interpreter);
  const remainingReadOnlyTurns = Math.max(0, 3 - usedReadOnlyTurns);
  const phases = buildPhases({ memory, interpreter, status });
  const decision = decisionFor({ status, interpreter, memory });
  const stopReason =
    remainingReadOnlyTurns <= 0
      ? "Read-only cycle budget exhausted."
      : status === "halted"
        ? "Blocked proof or memory state."
        : status === "repair-required"
          ? "Proof repair is required."
          : null;
  const loopHash = stableHash({
    date: memory.date,
    sport: memory.sport,
    memory: memory.memoryHash,
    interpreter: interpreter.interpreterHash,
    status,
    decision: [decision.nextMove, decision.verifyUrl, decision.safeToRun],
    phases: phases.map((item) => [item.id, item.status])
  });
  const memoryContent = compact(
    [
      `status:${status}`,
      `move:${decision.nextMove}`,
      `belief:${memory.attention.currentBelief}`,
      `doubt:${memory.attention.primaryDoubt}`,
      `next:${decision.label}`,
      `budget:${remainingReadOnlyTurns}`
    ].join(" | "),
    460
  );

  return {
    generatedAt: now.toISOString(),
    date: memory.date,
    sport: memory.sport,
    mode: "decision-shadow-reasoning-loop",
    status,
    loopHash,
    summary: summaryFor(status, decision),
    cycleBudget: {
      maxReadOnlyTurns: 3,
      usedReadOnlyTurns,
      remainingReadOnlyTurns,
      stopReason
    },
    focus: {
      memoryHash: memory.memoryHash,
      interpreterHash: interpreter.interpreterHash,
      proofHash: memory.focus.proofHash,
      currentBelief: memory.attention.currentBelief,
      primaryDoubt: memory.attention.primaryDoubt,
      decisiveUnknown: memory.attention.decisiveUnknown
    },
    phases,
    decision,
    memoryDraft: {
      canPersist: false,
      label: "shadow_reasoning_loop",
      evidenceHash: memory.focus.proofHash,
      content: memoryContent
    },
    controls: {
      canRunOneReadOnlyTurn: decision.safeToRun && remainingReadOnlyTurns > 0,
      canUseWorkingMemoryForPlanning: memory.policy.canUseForPlanning,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-reasoning-loop",
      "/api/sports/decision/shadow-working-memory",
      decision.verifyUrl,
      ...memory.proofUrls,
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow reasoning loop is public, bounded, and read-only.",
      "It can choose one next proof route but cannot execute shell by itself.",
      "It cannot persist memory, write decisions, train models, adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...memory.locks,
      ...interpreter.locks
    ])
  };
}
