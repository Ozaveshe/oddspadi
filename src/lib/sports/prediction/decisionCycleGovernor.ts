import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import type { DecisionBrainState } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionInterventionPlanner } from "@/lib/sports/prediction/decisionInterventionPlanner";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionCycleGovernorStatus = "run-evidence" | "ask-ai-review" | "inspect-intervention" | "hold" | "blocked";
export type DecisionCycleGovernorIntentId = "run-evidence" | "ask-ai-review" | "inspect-intervention" | "inspect-brain" | "hold";
export type DecisionCycleGovernorBeliefStatus = "supported" | "uncertain" | "blocked";

export type DecisionCycleGovernorIntent = {
  id: DecisionCycleGovernorIntentId;
  label: string;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  expectedEvidence: string;
  expectedStateChange: string;
  utility: {
    informationGain: number;
    urgency: number;
    risk: number;
    lockPenalty: number;
    score: number;
  };
  blockedBy: string[];
  rationale: string;
};

export type DecisionCycleGovernorBelief = {
  id: string;
  label: string;
  status: DecisionCycleGovernorBeliefStatus;
  confidence: number;
  evidence: string[];
  implication: string;
};

export type DecisionCycleGovernor = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-cycle-governor";
  status: DecisionCycleGovernorStatus;
  governorHash: string;
  summary: string;
  selectedIntent: DecisionCycleGovernorIntent;
  intents: DecisionCycleGovernorIntent[];
  beliefs: DecisionCycleGovernorBelief[];
  doubts: string[];
  nextObservation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
  };
  autonomy: {
    mode: "supervised-readonly" | "manual-hold";
    maxCommandsThisTurn: 1;
    requiresOperator: true;
    reason: string;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunSelectedCommand: boolean;
    canRunReadOnly: boolean;
    canAskOpenAI: boolean;
    canApplyIntent: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function compact(value: string, maxLength = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = -100, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function utility({
  informationGain,
  urgency,
  risk,
  lockPenalty,
  allowed
}: {
  informationGain: number;
  urgency: number;
  risk: number;
  lockPenalty: number;
  allowed: boolean;
}): DecisionCycleGovernorIntent["utility"] {
  return {
    informationGain,
    urgency,
    risk,
    lockPenalty,
    score: clamp(allowed ? informationGain + urgency - risk - lockPenalty : -80 - risk - lockPenalty)
  };
}

function commandIsSafe(command: string | null, verifyUrl: string | null): boolean {
  if (!command || !verifyUrl) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes("/api/sports/decision/")) return false;
  if (!verifyUrl.startsWith("/api/sports/decision/")) return false;
  return ![" -x post", "-xpost", "persist=1", "publish=1", "train=1", "stake=1", "dryrun=0", "apply_migration", "supabase db push"].some((fragment) =>
    lower.includes(fragment)
  );
}

function intent(input: Omit<DecisionCycleGovernorIntent, "rationale"> & { rationale?: string }): DecisionCycleGovernorIntent {
  return {
    ...input,
    expectedEvidence: compact(input.expectedEvidence),
    expectedStateChange: compact(input.expectedStateChange),
    blockedBy: unique(input.blockedBy),
    rationale:
      input.rationale ??
      (input.safeToRun
        ? `${input.label} is selected with utility ${input.utility.score} and stays inside read-only controls.`
        : `${input.label} is held by ${input.blockedBy[0] ?? "a safety lock"}.`)
  };
}

function buildIntents({
  date,
  sport,
  brainState,
  evidenceAcquisitionPlanner,
  agentOperationQueue,
  brainReviewRunner,
  interventionPlanner
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentOperationQueue: DecisionAgentOperationQueue;
  brainReviewRunner: DecisionBrainReviewRunner;
  interventionPlanner: DecisionInterventionPlanner;
}): DecisionCycleGovernorIntent[] {
  const evidence = evidenceAcquisitionPlanner.nextCandidate;
  const operation = agentOperationQueue.nextOperation;
  const evidenceCommand = evidence?.safeToRun ? evidence.command : operation?.safeToRun ? operation.command : null;
  const evidenceVerifyUrl = evidence?.safeToRun ? evidence.verifyUrl : operation?.safeToRun ? operation.verifyUrl : null;
  const evidenceSafe = commandIsSafe(evidenceCommand, evidenceVerifyUrl);
  const aiRunUrl = `/api/sports/decision/brain-review-runner?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=12&run=1`;
  const aiCommand = brainReviewRunner.controls.canRequestOpenAI ? decisionCurlCommand(aiRunUrl) : null;
  const aiSafe = commandIsSafe(aiCommand, "/api/sports/decision/brain-review-runner");
  const interventionUrl = `/api/sports/decision/intervention-planner?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=8`;
  const interventionCommand = decisionCurlCommand(interventionUrl);
  const interventionSafe = commandIsSafe(interventionCommand, "/api/sports/decision/intervention-planner");
  const brainUrl = `/api/sports/decision/brain-state?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=8`;

  return [
    intent({
      id: "run-evidence",
      label: evidence?.label ?? operation?.label ?? "Run next evidence proof",
      command: evidenceCommand,
      verifyUrl: evidenceVerifyUrl,
      safeToRun: evidenceSafe,
      expectedEvidence: evidence?.expectedEvidence ?? operation?.expectedEvidence ?? "Read-only evidence proof changes a blocker, watch item, or belief revision.",
      expectedStateChange: "Evidence pressure can reduce, raise, or block the active thesis before any public action changes.",
      utility: utility({
        informationGain: evidence?.informationGainScore ?? 35,
        urgency: brainState.pressure.evidenceDebt,
        risk: 8,
        lockPenalty: evidenceSafe ? 0 : 24,
        allowed: evidenceSafe
      }),
      blockedBy: evidenceSafe ? [] : unique([...(evidence?.missingEnv ?? []), ...(evidence?.blockers ?? []), ...(operation?.blockedBy ?? []), "no safe read-only evidence command"]),
      rationale: "The governor prioritizes evidence because it can change the active belief without write, publish, train, or staking permissions."
    }),
    intent({
      id: "ask-ai-review",
      label: "Run guarded brain review",
      command: aiCommand,
      verifyUrl: "/api/sports/decision/brain-review-runner",
      safeToRun: aiSafe,
      expectedEvidence: "Same-or-safer OpenAI brain review returns valid JSON with never permissions.",
      expectedStateChange: "AI can critique or downgrade the thesis, but cannot upgrade public action or persist state.",
      utility: utility({
        informationGain: brainReviewRunner.status === "reviewed" ? 8 : 54,
        urgency: brainState.status === "waiting-ai-quota" ? 28 : 16,
        risk: 18,
        lockPenalty: aiSafe ? 0 : 30,
        allowed: aiSafe
      }),
      blockedBy: aiSafe ? [] : unique([brainReviewRunner.latestRun.reason, brainReviewRunner.summary, ...brainReviewRunner.locks.slice(0, 3)]),
      rationale: "AI review is useful only when the same-or-safer runner is available and no quota/config lock blocks it."
    }),
    intent({
      id: "inspect-intervention",
      label: "Inspect intervention scenarios",
      command: interventionCommand,
      verifyUrl: "/api/sports/decision/intervention-planner",
      safeToRun: interventionSafe,
      expectedEvidence: interventionPlanner.activeScenario?.evidenceNeeded ?? interventionPlanner.summary,
      expectedStateChange: "The next intervention scenario explains whether evidence would strengthen, monitor, downgrade, or block the thesis.",
      utility: utility({
        informationGain: interventionPlanner.totals.averageInformationGain,
        urgency: interventionPlanner.status === "blocked" ? 34 : interventionPlanner.status === "needs-evidence" ? 22 : 10,
        risk: 4,
        lockPenalty: interventionSafe ? 0 : 16,
        allowed: interventionSafe
      }),
      blockedBy: interventionSafe ? [] : interventionPlanner.locks.slice(0, 4),
      rationale: "Intervention inspection is the safest fallback when evidence or OpenAI cannot run yet."
    }),
    intent({
      id: "inspect-brain",
      label: "Inspect brain state",
      command: decisionCurlCommand(brainUrl),
      verifyUrl: "/api/sports/decision/brain-state",
      safeToRun: true,
      expectedEvidence: brainState.nextMove.expectedEvidence,
      expectedStateChange: "Operator sees the active thesis, pressure, next move, and safety locks before running anything.",
      utility: utility({
        informationGain: 28,
        urgency: brainState.pressure.blockerCount * 12 + brainState.pressure.watchCount * 6,
        risk: 2,
        lockPenalty: 0,
        allowed: true
      }),
      blockedBy: [],
      rationale: "Brain inspection is always safe and helps a human operator understand why the cycle chose its next intent."
    }),
    intent({
      id: "hold",
      label: "Hold supervised cycle",
      command: null,
      verifyUrl: null,
      safeToRun: false,
      expectedEvidence: "No command runs; operator resolves configuration, quota, Supabase isolation, or provider access first.",
      expectedStateChange: "The cycle stays frozen with all side effects locked.",
      utility: utility({
        informationGain: 0,
        urgency: brainState.pressure.blockerCount * 8,
        risk: 0,
        lockPenalty: 0,
        allowed: true
      }),
      blockedBy: [],
      rationale: "Hold is the fallback when every useful command is blocked or unsafe."
    })
  ].sort((a, b) => b.utility.score - a.utility.score);
}

function belief(input: DecisionCycleGovernorBelief): DecisionCycleGovernorBelief {
  return {
    ...input,
    confidence: clamp(input.confidence, 0, 100),
    evidence: unique(input.evidence, 6),
    implication: compact(input.implication)
  };
}

function buildBeliefs({
  brainState,
  beliefLedger,
  interventionPlanner,
  brainReviewRunner
}: {
  brainState: DecisionBrainState;
  beliefLedger: DecisionBayesianBeliefLedger;
  interventionPlanner: DecisionInterventionPlanner;
  brainReviewRunner: DecisionBrainReviewRunner;
}): DecisionCycleGovernorBelief[] {
  return [
    belief({
      id: "active-thesis",
      label: "Active thesis",
      status: brainState.status === "blocked" ? "blocked" : brainState.status === "ready-readonly" ? "supported" : "uncertain",
      confidence: brainState.pressure.readinessScore,
      evidence: unique([brainState.brainHash, brainState.activeThesis.match, brainState.activeThesis.selection]),
      implication: brainState.activeThesis.reason
    }),
    belief({
      id: "belief-ledger",
      label: "Bayesian ledger",
      status: beliefLedger.status === "blocked" ? "blocked" : beliefLedger.status === "supported" ? "supported" : "uncertain",
      confidence: 100 - beliefLedger.totals.averageUncertainty,
      evidence: unique([beliefLedger.ledgerHash, beliefLedger.activeBelief?.id, beliefLedger.activeBelief?.summary]),
      implication: beliefLedger.summary
    }),
    belief({
      id: "intervention-pressure",
      label: "Intervention pressure",
      status: interventionPlanner.status === "blocked" ? "blocked" : interventionPlanner.status === "ready-readonly" ? "supported" : "uncertain",
      confidence: Math.max(0, 100 - interventionPlanner.totals.block * 18 - interventionPlanner.totals.downgrade * 10),
      evidence: unique([interventionPlanner.plannerHash, interventionPlanner.activeScenario?.id, interventionPlanner.activeScenario?.outcome]),
      implication: interventionPlanner.summary
    }),
    belief({
      id: "ai-review",
      label: "AI review",
      status: brainReviewRunner.status === "reviewed" ? "supported" : brainReviewRunner.status === "blocked" ? "blocked" : "uncertain",
      confidence: brainReviewRunner.status === "reviewed" ? 78 : brainReviewRunner.controls.canRequestOpenAI ? 54 : 28,
      evidence: [brainReviewRunner.runnerHash, brainReviewRunner.latestRun.status, brainReviewRunner.appliedReview.verdict],
      implication: brainReviewRunner.summary
    })
  ];
}

function statusFor(selected: DecisionCycleGovernorIntent, beliefs: DecisionCycleGovernorBelief[]): DecisionCycleGovernorStatus {
  if (beliefs.some((item) => item.status === "blocked") && selected.id === "hold") return "blocked";
  if (selected.id === "run-evidence" && selected.safeToRun) return "run-evidence";
  if (selected.id === "ask-ai-review" && selected.safeToRun) return "ask-ai-review";
  if (selected.id === "inspect-intervention" || selected.id === "inspect-brain") return "inspect-intervention";
  if (selected.id === "hold") return beliefs.some((item) => item.status === "blocked") ? "blocked" : "hold";
  return "hold";
}

function summaryFor(status: DecisionCycleGovernorStatus, selected: DecisionCycleGovernorIntent): string {
  if (status === "run-evidence") return `Cycle governor selected the next safe evidence command: ${selected.label}.`;
  if (status === "ask-ai-review") return "Cycle governor selected a guarded same-or-safer OpenAI brain review.";
  if (status === "inspect-intervention") return `Cycle governor selected a read-only inspection step: ${selected.label}.`;
  if (status === "blocked") return "Cycle governor is blocked; it will not run commands until evidence, quota, or safety locks clear.";
  return "Cycle governor is holding the supervised decision loop.";
}

export function buildDecisionCycleGovernor({
  date,
  sport,
  brainState,
  beliefLedger,
  evidenceAcquisitionPlanner,
  agentOperationQueue,
  brainReviewRunner,
  interventionPlanner,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  beliefLedger: DecisionBayesianBeliefLedger;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentOperationQueue: DecisionAgentOperationQueue;
  brainReviewRunner: DecisionBrainReviewRunner;
  interventionPlanner: DecisionInterventionPlanner;
  now?: Date;
}): DecisionCycleGovernor {
  const intents = buildIntents({
    date,
    sport,
    brainState,
    evidenceAcquisitionPlanner,
    agentOperationQueue,
    brainReviewRunner,
    interventionPlanner
  });
  const beliefs = buildBeliefs({ brainState, beliefLedger, interventionPlanner, brainReviewRunner });
  const selectedIntent = intents.find((item) => item.safeToRun) ?? intents.find((item) => item.id === "hold") ?? intents[0];
  const status = statusFor(selectedIntent, beliefs);
  const governorHash = stableHash({
    date,
    sport,
    brain: brainState.brainHash,
    belief: beliefLedger.ledgerHash,
    intervention: interventionPlanner.plannerHash,
    runner: brainReviewRunner.runnerHash,
    selected: [selectedIntent.id, selectedIntent.utility.score, selectedIntent.safeToRun],
    beliefs: beliefs.map((item) => [item.id, item.status, item.confidence])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-cycle-governor",
    status,
    governorHash,
    summary: summaryFor(status, selectedIntent),
    selectedIntent,
    intents,
    beliefs,
    doubts: unique([
      ...brainState.selfCritique,
      interventionPlanner.activeScenario?.ifMissing,
      brainReviewRunner.latestRun.reason,
      evidenceAcquisitionPlanner.nextCandidate?.ifMissing
    ], 10),
    nextObservation: {
      label: selectedIntent.label,
      command: selectedIntent.safeToRun ? selectedIntent.command : null,
      verifyUrl: selectedIntent.verifyUrl,
      expectedEvidence: selectedIntent.expectedEvidence
    },
    autonomy: {
      mode: selectedIntent.safeToRun ? "supervised-readonly" : "manual-hold",
      maxCommandsThisTurn: 1,
      requiresOperator: true,
      reason: selectedIntent.safeToRun
        ? "The governor can propose one read-only command, but an operator must run it."
        : "The governor is holding because no selected command is safe to run."
    },
    memoryDraft: {
      canPersist: false,
      label: `Cycle ${status} for ${brainState.activeThesis.match ?? sport}`,
      evidenceHash: stableHash({
        governorHash,
        selectedIntent: selectedIntent.id,
        beliefs: beliefs.map((item) => [item.id, item.status])
      }),
      content: compact(`${summaryFor(status, selectedIntent)} Doubt: ${brainState.selfCritique[0] ?? interventionPlanner.activeScenario?.ifMissing ?? "No primary doubt recorded."}`)
    },
    controls: {
      canRunSelectedCommand: selectedIntent.safeToRun,
      canRunReadOnly: selectedIntent.safeToRun,
      canAskOpenAI: brainReviewRunner.controls.canRequestOpenAI,
      canApplyIntent: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/cycle-governor",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/intervention-planner",
      "/api/sports/decision/brain-review-runner",
      "/api/sports/decision/evidence-acquisition-planner",
      ...brainState.proofUrls,
      ...interventionPlanner.proofUrls,
      ...brainReviewRunner.proofUrls
    ], 24),
    locks: unique([
      "Cycle governor is supervised and can propose at most one read-only command.",
      "Governor intent cannot persist decisions, publish picks, train models, stake, or upgrade public action.",
      "Memory draft is advisory and cannot be written automatically.",
      ...brainState.locks,
      ...interventionPlanner.locks,
      ...brainReviewRunner.locks
    ], 24)
  };
}
