import type { DecisionShadowLoopContinuityReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceiptInterpreter";

export type DecisionShadowLoopAutopilotStatus = "ready-readonly" | "waiting-observation" | "repair-required" | "holding";
export type DecisionShadowLoopAutopilotActionId = "observe-continuity-receipt" | "refresh-continuity" | "repair-continuity-proof" | "hold";
export type DecisionShadowLoopAutopilotPhaseId = "sense" | "observe" | "interpret" | "decide" | "learn";
export type DecisionShadowLoopAutopilotPhaseStatus = "pass" | "watch" | "block";

export type DecisionShadowLoopAutopilotPhase = {
  id: DecisionShadowLoopAutopilotPhaseId;
  label: string;
  status: DecisionShadowLoopAutopilotPhaseStatus;
  evidence: string[];
  conclusion: string;
  nextAction: string;
};

export type DecisionShadowLoopAutopilot = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopContinuityReceiptInterpreter["sport"];
  mode: "decision-shadow-loop-autopilot";
  status: DecisionShadowLoopAutopilotStatus;
  autopilotHash: string;
  summary: string;
  input: {
    interpreterHash: string;
    interpreterStatus: DecisionShadowLoopContinuityReceiptInterpreter["status"];
    proofHash: string | null;
    observedMode: string | null;
  };
  cycle: {
    maxShadowTurns: 5;
    usedShadowTurns: number;
    remainingShadowTurns: number;
    stopReason: string | null;
  };
  selectedAction: {
    id: DecisionShadowLoopAutopilotActionId;
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    canAutoRunReadOnly: boolean;
    reason: string;
    expectedEvidence: string;
  };
  phases: DecisionShadowLoopAutopilotPhase[];
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  controls: {
    canRunSelectedReadOnlyAction: boolean;
    canExecuteShell: false;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function isSafeReadOnlyCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return (
    lower.includes("curl.exe") &&
    !lower.includes("-x post") &&
    !lower.includes("-xpost") &&
    !lower.includes("persist=1") &&
    !lower.includes("persist=true") &&
    !lower.includes("dryrun=0") &&
    !lower.includes("dryrun=false") &&
    !lower.includes("publish=1") &&
    !lower.includes("train=1") &&
    !lower.includes("stake=1") &&
    !lower.includes("deploy")
  );
}

function cycleFor(interpreter: DecisionShadowLoopContinuityReceiptInterpreter): DecisionShadowLoopAutopilot["cycle"] {
  const used =
    interpreter.status === "waiting-continuity-observation"
      ? 3
      : interpreter.status === "observed-continuity-proof"
        ? 4
        : 5;
  const remaining = Math.max(0, 5 - used);
  return {
    maxShadowTurns: 5,
    usedShadowTurns: used,
    remainingShadowTurns: remaining,
    stopReason: remaining <= 0 ? "shadow loop autopilot turn budget exhausted" : null
  };
}

function actionFor(
  interpreter: DecisionShadowLoopContinuityReceiptInterpreter,
  cycle: DecisionShadowLoopAutopilot["cycle"]
): DecisionShadowLoopAutopilot["selectedAction"] {
  if (cycle.remainingShadowTurns <= 0) {
    return {
      id: "hold",
      label: "Hold shadow loop",
      command: null,
      verifyUrl: "/api/sports/decision/shadow-loop-autopilot",
      safeToRun: false,
      canAutoRunReadOnly: false,
      reason: cycle.stopReason ?? "No shadow-loop turn budget remains.",
      expectedEvidence: "Operator reviews the loop state before another read-only cycle is selected."
    };
  }

  if (interpreter.status === "waiting-continuity-observation" && interpreter.controls.canRunContinuityReceiptObservation) {
    const safe = interpreter.nextTurn.safeToRun && isSafeReadOnlyCommand(interpreter.nextTurn.command);
    return {
      id: "observe-continuity-receipt",
      label: interpreter.nextTurn.label,
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: safe,
      canAutoRunReadOnly: safe,
      reason: "The loop needs a continuity receipt hash before it can refresh its shadow state.",
      expectedEvidence: "Continuity receipt interpreter returns observed-continuity-proof with a public response hash and unchanged write locks."
    };
  }

  if (interpreter.status === "observed-continuity-proof" && interpreter.controls.canRefreshContinuityWithObservedProof) {
    const safe = interpreter.nextTurn.safeToRun && isSafeReadOnlyCommand(interpreter.nextTurn.command);
    return {
      id: "refresh-continuity",
      label: interpreter.nextTurn.label,
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: safe,
      canAutoRunReadOnly: safe,
      reason: "Observed continuity proof can feed one more bounded read-only continuity refresh.",
      expectedEvidence: "Shadow loop continuity returns a refreshed status, next move, budget, and locked controls."
    };
  }

  if (interpreter.status === "needs-repair") {
    return {
      id: "repair-continuity-proof",
      label: "Repair continuity proof",
      command: null,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: false,
      canAutoRunReadOnly: false,
      reason: interpreter.interpretation.nextAction,
      expectedEvidence: "The failing continuity proof route is repaired or replaced before another observation is attempted."
    };
  }

  return {
    id: "hold",
    label: "Hold shadow loop",
    command: null,
    verifyUrl: interpreter.nextTurn.verifyUrl,
    safeToRun: false,
    canAutoRunReadOnly: false,
    reason: "The continuity interpreter is blocked or has no safe next read-only action.",
    expectedEvidence: "A safe continuity receipt or continuity refresh route becomes available."
  };
}

function statusFor(action: DecisionShadowLoopAutopilot["selectedAction"], interpreter: DecisionShadowLoopContinuityReceiptInterpreter): DecisionShadowLoopAutopilotStatus {
  if (action.id === "repair-continuity-proof") return "repair-required";
  if (action.id === "hold") return "holding";
  if (action.safeToRun) return "ready-readonly";
  return interpreter.status === "waiting-continuity-observation" ? "waiting-observation" : "holding";
}

function phase(input: DecisionShadowLoopAutopilotPhase): DecisionShadowLoopAutopilotPhase {
  return {
    ...input,
    evidence: unique(input.evidence, 8),
    conclusion: compact(input.conclusion),
    nextAction: compact(input.nextAction)
  };
}

function phasesFor(
  interpreter: DecisionShadowLoopContinuityReceiptInterpreter,
  action: DecisionShadowLoopAutopilot["selectedAction"],
  cycle: DecisionShadowLoopAutopilot["cycle"]
): DecisionShadowLoopAutopilotPhase[] {
  return [
    phase({
      id: "sense",
      label: "Sense loop state",
      status: interpreter.status === "blocked" ? "block" : "pass",
      evidence: [interpreter.interpreterHash, interpreter.status, interpreter.input.receiptStatus],
      conclusion: interpreter.summary,
      nextAction: interpreter.interpretation.nextAction
    }),
    phase({
      id: "observe",
      label: "Observe proof",
      status: interpreter.input.proofHash ? "pass" : action.id === "observe-continuity-receipt" ? "watch" : interpreter.status === "needs-repair" ? "block" : "watch",
      evidence: [interpreter.input.proofHash ?? "proof:pending", interpreter.input.observedMode ?? "mode:pending", action.verifyUrl],
      conclusion: interpreter.input.proofHash ? "Continuity proof is observed." : "Continuity proof is not observed yet.",
      nextAction: action.id === "observe-continuity-receipt" ? action.expectedEvidence : "Use observed proof or repair the proof path."
    }),
    phase({
      id: "interpret",
      label: "Interpret proof",
      status: interpreter.status === "observed-continuity-proof" ? "pass" : interpreter.status === "needs-repair" || interpreter.status === "blocked" ? "block" : "watch",
      evidence: [interpreter.interpretation.learned, interpreter.interpretation.risk, ...interpreter.publicTrace.map((item) => `${item.id}:${item.status}`)],
      conclusion: interpreter.interpretation.learned,
      nextAction: interpreter.interpretation.nextAction
    }),
    phase({
      id: "decide",
      label: "Select next move",
      status: action.safeToRun ? "pass" : action.id === "repair-continuity-proof" || action.id === "hold" ? "block" : "watch",
      evidence: [action.id, action.verifyUrl, `safe:${action.safeToRun}`, `auto:${action.canAutoRunReadOnly}`],
      conclusion: action.reason,
      nextAction: action.expectedEvidence
    }),
    phase({
      id: "learn",
      label: "Draft memory",
      status: "watch",
      evidence: [interpreter.memoryDraft.evidenceHash ?? "memory-proof:pending", interpreter.memoryDraft.label, `left:${cycle.remainingShadowTurns}`],
      conclusion: "Autopilot can draft response-local loop memory only.",
      nextAction: "Keep memory local until outcome, training, and promotion gates pass."
    })
  ];
}

function summaryFor(status: DecisionShadowLoopAutopilotStatus, action: DecisionShadowLoopAutopilot["selectedAction"]): string {
  if (status === "ready-readonly") return `Shadow loop autopilot selected a read-only action: ${action.label}.`;
  if (status === "waiting-observation") return `Shadow loop autopilot is waiting for proof before ${action.label}.`;
  if (status === "repair-required") return `Shadow loop autopilot requires repair: ${action.reason}`;
  return `Shadow loop autopilot is holding: ${action.reason}`;
}

export function buildDecisionShadowLoopAutopilot({
  interpreter,
  now = new Date()
}: {
  interpreter: DecisionShadowLoopContinuityReceiptInterpreter;
  now?: Date;
}): DecisionShadowLoopAutopilot {
  const cycle = cycleFor(interpreter);
  const selectedAction = actionFor(interpreter, cycle);
  const status = statusFor(selectedAction, interpreter);
  const phases = phasesFor(interpreter, selectedAction, cycle);
  const memoryContent = compact(
    [
      `status:${status}`,
      `action:${selectedAction.id}`,
      `proof:${interpreter.input.proofHash ?? "pending"}`,
      `turns-left:${cycle.remainingShadowTurns}`,
      `learned:${interpreter.interpretation.learned}`
    ].join(" | "),
    420
  );
  const autopilotHash = stableHash({
    date: interpreter.date,
    sport: interpreter.sport,
    interpreter: interpreter.interpreterHash,
    status,
    action: [selectedAction.id, selectedAction.safeToRun, selectedAction.verifyUrl],
    proof: interpreter.input.proofHash,
    cycle: [cycle.usedShadowTurns, cycle.remainingShadowTurns],
    phases: phases.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: interpreter.date,
    sport: interpreter.sport,
    mode: "decision-shadow-loop-autopilot",
    status,
    autopilotHash,
    summary: summaryFor(status, selectedAction),
    input: {
      interpreterHash: interpreter.interpreterHash,
      interpreterStatus: interpreter.status,
      proofHash: interpreter.input.proofHash,
      observedMode: interpreter.input.observedMode
    },
    cycle,
    selectedAction,
    phases,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_autopilot",
      evidenceHash: interpreter.input.proofHash,
      content: memoryContent
    },
    controls: {
      canRunSelectedReadOnlyAction: selectedAction.safeToRun,
      canExecuteShell: false,
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
      "/api/sports/decision/shadow-loop-autopilot",
      selectedAction.verifyUrl,
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow loop autopilot can select one read-only local proof action only.",
      "It cannot execute shell, persist memory, write decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      "Autopilot memory is response-local until outcome, training, and promotion gates approve persistence.",
      "Autopilot output is a public control board, not hidden chain-of-thought.",
      ...interpreter.locks
    ])
  };
}
