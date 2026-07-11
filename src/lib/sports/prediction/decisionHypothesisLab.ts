import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { ConfidenceLevel, DecisionAction, DecisionHypothesis, DecisionScenario, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionHypothesisExperimentStatus = "ready" | "observing" | "needs-data" | "blocked";
export type DecisionHypothesisLabStatus = "clear" | "testing" | "blocked";

export type DecisionHypothesisExperiment = {
  id: string;
  matchId: string;
  match: string;
  league: string;
  sport: Sport;
  priority: "critical" | "high" | "medium" | "low";
  status: DecisionHypothesisExperimentStatus;
  hypothesisId: string;
  hypothesisStatus: DecisionHypothesis["status"];
  confidence: ConfidenceLevel;
  thesis: string;
  counterThesis: string;
  test: string;
  falsifier: string;
  expectedSignal: string;
  actionIfPasses: DecisionAction;
  actionIfFails: DecisionAction;
  projectedAction: DecisionAction;
  impactScore: number;
  evidence: string[];
  verifyUrl: string;
  command: string;
};

export type DecisionHypothesisLab = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionHypothesisLabStatus;
  summary: string;
  totalHypotheses: number;
  readyExperiments: number;
  blockedExperiments: number;
  needsDataExperiments: number;
  nextExperiment: DecisionHypothesisExperiment | null;
  experiments: DecisionHypothesisExperiment[];
  slateQuestions: string[];
};

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function commandFor(matchId: string): string {
  return decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(matchId)}`);
}

function confidenceWeight(confidence: ConfidenceLevel): number {
  if (confidence === "high") return 18;
  if (confidence === "medium") return 10;
  return 4;
}

function scenarioForHypothesis(hypothesis: DecisionHypothesis, scenarios: DecisionScenario[]): DecisionScenario | null {
  const haystack = `${hypothesis.id} ${hypothesis.label} ${hypothesis.detail} ${hypothesis.decisionImpact}`.toLowerCase();
  if (haystack.includes("market") || haystack.includes("odds") || haystack.includes("price")) {
    return scenarios.find((scenario) => scenario.id === "odds-shortening") ?? scenarios[0] ?? null;
  }
  if (haystack.includes("context") || haystack.includes("lineup") || haystack.includes("injur") || haystack.includes("news")) {
    return scenarios.find((scenario) => scenario.id === "adverse-team-news") ?? scenarios.find((scenario) => scenario.id === "context-upgrade") ?? scenarios[0] ?? null;
  }
  return scenarios.find((scenario) => scenario.id === "base-case") ?? scenarios[0] ?? null;
}

function statusForHypothesis(row: DecisionRow, hypothesis: DecisionHypothesis): DecisionHypothesisExperimentStatus {
  const decision = row.prediction.decision;
  if (decision.controlPolicy.status === "blocked" || decision.toolExecution.status === "blocked") return "blocked";
  if (hypothesis.status === "needs-data") return "needs-data";
  if (hypothesis.status === "contested") return "ready";
  if (hypothesis.status === "rejected") return "blocked";
  return decision.monitoringPlan.status === "active" || decision.monitoringPlan.status === "watching" ? "observing" : "ready";
}

function priorityForExperiment(row: DecisionRow, hypothesis: DecisionHypothesis, scenario: DecisionScenario | null): DecisionHypothesisExperiment["priority"] {
  const decision = row.prediction.decision;
  const actionFlip = scenario ? scenario.projectedAction !== decision.action : false;
  if (decision.controlPolicy.status === "blocked" || actionFlip) return "critical";
  if (hypothesis.status === "contested" || hypothesis.status === "needs-data" || decision.health === "fragile") return "high";
  if (hypothesis.confidence === "high" || decision.action !== "avoid") return "medium";
  return "low";
}

function impactScore(row: DecisionRow, hypothesis: DecisionHypothesis, scenario: DecisionScenario | null): number {
  const decision = row.prediction.decision;
  const statusImpact = hypothesis.status === "contested" ? 22 : hypothesis.status === "needs-data" ? 18 : hypothesis.status === "rejected" ? 14 : 8;
  const actionImpact = scenario && scenario.projectedAction !== decision.action ? 28 : 0;
  const blockerImpact = decision.controlPolicy.status === "blocked" ? 18 : decision.controlPolicy.status === "needs-rerun" ? 12 : 0;
  const healthImpact = decision.health === "fragile" ? 16 : decision.health === "review" ? 8 : 0;
  return Math.min(100, statusImpact + actionImpact + blockerImpact + healthImpact + confidenceWeight(hypothesis.confidence));
}

function experimentForHypothesis(row: DecisionRow, hypothesis: DecisionHypothesis): DecisionHypothesisExperiment {
  const { match, prediction } = row;
  const decision = prediction.decision;
  const scenario = scenarioForHypothesis(hypothesis, decision.scenarioMatrix);
  const falsifier =
    decision.notebook.falsifiers[0]?.detail ??
    hypothesis.challenge[0] ??
    decision.deliberation.decisionIfMissingDataTurnsBad ??
    "The hypothesis fails if the next provider refresh contradicts the claimed value thesis.";
  const expectedSignal =
    decision.dataCoverage.requiredBeforeTrust[0] ??
    decision.researchBrief.requiredChecks[0] ??
    decision.monitoringPlan.tasks[0]?.trigger ??
    "Fresh odds, lineup, injury, market, memory, or training evidence changes the control-policy gate.";
  const status = statusForHypothesis(row, hypothesis);
  const projectedAction = scenario?.projectedAction ?? decision.action;

  return {
    id: `${match.id}:${hypothesis.id}`,
    matchId: match.id,
    match: matchLabel(match),
    league: match.league.name,
    sport: match.sport,
    priority: priorityForExperiment(row, hypothesis, scenario),
    status,
    hypothesisId: hypothesis.id,
    hypothesisStatus: hypothesis.status,
    confidence: hypothesis.confidence,
    thesis: hypothesis.detail,
    counterThesis: hypothesis.challenge[0] ?? decision.deliberation.dissentingThesis,
    test: hypothesis.decisionImpact,
    falsifier,
    expectedSignal,
    actionIfPasses: decision.action,
    actionIfFails: projectedAction === decision.action ? "avoid" : projectedAction,
    projectedAction,
    impactScore: impactScore(row, hypothesis, scenario),
    evidence: [
      ...hypothesis.support.slice(0, 2),
      ...(scenario ? [`Scenario ${scenario.label}: ${scenario.detail}`] : []),
      decision.researchBrief.evidenceTrail[0] ?? decision.publicReasoningSteps[0] ?? ""
    ].filter(Boolean),
    verifyUrl: `/api/sports/decision/${encodeURIComponent(match.id)}`,
    command: commandFor(match.id)
  };
}

function sortExperiments(experiments: DecisionHypothesisExperiment[]): DecisionHypothesisExperiment[] {
  const priorityRank: Record<DecisionHypothesisExperiment["priority"], number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<DecisionHypothesisExperimentStatus, number> = { ready: 4, observing: 3, "needs-data": 2, blocked: 1 };
  return experiments
    .slice()
    .sort((a, b) => {
      const priority = priorityRank[b.priority] - priorityRank[a.priority];
      if (priority !== 0) return priority;
      const status = statusRank[b.status] - statusRank[a.status];
      if (status !== 0) return status;
      return b.impactScore - a.impactScore;
    });
}

export function buildDecisionHypothesisLab({
  rows,
  date,
  sport,
  limit = 10
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionHypothesisLab {
  const experiments = sortExperiments(rows.flatMap((row) => row.prediction.decision.deliberation.hypotheses.map((hypothesis) => experimentForHypothesis(row, hypothesis))));
  const visibleExperiments = experiments.slice(0, limit);
  const readyExperiments = visibleExperiments.filter((experiment) => experiment.status === "ready" || experiment.status === "observing").length;
  const blockedExperiments = visibleExperiments.filter((experiment) => experiment.status === "blocked").length;
  const needsDataExperiments = visibleExperiments.filter((experiment) => experiment.status === "needs-data").length;
  const nextExperiment =
    visibleExperiments.find((experiment) => experiment.status === "ready") ??
    visibleExperiments.find((experiment) => experiment.status === "observing") ??
    visibleExperiments.find((experiment) => experiment.status === "needs-data") ??
    visibleExperiments[0] ??
    null;
  const status: DecisionHypothesisLabStatus = blockedExperiments && !readyExperiments ? "blocked" : readyExperiments || needsDataExperiments ? "testing" : "clear";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "clear"
        ? "Hypothesis lab has no open slate-level tests."
        : status === "blocked"
          ? `Hypothesis lab is blocked on ${blockedExperiments} experiment(s) before trust can rise.`
          : `Hypothesis lab is testing ${readyExperiments + needsDataExperiments} experiment(s); next test is ${nextExperiment?.match ?? "the top slate item"}.`,
    totalHypotheses: experiments.length,
    readyExperiments,
    blockedExperiments,
    needsDataExperiments,
    nextExperiment,
    experiments: visibleExperiments,
    slateQuestions: [
      nextExperiment ? `What evidence would falsify ${nextExperiment.hypothesisId} for ${nextExperiment.match}?` : "Which match should the agent test first?",
      "Does the next provider refresh reduce missing context enough to change the control policy?",
      "Does odds movement preserve positive EV after bookmaker margin removal?",
      "Does the post-match learning loop later confirm calibration and closing-line value?"
    ]
  };
}
