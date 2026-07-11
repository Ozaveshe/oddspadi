import type { DecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import type { DecisionAgentKernel } from "@/lib/sports/prediction/decisionAgentKernel";
import type { DecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import type { DecisionAutopilot, DecisionAutopilotActionStatus } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionDataIntakeItem, DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionTraceLedger, DecisionTraceReplayStep } from "@/lib/sports/prediction/decisionTraceLedger";
import type { Sport } from "@/lib/sports/types";

export type DecisionAgentRuntimeStatus = "blocked" | "manual-proof" | "ready-readonly" | "ready-ai-review" | "live-ready";
export type DecisionAgentRuntimeMode = "safe-hold" | "manual-proof" | "read-only-autopilot" | "openai-review" | "live-ready";
export type DecisionAgentRuntimePhaseId = "sense" | "think" | "review" | "decide" | "execute" | "verify" | "learn";
export type DecisionAgentRuntimePhaseStatus = "pass" | "watch" | "block";
export type DecisionAgentRuntimeCommandKind = "provider" | "ai-review" | "proof" | "verification" | "learning";
export type DecisionAgentRuntimeCommandStatus = "ready" | "waiting" | "blocked";

export type DecisionAgentRuntimePhase = {
  id: DecisionAgentRuntimePhaseId;
  label: string;
  status: DecisionAgentRuntimePhaseStatus;
  state: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAgentRuntimeCommand = {
  id: string;
  kind: DecisionAgentRuntimeCommandKind;
  status: DecisionAgentRuntimeCommandStatus;
  label: string;
  command: string | null;
  verifyUrl: string | null;
  expectedEvidence: string;
  missingEnv: string[];
  source: string;
  safeMode: "read-only" | "dry-run" | "not-runnable";
  canRunNow: boolean;
};

export type DecisionAgentRuntimeLock = {
  id: "supabase-writes" | "public-publishing" | "outcome-learning" | "provider-backfill" | "openai-review";
  locked: boolean;
  reason: string;
  unlockEvidence: string;
};

export type DecisionAgentRuntime = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAgentRuntimeStatus;
  mode: DecisionAgentRuntimeMode;
  runtimeHash: string;
  summary: string;
  activeTurn: {
    turnId: string;
    kernelHash: string;
    activeMatch: string | null;
    authorizedAction: string;
    source: string;
  };
  permissions: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canAskOpenAI: boolean;
    canUseProviderReads: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
  };
  phases: DecisionAgentRuntimePhase[];
  commands: DecisionAgentRuntimeCommand[];
  locks: DecisionAgentRuntimeLock[];
  nextCommand: DecisionAgentRuntimeCommand | null;
  blockedBy: string[];
  proof: {
    activationStatus: DecisionActivationAudit["status"];
    activationScore: number;
    activationNextGate: string | null;
    autopilotStatus: DecisionAutopilot["status"];
    traceStatus: DecisionTraceLedger["status"];
    traceId: string;
    orchestratorStatus: DecisionAIOrchestrator["status"];
  };
  guardrails: string[];
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

function unique(values: string[], limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function commandSafeMode(command: string | null): DecisionAgentRuntimeCommand["safeMode"] {
  if (!command) return "not-runnable";
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return "not-runnable";
  if (lower.includes("persist=1") || lower.includes("persist=true")) return "not-runnable";
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return "not-runnable";
  if (lower.includes("-x post") || lower.includes("-xpost")) return lower.includes("dryrun=1") ? "dry-run" : "not-runnable";
  return "read-only";
}

function commandStatus({
  missingEnv,
  safeMode,
  preferredStatus = "ready"
}: {
  missingEnv: string[];
  safeMode: DecisionAgentRuntimeCommand["safeMode"];
  preferredStatus?: DecisionAgentRuntimeCommandStatus;
}): DecisionAgentRuntimeCommandStatus {
  if (missingEnv.length || safeMode === "not-runnable") return "blocked";
  return preferredStatus;
}

function command(input: Omit<DecisionAgentRuntimeCommand, "safeMode" | "canRunNow">): DecisionAgentRuntimeCommand {
  const safeMode = commandSafeMode(input.command);
  return {
    ...input,
    safeMode,
    canRunNow: input.status === "ready" && input.missingEnv.length === 0 && safeMode !== "not-runnable"
  };
}

function commandFromDataIntake(item: DecisionDataIntakeItem | null): DecisionAgentRuntimeCommand | null {
  if (!item) return null;
  const safeMode = commandSafeMode(item.command);
  return command({
    id: `provider-${item.category}`,
    kind: "provider",
    status: commandStatus({
      missingEnv: item.missingEnv,
      safeMode,
      preferredStatus: item.status === "needs-provider" ? "ready" : item.status === "watch" || item.status === "ready" ? "waiting" : "blocked"
    }),
    label: item.label,
    command: item.command,
    verifyUrl: item.verifyUrl,
    expectedEvidence: item.expectedEvidence,
    missingEnv: item.missingEnv,
    source: `data-intake:${item.category}`
  });
}

function commandFromOrchestrator(orchestrator: DecisionAIOrchestrator): DecisionAgentRuntimeCommand | null {
  const target = orchestrator.activeTarget;
  if (!target) return null;
  const safeMode = commandSafeMode(target.command);
  return command({
    id: `ai-${target.scope}`,
    kind: "ai-review",
    status: commandStatus({
      missingEnv: target.missingEnv,
      safeMode,
      preferredStatus: orchestrator.status === "ready-to-review" || orchestrator.status === "reviewed" ? "ready" : "blocked"
    }),
    label: target.label,
    command: target.command,
    verifyUrl: target.verifyUrl,
    expectedEvidence: target.expectedEvidence,
    missingEnv: target.missingEnv,
    source: `ai-orchestrator:${target.scope}`
  });
}

function commandFromAutopilot(autopilot: DecisionAutopilot): DecisionAgentRuntimeCommand | null {
  const action = autopilot.nextAction;
  if (!action) return null;
  const safeMode = commandSafeMode(action.command);
  const preferredStatus: Record<DecisionAutopilotActionStatus, DecisionAgentRuntimeCommandStatus> = {
    ready: "ready",
    waiting: "waiting",
    blocked: "blocked"
  };
  return command({
    id: `proof-${action.id}`,
    kind: "proof",
    status: commandStatus({ missingEnv: action.missingEnv, safeMode, preferredStatus: preferredStatus[action.status] }),
    label: action.label,
    command: action.command,
    verifyUrl: action.verifyUrl,
    expectedEvidence: action.expectedEvidence,
    missingEnv: action.missingEnv,
    source: action.source
  });
}

function commandFromTrace(step: DecisionTraceReplayStep | null): DecisionAgentRuntimeCommand | null {
  if (!step) return null;
  const safeMode = commandSafeMode(step.command);
  return command({
    id: `verify-${step.id}`,
    kind: "verification",
    status: commandStatus({ missingEnv: step.blockedBy, safeMode, preferredStatus: step.canReplay ? "ready" : "blocked" }),
    label: step.label,
    command: step.command,
    verifyUrl: step.verifyUrl,
    expectedEvidence: step.expectedEvidence,
    missingEnv: step.blockedBy,
    source: "trace-ledger"
  });
}

function commandFromActivation(audit: DecisionActivationAudit): DecisionAgentRuntimeCommand | null {
  const gate = audit.nextGate;
  if (!gate) return null;
  const safeMode = commandSafeMode(gate.command);
  return command({
    id: `activation-${gate.id}`,
    kind: gate.category === "learning" || gate.category === "database" ? "learning" : gate.category === "ai" ? "ai-review" : "proof",
    status: commandStatus({
      missingEnv: gate.missingEnv,
      safeMode,
      preferredStatus: gate.status === "pass" ? "ready" : gate.status === "watch" ? "waiting" : "blocked"
    }),
    label: gate.label,
    command: gate.command,
    verifyUrl: gate.verifyUrl,
    expectedEvidence: gate.requiredEvidence,
    missingEnv: gate.missingEnv,
    source: `activation-audit:${gate.id}`
  });
}

function commandSort(a: DecisionAgentRuntimeCommand, b: DecisionAgentRuntimeCommand): number {
  const statusRank = { ready: 3, waiting: 2, blocked: 1 }[b.status] - { ready: 3, waiting: 2, blocked: 1 }[a.status];
  if (statusRank !== 0) return statusRank;
  const kindRank: Record<DecisionAgentRuntimeCommandKind, number> = {
    provider: 5,
    "ai-review": 4,
    proof: 3,
    verification: 2,
    learning: 1
  };
  return kindRank[b.kind] - kindRank[a.kind] || a.id.localeCompare(b.id);
}

function buildCommands({
  dataIntake,
  orchestrator,
  autopilot,
  traceLedger,
  activationAudit
}: {
  dataIntake: DecisionDataIntakeQueue;
  orchestrator: DecisionAIOrchestrator;
  autopilot: DecisionAutopilot;
  traceLedger: DecisionTraceLedger;
  activationAudit: DecisionActivationAudit;
}): DecisionAgentRuntimeCommand[] {
  const commands = [
    commandFromDataIntake(dataIntake.nextItem),
    commandFromOrchestrator(orchestrator),
    commandFromAutopilot(autopilot),
    commandFromTrace(traceLedger.nextReplayStep),
    commandFromActivation(activationAudit)
  ].filter((item): item is DecisionAgentRuntimeCommand => Boolean(item));
  const uniqueCommands = Array.from(new Map(commands.map((item) => [`${item.kind}:${item.command ?? item.id}`, item])).values());
  return uniqueCommands.sort(commandSort);
}

function phase(input: DecisionAgentRuntimePhase): DecisionAgentRuntimePhase {
  return {
    ...input,
    evidence: unique(input.evidence, 5)
  };
}

function buildPhases({
  kernel,
  activationAudit,
  orchestrator,
  autopilot,
  dataIntake,
  traceLedger
}: {
  kernel: DecisionAgentKernel;
  activationAudit: DecisionActivationAudit;
  orchestrator: DecisionAIOrchestrator;
  autopilot: DecisionAutopilot;
  dataIntake: DecisionDataIntakeQueue;
  traceLedger: DecisionTraceLedger;
}): DecisionAgentRuntimePhase[] {
  const authorityPhase = kernel.phases.find((item) => item.id === "authorize");
  return [
    phase({
      id: "sense",
      label: "Sense",
      status: dataIntake.status === "blocked" ? "block" : dataIntake.status === "ready" ? "watch" : "pass",
      state: dataIntake.summary,
      evidence: [
        `coverage:${dataIntake.coverageScore}`,
        `provider:${dataIntake.providerReadiness.status}`,
        `mock:${dataIntake.mockSignals}`,
        `missing:${dataIntake.missingSignals}`
      ],
      nextAction: dataIntake.nextItem?.expectedEvidence ?? "Keep monitoring provider coverage."
    }),
    phase({
      id: "think",
      label: "Think",
      status: kernel.counts.block > 0 ? "block" : kernel.counts.watch > 0 ? "watch" : "pass",
      state: kernel.summary,
      evidence: [kernel.kernelHash, kernel.turnId, `mode:${kernel.mode}`],
      nextAction: kernel.nextOperation.blockedBy[0] ?? kernel.nextOperation.label
    }),
    phase({
      id: "review",
      label: "Review",
      status: orchestrator.status === "reviewed" ? "pass" : orchestrator.status === "ready-to-review" ? "watch" : "block",
      state: orchestrator.summary,
      evidence: [`openai:${orchestrator.openAiConfigured}`, `targets:${orchestrator.targets.length}`, `runs:${orchestrator.latestRun.items.length}`],
      nextAction: orchestrator.runbook.recommendedNextStep
    }),
    phase({
      id: "decide",
      label: "Decide",
      status: authorityPhase?.status ?? "block",
      state: kernel.activeDecision.reason,
      evidence: [`action:${kernel.activeDecision.authorizedAction}`, `source:${kernel.activeDecision.source}`, `posture:${kernel.activeDecision.publicPosture}`],
      nextAction: authorityPhase?.nextAction ?? "Keep authority blocked until proof clears."
    }),
    phase({
      id: "execute",
      label: "Execute",
      status: autopilot.status === "ready" ? "pass" : autopilot.status === "blocked" ? "block" : "watch",
      state: autopilot.summary,
      evidence: [`mode:${autopilot.mode}`, `ready:${autopilot.state.readyActions}`, `blocked:${autopilot.state.blockedActions}`],
      nextAction: autopilot.nextAction?.expectedEvidence ?? "Queue a safe proof action."
    }),
    phase({
      id: "verify",
      label: "Verify",
      status: traceLedger.status === "ready" ? "pass" : traceLedger.status === "watching" ? "watch" : "block",
      state: traceLedger.summary,
      evidence: [traceLedger.traceId, `pass:${traceLedger.supportedClaims}`, `block:${traceLedger.blockedClaims}`],
      nextAction: traceLedger.nextReplayStep?.expectedEvidence ?? "Produce a replayable trace before action."
    }),
    phase({
      id: "learn",
      label: "Learn",
      status: activationAudit.capabilities.historicalTraining && activationAudit.capabilities.supabaseMemory ? "pass" : "block",
      state: activationAudit.summary,
      evidence: [`score:${activationAudit.score}`, `supabase:${activationAudit.capabilities.supabaseMemory}`, `training:${activationAudit.capabilities.historicalTraining}`],
      nextAction: activationAudit.nextGate?.nextAction ?? "Keep write-mode learning disabled until activation is ready."
    })
  ];
}

function buildLocks({
  kernel,
  activationAudit,
  orchestrator
}: {
  kernel: DecisionAgentKernel;
  activationAudit: DecisionActivationAudit;
  orchestrator: DecisionAIOrchestrator;
}): DecisionAgentRuntimeLock[] {
  return [
    {
      id: "supabase-writes",
      locked: true,
      reason: activationAudit.capabilities.supabaseMemory ? "Kernel still keeps persistence locked until proof receipts clear." : "Supabase memory/schema proof is not ready for write mode.",
      unlockEvidence: "OddsPadi project target, schema, service role, memory read/write smoke, and trace payload proof all pass."
    },
    {
      id: "public-publishing",
      locked: true,
      reason: kernel.permissions.canPublish ? "Kernel allows display only after final product gates clear; publishing remains disabled in runtime." : "Kernel does not permit publishing for this turn.",
      unlockEvidence: "Kernel status ready, authority public posture candidate, provider data, governance, and invalidation gates pass."
    },
    {
      id: "outcome-learning",
      locked: true,
      reason: activationAudit.capabilities.historicalTraining ? "Training governance is ready, but runtime still waits for settlement and write proof." : "Historical training and outcome-settlement proof are not ready.",
      unlockEvidence: "Real historical fixtures, odds snapshots, outcomes, backtests, calibration, and drift checks pass governance."
    },
    {
      id: "provider-backfill",
      locked: activationAudit.status !== "ready",
      reason: activationAudit.status === "ready" ? "Provider backfill can remain dry-run or supervised." : "Provider/Supabase activation gates still block write-mode imports.",
      unlockEvidence: "Provider keys, admin token, Supabase write credentials, schema checks, and dry-run counts are reviewed."
    },
    {
      id: "openai-review",
      locked: !orchestrator.openAiConfigured || !kernel.permissions.canAskOpenAI,
      reason: orchestrator.openAiConfigured ? "OpenAI is configured but kernel or citation rules do not allow trusted submission yet." : "OPENAI_API_KEY is not configured.",
      unlockEvidence: "OpenAI env is configured, proof runner is not blocked, handoff evidence IDs pass citation validation, and firewall remains same-or-safer."
    }
  ];
}

function modeFor({
  kernel,
  activationAudit,
  orchestrator,
  autopilot
}: {
  kernel: DecisionAgentKernel;
  activationAudit: DecisionActivationAudit;
  orchestrator: DecisionAIOrchestrator;
  autopilot: DecisionAutopilot;
}): DecisionAgentRuntimeMode {
  if (activationAudit.status === "ready" && kernel.status === "ready") return "live-ready";
  if (orchestrator.status === "ready-to-review" && kernel.permissions.canAskOpenAI) return "openai-review";
  if (autopilot.canRunNow) return "read-only-autopilot";
  if (kernel.status === "blocked" || activationAudit.status === "blocked") return "safe-hold";
  return "manual-proof";
}

function statusFor(mode: DecisionAgentRuntimeMode, commands: DecisionAgentRuntimeCommand[]): DecisionAgentRuntimeStatus {
  if (mode === "live-ready") return "live-ready";
  if (mode === "openai-review") return "ready-ai-review";
  if (mode === "read-only-autopilot") return "ready-readonly";
  if (commands.some((item) => item.status === "ready")) return "manual-proof";
  return "blocked";
}

function summaryFor(status: DecisionAgentRuntimeStatus, mode: DecisionAgentRuntimeMode, nextCommand: DecisionAgentRuntimeCommand | null): string {
  if (status === "live-ready") return "Agent runtime is live-ready, but write, publish, and train permissions remain explicit gates.";
  if (status === "ready-ai-review") return `Agent runtime can request guarded OpenAI review through ${nextCommand?.label ?? "the AI review command"}.`;
  if (status === "ready-readonly") return `Agent runtime can run a read-only proof step through ${nextCommand?.label ?? "the next safe command"}.`;
  if (status === "manual-proof") return `Agent runtime is in ${mode} mode; a human can run the next safe proof command.`;
  return `Agent runtime is blocked in ${mode} mode; missing configuration or proof must clear first.`;
}

export function buildDecisionAgentRuntime({
  date,
  sport,
  kernel,
  activationAudit,
  orchestrator,
  autopilot,
  dataIntake,
  traceLedger
}: {
  date: string;
  sport: Sport;
  kernel: DecisionAgentKernel;
  activationAudit: DecisionActivationAudit;
  orchestrator: DecisionAIOrchestrator;
  autopilot: DecisionAutopilot;
  dataIntake: DecisionDataIntakeQueue;
  traceLedger: DecisionTraceLedger;
}): DecisionAgentRuntime {
  const commands = buildCommands({ dataIntake, orchestrator, autopilot, traceLedger, activationAudit });
  const nextCommand = commands.find((item) => item.status === "ready") ?? commands[0] ?? null;
  const mode = modeFor({ kernel, activationAudit, orchestrator, autopilot });
  const status = statusFor(mode, commands);
  const phases = buildPhases({ kernel, activationAudit, orchestrator, autopilot, dataIntake, traceLedger });
  const locks = buildLocks({ kernel, activationAudit, orchestrator });
  const permissions: DecisionAgentRuntime["permissions"] = {
    canRunReadOnly: commands.some((item) => item.canRunNow && item.safeMode === "read-only"),
    canRunDryRun: commands.some((item) => item.canRunNow && item.safeMode === "dry-run"),
    canAskOpenAI: kernel.permissions.canAskOpenAI && orchestrator.runbook.canRunReview,
    canUseProviderReads: dataIntake.providerBackedSignals > 0 || dataIntake.computedSignals > 0,
    canPersist: false,
    canPublish: false,
    canTrain: false
  };
  const blockedBy = unique([
    ...phases.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.nextAction}`),
    ...commands.filter((item) => item.status === "blocked").flatMap((item) => item.missingEnv.length ? item.missingEnv.map((env) => `${item.label}: missing ${env}`) : [`${item.label}: command not runnable`]),
    ...locks.filter((item) => item.locked).map((item) => `${item.id}: ${item.reason}`)
  ]);
  const runtimeHash = stableHash({
    date,
    sport,
    status,
    mode,
    kernel: kernel.kernelHash,
    activation: activationAudit.status,
    activationScore: activationAudit.score,
    orchestrator: orchestrator.status,
    autopilot: autopilot.status,
    trace: traceLedger.traceId,
    phases: phases.map((item) => [item.id, item.status]),
    commands: commands.map((item) => [item.id, item.status, item.safeMode]),
    permissions
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode,
    runtimeHash,
    summary: summaryFor(status, mode, nextCommand),
    activeTurn: {
      turnId: kernel.turnId,
      kernelHash: kernel.kernelHash,
      activeMatch: kernel.activeDecision.match,
      authorizedAction: kernel.activeDecision.authorizedAction,
      source: kernel.activeDecision.source
    },
    permissions,
    phases,
    commands,
    locks,
    nextCommand,
    blockedBy,
    proof: {
      activationStatus: activationAudit.status,
      activationScore: activationAudit.score,
      activationNextGate: activationAudit.nextGate?.id ?? null,
      autopilotStatus: autopilot.status,
      traceStatus: traceLedger.status,
      traceId: traceLedger.traceId,
      orchestratorStatus: orchestrator.status
    },
    guardrails: unique([
      "Run only read-only GETs or explicit dryRun=1 commands from this runtime.",
      "Never persist, publish, or train from runtime output while any lock is active.",
      "Never trust OpenAI text without evidence IDs, citation validation, firewall acceptance, and same-or-safer authority.",
      "Never use global Supabase tooling for OddsPadi schema changes without project-ref proof.",
      "Treat provider-backed data as required before increasing public confidence.",
      ...kernel.guardrails,
      ...activationAudit.evidenceContract.forbiddenUntilVerified
    ])
  };
}
