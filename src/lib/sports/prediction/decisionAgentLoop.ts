import { buildDecisionBrain, buildDecisionBrainSlate, type DecisionBrain, type DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import type {
  DecisionDataCoverageSignal,
  DecisionMonitoringPriority,
  DecisionSupervisorQueue,
  DecisionSupervisorQueueItem,
  Match,
  Prediction,
  Sport
} from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type EnvMap = Record<string, string | undefined>;

export type DecisionAgentLoopStatus = "clear" | "active" | "blocked";
export type DecisionAgentLoopPhaseId = "observe" | "orient" | "decide" | "act" | "learn";
export type DecisionAgentLoopPhaseStatus = "complete" | "active" | "waiting" | "blocked";
export type DecisionAgentEvidenceStatus = "ready" | "watch" | "missing" | "blocked";

export type DecisionAgentLoopPhase = {
  id: DecisionAgentLoopPhaseId;
  label: string;
  status: DecisionAgentLoopPhaseStatus;
  focus: string;
  evidence: string[];
  nextAction: string;
  successSignal: string;
};

export type DecisionAgentEvidenceItem = {
  id: string;
  label: string;
  status: DecisionAgentEvidenceStatus;
  source: string;
  detail: string;
};

export type DecisionAgentLoopFocus = {
  matchId: string;
  match: string;
  league: string;
  country: string;
  kickoffTime: string;
  queueItemId: string | null;
  queueType: DecisionSupervisorQueueItem["type"] | null;
  queuePriority: DecisionMonitoringPriority | null;
  queueStatus: DecisionSupervisorQueueItem["status"] | null;
  controlStatus: DecisionBrain["status"];
  reason: string;
};

export type DecisionAgentLoop = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAgentLoopStatus;
  summary: string;
  intent: string;
  activeFocus: DecisionAgentLoopFocus | null;
  autonomy: {
    mode: DecisionSupervisorQueue["runbook"]["mode"];
    status: DecisionSupervisorQueue["runbook"]["status"];
    canRunPrimaryCommand: boolean;
    humanApprovalRequired: boolean;
    primaryCommand: string | null;
    missingEnv: string[];
    summary: string;
  };
  phases: DecisionAgentLoopPhase[];
  evidenceLedger: DecisionAgentEvidenceItem[];
  currentHypotheses: string[];
  actionContract: {
    publishAllowed: boolean;
    persistAllowed: boolean;
    allowedActions: string[];
    forbiddenActions: string[];
    releaseCriteria: string[];
  };
  verification: {
    rerunUrl: string;
    verifyUrl: string;
    expectedStateChange: string;
    abortConditions: string[];
  };
  slate: {
    totalMatches: number;
    publishable: number;
    blocked: number;
    needsRerun: number;
    aiReviewRequired: number;
  };
};

function compactList(values: string[], fallback: string, limit = 4): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return (cleaned.length ? cleaned : [fallback]).slice(0, limit);
}

function signalStatus(signal: DecisionDataCoverageSignal): DecisionAgentEvidenceStatus {
  if (signal.status === "missing" || signal.status === "stale") return "missing";
  if (signal.status === "mock" && signal.requiredForProduction) return "watch";
  if (signal.status === "not-applicable") return "watch";
  return "ready";
}

function buildEvidenceLedger(row: DecisionRow | null): DecisionAgentEvidenceItem[] {
  if (!row) {
    return [
      {
        id: "no-fixture",
        label: "No active fixture",
        status: "missing",
        source: "agent-loop",
        detail: "The agent loop needs at least one fixture before it can observe, reason, act, or learn."
      }
    ];
  }

  const decision = row.prediction.decision;
  const coverageItems = decision.dataCoverage.signals
    .filter((signal) => signal.requiredForProduction || signal.status === "missing" || signal.status === "stale")
    .slice(0, 6)
    .map(
      (signal): DecisionAgentEvidenceItem => ({
      id: `coverage-${signal.id}`,
      label: signal.label,
      status: signalStatus(signal),
      source: signal.source,
      detail: signal.detail
    })
    );

  const ledger: DecisionAgentEvidenceItem[] = [
    {
      id: "belief-state",
      label: "Belief state",
      status: decision.beliefState.grade === "fragile" ? "watch" : "ready",
      source: "decision.beliefState",
      detail: decision.beliefState.summary
    },
    {
      id: "market-price",
      label: "Market price intelligence",
      status: decision.oddsIntelligence.actionableSelections > 0 ? "ready" : "watch",
      source: "decision.oddsIntelligence",
      detail: decision.oddsIntelligence.summary
    },
    ...coverageItems,
    {
      id: "case-memory",
      label: "Case memory",
      status:
        decision.caseMemory.status === "failed"
          ? "blocked"
          : decision.caseMemory.status === "not-configured" || decision.caseMemory.status === "no-memory"
            ? "watch"
            : "ready",
      source: "decision.caseMemory",
      detail: decision.caseMemory.summary
    },
    {
      id: "control-policy",
      label: "Control policy",
      status: decision.controlPolicy.status === "blocked" ? "blocked" : decision.controlPolicy.status === "publishable" ? "ready" : "watch",
      source: "decision.controlPolicy",
      detail: decision.controlPolicy.summary
    }
  ];

  return ledger.slice(0, 10);
}

function findActiveRow(rows: DecisionRow[], queue: DecisionSupervisorQueue, slate: DecisionBrainSlate): DecisionRow | null {
  const matchId = queue.nextItem?.matchId ?? slate.topBrains[0]?.matchId ?? rows[0]?.match.id;
  return rows.find((row) => row.match.id === matchId) ?? rows[0] ?? null;
}

function buildFocus(row: DecisionRow | null, brain: DecisionBrain | null, queueItem: DecisionSupervisorQueueItem | null): DecisionAgentLoopFocus | null {
  if (!row || !brain) return null;
  return {
    matchId: row.match.id,
    match: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
    league: row.match.league.name,
    country: row.match.league.country,
    kickoffTime: row.match.kickoffTime,
    queueItemId: queueItem?.id ?? null,
    queueType: queueItem?.type ?? null,
    queuePriority: queueItem?.priority ?? null,
    queueStatus: queueItem?.status ?? null,
    controlStatus: brain.status,
    reason: queueItem?.action ?? brain.nextBestAction
  };
}

function phaseStatus(blocked: boolean, active: boolean, waiting: boolean): DecisionAgentLoopPhaseStatus {
  if (blocked) return "blocked";
  if (active) return "active";
  if (waiting) return "waiting";
  return "complete";
}

function buildPhases({
  row,
  brain,
  queue
}: {
  row: DecisionRow | null;
  brain: DecisionBrain | null;
  queue: DecisionSupervisorQueue;
}): DecisionAgentLoopPhase[] {
  if (!row || !brain) {
    return [
      {
        id: "observe",
        label: "Observe",
        status: "waiting",
        focus: "Wait for fixtures.",
        evidence: ["No active match row is available."],
        nextAction: "Fetch fixtures and rebuild the prediction slate.",
        successSignal: "At least one match row is available."
      }
    ];
  }

  const decision = row.prediction.decision;
  const nextItem = queue.nextItem;
  const runbook = queue.runbook;
  const toolBlocked = decision.toolExecution.status === "blocked" || decision.toolOrchestration.status === "blocked";
  const dataMissing = decision.dataCoverage.status === "insufficient" || decision.dataCoverage.missingSignals > 0 || decision.dataCoverage.staleSignals > 0;
  const committeeBlocked = decision.committee.consensus === "blocked" || decision.reviewLoop.unresolvedIssues.length > 0;
  const controlBlocked = decision.controlPolicy.status === "blocked";

  return [
    {
      id: "observe",
      label: "Observe",
      status: phaseStatus(toolBlocked || dataMissing, nextItem?.type === "tool-task" || nextItem?.type === "monitoring", false),
      focus: "Collect the live and pre-match signals required before trust.",
      evidence: compactList(
        [
          decision.dataCoverage.summary,
          decision.toolExecution.summary,
          decision.monitoringPlan.tasks[0]?.trigger ?? ""
        ],
        "No observation evidence is available."
      ),
      nextAction: decision.toolExecution.nextRun,
      successSignal: "Required provider signals move from missing/stale/mock to provider-backed or computed."
    },
    {
      id: "orient",
      label: "Orient",
      status: phaseStatus(committeeBlocked, brain.committee.consensus !== "unanimous" || brain.hypotheses.length > 0, false),
      focus: "Test the model thesis against market, context, risk, memory, and dissent.",
      evidence: compactList(
        [brain.thesis.primary, brain.thesis.dissenting, brain.thesis.synthesis, decision.reasoningGraph.summary],
        "No orientation evidence is available."
      ),
      nextAction: brain.watchItems[0]?.actionIfConfirmed ?? decision.reviewLoop.releaseCriteria[0] ?? brain.nextBestAction,
      successSignal: "The committee can explain a clear consider, monitor, or avoid stance with unresolved issues reduced."
    },
    {
      id: "decide",
      label: "Decide",
      status: phaseStatus(controlBlocked, decision.controlPolicy.status !== "publishable", false),
      focus: "Apply deterministic guardrails before any public candidate is allowed.",
      evidence: compactList(
        [decision.controlPolicy.summary, decision.actionability.summary, decision.robustness.summary],
        "No decision evidence is available."
      ),
      nextAction: decision.controlPolicy.nextBestAction,
      successSignal: "Control policy becomes publishable, monitor-only, or explicitly blocked with a named blocker."
    },
    {
      id: "act",
      label: "Act",
      status: phaseStatus(runbook.status === "blocked", runbook.status === "ready", runbook.status === "waiting"),
      focus: "Execute only the safe next command emitted by the supervisor runbook.",
      evidence: compactList([runbook.summary, runbook.preflight.summary], "No action runbook is available."),
      nextAction: runbook.primaryCommand ?? runbook.summary,
      successSignal: runbook.expectedStateChange
    },
    {
      id: "learn",
      label: "Learn",
      status: phaseStatus(
        decision.caseMemory.status === "failed",
        decision.evaluationPlan.status === "track-value",
        decision.caseMemory.status === "not-configured" || decision.caseMemory.status === "no-memory"
      ),
      focus: "Close the loop with persistence, settlement, calibration, and similar-case memory.",
      evidence: compactList(
        [decision.evaluationPlan.summary, decision.caseMemory.summary, decision.calibration.detail],
        "No learning evidence is available."
      ),
      nextAction: decision.evaluationPlan.postMatchActions[0] ?? "Store the decision and settle the outcome when the result is known.",
      successSignal: "A persisted decision has a settled outcome, closing-line value, calibration update, and case-memory comparison."
    }
  ];
}

function loopStatus(queue: DecisionSupervisorQueue, phases: DecisionAgentLoopPhase[]): DecisionAgentLoopStatus {
  if (queue.status === "blocked" || phases.some((phase) => phase.status === "blocked")) return "blocked";
  if (queue.status === "active" || phases.some((phase) => phase.status === "active" || phase.status === "waiting")) return "active";
  return "clear";
}

export function buildDecisionAgentLoop({
  rows,
  date,
  sport,
  limit = 8,
  env = process.env,
  brainSlate,
  supervisorQueue
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
  env?: EnvMap;
  brainSlate?: DecisionBrainSlate;
  supervisorQueue?: DecisionSupervisorQueue;
}): DecisionAgentLoop {
  const slate = brainSlate ?? buildDecisionBrainSlate({ rows, date, sport, limit });
  const queue = supervisorQueue ?? buildDecisionSupervisorQueue({ rows, date, sport, limit, env });
  const activeRow = findActiveRow(rows, queue, slate);
  const activeBrain = activeRow ? buildDecisionBrain(activeRow) : null;
  const activeFocus = buildFocus(activeRow, activeBrain, queue.nextItem);
  const phases = buildPhases({ row: activeRow, brain: activeBrain, queue });
  const status = loopStatus(queue, phases);
  const activeDecision = activeRow?.prediction.decision ?? null;
  const humanApprovalRequired = queue.runbook.mode !== "read-only" || queue.runbook.preflight.status !== "ready";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "blocked"
        ? `Agent loop is blocked on ${activeFocus?.match ?? "the slate"}: ${activeFocus?.reason ?? queue.summary}`
        : status === "active"
          ? `Agent loop is active on ${activeFocus?.match ?? "the slate"}: ${activeFocus?.reason ?? queue.summary}`
          : "Agent loop is clear; no immediate blocker owns the slate.",
    intent: "Protect users by turning model, market, context, risk, memory, and learning evidence into a bounded observe-orient-decide-act-learn cycle.",
    activeFocus,
    autonomy: {
      mode: queue.runbook.mode,
      status: queue.runbook.status,
      canRunPrimaryCommand: queue.runbook.preflight.canRunPrimaryCommand,
      humanApprovalRequired,
      primaryCommand: queue.runbook.primaryCommand,
      missingEnv: queue.runbook.preflight.missingEnv,
      summary: queue.runbook.preflight.summary
    },
    phases,
    evidenceLedger: buildEvidenceLedger(activeRow),
    currentHypotheses: activeDecision
      ? compactList(
          [
            activeDecision.deliberation.primaryThesis,
            activeDecision.deliberation.dissentingThesis,
            ...activeDecision.deliberation.hypotheses.slice(0, 3).map((hypothesis) => hypothesis.decisionImpact)
          ],
          "No current hypothesis is available.",
          5
        )
      : [],
    actionContract: {
      publishAllowed: Boolean(activeDecision?.controlPolicy.publishAllowed),
      persistAllowed: Boolean(activeDecision?.controlPolicy.persistAllowed),
      allowedActions: activeDecision?.controlPolicy.allowedActions ?? [],
      forbiddenActions: activeDecision?.controlPolicy.forbiddenActions ?? [],
      releaseCriteria: activeDecision?.controlPolicy.releaseCriteria ?? []
    },
    verification: {
      rerunUrl: activeFocus ? `/api/sports/decision/${encodeURIComponent(activeFocus.matchId)}` : `/api/sports/decision?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
      verifyUrl: `/api/sports/decision/agent-loop?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
      expectedStateChange: queue.runbook.expectedStateChange,
      abortConditions: queue.runbook.abortConditions
    },
    slate: {
      totalMatches: slate.totalMatches,
      publishable: slate.publishable,
      blocked: slate.blocked,
      needsRerun: slate.needsRerun,
      aiReviewRequired: slate.aiReviewRequired
    }
  };
}
