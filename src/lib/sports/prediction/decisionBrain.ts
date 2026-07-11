import type {
  ConfidenceLevel,
  DecisionAction,
  DecisionCommitteeConsensus,
  DecisionControlStatus,
  DecisionEngineReport,
  DecisionHealth,
  DecisionToolTask,
  DecisionVerdict,
  Match,
  Prediction,
  RiskLevel,
  Sport
} from "@/lib/sports/types";

export type DecisionBrainThinkingStepStatus = "complete" | "watch" | "blocked";

export type DecisionBrainThinkingStep = {
  id: string;
  label: string;
  status: DecisionBrainThinkingStepStatus;
  detail: string;
};

export type DecisionBrainHypothesis = {
  id: string;
  label: string;
  status: string;
  confidence: ConfidenceLevel;
  decisionImpact: string;
};

export type DecisionBrainWatchItem = {
  id: string;
  label: string;
  priority: string;
  actionIfConfirmed: string;
};

export type DecisionBrainCommitteeMember = {
  id: string;
  role: string;
  stance: string;
  vote: DecisionAction;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  thesis: string;
};

export type DecisionBrain = {
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  country: string;
  kickoffTime: string;
  generatedAt: string;
  engineVersion: string;
  verdict: DecisionVerdict;
  action: DecisionAction;
  health: DecisionHealth;
  decisionScore: number;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  status: DecisionControlStatus;
  summary: string;
  belief: {
    grade: string;
    believedProbability: number | null;
    probabilityEdge: number | null;
    expectedValue: number | null;
    uncertaintyScore: number;
    ttlMinutes: number;
    summary: string;
  };
  thesis: {
    primary: string;
    dissenting: string;
    synthesis: string;
  };
  committee: {
    consensus: DecisionCommitteeConsensus;
    voteCounts: {
      consider: number;
      monitor: number;
      avoid: number;
    };
    recommendedAction: DecisionAction;
    finalRationale: string;
    members: DecisionBrainCommitteeMember[];
  };
  nextTool: Pick<DecisionToolTask, "id" | "label" | "status" | "provider" | "reason" | "decisionImpact"> | null;
  nextBestAction: string;
  blockers: string[];
  watchItems: DecisionBrainWatchItem[];
  hypotheses: DecisionBrainHypothesis[];
  thinkingSteps: DecisionBrainThinkingStep[];
  publishAllowed: boolean;
  aiReviewRequired: boolean;
  rerunRequired: boolean;
  safeToDisplay: boolean;
};

export type DecisionBrainSlate = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: "clear" | "watching" | "blocked";
  summary: string;
  totalMatches: number;
  publishable: number;
  blocked: number;
  needsRerun: number;
  aiReviewRequired: number;
  topBrains: DecisionBrain[];
};

type PredictionRow = {
  match: Match;
  prediction: Prediction;
};

function thinkingStatus(blocked: boolean, watch: boolean): DecisionBrainThinkingStepStatus {
  if (blocked) return "blocked";
  if (watch) return "watch";
  return "complete";
}

function nextToolTask(decision: DecisionEngineReport): DecisionBrain["nextTool"] {
  const task = decision.toolOrchestration.tasks.find((item) => item.id === decision.toolOrchestration.nextTaskId);
  if (!task) return null;
  return {
    id: task.id,
    label: task.label,
    status: task.status,
    provider: task.provider,
    reason: task.reason,
    decisionImpact: task.decisionImpact
  };
}

function decisionBlockers(decision: DecisionEngineReport): string[] {
  return [
    ...decision.controlPolicy.gates.filter((gate) => gate.status === "block").map((gate) => `${gate.label}: ${gate.requiredAction ?? gate.detail}`),
    ...decision.actionability.blockers,
    ...decision.toolOrchestration.blockingTasks.map((taskId) => {
      const task = decision.toolOrchestration.tasks.find((item) => item.id === taskId);
      return task ? `${task.label}: ${task.reason}` : taskId;
    })
  ].slice(0, 8);
}

function buildThinkingSteps(decision: DecisionEngineReport): DecisionBrainThinkingStep[] {
  const blockedGates = decision.controlPolicy.gates.filter((gate) => gate.status === "block").length;
  const watchGates = decision.controlPolicy.gates.filter((gate) => gate.status === "watch").length;

  return [
    {
      id: "model-market-belief",
      label: "Model and market belief",
      status: thinkingStatus(false, decision.beliefState.grade !== "strong"),
      detail: decision.beliefState.summary
    },
    {
      id: "hypothesis-red-team",
      label: "Hypothesis red-team",
      status: thinkingStatus(
        decision.deliberation.hypotheses.some((item) => item.status === "rejected"),
        decision.deliberation.watchItems.length > 0
      ),
      detail: decision.deliberation.synthesis
    },
    {
      id: "committee-arbitration",
      label: "Committee arbitration",
      status: thinkingStatus(decision.committee.consensus === "blocked", decision.committee.consensus !== "unanimous"),
      detail: decision.committee.finalRationale
    },
    {
      id: "tool-and-data-gates",
      label: "Tool and data gates",
      status: thinkingStatus(decision.toolExecution.status === "blocked" || blockedGates > 0, decision.toolOrchestration.status !== "ready"),
      detail: `${decision.toolExecution.summary} ${decision.toolOrchestration.summary}`
    },
    {
      id: "control-policy",
      label: "Control policy",
      status: thinkingStatus(decision.controlPolicy.status === "blocked", watchGates > 0 || decision.controlPolicy.rerunRequired),
      detail: decision.controlPolicy.nextBestAction
    }
  ];
}

function brainRank(brain: DecisionBrain): number {
  const statusWeight = brain.status === "blocked" ? 400 : brain.status === "needs-rerun" ? 300 : brain.status === "monitor-only" ? 200 : 100;
  const reviewWeight = brain.aiReviewRequired ? 50 : 0;
  const blockerWeight = brain.blockers.length * 10;
  return statusWeight + reviewWeight + blockerWeight + brain.decisionScore / 100;
}

export function buildDecisionBrain({ match, prediction }: PredictionRow): DecisionBrain {
  const decision = prediction.decision;
  const nextTool = nextToolTask(decision);
  const blockers = decisionBlockers(decision);

  return {
    matchId: match.id,
    match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
    sport: match.sport,
    league: match.league.name,
    country: match.league.country,
    kickoffTime: match.kickoffTime,
    generatedAt: prediction.generatedAt,
    engineVersion: decision.engineVersion,
    verdict: decision.verdict,
    action: decision.action,
    health: decision.health,
    decisionScore: decision.decisionScore,
    confidence: decision.confidence,
    risk: decision.risk,
    status: decision.controlPolicy.status,
    summary: `${decision.controlPolicy.primaryDirective} ${decision.beliefState.summary}`,
    belief: {
      grade: decision.beliefState.grade,
      believedProbability: decision.beliefState.believedProbability,
      probabilityEdge: decision.beliefState.probabilityEdge,
      expectedValue: decision.beliefState.expectedValue,
      uncertaintyScore: decision.beliefState.uncertaintyScore,
      ttlMinutes: decision.beliefState.ttlMinutes,
      summary: decision.beliefState.summary
    },
    thesis: {
      primary: decision.deliberation.primaryThesis,
      dissenting: decision.deliberation.dissentingThesis,
      synthesis: decision.deliberation.synthesis
    },
    committee: {
      consensus: decision.committee.consensus,
      voteCounts: decision.committee.voteCounts,
      recommendedAction: decision.committee.recommendedAction,
      finalRationale: decision.committee.finalRationale,
      members: decision.committee.members.map((member) => ({
        id: member.id,
        role: member.role,
        stance: member.stance,
        vote: member.vote,
        confidence: member.confidence,
        risk: member.risk,
        thesis: member.thesis
      }))
    },
    nextTool,
    nextBestAction: decision.controlPolicy.nextBestAction,
    blockers,
    watchItems: decision.deliberation.watchItems.slice(0, 5).map((item) => ({
      id: item.id,
      label: item.label,
      priority: item.priority,
      actionIfConfirmed: item.actionIfConfirmed
    })),
    hypotheses: decision.deliberation.hypotheses.slice(0, 5).map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      confidence: item.confidence,
      decisionImpact: item.decisionImpact
    })),
    thinkingSteps: buildThinkingSteps(decision),
    publishAllowed: decision.controlPolicy.publishAllowed,
    aiReviewRequired: decision.controlPolicy.aiReviewRequired,
    rerunRequired: decision.controlPolicy.rerunRequired,
    safeToDisplay: decision.controlPolicy.safeToDisplay
  };
}

export function buildDecisionBrainSlate({
  rows,
  date,
  sport,
  limit = 8
}: {
  rows: PredictionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionBrainSlate {
  const brains = rows.map((row) => buildDecisionBrain(row));
  const publishable = brains.filter((brain) => brain.publishAllowed).length;
  const blocked = brains.filter((brain) => brain.status === "blocked").length;
  const needsRerun = brains.filter((brain) => brain.rerunRequired).length;
  const aiReviewRequired = brains.filter((brain) => brain.aiReviewRequired).length;
  const status: DecisionBrainSlate["status"] = blocked ? "blocked" : needsRerun || aiReviewRequired ? "watching" : "clear";
  const topBrains = brains
    .slice()
    .sort((a, b) => brainRank(b) - brainRank(a))
    .slice(0, Math.max(1, limit));

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "blocked"
        ? `Agent brain is blocked on ${blocked} match(es); resolve data/tool/control gates before publishing.`
        : status === "watching"
          ? `Agent brain is watching ${needsRerun + aiReviewRequired} match workflow(s) before public action.`
          : "Agent brain has no blocking gates in the current slate.",
    totalMatches: brains.length,
    publishable,
    blocked,
    needsRerun,
    aiReviewRequired,
    topBrains
  };
}
