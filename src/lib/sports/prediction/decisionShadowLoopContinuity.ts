import type { DecisionShadowLoopReflectionReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceiptInterpreter";

export type DecisionShadowLoopContinuityStatus = "awaiting-reflection-observation" | "continue-shadow-loop" | "repair-required" | "halted";
export type DecisionShadowLoopContinuityCheckStatus = "pass" | "watch" | "block";
export type DecisionShadowLoopContinuityMoveId = "observe-reflection-receipt" | "reflect-again" | "repair-proof" | "hold";

export type DecisionShadowLoopContinuityCheck = {
  id: "proof" | "budget" | "authority" | "risk" | "next-move" | "memory";
  label: string;
  status: DecisionShadowLoopContinuityCheckStatus;
  evidence: string[];
  conclusion: string;
};

export type DecisionShadowLoopContinuity = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopReflectionReceiptInterpreter["sport"];
  mode: "decision-shadow-loop-continuity";
  status: DecisionShadowLoopContinuityStatus;
  continuityHash: string;
  summary: string;
  input: {
    interpreterHash: string;
    interpreterStatus: DecisionShadowLoopReflectionReceiptInterpreter["status"];
    proofHash: string | null;
    observedMode: string | null;
  };
  cycleBudget: {
    maxReadOnlyContinuations: 4;
    usedReadOnlyContinuations: number;
    remainingReadOnlyContinuations: number;
    stopReason: string | null;
  };
  stance: {
    currentBelief: string;
    openQuestion: string;
    safeBoundary: string;
    riskPosture: "low-shadow-risk" | "medium-proof-risk" | "high-repair-risk" | "stopped";
  };
  checks: DecisionShadowLoopContinuityCheck[];
  nextMove: {
    id: DecisionShadowLoopContinuityMoveId;
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
    canRunNextReadOnlyMove: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function usedTurns(interpreter: DecisionShadowLoopReflectionReceiptInterpreter): number {
  if (interpreter.status === "observed-reflection-proof") return 3;
  if (interpreter.status === "waiting-observation") return 2;
  return 4;
}

function budgetFor(interpreter: DecisionShadowLoopReflectionReceiptInterpreter): DecisionShadowLoopContinuity["cycleBudget"] {
  const used = usedTurns(interpreter);
  const remaining = Math.max(0, 4 - used);
  return {
    maxReadOnlyContinuations: 4,
    usedReadOnlyContinuations: used,
    remainingReadOnlyContinuations: remaining,
    stopReason: remaining <= 0 ? "read-only continuity budget exhausted" : null
  };
}

function statusFor(interpreter: DecisionShadowLoopReflectionReceiptInterpreter, budget: DecisionShadowLoopContinuity["cycleBudget"]): DecisionShadowLoopContinuityStatus {
  if (budget.remainingReadOnlyContinuations <= 0 && interpreter.status !== "observed-reflection-proof") return "halted";
  if (interpreter.status === "observed-reflection-proof") return budget.remainingReadOnlyContinuations > 0 ? "continue-shadow-loop" : "halted";
  if (interpreter.status === "waiting-observation") return "awaiting-reflection-observation";
  if (interpreter.status === "needs-repair") return "repair-required";
  return "halted";
}

function nextMoveFor(
  status: DecisionShadowLoopContinuityStatus,
  interpreter: DecisionShadowLoopReflectionReceiptInterpreter,
  budget: DecisionShadowLoopContinuity["cycleBudget"]
): DecisionShadowLoopContinuity["nextMove"] {
  if (status === "awaiting-reflection-observation" && interpreter.controls.canRunReflectionReceiptObservation) {
    return {
      id: "observe-reflection-receipt",
      label: "Observe reflected receipt",
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "Continuity needs a reflected receipt hash before another loop reflection."
    };
  }
  if (status === "continue-shadow-loop" && interpreter.controls.canReflectOnObservedProof && budget.remainingReadOnlyContinuations > 0) {
    return {
      id: "reflect-again",
      label: "Reflect again with observed proof",
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "Observed reflected proof can feed one more read-only reflection turn."
    };
  }
  if (status === "repair-required") {
    return {
      id: "repair-proof",
      label: "Repair reflected proof path",
      command: null,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: false,
      reason: "The reflected proof path returned warning, failure, or blocker signals."
    };
  }
  return {
    id: "hold",
    label: "Hold shadow continuity",
    command: null,
    verifyUrl: "/api/sports/decision/shadow-loop-continuity",
    safeToRun: false,
    reason: budget.stopReason ?? "No safe read-only continuity move is available."
  };
}

function stanceFor(
  status: DecisionShadowLoopContinuityStatus,
  interpreter: DecisionShadowLoopReflectionReceiptInterpreter,
  nextMove: DecisionShadowLoopContinuity["nextMove"]
): DecisionShadowLoopContinuity["stance"] {
  if (status === "continue-shadow-loop") {
    return {
      currentBelief: compact(`Reflected proof is observed: ${interpreter.interpretation.learned}`),
      openQuestion: "Does one more reflected pass change only the next shadow question, without touching public action?",
      safeBoundary: "Continue only as a read-only shadow reflection; no persistence, training, probability, confidence, publishing, or staking change.",
      riskPosture: "low-shadow-risk"
    };
  }
  if (status === "awaiting-reflection-observation") {
    return {
      currentBelief: "Reflection selected a safe move, but the reflected receipt has not been observed yet.",
      openQuestion: "Will the reflected move return a successful proof hash or reveal a blocker?",
      safeBoundary: "Observe exactly one reflection receipt route before claiming reflected proof.",
      riskPosture: "medium-proof-risk"
    };
  }
  if (status === "repair-required") {
    return {
      currentBelief: compact(interpreter.interpretation.learned),
      openQuestion: "Which proof route or signal must be repaired before continuity can resume?",
      safeBoundary: "Repair only; do not promote blocked proof into memory, odds, confidence, or public picks.",
      riskPosture: "high-repair-risk"
    };
  }
  return {
    currentBelief: compact(nextMove.reason),
    openQuestion: "Continuity is stopped until an operator or later proof resets the read-only budget.",
    safeBoundary: "Hold all loop continuation and keep outputs read-only.",
    riskPosture: "stopped"
  };
}

function check(input: DecisionShadowLoopContinuityCheck): DecisionShadowLoopContinuityCheck {
  return {
    ...input,
    evidence: unique(input.evidence, 7),
    conclusion: compact(input.conclusion)
  };
}

function checksFor(
  status: DecisionShadowLoopContinuityStatus,
  interpreter: DecisionShadowLoopReflectionReceiptInterpreter,
  budget: DecisionShadowLoopContinuity["cycleBudget"],
  stance: DecisionShadowLoopContinuity["stance"],
  nextMove: DecisionShadowLoopContinuity["nextMove"]
): DecisionShadowLoopContinuityCheck[] {
  return [
    check({
      id: "proof",
      label: "Reflected proof",
      status: interpreter.input.proofHash ? "pass" : status === "awaiting-reflection-observation" ? "watch" : "block",
      evidence: [interpreter.input.proofHash ?? "proof:pending", interpreter.input.receiptStatus, interpreter.input.observedMode ?? "mode:pending"],
      conclusion: stance.currentBelief
    }),
    check({
      id: "budget",
      label: "Continuity budget",
      status: budget.remainingReadOnlyContinuations > 0 ? "pass" : "block",
      evidence: [`used:${budget.usedReadOnlyContinuations}`, `left:${budget.remainingReadOnlyContinuations}`, budget.stopReason ?? "not-stopped"],
      conclusion: budget.stopReason ?? "A bounded read-only continuation remains available."
    }),
    check({
      id: "authority",
      label: "Authority locks",
      status:
        interpreter.controls.canPersistMemory ||
        interpreter.controls.canTrainModels ||
        interpreter.controls.canApplyLearnedWeights ||
        interpreter.controls.canAdjustProbabilities ||
        interpreter.controls.canPublishPicks ||
        interpreter.controls.canStake ||
        interpreter.controls.canUpgradePublicAction
          ? "block"
          : "pass",
      evidence: [
        `persist:${interpreter.controls.canPersistMemory}`,
        `train:${interpreter.controls.canTrainModels}`,
        `weights:${interpreter.controls.canApplyLearnedWeights}`,
        `adjust:${interpreter.controls.canAdjustProbabilities}`,
        `publish:${interpreter.controls.canPublishPicks}`,
        `stake:${interpreter.controls.canStake}`,
        `upgrade:${interpreter.controls.canUpgradePublicAction}`
      ],
      conclusion: "Continuity can select only one read-only next move."
    }),
    check({
      id: "risk",
      label: "Risk posture",
      status: stance.riskPosture === "low-shadow-risk" ? "pass" : stance.riskPosture === "medium-proof-risk" ? "watch" : "block",
      evidence: [stance.riskPosture, interpreter.interpretation.risk],
      conclusion: stance.safeBoundary
    }),
    check({
      id: "next-move",
      label: "Next move",
      status: nextMove.safeToRun ? "pass" : status === "halted" ? "block" : "watch",
      evidence: [nextMove.id, nextMove.verifyUrl, String(nextMove.safeToRun)],
      conclusion: nextMove.reason
    }),
    check({
      id: "memory",
      label: "Memory boundary",
      status: "watch",
      evidence: [interpreter.memoryDraft.evidenceHash ?? "memory-proof:pending", interpreter.memoryDraft.label, `persist:${interpreter.memoryDraft.canPersist}`],
      conclusion: "Memory draft remains response-local until outcome and promotion gates approve it."
    })
  ];
}

function summaryFor(status: DecisionShadowLoopContinuityStatus, nextMove: DecisionShadowLoopContinuity["nextMove"]): string {
  if (status === "continue-shadow-loop") return `Shadow continuity can continue: ${nextMove.reason}`;
  if (status === "awaiting-reflection-observation") return `Shadow continuity is waiting for reflected proof: ${nextMove.reason}`;
  if (status === "repair-required") return `Shadow continuity requires repair: ${nextMove.reason}`;
  return `Shadow continuity is holding: ${nextMove.reason}`;
}

export function buildDecisionShadowLoopContinuity({
  interpreter,
  now = new Date()
}: {
  interpreter: DecisionShadowLoopReflectionReceiptInterpreter;
  now?: Date;
}): DecisionShadowLoopContinuity {
  const budget = budgetFor(interpreter);
  const status = statusFor(interpreter, budget);
  const nextMove = nextMoveFor(status, interpreter, budget);
  const stance = stanceFor(status, interpreter, nextMove);
  const checks = checksFor(status, interpreter, budget, stance, nextMove);
  const continuityHash = stableHash({
    date: interpreter.date,
    sport: interpreter.sport,
    interpreter: interpreter.interpreterHash,
    status,
    proof: interpreter.input.proofHash,
    budget: [budget.usedReadOnlyContinuations, budget.remainingReadOnlyContinuations],
    next: [nextMove.id, nextMove.safeToRun, nextMove.verifyUrl],
    checks: checks.map((item) => [item.id, item.status])
  });
  const memoryContent = compact(
    [
      `status:${status}`,
      `belief:${stance.currentBelief}`,
      `question:${stance.openQuestion}`,
      `next:${nextMove.id}`,
      `budget:${budget.remainingReadOnlyContinuations}`
    ].join(" | "),
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: interpreter.date,
    sport: interpreter.sport,
    mode: "decision-shadow-loop-continuity",
    status,
    continuityHash,
    summary: summaryFor(status, nextMove),
    input: {
      interpreterHash: interpreter.interpreterHash,
      interpreterStatus: interpreter.status,
      proofHash: interpreter.input.proofHash,
      observedMode: interpreter.input.observedMode
    },
    cycleBudget: budget,
    stance,
    checks,
    nextMove,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_continuity",
      evidenceHash: interpreter.input.proofHash,
      content: memoryContent
    },
    controls: {
      canRunNextReadOnlyMove: nextMove.safeToRun,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
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
      "/api/sports/decision/shadow-loop-continuity",
      "/api/sports/decision/shadow-loop-reflection-receipt-interpreter",
      nextMove.verifyUrl,
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow loop continuity is public control flow, not hidden chain-of-thought.",
      "It can choose one bounded read-only next move only.",
      "It cannot persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...interpreter.locks
    ])
  };
}
