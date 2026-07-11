import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionAIDeliberation, DecisionAIDeliberationItemStatus } from "@/lib/sports/prediction/decisionAIDeliberation";
import type { DecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIControlStatus = "live-ready" | "ready-ai-review" | "ready-readonly" | "manual-proof" | "blocked";
export type DecisionAIControlStageStatus = "pass" | "watch" | "block";
export type DecisionAIControlStageId = "sense" | "deliberate" | "authorize" | "execute" | "verify" | "learn";
export type DecisionAIControlRunMode = "read-only" | "dry-run" | "manual-only";

export type DecisionAIControlStage = {
  id: DecisionAIControlStageId;
  label: string;
  status: DecisionAIControlStageStatus;
  state: string;
  evidence: string[];
  nextCheck: string;
};

export type DecisionAIControlMove = {
  label: string;
  command: string | null;
  verifyUrl: string | null;
  source: string;
  expectedEvidence: string;
  runMode: DecisionAIControlRunMode;
  missingEnv: string[];
  canRunNow: boolean;
};

export type DecisionAIControlPacket = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-control-packet";
  status: DecisionAIControlStatus;
  controlHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    action: DecisionAIDeliberation["activeDecision"]["action"];
    stance: DecisionAIDeliberation["finalResolution"]["stance"];
    trustCeiling: DecisionAIDeliberation["activeDecision"]["trustCeiling"];
    publicPosture: DecisionAIDeliberation["activeDecision"]["publicPosture"];
  };
  scorecard: {
    runtimeStatus: DecisionAgentRuntime["status"];
    capabilityStatus: DecisionCapabilityContract["status"];
    operatorStatus: DecisionOperatorTurn["status"];
    deliberationStatus: DecisionAIDeliberation["status"];
    stagePasses: number;
    stageWatches: number;
    stageBlocks: number;
    lockedCapabilities: number;
    learningReadinessScore: number;
  };
  stages: DecisionAIControlStage[];
  nextMove: DecisionAIControlMove;
  escalation: {
    level: "hold" | "manual-proof" | "operator-review" | "ready-shadow";
    reason: string;
    unlocks: string[];
  };
  forbiddenActions: string[];
  controls: {
    canRunCommand: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
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

function compact(value: string, maxLength = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function stageStatusFromDeliberation(status: DecisionAIDeliberationItemStatus | DecisionAIDeliberation["status"]): DecisionAIControlStageStatus {
  if (status === "pass" || status === "ready-shadow") return "pass";
  if (status === "watch" || status === "needs-proof") return "watch";
  return "block";
}

function stage(input: DecisionAIControlStage): DecisionAIControlStage {
  return {
    ...input,
    state: compact(input.state, 420),
    evidence: unique(input.evidence, 6),
    nextCheck: compact(input.nextCheck, 280)
  };
}

function runMode(command: string | null): DecisionAIControlRunMode {
  if (!command) return "manual-only";
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return "manual-only";
  if (lower.includes("persist=1") || lower.includes("persist=true") || lower.includes("publish=1") || lower.includes("dryrun=0") || lower.includes("dryrun=false")) {
    return "manual-only";
  }
  if (lower.includes("-x post") || lower.includes("-xpost") || lower.includes("--request post")) {
    return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "manual-only";
  }
  return "read-only";
}

function missingEnvFromCommand(command: string | null): string[] {
  if (!command) return [];
  const placeholders = Array.from(command.matchAll(/<([A-Z0-9_]+)>/g)).map((match) => match[1]);
  return unique(placeholders, 8);
}

function canRunMove(command: string | null, mode: DecisionAIControlRunMode, missingEnv: string[]): boolean {
  return Boolean(command && mode !== "manual-only" && missingEnv.length === 0);
}

function move(input: Omit<DecisionAIControlMove, "runMode" | "missingEnv" | "canRunNow">): DecisionAIControlMove {
  const mode = runMode(input.command);
  const missingEnv = missingEnvFromCommand(input.command);
  return {
    ...input,
    runMode: mode,
    missingEnv,
    canRunNow: canRunMove(input.command, mode, missingEnv)
  };
}

function moveFromOperator(turn: DecisionOperatorTurn): DecisionAIControlMove | null {
  if (!turn.nextOperation) return null;
  return move({
    label: turn.nextOperation.label,
    command: turn.nextOperation.command,
    verifyUrl: turn.nextOperation.verifyUrl,
    source: `operator-turn:${turn.nextOperation.source}`,
    expectedEvidence: turn.nextOperation.expectedEvidence
  });
}

function moveFromRuntime(runtime: DecisionAgentRuntime): DecisionAIControlMove | null {
  if (!runtime.nextCommand) return null;
  return move({
    label: runtime.nextCommand.label,
    command: runtime.nextCommand.command,
    verifyUrl: runtime.nextCommand.verifyUrl,
    source: `runtime:${runtime.nextCommand.source}`,
    expectedEvidence: runtime.nextCommand.expectedEvidence
  });
}

function moveFromCapability(contract: DecisionCapabilityContract): DecisionAIControlMove | null {
  if (!contract.nextSafeCommand) return null;
  return move({
    label: contract.nextSafeCommand.label,
    command: contract.nextSafeCommand.command,
    verifyUrl: contract.nextSafeCommand.verifyUrl,
    source: `capability:${contract.nextSafeCommand.source}`,
    expectedEvidence: contract.nextSafeCommand.expectedEvidence
  });
}

function moveFromDeliberation(deliberation: DecisionAIDeliberation): DecisionAIControlMove {
  return move({
    label: deliberation.nextProof.label,
    command: deliberation.nextProof.command,
    verifyUrl: deliberation.nextProof.verifyUrl,
    source: "ai-deliberation",
    expectedEvidence: deliberation.nextProof.expectedEvidence
  });
}

function chooseNextMove({
  deliberation,
  runtime,
  capabilityContract,
  operatorTurn
}: {
  deliberation: DecisionAIDeliberation;
  runtime: DecisionAgentRuntime;
  capabilityContract: DecisionCapabilityContract;
  operatorTurn: DecisionOperatorTurn;
}): DecisionAIControlMove {
  const candidates = [
    moveFromOperator(operatorTurn),
    moveFromRuntime(runtime),
    moveFromCapability(capabilityContract),
    moveFromDeliberation(deliberation)
  ].filter((item): item is DecisionAIControlMove => Boolean(item));

  return (
    candidates.find((item) => item.canRunNow && item.runMode === "read-only") ??
    candidates.find((item) => item.canRunNow && item.runMode === "dry-run") ??
    candidates.find((item) => item.runMode !== "manual-only") ??
    candidates[0] ??
    move({
      label: "Inspect AI deliberation",
      command: null,
      verifyUrl: "/api/sports/decision/ai-deliberation",
      source: "ai-control",
      expectedEvidence: "A fresh AI deliberation packet with public stance and locked controls."
    })
  );
}

function buildStages({
  deliberation,
  runtime,
  capabilityContract,
  operatorTurn,
  nextMove
}: {
  deliberation: DecisionAIDeliberation;
  runtime: DecisionAgentRuntime;
  capabilityContract: DecisionCapabilityContract;
  operatorTurn: DecisionOperatorTurn;
  nextMove: DecisionAIControlMove;
}): DecisionAIControlStage[] {
  const verifyTrace = operatorTurn.publicTrace.find((item) => item.id === "verify");
  return [
    stage({
      id: "sense",
      label: "Sense runtime",
      status: runtime.status === "blocked" ? "block" : runtime.status === "manual-proof" ? "watch" : "pass",
      state: runtime.summary,
      evidence: [runtime.runtimeHash, runtime.mode, runtime.nextCommand?.id ?? "no-runtime-command"],
      nextCheck: runtime.nextCommand?.expectedEvidence ?? "Keep runtime proof current."
    }),
    stage({
      id: "deliberate",
      label: "Deliberate",
      status: stageStatusFromDeliberation(deliberation.status),
      state: deliberation.finalResolution.publicAnswer,
      evidence: [deliberation.deliberationHash, deliberation.finalResolution.stance, deliberation.activeDecision.trustCeiling],
      nextCheck: deliberation.nextProof.expectedEvidence
    }),
    stage({
      id: "authorize",
      label: "Authorize capability",
      status: capabilityContract.status === "live-ready" || capabilityContract.status === "review-ready" ? "pass" : capabilityContract.status === "proof-mode" ? "watch" : "block",
      state: capabilityContract.summary,
      evidence: [capabilityContract.contractHash, `score:${capabilityContract.liveReadinessScore}`, `locked:${capabilityContract.counts.locked}`],
      nextCheck: capabilityContract.nextCapability?.nextAction ?? "No capability unlock is selected."
    }),
    stage({
      id: "execute",
      label: "Choose bounded move",
      status: nextMove.canRunNow ? "pass" : nextMove.runMode !== "manual-only" ? "watch" : "block",
      state: `${nextMove.label} via ${nextMove.source}.`,
      evidence: [nextMove.runMode, nextMove.verifyUrl ?? "manual-verification", ...nextMove.missingEnv],
      nextCheck: nextMove.missingEnv.length ? `Configure ${nextMove.missingEnv.join(", ")}.` : nextMove.expectedEvidence
    }),
    stage({
      id: "verify",
      label: "Verify receipt",
      status: verifyTrace?.status === "pass" ? "pass" : verifyTrace?.status === "watch" ? "watch" : "block",
      state: verifyTrace?.publicReason ?? operatorTurn.verification.successCriteria[0] ?? "Verification proof has not cleared.",
      evidence: [operatorTurn.turnHash, operatorTurn.nextOperation?.verifyUrl ?? "no-operator-verify-url", nextMove.verifyUrl ?? "manual-verification"],
      nextCheck: operatorTurn.verification.successCriteria[0] ?? "Observe the next receipt before changing trust."
    }),
    stage({
      id: "learn",
      label: "Learn later",
      status: deliberation.scorecard.learningReadinessScore >= 75 && runtime.permissions.canTrain ? "pass" : "block",
      state: "Learning remains disabled until settlement, calibration, backtest, corpus, and write gates clear.",
      evidence: [`learning:${deliberation.scorecard.learningReadinessScore}`, `runtimeTrain:${runtime.permissions.canTrain}`, deliberation.activeDecision.reviewStatus],
      nextCheck: "Do not train or apply learned guardrails from this packet."
    })
  ];
}

function statusFor({
  deliberation,
  runtime,
  capabilityContract,
  operatorTurn,
  nextMove,
  stages
}: {
  deliberation: DecisionAIDeliberation;
  runtime: DecisionAgentRuntime;
  capabilityContract: DecisionCapabilityContract;
  operatorTurn: DecisionOperatorTurn;
  nextMove: DecisionAIControlMove;
  stages: DecisionAIControlStage[];
}): DecisionAIControlStatus {
  if (capabilityContract.status === "live-ready" && runtime.status === "live-ready" && deliberation.status === "ready-shadow") return "live-ready";
  if (runtime.permissions.canAskOpenAI && operatorTurn.status === "review-ready") return "ready-ai-review";
  if (nextMove.canRunNow && nextMove.runMode === "read-only") return "ready-readonly";
  if (nextMove.canRunNow || stages.some((item) => item.status === "watch")) return "manual-proof";
  return "blocked";
}

function counts(stages: DecisionAIControlStage[]) {
  return {
    passes: stages.filter((item) => item.status === "pass").length,
    watches: stages.filter((item) => item.status === "watch").length,
    blocks: stages.filter((item) => item.status === "block").length
  };
}

function escalation({
  status,
  nextMove,
  deliberation,
  capabilityContract,
  operatorTurn
}: {
  status: DecisionAIControlStatus;
  nextMove: DecisionAIControlMove;
  deliberation: DecisionAIDeliberation;
  capabilityContract: DecisionCapabilityContract;
  operatorTurn: DecisionOperatorTurn;
}): DecisionAIControlPacket["escalation"] {
  if (status === "ready-readonly" || status === "live-ready") {
    return {
      level: "ready-shadow",
      reason: `The next move can run in ${nextMove.runMode} mode.`,
      unlocks: [nextMove.expectedEvidence]
    };
  }
  if (status === "ready-ai-review") {
    return {
      level: "operator-review",
      reason: "Guarded OpenAI review is available, but same-or-safer controls still apply.",
      unlocks: ["Run AI review only through citation validation, firewall, and authority."]
    };
  }
  if (status === "manual-proof") {
    return {
      level: "manual-proof",
      reason: nextMove.missingEnv.length ? `Next move needs ${nextMove.missingEnv.join(", ")}.` : operatorTurn.verification.fallbackAction,
      unlocks: unique([nextMove.expectedEvidence, capabilityContract.nextCapability?.nextAction, deliberation.nextProof.expectedEvidence], 5)
    };
  }
  return {
    level: "hold",
    reason: deliberation.finalResolution.reason,
    unlocks: unique([deliberation.counterThesis, ...capabilityContract.blockers.slice(0, 4)], 6)
  };
}

function summaryFor(status: DecisionAIControlStatus, nextMove: DecisionAIControlMove): string {
  if (status === "live-ready") return "AI control packet is live-ready, but publish, persist, and train permissions still require explicit gates.";
  if (status === "ready-ai-review") return "AI control packet can request guarded AI review with citation, firewall, and authority controls.";
  if (status === "ready-readonly") return `AI control packet can run ${nextMove.label} as a read-only proof step.`;
  if (status === "manual-proof") return `AI control packet is waiting for manual proof before ${nextMove.label} can advance.`;
  return "AI control packet is blocked; keep the public action at avoid and repair proof/configuration first.";
}

export function buildDecisionAIControlPacket({
  deliberation,
  runtime,
  capabilityContract,
  operatorTurn,
  now = new Date()
}: {
  deliberation: DecisionAIDeliberation;
  runtime: DecisionAgentRuntime;
  capabilityContract: DecisionCapabilityContract;
  operatorTurn: DecisionOperatorTurn;
  now?: Date;
}): DecisionAIControlPacket {
  const nextMove = chooseNextMove({ deliberation, runtime, capabilityContract, operatorTurn });
  const stages = buildStages({ deliberation, runtime, capabilityContract, operatorTurn, nextMove });
  const status = statusFor({ deliberation, runtime, capabilityContract, operatorTurn, nextMove, stages });
  const stageCounts = counts(stages);
  const controls = {
    canRunCommand: nextMove.canRunNow && (status === "ready-readonly" || status === "manual-proof"),
    canAskOpenAI: status === "ready-ai-review",
    canPersist: false as const,
    canPublish: false as const,
    canTrain: false as const,
    canUpgradePublicAction: false as const
  };
  const controlHash = stableHash({
    deliberation: deliberation.deliberationHash,
    runtime: runtime.runtimeHash,
    capability: capabilityContract.contractHash,
    operator: operatorTurn.turnHash,
    status,
    nextMove: [nextMove.label, nextMove.runMode, nextMove.canRunNow],
    stages: stages.map((item) => [item.id, item.status]),
    controls
  });

  return {
    generatedAt: now.toISOString(),
    date: deliberation.date,
    sport: deliberation.sport,
    mode: "ai-control-packet",
    status,
    controlHash,
    summary: summaryFor(status, nextMove),
    activeDecision: {
      matchId: deliberation.activeDecision.matchId,
      match: deliberation.activeDecision.match,
      action: deliberation.activeDecision.action,
      stance: deliberation.finalResolution.stance,
      trustCeiling: deliberation.activeDecision.trustCeiling,
      publicPosture: deliberation.activeDecision.publicPosture
    },
    scorecard: {
      runtimeStatus: runtime.status,
      capabilityStatus: capabilityContract.status,
      operatorStatus: operatorTurn.status,
      deliberationStatus: deliberation.status,
      stagePasses: stageCounts.passes,
      stageWatches: stageCounts.watches,
      stageBlocks: stageCounts.blocks,
      lockedCapabilities: capabilityContract.counts.locked,
      learningReadinessScore: deliberation.scorecard.learningReadinessScore
    },
    stages,
    nextMove,
    escalation: escalation({ status, nextMove, deliberation, capabilityContract, operatorTurn }),
    forbiddenActions: unique(
      [
        "Do not publish, persist, train, stake, or upgrade public action from this control packet.",
        "Do not run commands that are not read-only or explicit dry-run proof commands.",
        "Do not bypass missing env placeholders with fake credentials.",
        "Do not treat shadow deliberation as a public betting recommendation.",
        ...capabilityContract.forbiddenActions,
        ...operatorTurn.locks,
        ...runtime.guardrails
      ],
      20
    ),
    controls,
    proofUrls: unique(
      [
        "/api/sports/decision/ai-control",
        "/api/sports/decision/ai-deliberation",
        "/api/sports/decision/agent-runtime",
        "/api/sports/decision/capability-contract",
        "/api/sports/decision/operator-turn",
        ...deliberation.proofUrls,
        ...operatorTurn.proofUrls
      ],
      22
    )
  };
}
