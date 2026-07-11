import type { DecisionShadowLoopInterpreter } from "@/lib/sports/prediction/decisionShadowLoopInterpreter";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopReflectionStatus = "waiting-observation" | "ready-refresh" | "needs-repair" | "blocked";
export type DecisionShadowLoopReflectionCheckStatus = "pass" | "watch" | "block";
export type DecisionShadowLoopReflectionMoveId = "observe-loop-receipt" | "refresh-governor" | "repair-proof" | "hold";

export type DecisionShadowLoopReflectionCheck = {
  id: "belief" | "uncertainty" | "risk" | "authority" | "next-move" | "learning";
  label: string;
  status: DecisionShadowLoopReflectionCheckStatus;
  evidence: string[];
  conclusion: string;
};

export type DecisionShadowLoopReflection = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopInterpreter["sport"];
  mode: "decision-shadow-loop-reflection";
  status: DecisionShadowLoopReflectionStatus;
  reflectionHash: string;
  summary: string;
  input: {
    interpreterHash: string;
    interpreterStatus: DecisionShadowLoopInterpreter["status"];
    proofHash: string | null;
    selectedIntentId: string | null;
  };
  stance: {
    currentBelief: string;
    primaryUncertainty: string;
    riskPosture: "low-shadow-risk" | "medium-proof-risk" | "high-repair-risk";
    safestNextAction: string;
    learningBoundary: string;
  };
  checks: DecisionShadowLoopReflectionCheck[];
  nextMove: {
    id: DecisionShadowLoopReflectionMoveId;
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

function statusFor(interpreter: DecisionShadowLoopInterpreter): DecisionShadowLoopReflectionStatus {
  if (interpreter.status === "observed-governed-proof") return "ready-refresh";
  if (interpreter.status === "waiting-observation") return "waiting-observation";
  if (interpreter.status === "needs-repair") return "needs-repair";
  return "blocked";
}

function stanceFor(status: DecisionShadowLoopReflectionStatus, interpreter: DecisionShadowLoopInterpreter): DecisionShadowLoopReflection["stance"] {
  if (status === "ready-refresh") {
    return {
      currentBelief: compact(`The governed proof is observed: ${interpreter.interpretation.learned}`),
      primaryUncertainty: "The refreshed governor still needs to decide whether the observed proof changes the next shadow-only step.",
      riskPosture: "low-shadow-risk",
      safestNextAction: "Refresh the shadow loop governor with observed proof.",
      learningBoundary: "Use the proof hash for shadow-loop planning only; do not change public picks, probabilities, confidence, stakes, or learned weights."
    };
  }
  if (status === "waiting-observation") {
    return {
      currentBelief: "The loop has a governed target, but no governed receipt has been observed yet.",
      primaryUncertainty: "The route may still fail, return warning signals, or prove a blocker once observed.",
      riskPosture: "medium-proof-risk",
      safestNextAction: "Observe one governed receipt route before refreshing the governor.",
      learningBoundary: "No fresh proof may be claimed until the receipt records a response hash."
    };
  }
  return {
    currentBelief: compact(interpreter.interpretation.learned),
    primaryUncertainty: "The proof path is unsafe, failed, or blocked, so the loop cannot trust the current next move.",
    riskPosture: "high-repair-risk",
    safestNextAction: "Repair or replace the governed proof path.",
    learningBoundary: "Blocked or failed proof cannot train models, adjust weights, or promote public action."
  };
}

function check(input: DecisionShadowLoopReflectionCheck): DecisionShadowLoopReflectionCheck {
  return {
    ...input,
    evidence: unique(input.evidence, 7),
    conclusion: compact(input.conclusion)
  };
}

function checksFor(
  status: DecisionShadowLoopReflectionStatus,
  interpreter: DecisionShadowLoopInterpreter,
  stance: DecisionShadowLoopReflection["stance"]
): DecisionShadowLoopReflectionCheck[] {
  const blockers = interpreter.publicTrace.filter((item) => item.status === "block");
  return [
    check({
      id: "belief",
      label: "Belief state",
      status: status === "ready-refresh" ? "pass" : status === "waiting-observation" ? "watch" : "block",
      evidence: [interpreter.interpreterHash, interpreter.input.proofHash ?? "proof:pending", interpreter.interpretation.learned],
      conclusion: stance.currentBelief
    }),
    check({
      id: "uncertainty",
      label: "Primary uncertainty",
      status: status === "ready-refresh" ? "watch" : status === "waiting-observation" ? "watch" : "block",
      evidence: [interpreter.input.observedMode ?? "mode:pending", interpreter.input.receiptStatus, interpreter.input.selectedIntentId ?? "intent:none"],
      conclusion: stance.primaryUncertainty
    }),
    check({
      id: "risk",
      label: "Risk posture",
      status: stance.riskPosture === "low-shadow-risk" ? "pass" : stance.riskPosture === "medium-proof-risk" ? "watch" : "block",
      evidence: [stance.riskPosture, interpreter.interpretation.risk],
      conclusion: `Risk remains ${stance.riskPosture}; ${interpreter.interpretation.risk}`
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
      conclusion: "The reflection can choose only a read-only next move."
    }),
    check({
      id: "next-move",
      label: "Next move",
      status: interpreter.nextTurn.safeToRun ? "pass" : status === "blocked" ? "block" : "watch",
      evidence: [interpreter.nextTurn.label, interpreter.nextTurn.verifyUrl, String(interpreter.nextTurn.safeToRun)],
      conclusion: stance.safestNextAction
    }),
    check({
      id: "learning",
      label: "Learning boundary",
      status: "watch",
      evidence: [interpreter.memoryDraft.evidenceHash ?? "memory-proof:pending", interpreter.memoryDraft.label, `persist:${interpreter.memoryDraft.canPersist}`],
      conclusion: stance.learningBoundary
    }),
    ...blockers.slice(0, 2).map((item) =>
      check({
        id: "risk",
        label: `Blocked trace: ${item.label}`,
        status: "block",
        evidence: item.evidence,
        conclusion: item.nextAction
      })
    )
  ].slice(0, 8);
}

function nextMoveFor(status: DecisionShadowLoopReflectionStatus, interpreter: DecisionShadowLoopInterpreter): DecisionShadowLoopReflection["nextMove"] {
  if (status === "waiting-observation" && interpreter.controls.canRunLoopReceiptObservation) {
    return {
      id: "observe-loop-receipt",
      label: "Observe governed receipt",
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "The loop reflection needs a receipt hash before it can refresh the governor."
    };
  }
  if (status === "ready-refresh" && interpreter.controls.canRefreshGovernorWithObservedProof) {
    return {
      id: "refresh-governor",
      label: "Refresh governor with observed proof",
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: true,
      reason: "The governed proof is observed and can be used to refresh the next read-only loop choice."
    };
  }
  if (status === "needs-repair") {
    return {
      id: "repair-proof",
      label: "Repair governed proof",
      command: null,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: false,
      reason: "The interpreted proof carries a failure, warning, or blocker signal."
    };
  }
  return {
    id: "hold",
    label: "Hold shadow loop",
    command: null,
    verifyUrl: "/api/sports/decision/shadow-loop-interpreter",
    safeToRun: false,
    reason: "No safe read-only loop move is currently available."
  };
}

function summaryFor(status: DecisionShadowLoopReflectionStatus, nextMove: DecisionShadowLoopReflection["nextMove"]): string {
  if (status === "ready-refresh") return `Shadow loop reflection is ready to refresh the governor: ${nextMove.reason}`;
  if (status === "waiting-observation") return `Shadow loop reflection is waiting for governed observation: ${nextMove.reason}`;
  if (status === "needs-repair") return `Shadow loop reflection requires proof repair: ${nextMove.reason}`;
  return "Shadow loop reflection is blocked; no safe read-only loop move is available.";
}

export function buildDecisionShadowLoopReflection({
  interpreter,
  now = new Date()
}: {
  interpreter: DecisionShadowLoopInterpreter;
  now?: Date;
}): DecisionShadowLoopReflection {
  const status = statusFor(interpreter);
  const stance = stanceFor(status, interpreter);
  const checks = checksFor(status, interpreter, stance);
  const nextMove = nextMoveFor(status, interpreter);
  const reflectionHash = stableHash({
    date: interpreter.date,
    sport: interpreter.sport,
    interpreter: interpreter.interpreterHash,
    status,
    proof: interpreter.input.proofHash,
    nextMove: [nextMove.id, nextMove.safeToRun, nextMove.verifyUrl],
    checks: checks.map((item) => [item.id, item.status])
  });
  const memoryContent = compact(
    [
      `status:${status}`,
      `belief:${stance.currentBelief}`,
      `uncertainty:${stance.primaryUncertainty}`,
      `next:${nextMove.id}`,
      `boundary:${stance.learningBoundary}`
    ].join(" | "),
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: interpreter.date,
    sport: interpreter.sport,
    mode: "decision-shadow-loop-reflection",
    status,
    reflectionHash,
    summary: summaryFor(status, nextMove),
    input: {
      interpreterHash: interpreter.interpreterHash,
      interpreterStatus: interpreter.status,
      proofHash: interpreter.input.proofHash,
      selectedIntentId: interpreter.input.selectedIntentId
    },
    stance,
    checks,
    nextMove,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_reflection",
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
      "/api/sports/decision/shadow-loop-reflection",
      "/api/sports/decision/shadow-loop-interpreter",
      nextMove.verifyUrl,
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow loop reflection is public metacognition, not hidden chain-of-thought.",
      "It can choose one read-only next move only.",
      "It cannot persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...interpreter.locks
    ])
  };
}
