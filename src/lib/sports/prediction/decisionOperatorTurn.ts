import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import type { DecisionEvidenceTransition } from "@/lib/sports/prediction/decisionEvidenceTransition";
import type { DecisionMind } from "@/lib/sports/prediction/decisionMind";
import type { Sport } from "@/lib/sports/types";

export type DecisionOperatorTurnStatus = "ready-to-run" | "review-ready" | "waiting" | "blocked";
export type DecisionOperatorTurnPhaseId = "observe" | "frame" | "hypothesize" | "challenge" | "decide" | "execute" | "verify" | "learn";
export type DecisionOperatorTurnPhaseStatus = "pass" | "watch" | "block";

export type DecisionOperatorTurnPhase = {
  id: DecisionOperatorTurnPhaseId;
  label: string;
  status: DecisionOperatorTurnPhaseStatus;
  publicReason: string;
  evidence: string[];
  nextCheck: string;
};

export type DecisionOperatorTurn = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionOperatorTurnStatus;
  mode: "single-safe-operator-turn";
  turnHash: string;
  summary: string;
  objective: {
    label: string;
    match: string | null;
    capability: string | null;
    reason: string;
  };
  publicTrace: DecisionOperatorTurnPhase[];
  nextOperation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    source: string;
    expectedEvidence: string;
    safeToRun: boolean;
    runMode: "read-only" | "dry-run" | "manual-only";
  } | null;
  verification: {
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  statePatch: {
    confidence: "no-change" | "keep-capped" | "cap-low";
    trust: DecisionEvidenceTransition["decision"]["trustEffect"];
    authorizedAction: DecisionAuthority["activeDecision"]["authorizedAction"];
    publicPosture: DecisionAuthority["activeDecision"]["publicPosture"];
  };
  permissions: {
    canRunCommand: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function safeMode(command: string | null): "read-only" | "dry-run" | "manual-only" {
  if (!command) return "manual-only";
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return "manual-only";
  if (lower.includes("persist=1") || lower.includes("persist=true") || lower.includes("dryrun=0") || lower.includes("dryrun=false")) return "manual-only";
  if (lower.includes("-x post") || lower.includes("-xpost")) return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "manual-only";
  return "read-only";
}

function chooseOperation({
  contract,
  mind,
  transition,
  runtime
}: {
  contract: DecisionCapabilityContract;
  mind: DecisionMind;
  transition: DecisionEvidenceTransition;
  runtime: DecisionAgentRuntime;
}): DecisionOperatorTurn["nextOperation"] {
  const contractCommand = contract.nextSafeCommand;
  if (contractCommand?.safeToRun) {
    return {
      label: contractCommand.label,
      command: contractCommand.command,
      verifyUrl: contractCommand.verifyUrl,
      source: contractCommand.source,
      expectedEvidence: contractCommand.expectedEvidence,
      safeToRun: Boolean(contractCommand.command),
      runMode: safeMode(contractCommand.command)
    };
  }

  if (mind.nextSafeAction) {
    return {
      label: mind.nextSafeAction.label,
      command: mind.nextSafeAction.command,
      verifyUrl: mind.nextSafeAction.verifyUrl,
      source: "decision-mind",
      expectedEvidence: mind.nextSafeAction.reason,
      safeToRun: true,
      runMode: safeMode(mind.nextSafeAction.command)
    };
  }

  if (transition.nextTransition.command && transition.nextTransition.canRunNow) {
    return {
      label: transition.nextTransition.label,
      command: transition.nextTransition.command,
      verifyUrl: transition.nextTransition.verifyUrl,
      source: "evidence-transition",
      expectedEvidence: transition.nextTransition.expectedEvidence,
      safeToRun: true,
      runMode: safeMode(transition.nextTransition.command)
    };
  }

  if (runtime.nextCommand) {
    return {
      label: runtime.nextCommand.label,
      command: runtime.nextCommand.command,
      verifyUrl: runtime.nextCommand.verifyUrl,
      source: runtime.nextCommand.source,
      expectedEvidence: runtime.nextCommand.expectedEvidence,
      safeToRun: runtime.nextCommand.canRunNow,
      runMode: safeMode(runtime.nextCommand.command)
    };
  }

  return null;
}

function phase(input: DecisionOperatorTurnPhase): DecisionOperatorTurnPhase {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 5),
    nextCheck: compact(input.nextCheck)
  };
}

function buildTrace({
  contract,
  mind,
  transition,
  runtime,
  authority,
  operation
}: {
  contract: DecisionCapabilityContract;
  mind: DecisionMind;
  transition: DecisionEvidenceTransition;
  runtime: DecisionAgentRuntime;
  authority: DecisionAuthority;
  operation: DecisionOperatorTurn["nextOperation"];
}): DecisionOperatorTurnPhase[] {
  return [
    phase({
      id: "observe",
      label: "Observe",
      status: contract.status === "blocked" ? "block" : "pass",
      publicReason: contract.summary,
      evidence: [contract.contractHash, `score:${contract.liveReadinessScore}`, `locked:${contract.counts.locked}`],
      nextCheck: contract.nextCapability?.nextAction ?? "No capability check is currently selected."
    }),
    phase({
      id: "frame",
      label: "Frame",
      status: mind.status === "blocked" ? "block" : mind.status === "waiting-for-evidence" ? "watch" : "pass",
      publicReason: mind.summary,
      evidence: [mind.mindHash, mind.activeDecision.match ?? "", mind.activeDecision.source],
      nextCheck: mind.thinkingTrace.nextEvidenceAction
    }),
    phase({
      id: "hypothesize",
      label: "Hypothesize",
      status: mind.thinkingTrace.status === "supportive" ? "pass" : mind.thinkingTrace.status === "blocked" ? "block" : "watch",
      publicReason: mind.thinkingTrace.thesis,
      evidence: [`belief:${mind.thinkingTrace.beliefPressure.netScore}`, `confidence:${mind.thinkingTrace.confidenceBudget.score}`],
      nextCheck: mind.thinkingTrace.synthesis
    }),
    phase({
      id: "challenge",
      label: "Challenge",
      status: mind.thinkingTrace.beliefPressure.blocking > 0 ? "block" : mind.thinkingTrace.beliefPressure.questioning > 0 ? "watch" : "pass",
      publicReason: mind.thinkingTrace.counterThesis,
      evidence: mind.doubts.slice(0, 4),
      nextCheck: mind.changeMyMind[0] ?? "No change-my-mind evidence is currently listed."
    }),
    phase({
      id: "decide",
      label: "Decide",
      status: authority.status === "authorized" ? "pass" : authority.status === "supervised" ? "watch" : "block",
      publicReason: authority.summary,
      evidence: [authority.authorityHash, `action:${authority.activeDecision.authorizedAction}`, `posture:${authority.activeDecision.publicPosture}`],
      nextCheck: authority.control.nextSafeCommand ?? authority.control.forbiddenActions[0] ?? "Keep authority proof current."
    }),
    phase({
      id: "execute",
      label: "Execute",
      status: operation?.safeToRun && operation.runMode !== "manual-only" ? "pass" : operation ? "watch" : "block",
      publicReason: operation ? `The next bounded operation is ${operation.label} from ${operation.source}.` : "No safe operation is available.",
      evidence: [operation?.source ?? "", operation?.runMode ?? "", operation?.verifyUrl ?? ""],
      nextCheck: operation?.expectedEvidence ?? "Wait for a safe proof command."
    }),
    phase({
      id: "verify",
      label: "Verify",
      status: transition.status === "advance-ready" ? "pass" : transition.status === "retry-proof" || transition.status === "hold" ? "watch" : "block",
      publicReason: transition.summary,
      evidence: [transition.transitionHash, `next:${transition.nextTransition.label}`, `status:${transition.nextTransition.status}`],
      nextCheck: transition.nextTransition.expectedEvidence
    }),
    phase({
      id: "learn",
      label: "Learn",
      status: runtime.permissions.canTrain ? "pass" : "block",
      publicReason: runtime.summary,
      evidence: [runtime.runtimeHash, `mode:${runtime.mode}`, `learn:${runtime.permissions.canTrain}`],
      nextCheck: "Do not learn from this turn until outcome settlement, calibration, Supabase memory, and training gates open."
    })
  ];
}

function statusFor({
  contract,
  runtime,
  operation,
  trace
}: {
  contract: DecisionCapabilityContract;
  runtime: DecisionAgentRuntime;
  operation: DecisionOperatorTurn["nextOperation"];
  trace: DecisionOperatorTurnPhase[];
}): DecisionOperatorTurnStatus {
  if (runtime.permissions.canAskOpenAI && contract.status === "review-ready") return "review-ready";
  if (operation?.safeToRun && operation.runMode !== "manual-only") return "ready-to-run";
  if (trace.some((item) => item.status === "block") || contract.status === "blocked") return "blocked";
  return "waiting";
}

function confidencePatch(transition: DecisionEvidenceTransition, mind: DecisionMind): DecisionOperatorTurn["statePatch"]["confidence"] {
  if (transition.decision.confidenceEffect === "cap-low") return "cap-low";
  if (transition.decision.confidenceEffect === "keep-capped" || mind.locks.canPromote === false) return "keep-capped";
  return "no-change";
}

export function buildDecisionOperatorTurn({
  date,
  sport,
  mind,
  contract,
  transition,
  runtime,
  authority,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  mind: DecisionMind;
  contract: DecisionCapabilityContract;
  transition: DecisionEvidenceTransition;
  runtime: DecisionAgentRuntime;
  authority: DecisionAuthority;
  now?: Date;
}): DecisionOperatorTurn {
  const operation = chooseOperation({ contract, mind, transition, runtime });
  const trace = buildTrace({ contract, mind, transition, runtime, authority, operation });
  const status = statusFor({ contract, runtime, operation, trace });
  const successCriteria = unique([
    operation?.expectedEvidence,
    operation?.verifyUrl ? `Verification route returns updated proof at ${operation.verifyUrl}.` : null,
    transition.nextTransition.expectedEvidence,
    "No persistence, publishing, write backfill, or training side effect occurs."
  ]);
  const failureSignals = unique([
    operation?.runMode === "manual-only" ? "Operation is manual-only or unsafe." : null,
    ...contract.blockers.slice(0, 4),
    ...transition.nextTransition.blockedBy.slice(0, 3),
    ...runtime.blockedBy.slice(0, 3)
  ]);
  const turnHash = stableHash({
    date,
    sport,
    status,
    mind: mind.mindHash,
    contract: contract.contractHash,
    transition: transition.transitionHash,
    runtime: runtime.runtimeHash,
    authority: authority.authorityHash,
    operation: operation ? [operation.label, operation.source, operation.runMode] : null,
    trace: trace.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    mode: "single-safe-operator-turn",
    turnHash,
    summary:
      status === "ready-to-run"
        ? `Operator turn is ready to run ${operation?.label ?? "the next safe proof"} in ${operation?.runMode ?? "manual-only"} mode.`
        : status === "review-ready"
          ? "Operator turn is ready for guarded AI review, with citation/firewall/authority controls still enforced."
          : status === "waiting"
            ? "Operator turn is waiting for proof before the next command can run."
            : "Operator turn is blocked; the engine must repair proof or configuration before acting.",
    objective: {
      label: contract.nextCapability?.label ?? mind.activeDecision.match ?? "Decision proof turn",
      match: mind.activeDecision.match,
      capability: contract.nextCapability?.id ?? null,
      reason: operation?.expectedEvidence ?? contract.nextCapability?.nextAction ?? mind.thinkingTrace.nextEvidenceAction
    },
    publicTrace: trace,
    nextOperation: operation,
    verification: {
      successCriteria,
      failureSignals,
      fallbackAction:
        failureSignals[0] ??
        transition.nextTransition.blockedBy[0] ??
        contract.blockers[0] ??
        "Hold the decision state and rerun capability-contract plus evidence-transition proof."
    },
    statePatch: {
      confidence: confidencePatch(transition, mind),
      trust: transition.decision.trustEffect,
      authorizedAction: authority.activeDecision.authorizedAction,
      publicPosture: authority.activeDecision.publicPosture
    },
    permissions: {
      canRunCommand: Boolean(operation?.safeToRun && operation.runMode !== "manual-only"),
      canAskOpenAI: status === "review-ready",
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    locks: unique([
      ...mind.locks.reasons,
      ...contract.forbiddenActions,
      ...runtime.locks.filter((item) => item.locked).map((item) => `${item.id}: ${item.reason}`),
      ...authority.control.forbiddenActions
    ]),
    proofUrls: unique([
      "/api/sports/decision/operator-turn",
      "/api/sports/decision/mind",
      "/api/sports/decision/capability-contract",
      "/api/sports/decision/evidence-transition",
      operation?.verifyUrl,
      ...mind.proofUrls
    ])
  };
}
