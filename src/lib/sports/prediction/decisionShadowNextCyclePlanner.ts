import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionResolutionPlanner } from "@/lib/sports/prediction/decisionResolutionPlanner";
import type { DecisionShadowInfluenceSimulation, DecisionShadowInfluenceSimulator } from "@/lib/sports/prediction/decisionShadowInfluenceSimulator";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { Sport } from "@/lib/sports/types";

export type DecisionShadowNextCyclePlannerStatus = "ready-readonly" | "needs-proof" | "blocked";
export type DecisionShadowNextCycleStepStatus = "ready" | "waiting-proof" | "blocked";
export type DecisionShadowNextCycleStepSource = "historical-diagnosis" | "shadow-influence" | "evidence-acquisition" | "agent-operation" | "resolution-planner";

export type DecisionShadowNextCycleStep = {
  id: string;
  source: DecisionShadowNextCycleStepSource;
  sourceId: string;
  status: DecisionShadowNextCycleStepStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  question: string;
  expectedEvidence: string;
  proofUrl: string;
  command: string | null;
  safeToRun: boolean;
  zeroDeltaGuarantee: true;
  blockers: string[];
};

export type DecisionShadowNextCyclePlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-shadow-next-cycle-planner";
  status: DecisionShadowNextCyclePlannerStatus;
  plannerHash: string;
  summary: string;
  selectedStep: DecisionShadowNextCycleStep | null;
  steps: DecisionShadowNextCycleStep[];
  totals: {
    steps: number;
    diagnosisSteps: number;
    ready: number;
    waitingProof: number;
    blocked: number;
    safeCommands: number;
    zeroDeltaSteps: number;
  };
  planningPolicy: {
    goal: string;
    rule: string;
    diagnosisFocus: string | null;
    canInspectReadOnly: true;
    canRunOneReadOnlyCommand: boolean;
    probabilityDelta: 0;
    publicActionDelta: 0;
    confidenceDelta: 0;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canUseHiddenChainOfThought: false;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 36): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function safeReadOnlyCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  const banned = ["persist", "publish", "stake", "train", "write", "insert", "update", "delete", "remove", "deploy", "--prod"];
  return lower.startsWith("curl.exe -ss ") && !banned.some((token) => lower.includes(token));
}

function statusFromSimulation(simulation: DecisionShadowInfluenceSimulation | null, planner: DecisionShadowNextCyclePlannerStatus): DecisionShadowNextCycleStepStatus {
  if (!simulation || planner === "blocked" || simulation.status === "blocked") return "blocked";
  if (simulation.status === "needs-proof") return "waiting-proof";
  return "ready";
}

function step(input: Omit<DecisionShadowNextCycleStep, "zeroDeltaGuarantee">): DecisionShadowNextCycleStep {
  const safeToRun = input.safeToRun && input.status === "ready" && safeReadOnlyCommand(input.command);
  return {
    ...input,
    command: safeToRun ? input.command : null,
    safeToRun,
    zeroDeltaGuarantee: true
  };
}

function shadowInfluenceSteps({
  date,
  sport,
  shadowInfluenceSimulator
}: {
  date: string;
  sport: Sport;
  shadowInfluenceSimulator: DecisionShadowInfluenceSimulator;
}): DecisionShadowNextCycleStep[] {
  const inspectUrl = `/api/sports/decision/shadow-influence-simulator?date=${date}&sport=${sport}`;
  const selected = shadowInfluenceSimulator.selectedSimulation;
  return [
    step({
      id: "inspect-shadow-influence-simulator",
      source: "shadow-influence",
      sourceId: shadowInfluenceSimulator.simulatorHash,
      status: shadowInfluenceSimulator.status === "blocked" ? "blocked" : "ready",
      priority: shadowInfluenceSimulator.status === "needs-proof" ? "high" : "medium",
      label: "Inspect shadow influence simulator",
      question: "Which shadow memory influence should shape the next proof question without changing the public pick?",
      expectedEvidence: compact(shadowInfluenceSimulator.summary),
      proofUrl: inspectUrl,
      command: decisionCurlCommand(inspectUrl),
      safeToRun: shadowInfluenceSimulator.controls.canInspectReadOnly,
      blockers: shadowInfluenceSimulator.status === "blocked" ? shadowInfluenceSimulator.locks.slice(0, 3) : []
    }),
    step({
      id: "verify-selected-shadow-influence-proof",
      source: "shadow-influence",
      sourceId: selected?.id ?? "none",
      status: statusFromSimulation(selected, shadowInfluenceSimulator.status === "blocked" ? "blocked" : "needs-proof"),
      priority: selected?.status === "blocked" ? "critical" : selected?.status === "needs-proof" ? "high" : "medium",
      label: selected ? `Verify ${selected.action.replaceAll("-", " ")} influence` : "Verify selected shadow influence",
      question: selected
        ? `What proof would make ${selected.episodeId.replaceAll("-", " ")} useful for planning only?`
        : "Which shadow memory proof should be inspected next?",
      expectedEvidence: compact(selected?.expectedEffect ?? "No selected shadow influence is available."),
      proofUrl: selected?.proofUrl ?? "/api/sports/decision/shadow-replay-critic",
      command: null,
      safeToRun: false,
      blockers: selected?.blockers ?? ["No selected shadow influence is available."]
    })
  ];
}

function evidenceStep(planner: DecisionEvidenceAcquisitionPlanner): DecisionShadowNextCycleStep | null {
  const candidate = planner.nextCandidate;
  if (!candidate) return null;
  return step({
    id: "inspect-evidence-acquisition-next-candidate",
    source: "evidence-acquisition",
    sourceId: candidate.id,
    status: candidate.status === "ready" ? "ready" : candidate.status === "blocked" ? "blocked" : "waiting-proof",
    priority: candidate.priority,
    label: `Inspect ${candidate.label}`,
    question: planner.acquisitionPolicy.question,
    expectedEvidence: compact(candidate.expectedEvidence),
    proofUrl: candidate.verifyUrl,
    command: candidate.safeToRun ? candidate.command : null,
    safeToRun: candidate.safeToRun,
    blockers: unique([...candidate.missingEnv, ...candidate.blockers], 6)
  });
}

function operationStep(queue: DecisionAgentOperationQueue): DecisionShadowNextCycleStep | null {
  const operation = queue.nextOperation;
  if (!operation) return null;
  return step({
    id: "inspect-agent-operation-next-step",
    source: "agent-operation",
    sourceId: operation.id,
    status: operation.status === "ready" ? "ready" : operation.status === "blocked" ? "blocked" : "waiting-proof",
    priority: operation.priority,
    label: `Inspect ${operation.label}`,
    question: "Which operator proof can advance the next cycle without writing, training, publishing, or staking?",
    expectedEvidence: compact(operation.expectedEvidence),
    proofUrl: operation.verifyUrl,
    command: operation.safeToRun ? operation.command : null,
    safeToRun: operation.safeToRun,
    blockers: operation.blockedBy
  });
}

function resolutionStep(planner: DecisionResolutionPlanner): DecisionShadowNextCycleStep | null {
  const nextStep = planner.nextStep;
  if (!nextStep) return null;
  return step({
    id: "inspect-resolution-planner-next-step",
    source: "resolution-planner",
    sourceId: nextStep.id,
    status: nextStep.status === "ready" ? "ready" : nextStep.status === "blocked" ? "blocked" : "waiting-proof",
    priority: nextStep.priority,
    label: `Inspect ${nextStep.label}`,
    question: "Which contradiction proof should be checked before the next decision cycle?",
    expectedEvidence: compact(nextStep.expectedUnlock),
    proofUrl: nextStep.verifyUrl,
    command: nextStep.safeToRun ? nextStep.command : null,
    safeToRun: nextStep.safeToRun,
    blockers: nextStep.blockedBy
  });
}

function historicalDiagnosisSteps({
  evidence
}: {
  evidence: PublicHistoricalTrainingEvidence | null;
}): DecisionShadowNextCycleStep[] {
  if (!evidence) return [];
  const diagnosis = evidence.failureDiagnosis;
  const priorityFor = (priority: number): DecisionShadowNextCycleStep["priority"] =>
    priority <= 1 ? "critical" : priority === 2 ? "high" : priority <= 4 ? "medium" : "low";
  const statusForChecklist = (proofUrl: string): DecisionShadowNextCycleStepStatus => {
    if (evidence.status === "failed" || evidence.status === "insufficient-history") return "blocked";
    return proofUrl.includes("/training/") ? "waiting-proof" : "ready";
  };

  return diagnosis.providerRetestChecklist.map((item) =>
    step({
      id: `diagnose-${item.id}`,
      source: "historical-diagnosis",
      sourceId: `${evidence.evidenceHash}:${item.id}`,
      status: statusForChecklist(item.proofUrl),
      priority: priorityFor(item.priority),
      label: item.label,
      question:
        item.id === "fixture-identity"
          ? "Can provider fixture identity connect the public 10-year history to real provider events for the next retest?"
          : item.id === "odds-snapshots"
            ? "Can odds snapshots preserve enough bookmaker timing evidence to retest model value against no-vig market consensus?"
            : item.id === "market-gates"
              ? "Which market gates must be beaten before the model can challenge the market prior?"
              : `What evidence is required for ${item.label.toLowerCase()}?`,
      expectedEvidence: compact(`${diagnosis.headline} ${item.requiredEvidence}`),
      proofUrl: item.proofUrl,
      command: decisionCurlCommand(item.proofUrl),
      safeToRun: evidence.controls.canInspectReadOnly,
      blockers:
        evidence.status === "failed" || evidence.status === "insufficient-history"
          ? [diagnosis.headline]
          : item.proofUrl.includes("/training/")
            ? ["Training-namespaced proof routes stay manual until an operator selects the exact read-only retest path."]
            : []
    })
  );
}

function rank(item: DecisionShadowNextCycleStep): number {
  const statusRank = { ready: 4, "waiting-proof": 3, blocked: 2 }[item.status];
  const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[item.priority];
  const safeBonus = item.safeToRun ? 12 : 0;
  const sourceBonus =
    item.source === "historical-diagnosis"
      ? 6
      : item.source === "shadow-influence"
        ? 4
        : item.source === "evidence-acquisition"
          ? 3
          : item.source === "resolution-planner"
            ? 2
            : 1;
  return statusRank * 20 + priorityRank * 4 + safeBonus + sourceBonus;
}

function statusFor(steps: DecisionShadowNextCycleStep[], shadowInfluenceSimulator: DecisionShadowInfluenceSimulator): DecisionShadowNextCyclePlannerStatus {
  if (!steps.length || shadowInfluenceSimulator.status === "blocked" || steps.every((item) => item.status === "blocked")) return "blocked";
  if (steps.some((item) => item.safeToRun)) return "ready-readonly";
  return "needs-proof";
}

function summaryFor(status: DecisionShadowNextCyclePlannerStatus, selectedStep: DecisionShadowNextCycleStep | null): string {
  if (status === "ready-readonly") return `Shadow next-cycle planner selected a safe read-only step: ${selectedStep?.label ?? "inspect proof"}.`;
  if (status === "blocked") return "Shadow next-cycle planner is blocked; memory influence cannot move the next cycle.";
  return `Shadow next-cycle planner is waiting for proof before selecting ${selectedStep?.label ?? "a next-cycle step"}.`;
}

export function buildDecisionShadowNextCyclePlanner({
  date,
  sport,
  shadowInfluenceSimulator,
  evidenceAcquisitionPlanner,
  agentOperationQueue,
  resolutionPlanner,
  publicHistoricalTrainingEvidence = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  shadowInfluenceSimulator: DecisionShadowInfluenceSimulator;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentOperationQueue: DecisionAgentOperationQueue;
  resolutionPlanner: DecisionResolutionPlanner;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  now?: Date;
}): DecisionShadowNextCyclePlanner {
  const steps = uniqueStepIds([
    ...historicalDiagnosisSteps({ evidence: publicHistoricalTrainingEvidence }),
    ...shadowInfluenceSteps({ date, sport, shadowInfluenceSimulator }),
    evidenceStep(evidenceAcquisitionPlanner),
    operationStep(agentOperationQueue),
    resolutionStep(resolutionPlanner)
  ]).sort((a, b) => rank(b) - rank(a));
  const selectedStep = steps.find((item) => item.safeToRun) ?? steps.find((item) => item.status === "waiting-proof") ?? steps[0] ?? null;
  const status = statusFor(steps, shadowInfluenceSimulator);
  const totals = {
    steps: steps.length,
    diagnosisSteps: steps.filter((item) => item.source === "historical-diagnosis").length,
    ready: steps.filter((item) => item.status === "ready").length,
    waitingProof: steps.filter((item) => item.status === "waiting-proof").length,
    blocked: steps.filter((item) => item.status === "blocked").length,
    safeCommands: steps.filter((item) => item.safeToRun).length,
    zeroDeltaSteps: steps.filter((item) => item.zeroDeltaGuarantee).length
  };
  const plannerHash = stableHash({
    date,
    sport,
    shadow: shadowInfluenceSimulator.simulatorHash,
    evidence: evidenceAcquisitionPlanner.plannerHash,
    queue: agentOperationQueue.queueHash,
    resolution: resolutionPlanner.plannerHash,
    publicHistory: publicHistoricalTrainingEvidence?.evidenceHash ?? "not-attached",
    steps: steps.map((item) => [item.id, item.status, item.safeToRun, item.sourceId])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-shadow-next-cycle-planner",
    status,
    plannerHash,
    summary: summaryFor(status, selectedStep),
    selectedStep,
    steps,
    totals,
    planningPolicy: {
      goal: "Select the next read-only proof question from historical diagnosis and shadow influence without applying memory to public action.",
      rule: "A next-cycle step may inspect proof or run one safe curl read only. It cannot persist memory, adjust probabilities, raise confidence, publish picks, train models, stake, or expose hidden chain-of-thought.",
      diagnosisFocus: publicHistoricalTrainingEvidence?.failureDiagnosis.headline ?? null,
      canInspectReadOnly: true,
      canRunOneReadOnlyCommand: totals.safeCommands > 0,
      probabilityDelta: 0,
      publicActionDelta: 0,
      confidenceDelta: 0,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canUseHiddenChainOfThought: false
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(selectedStep?.safeToRun),
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
      "/api/sports/decision/shadow-next-cycle-planner",
      "/api/sports/decision/shadow-influence-simulator",
      selectedStep?.proofUrl,
      ...steps.map((item) => item.proofUrl),
      publicHistoricalTrainingEvidence ? "/api/sports/decision/training/public-historical-training-evidence" : null,
      ...shadowInfluenceSimulator.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...agentOperationQueue.proofUrls,
      ...resolutionPlanner.proofUrls
    ]),
    locks: unique([
      "Shadow next-cycle planning is read-only and cannot execute writes, training, publishing, staking, probability changes, confidence changes, or memory persistence.",
      "Shadow memory may shape the next proof question only; public action and model probability deltas remain zero.",
      publicHistoricalTrainingEvidence
        ? "Historical diagnosis may select provider retest proof only; it cannot unlock training, learned thresholds, public picks, or staking."
        : null,
      ...shadowInfluenceSimulator.locks,
      ...evidenceAcquisitionPlanner.locks,
      ...agentOperationQueue.locks,
      ...resolutionPlanner.locks
    ])
  };
}

function uniqueStepIds(values: Array<DecisionShadowNextCycleStep | null>): DecisionShadowNextCycleStep[] {
  const seen = new Set<string>();
  return values.filter((value): value is DecisionShadowNextCycleStep => {
    if (!value || seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}
