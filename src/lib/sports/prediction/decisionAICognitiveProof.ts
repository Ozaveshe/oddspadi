import type { DecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import type { DecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import type { DecisionAIDeliberation } from "@/lib/sports/prediction/decisionAIDeliberation";
import type { DecisionAIExecutive } from "@/lib/sports/prediction/decisionAIExecutive";
import type { DecisionAIExecutiveGovernor } from "@/lib/sports/prediction/decisionAIExecutiveGovernor";
import type { DecisionAIExperimentState } from "@/lib/sports/prediction/decisionAIExperimentState";
import type { DecisionAIThoughtEpisode } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import type { DecisionAIThoughtMemory } from "@/lib/sports/prediction/decisionAIThoughtMemory";
import type { Sport } from "@/lib/sports/types";

export type DecisionAICognitiveProofStatus = "ready-shadow" | "needs-provider" | "blocked";
export type DecisionAICognitiveProofCheckStatus = "pass" | "watch" | "blocked";

export type DecisionAICognitiveProofCheck = {
  id: string;
  label: string;
  status: DecisionAICognitiveProofCheckStatus;
  detail: string;
  evidence: string[];
};

export type DecisionAICognitiveProofStage = {
  id: string;
  label: string;
  status: DecisionAICognitiveProofCheckStatus;
  source: string;
  hash: string;
  summary: string;
  nextAction: string;
};

export type DecisionAICognitiveProof = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-cognitive-proof";
  status: DecisionAICognitiveProofStatus;
  proofHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    action: string;
    stance: string;
    trustCeiling: string;
    openAiConfigured: boolean;
  };
  totals: {
    publicStages: number;
    pass: number;
    watch: number;
    blocked: number;
    checks: number;
    locks: number;
    proofUrls: number;
    memoryMatches: number;
  };
  stages: DecisionAICognitiveProofStage[];
  checks: DecisionAICognitiveProofCheck[];
  nextMove: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canRunReadOnly: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  locks: string[];
  proofUrls: string[];
};

export type DecisionAIExecutiveWithGovernor = DecisionAIExecutive & {
  governor?: DecisionAIExecutiveGovernor;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFromItems(values: Array<"pass" | "watch" | "block" | "blocked" | string | null | undefined>): DecisionAICognitiveProofCheckStatus {
  if (values.some((value) => value === "block" || value === "blocked")) return "blocked";
  if (values.some((value) => value === "watch")) return "watch";
  return "pass";
}

function proofStatus(checks: DecisionAICognitiveProofCheck[], openAiConfigured: boolean): DecisionAICognitiveProofStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (!openAiConfigured || checks.some((check) => check.status === "watch")) return "needs-provider";
  return "ready-shadow";
}

function stage(input: DecisionAICognitiveProofStage): DecisionAICognitiveProofStage {
  return {
    ...input,
    summary: compact(input.summary, 280),
    nextAction: compact(input.nextAction, 220)
  };
}

function check(input: DecisionAICognitiveProofCheck): DecisionAICognitiveProofCheck {
  return {
    ...input,
    detail: compact(input.detail, 300),
    evidence: unique(input.evidence, 8)
  };
}

function allStatuses(stages: DecisionAICognitiveProofStage[], checks: DecisionAICognitiveProofCheck[]) {
  const values = [...stages.map((item) => item.status), ...checks.map((item) => item.status)];
  return {
    pass: values.filter((value) => value === "pass").length,
    watch: values.filter((value) => value === "watch").length,
    blocked: values.filter((value) => value === "blocked").length
  };
}

function buildStages({
  cognitiveLoop,
  deliberation,
  control,
  thought,
  memory,
  experimentState,
  executive
}: {
  cognitiveLoop: DecisionAICognitiveLoop;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  thought: DecisionAIThoughtEpisode;
  memory: DecisionAIThoughtMemory;
  experimentState: DecisionAIExperimentState;
  executive: DecisionAIExecutiveWithGovernor;
}): DecisionAICognitiveProofStage[] {
  const governor = executive.governor;
  return [
    stage({
      id: "cognitive-loop",
      label: "Cognitive loop",
      status: statusFromItems(cognitiveLoop.cycle.map((item) => item.status)),
      source: cognitiveLoop.mode,
      hash: cognitiveLoop.loopHash,
      summary: cognitiveLoop.summary,
      nextAction: cognitiveLoop.nextOperation.fallbackAction
    }),
    stage({
      id: "deliberation",
      label: "Deliberation council",
      status: statusFromItems([...deliberation.panel.map((item) => item.status), ...deliberation.hypotheses.map((item) => item.status)]),
      source: deliberation.mode,
      hash: deliberation.deliberationHash,
      summary: deliberation.finalResolution.publicAnswer,
      nextAction: deliberation.nextProof.expectedEvidence
    }),
    stage({
      id: "control-packet",
      label: "Control packet",
      status: statusFromItems(control.stages.map((item) => item.status)),
      source: control.mode,
      hash: control.controlHash,
      summary: control.summary,
      nextAction: control.nextMove.expectedEvidence
    }),
    stage({
      id: "thought-episode",
      label: "Thought episode",
      status: statusFromItems(thought.thoughtChain.map((item) => item.status)),
      source: thought.mode,
      hash: thought.thoughtHash,
      summary: thought.summary,
      nextAction: thought.thoughtChain.find((item) => item.status !== "pass")?.nextAction ?? "Keep the private thought trace draft-only."
    }),
    stage({
      id: "memory-recall",
      label: "Memory recall",
      status: memory.status === "failed" ? "blocked" : memory.status === "not-configured" || memory.status === "no-memory" ? "watch" : "pass",
      source: memory.mode,
      hash: memory.memoryHash,
      summary: memory.summary,
      nextAction: memory.recall.recommendation.nextCheck
    }),
    stage({
      id: "experiment-state",
      label: "Experiment reducer",
      status: statusFromItems(experimentState.gates.map((item) => item.status)),
      source: experimentState.mode,
      hash: experimentState.stateHash,
      summary: experimentState.summary,
      nextAction: experimentState.interpretation.nextMove
    }),
    stage({
      id: "executive-decision",
      label: "Executive decision",
      status: statusFromItems(executive.phases.map((item) => item.status)),
      source: executive.mode,
      hash: executive.executiveHash,
      summary: executive.summary,
      nextAction: executive.finalDirective.reason
    }),
    stage({
      id: "executive-governor",
      label: "Executive governor",
      status: governor ? statusFromItems(governor.beliefs.map((item) => (item.status === "supported" ? "pass" : item.status === "uncertain" ? "watch" : "blocked"))) : "watch",
      source: governor?.mode ?? "ai-executive-governor",
      hash: governor?.governorHash ?? "missing-governor",
      summary: governor?.summary ?? "Executive governor was not attached to this proof packet.",
      nextAction: governor?.selectedIntent.expectedEvidence ?? "Expose or rebuild the executive governor before relying on autonomous intent selection."
    })
  ];
}

function buildChecks({
  cognitiveLoop,
  deliberation,
  control,
  thought,
  memory,
  experimentState,
  executive
}: {
  cognitiveLoop: DecisionAICognitiveLoop;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  thought: DecisionAIThoughtEpisode;
  memory: DecisionAIThoughtMemory;
  experimentState: DecisionAIExperimentState;
  executive: DecisionAIExecutiveWithGovernor;
}): DecisionAICognitiveProofCheck[] {
  const governor = executive.governor;
  const forbiddenOpen =
    control.controls.canPersist ||
    control.controls.canPublish ||
    control.controls.canTrain ||
    control.controls.canUpgradePublicAction ||
    thought.controls.canPublish ||
    thought.controls.canTrain ||
    thought.controls.canUpgradePublicAction ||
    experimentState.statePatch.mayPersist ||
    experimentState.statePatch.mayPublish ||
    experimentState.statePatch.mayTrain ||
    experimentState.statePatch.mayRaiseTrust ||
    experimentState.statePatch.mayAskOpenAI ||
    executive.controls.canPersist ||
    executive.controls.canPublish ||
    executive.controls.canTrain ||
    executive.controls.canRaiseTrust ||
    executive.controls.canUpgradePublicAction ||
    Boolean(governor?.controls.canPersist || governor?.controls.canPublish || governor?.controls.canTrain || governor?.controls.canRaiseTrust || governor?.controls.canUpgradePublicAction);

  return [
    check({
      id: "loop-complete",
      label: "Cognitive loop stages",
      status: cognitiveLoop.cycle.length >= 7 ? "pass" : "blocked",
      detail: `${cognitiveLoop.cycle.length} cognitive stage(s) are present from sense through learn.`,
      evidence: [cognitiveLoop.loopHash, ...cognitiveLoop.cycle.map((item) => item.id)]
    }),
    check({
      id: "deliberation-panel",
      label: "Deliberation panel",
      status: deliberation.panel.length >= 6 && deliberation.decisionQuestions.length >= 3 ? "pass" : "watch",
      detail: `${deliberation.panel.length} role panel(s), ${deliberation.hypotheses.length} hypothesis item(s), and ${deliberation.decisionQuestions.length} decision question(s) were reduced.`,
      evidence: [deliberation.deliberationHash, deliberation.status, deliberation.finalResolution.stance]
    }),
    check({
      id: "control-safety",
      label: "Control safety",
      status: forbiddenOpen ? "blocked" : "pass",
      detail: "AI proof controls keep persistence, publishing, training, trust raises, and public-action upgrades closed.",
      evidence: [control.controlHash, thought.thoughtHash, experimentState.stateHash, executive.executiveHash, governor?.governorHash ?? "missing-governor"]
    }),
    check({
      id: "openai-gate",
      label: "OpenAI credential gate",
      status: executive.openAiConfigured || cognitiveLoop.permissions.canSubmitToOpenAI ? "pass" : "watch",
      detail: executive.openAiConfigured
        ? "OpenAI review can be submitted only through the guarded review path."
        : "OPENAI_API_KEY is not configured, so deterministic fallback remains active and no model review can raise trust.",
      evidence: [executive.latestRun.provider, executive.latestRun.status, cognitiveLoop.activeReviewSource]
    }),
    check({
      id: "memory-audit-only",
      label: "Memory audit boundary",
      status: memory.controls.canRaiseTrust || memory.controls.canPublish || memory.controls.canTrain || memory.controls.canUpgradePublicAction ? "blocked" : "pass",
      detail: `Memory status is ${memory.status}; recall can audit but cannot raise trust or publish.`,
      evidence: [memory.memoryHash, memory.status, memory.recall.recommendation.influence]
    }),
    check({
      id: "experiment-no-side-effects",
      label: "Experiment side effects",
      status:
        experimentState.statePatch.mayAskOpenAI ||
        experimentState.statePatch.mayPersist ||
        experimentState.statePatch.mayPublish ||
        experimentState.statePatch.mayTrain ||
        experimentState.statePatch.mayRaiseTrust
          ? "blocked"
          : "pass",
      detail: `Experiment reducer action is ${experimentState.statePatch.action}; state remains shadow-only.`,
      evidence: [experimentState.stateHash, experimentState.status, experimentState.statePatch.action]
    }),
    check({
      id: "executive-boundary",
      label: "Executive boundary",
      status: governor && governor.controls.canRunReadOnly && executive.controls.canRunReadOnly ? "pass" : "watch",
      detail: governor
        ? `Governor selected ${governor.selectedIntent.id}; autonomy remains ${governor.autonomy.mode}.`
        : "Executive proof is present, but governor attachment is missing from this packet.",
      evidence: [governor?.governorHash ?? "missing-governor", governor?.selectedIntent.id ?? "missing-intent", executive.finalDirective.action]
    })
  ];
}

export function buildDecisionAICognitiveProof({
  cognitiveLoop,
  deliberation,
  control,
  thought,
  memory,
  experimentState,
  executive,
  now = new Date()
}: {
  cognitiveLoop: DecisionAICognitiveLoop;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  thought: DecisionAIThoughtEpisode;
  memory: DecisionAIThoughtMemory;
  experimentState: DecisionAIExperimentState;
  executive: DecisionAIExecutiveWithGovernor;
  now?: Date;
}): DecisionAICognitiveProof {
  const stages = buildStages({ cognitiveLoop, deliberation, control, thought, memory, experimentState, executive });
  const checks = buildChecks({ cognitiveLoop, deliberation, control, thought, memory, experimentState, executive });
  const status = proofStatus(checks, executive.openAiConfigured);
  const statusCounts = allStatuses(stages, checks);
  const locks = unique(
    [
      "Cognitive proof cannot reveal hidden chain-of-thought.",
      "Cognitive proof cannot publish picks, train models, persist memory, raise trust, stake, or upgrade public action.",
      ...cognitiveLoop.locks,
      ...experimentState.locks,
      ...executive.locks,
      ...(executive.governor?.locks ?? [])
    ],
    32
  );
  const proofUrls = unique(
    [
      "/api/sports/decision/ai-cognitive-proof",
      ...cognitiveLoop.proofUrls,
      ...deliberation.proofUrls,
      ...control.proofUrls,
      ...thought.proofUrls,
      ...memory.proofUrls,
      ...experimentState.proofUrls,
      ...executive.proofUrls,
      ...(executive.governor?.proofUrls ?? [])
    ],
    40
  );
  const proofHash = stableHash({
    date: cognitiveLoop.date,
    sport: cognitiveLoop.sport,
    status,
    stages: stages.map((item) => [item.id, item.status, item.hash]),
    checks: checks.map((item) => [item.id, item.status]),
    executive: executive.executiveHash,
    governor: executive.governor?.governorHash ?? null
  });

  return {
    generatedAt: now.toISOString(),
    date: cognitiveLoop.date,
    sport: cognitiveLoop.sport,
    mode: "ai-cognitive-proof",
    status,
    proofHash,
    summary:
      status === "ready-shadow"
        ? "AI cognitive proof is ready for supervised read-only shadow operation."
        : status === "needs-provider"
          ? "AI cognitive proof is coherent, but provider, OpenAI, memory, or proof-observation gaps still cap trust."
          : "AI cognitive proof is blocked because one or more safety or reasoning checks failed.",
    activeDecision: {
      matchId: executive.activeDecision.matchId,
      match: executive.activeDecision.match,
      action: executive.activeDecision.executiveAction,
      stance: executive.activeDecision.publicStance,
      trustCeiling: executive.activeDecision.trustCeiling,
      openAiConfigured: executive.openAiConfigured
    },
    totals: {
      publicStages: stages.length,
      pass: statusCounts.pass,
      watch: statusCounts.watch,
      blocked: statusCounts.blocked,
      checks: checks.length,
      locks: locks.length,
      proofUrls: proofUrls.length,
      memoryMatches: memory.recall.similarCount
    },
    stages,
    checks,
    nextMove: {
      label: executive.governor?.selectedIntent.label ?? executive.finalDirective.command.label,
      command: executive.governor?.selectedIntent.command ?? executive.finalDirective.command.command,
      verifyUrl: executive.governor?.selectedIntent.verifyUrl ?? executive.finalDirective.command.verifyUrl,
      safeToRun: Boolean(executive.governor?.selectedIntent.safeToRun ?? executive.finalDirective.command.safeToRun),
      reason: executive.governor?.selectedIntent.rationale ?? executive.finalDirective.reason
    },
    controls: {
      canRunReadOnly: Boolean(executive.governor?.controls.canRunReadOnly && executive.controls.canRunReadOnly),
      canAskOpenAI: Boolean(executive.governor?.controls.canAskAIReview && executive.controls.canAskOpenAI),
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    locks,
    proofUrls
  };
}

export function buildDecisionAICognitiveProofFromExecutive({
  executive,
  now = new Date()
}: {
  executive: DecisionAIExecutiveWithGovernor;
  now?: Date;
}): DecisionAICognitiveProof {
  const governor = executive.governor;
  const executiveStages: DecisionAICognitiveProofStage[] = executive.phases.map((phase) =>
    stage({
      id: `executive-${phase.id}`,
      label: phase.label,
      status: phase.status === "pass" ? "pass" : phase.status === "watch" ? "watch" : "blocked",
      source: executive.mode,
      hash: executive.executiveHash,
      summary: phase.signal,
      nextAction: phase.nextAction
    })
  );
  const stages = [
    ...executiveStages,
    stage({
      id: "executive-governor",
      label: "Executive governor",
      status: governor ? statusFromItems(governor.beliefs.map((item) => (item.status === "supported" ? "pass" : item.status === "uncertain" ? "watch" : "blocked"))) : "watch",
      source: governor?.mode ?? "ai-executive-governor",
      hash: governor?.governorHash ?? "missing-governor",
      summary: governor?.summary ?? "Executive governor was not attached to this proof packet.",
      nextAction: governor?.selectedIntent.expectedEvidence ?? executive.finalDirective.reason
    })
  ];
  const checks = [
    check({
      id: "loop-complete",
      label: "Cognitive loop stages",
      status: executive.laneStates.cognitiveLoop === "blocked" ? "watch" : "pass",
      detail: `Executive lane reports cognitive loop as ${executive.laneStates.cognitiveLoop}.`,
      evidence: [executive.executiveHash, executive.laneStates.cognitiveLoop]
    }),
    check({
      id: "deliberation-panel",
      label: "Deliberation panel",
      status: executive.laneStates.deliberation === "blocked" || executive.laneStates.deliberation === "needs-proof" ? "watch" : "pass",
      detail: `Executive lane reports deliberation as ${executive.laneStates.deliberation}.`,
      evidence: [executive.executiveHash, executive.laneStates.deliberation, executive.activeDecision.publicStance]
    }),
    check({
      id: "control-safety",
      label: "Control safety",
      status:
        executive.controls.canPersist ||
        executive.controls.canPublish ||
        executive.controls.canTrain ||
        executive.controls.canRaiseTrust ||
        executive.controls.canUpgradePublicAction ||
        Boolean(governor?.controls.canPersist || governor?.controls.canPublish || governor?.controls.canTrain || governor?.controls.canRaiseTrust || governor?.controls.canUpgradePublicAction)
          ? "blocked"
          : "pass",
      detail: "Executive and governor controls keep persistence, publishing, training, trust raises, and public-action upgrades closed.",
      evidence: [executive.executiveHash, governor?.governorHash ?? "missing-governor", executive.finalDirective.action]
    }),
    check({
      id: "openai-gate",
      label: "OpenAI credential gate",
      status: executive.openAiConfigured ? "pass" : "watch",
      detail: executive.openAiConfigured
        ? "OpenAI review can be submitted only through the guarded review path."
        : "OPENAI_API_KEY is not configured, so deterministic fallback remains active and no model review can raise trust.",
      evidence: [executive.latestRun.provider, executive.latestRun.status, executive.openAiConfigured ? "openai-configured" : "openai-missing"]
    }),
    check({
      id: "memory-audit-only",
      label: "Memory audit boundary",
      status: executive.memoryDraft.canPersist ? "blocked" : "pass",
      detail: "Executive memory remains draft-only and cannot publish, train, or raise trust.",
      evidence: [executive.memoryDraft.evidenceHash, executive.laneStates.supabaseIsolation, executive.laneStates.providerIngestion]
    }),
    check({
      id: "experiment-no-side-effects",
      label: "Experiment side effects",
      status: executive.laneStates.experiment === "blocked" ? "watch" : "pass",
      detail: `Executive lane reports experiment state as ${executive.laneStates.experiment}.`,
      evidence: [executive.executiveHash, executive.laneStates.experiment, executive.proofReceipt.status]
    }),
    check({
      id: "executive-boundary",
      label: "Executive boundary",
      status: governor && governor.controls.canRunReadOnly && executive.controls.canRunReadOnly ? "pass" : "watch",
      detail: governor ? `Governor selected ${governor.selectedIntent.id}; autonomy remains ${governor.autonomy.mode}.` : "Executive proof is present, but governor attachment is missing from this packet.",
      evidence: [governor?.governorHash ?? "missing-governor", governor?.selectedIntent.id ?? "missing-intent", executive.finalDirective.action]
    })
  ];
  const status = proofStatus(checks, executive.openAiConfigured);
  const statusCounts = allStatuses(stages, checks);
  const locks = unique(
    [
      "Cognitive proof cannot reveal hidden chain-of-thought.",
      "Cognitive proof cannot publish picks, train models, persist memory, raise trust, stake, or upgrade public action.",
      ...executive.locks,
      ...(governor?.locks ?? [])
    ],
    32
  );
  const proofUrls = unique(["/api/sports/decision/ai-cognitive-proof", ...executive.proofUrls, ...(governor?.proofUrls ?? [])], 40);
  const proofHash = stableHash({
    date: executive.date,
    sport: executive.sport,
    status,
    executive: executive.executiveHash,
    governor: governor?.governorHash ?? null,
    checks: checks.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: executive.date,
    sport: executive.sport,
    mode: "ai-cognitive-proof",
    status,
    proofHash,
    summary:
      status === "ready-shadow"
        ? "AI cognitive proof is ready for supervised read-only shadow operation."
        : status === "needs-provider"
          ? "AI cognitive proof is coherent, but provider, OpenAI, memory, or proof-observation gaps still cap trust."
          : "AI cognitive proof is blocked because one or more safety or reasoning checks failed.",
    activeDecision: {
      matchId: executive.activeDecision.matchId,
      match: executive.activeDecision.match,
      action: executive.activeDecision.executiveAction,
      stance: executive.activeDecision.publicStance,
      trustCeiling: executive.activeDecision.trustCeiling,
      openAiConfigured: executive.openAiConfigured
    },
    totals: {
      publicStages: stages.length,
      pass: statusCounts.pass,
      watch: statusCounts.watch,
      blocked: statusCounts.blocked,
      checks: checks.length,
      locks: locks.length,
      proofUrls: proofUrls.length,
      memoryMatches: 0
    },
    stages,
    checks,
    nextMove: {
      label: governor?.selectedIntent.label ?? executive.finalDirective.command.label,
      command: governor?.selectedIntent.command ?? executive.finalDirective.command.command,
      verifyUrl: governor?.selectedIntent.verifyUrl ?? executive.finalDirective.command.verifyUrl,
      safeToRun: Boolean(governor?.selectedIntent.safeToRun ?? executive.finalDirective.command.safeToRun),
      reason: governor?.selectedIntent.rationale ?? executive.finalDirective.reason
    },
    controls: {
      canRunReadOnly: Boolean(governor?.controls.canRunReadOnly && executive.controls.canRunReadOnly),
      canAskOpenAI: Boolean(governor?.controls.canAskAIReview && executive.controls.canAskOpenAI),
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    locks,
    proofUrls
  };
}
