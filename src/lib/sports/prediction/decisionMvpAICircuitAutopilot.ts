import type { DecisionMvpAICircuitStage, DecisionMvpAICircuitState } from "@/lib/sports/prediction/decisionMvpAICircuitState";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMvpAICircuitAutopilotStatus = "ready-readonly" | "waiting-provider" | "repair-required" | "holding";
export type DecisionMvpAICircuitAutopilotActionId = "inspect-provider-evidence" | "observe-experiment" | "review-memory" | "repair-stage" | "hold";
export type DecisionMvpAICircuitAutopilotPhaseId = "sense" | "choose" | "guard" | "act" | "learn";
export type DecisionMvpAICircuitAutopilotPhaseStatus = "pass" | "watch" | "block";

export type DecisionMvpAICircuitAutopilotPhase = {
  id: DecisionMvpAICircuitAutopilotPhaseId;
  label: string;
  status: DecisionMvpAICircuitAutopilotPhaseStatus;
  evidence: string[];
  conclusion: string;
  nextAction: string;
};

export type DecisionMvpAICircuitAutopilot = {
  generatedAt: string;
  date: string;
  sport: DecisionMvpAICircuitState["sport"];
  mode: "decision-mvp-ai-circuit-autopilot";
  status: DecisionMvpAICircuitAutopilotStatus;
  autopilotHash: string;
  summary: string;
  input: {
    circuitHash: string;
    circuitStatus: DecisionMvpAICircuitState["status"];
    currentStageId: string;
    firstBlockerProofUrl: string;
  };
  selectedAction: {
    id: DecisionMvpAICircuitAutopilotActionId;
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    canAutoRunReadOnly: boolean;
    reason: string;
    expectedEvidence: string;
  };
  phases: DecisionMvpAICircuitAutopilotPhase[];
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunSelectedReadOnlyAction: boolean;
    canExecuteShell: false;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteProviderRows: false;
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function isSafeReadOnlyUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("/api/sports/decision/") &&
    !lower.includes("persist=1") &&
    !lower.includes("persist=true") &&
    !lower.includes("publish=1") &&
    !lower.includes("publish=true") &&
    !lower.includes("dryrun=0") &&
    !lower.includes("dryrun=false") &&
    !lower.includes("train=1") &&
    !lower.includes("stake=1") &&
    !lower.includes("deploy")
  );
}

function firstStage(circuitState: DecisionMvpAICircuitState, predicate: (stage: DecisionMvpAICircuitStage) => boolean): DecisionMvpAICircuitStage | null {
  return circuitState.stages.find(predicate) ?? null;
}

function actionFor(circuitState: DecisionMvpAICircuitState): DecisionMvpAICircuitAutopilot["selectedAction"] {
  const current = firstStage(circuitState, (stage) => stage.id === circuitState.progress.currentStageId) ?? circuitState.stages[0];
  const blocker = firstStage(circuitState, (stage) => stage.status === "block") ?? current;
  const memoryStage = firstStage(circuitState, (stage) => stage.id === "experiment-memory");
  const observerStage = firstStage(circuitState, (stage) => stage.id === "experiment-observer");

  if (!blocker) {
    return {
      id: "hold",
      label: "Hold circuit",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-circuit-state",
      safeToRun: false,
      canAutoRunReadOnly: false,
      reason: "No circuit stage is available.",
      expectedEvidence: "Rebuild the MVP AI circuit state."
    };
  }

  if (blocker.id === "provider-evidence") {
    const verifyUrl = circuitState.providerMinimum.proofUrl || blocker.proofUrl;
    const safeToRun = isSafeReadOnlyUrl(verifyUrl);
    return {
      id: "inspect-provider-evidence",
      label: "Inspect provider evidence blocker",
      command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      safeToRun,
      canAutoRunReadOnly: safeToRun,
      reason: compact(blocker.detail),
      expectedEvidence: compact(circuitState.providerMinimum.nextAction)
    };
  }

  if (observerStage && observerStage.status === "watch") {
    const verifyUrl = observerStage.proofUrl;
    const safeToRun = isSafeReadOnlyUrl(verifyUrl);
    return {
      id: "observe-experiment",
      label: "Observe MVP experiment",
      command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      safeToRun,
      canAutoRunReadOnly: safeToRun,
      reason: compact(observerStage.detail),
      expectedEvidence: "Observer returns support, warning, contradiction, block, or hold evidence with no model or public effect."
    };
  }

  if (memoryStage && memoryStage.status !== "pass") {
    const verifyUrl = memoryStage.proofUrl;
    const safeToRun = isSafeReadOnlyUrl(verifyUrl);
    return {
      id: "review-memory",
      label: "Review experiment memory",
      command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      safeToRun,
      canAutoRunReadOnly: safeToRun && memoryStage.status === "watch",
      reason: compact(memoryStage.detail),
      expectedEvidence: "Memory exposes learned signal, remaining doubt, next safe move, and locks."
    };
  }

  return {
    id: blocker.status === "block" ? "repair-stage" : "hold",
    label: blocker.status === "block" ? `Repair ${blocker.label}` : "Hold circuit",
    command: null,
    verifyUrl: blocker.proofUrl,
    safeToRun: false,
    canAutoRunReadOnly: false,
    reason: compact(blocker.detail),
    expectedEvidence: compact(blocker.unlocks.join(", ") || circuitState.nextAction.expectedEvidence)
  };
}

function statusFor(action: DecisionMvpAICircuitAutopilot["selectedAction"], circuitState: DecisionMvpAICircuitState): DecisionMvpAICircuitAutopilotStatus {
  if (action.id === "inspect-provider-evidence") return "waiting-provider";
  if (action.id === "repair-stage") return "repair-required";
  if (action.safeToRun) return "ready-readonly";
  return circuitState.status === "shadow-ready" ? "holding" : "repair-required";
}

function phase(input: DecisionMvpAICircuitAutopilotPhase): DecisionMvpAICircuitAutopilotPhase {
  return {
    ...input,
    evidence: unique(input.evidence, 8),
    conclusion: compact(input.conclusion),
    nextAction: compact(input.nextAction)
  };
}

function phasesFor(
  circuitState: DecisionMvpAICircuitState,
  action: DecisionMvpAICircuitAutopilot["selectedAction"]
): DecisionMvpAICircuitAutopilotPhase[] {
  const current = firstStage(circuitState, (stage) => stage.id === circuitState.progress.currentStageId);
  return [
    phase({
      id: "sense",
      label: "Sense circuit",
      status: circuitState.status === "shadow-ready" ? "pass" : circuitState.progress.firstBlocker ? "watch" : "block",
      evidence: [circuitState.circuitHash, circuitState.status, `${circuitState.progress.completedStages}/${circuitState.progress.totalStages}`],
      conclusion: circuitState.summary,
      nextAction: circuitState.nextAction.expectedEvidence
    }),
    phase({
      id: "choose",
      label: "Choose next action",
      status: action.id === "hold" ? "watch" : action.id === "repair-stage" ? "block" : "pass",
      evidence: [action.id, action.verifyUrl, action.reason],
      conclusion: `Selected ${action.label}.`,
      nextAction: action.expectedEvidence
    }),
    phase({
      id: "guard",
      label: "Check controls",
      status:
        circuitState.allowedActions.canPublishPicks ||
        circuitState.allowedActions.canTrainModels ||
        circuitState.allowedActions.canPersistDecisions ||
        circuitState.allowedActions.canPersistTrainingRows ||
        circuitState.allowedActions.canStake ||
        circuitState.allowedActions.canUseHiddenChainOfThought
          ? "block"
          : "pass",
      evidence: [
        `publish:${circuitState.allowedActions.canPublishPicks}`,
        `train:${circuitState.allowedActions.canTrainModels}`,
        `persist:${circuitState.allowedActions.canPersistDecisions}`,
        `stake:${circuitState.allowedActions.canStake}`,
        `cot:${circuitState.allowedActions.canUseHiddenChainOfThought}`
      ],
      conclusion: "Autopilot can choose read-only inspection only.",
      nextAction: "Keep all public, training, persistence, staking, and hidden-reasoning controls locked."
    }),
    phase({
      id: "act",
      label: "Prepare action",
      status: action.safeToRun ? "pass" : action.id === "repair-stage" ? "block" : "watch",
      evidence: [action.verifyUrl, `safe:${action.safeToRun}`, `auto:${action.canAutoRunReadOnly}`],
      conclusion: action.reason,
      nextAction: action.expectedEvidence
    }),
    phase({
      id: "learn",
      label: "Draft local memory",
      status: "watch",
      evidence: [current?.evidenceHash ?? circuitState.circuitHash, circuitState.progress.currentStageId, circuitState.allowedActions.allowedScope],
      conclusion: "Autopilot can draft response-local memory only.",
      nextAction: "Persist nothing until Supabase, outcome labels, calibration, and promotion gates clear."
    })
  ];
}

function summaryFor(status: DecisionMvpAICircuitAutopilotStatus, action: DecisionMvpAICircuitAutopilot["selectedAction"]): string {
  if (status === "ready-readonly") return `MVP AI circuit autopilot selected one read-only action: ${action.label}.`;
  if (status === "waiting-provider") return `MVP AI circuit autopilot is waiting on provider evidence: ${action.reason}`;
  if (status === "repair-required") return `MVP AI circuit autopilot requires repair before action: ${action.reason}`;
  return `MVP AI circuit autopilot is holding: ${action.reason}`;
}

export function buildDecisionMvpAICircuitAutopilot({
  circuitState,
  now = new Date()
}: {
  circuitState: DecisionMvpAICircuitState;
  now?: Date;
}): DecisionMvpAICircuitAutopilot {
  const selectedAction = actionFor(circuitState);
  const status = statusFor(selectedAction, circuitState);
  const phases = phasesFor(circuitState, selectedAction);
  const memoryContent = compact(
    [
      `status:${status}`,
      `action:${selectedAction.id}`,
      `stage:${circuitState.progress.currentStageId}`,
      `blocker:${circuitState.progress.firstBlocker}`,
      `scope:${circuitState.allowedActions.allowedScope}`
    ].join(" | "),
    460
  );
  const autopilotHash = stableHash({
    date: circuitState.date,
    sport: circuitState.sport,
    circuit: circuitState.circuitHash,
    status,
    action: [selectedAction.id, selectedAction.safeToRun, selectedAction.verifyUrl],
    phases: phases.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: circuitState.date,
    sport: circuitState.sport,
    mode: "decision-mvp-ai-circuit-autopilot",
    status,
    autopilotHash,
    summary: summaryFor(status, selectedAction),
    input: {
      circuitHash: circuitState.circuitHash,
      circuitStatus: circuitState.status,
      currentStageId: circuitState.progress.currentStageId,
      firstBlockerProofUrl: circuitState.progress.firstBlockerProofUrl
    },
    selectedAction,
    phases,
    memoryDraft: {
      canPersist: false,
      label: "mvp_ai_circuit_autopilot",
      evidenceHash: circuitState.circuitHash,
      content: memoryContent
    },
    controls: {
      canRunSelectedReadOnlyAction: selectedAction.safeToRun,
      canExecuteShell: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteProviderRows: false,
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
      "/api/sports/decision/mvp-ai-circuit-autopilot",
      "/api/sports/decision/mvp-ai-circuit-state",
      selectedAction.verifyUrl,
      ...circuitState.proofUrls
    ]),
    locks: unique([
      "MVP AI circuit autopilot selects one read-only local proof action only.",
      "It cannot execute shell, persist memory, write provider rows, persist decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      "Autopilot memory is response-local until Supabase, outcome labels, calibration, and promotion gates approve persistence.",
      "Autopilot output is public control state, not hidden chain-of-thought.",
      ...circuitState.locks
    ])
  };
}
