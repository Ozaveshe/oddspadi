import type {
  BestPickResult,
  DecisionAction,
  DecisionActionabilityAudit,
  DecisionBeliefState,
  DecisionCaseMemory,
  DecisionCommittee,
  DecisionDataCoverageAudit,
  DecisionDeliberation,
  DecisionEvaluationPlan,
  DecisionEvidence,
  DecisionLearningProfile,
  DecisionMonitoringPlan,
  DecisionOddsIntelligence,
  DecisionResearchBrief,
  DecisionReviewLoop,
  DecisionRobustnessAudit,
  Match
} from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";

function formatDecisionClockTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "unavailable";
  return `${timestamp.toISOString().slice(11, 16)} UTC`;
}

/**
 * Compiles the model, market, risk, evidence-gap, and time-bound thesis shown to operators.
 * The brief consumes only explicit report state and performs no provider or persistence work.
 */
export function buildDecisionResearchBrief({
  match,
  bestPick,
  action,
  summary,
  evidence,
  missingSignals,
  oddsIntelligence,
  dataCoverage,
  beliefState,
  deliberation,
  committee,
  monitoringPlan,
  actionability,
  reviewLoop,
  robustness,
  evaluationPlan,
  caseMemory,
  learningProfile
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  summary: string;
  evidence: DecisionEvidence[];
  missingSignals: string[];
  oddsIntelligence: DecisionOddsIntelligence;
  dataCoverage: DecisionDataCoverageAudit;
  beliefState: DecisionBeliefState;
  deliberation: DecisionDeliberation;
  committee: DecisionCommittee;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
  evaluationPlan: DecisionEvaluationPlan;
  caseMemory: DecisionCaseMemory;
  learningProfile?: DecisionLearningProfile;
}): DecisionResearchBrief {
  const status: DecisionResearchBrief["status"] =
    actionability.status === "blocked" || action === "avoid"
      ? "blocked"
      : action === "monitor" || reviewLoop.status === "downgraded" || reviewLoop.status === "repaired"
        ? "watchlist"
        : "ready";
  const fixtureLabel = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
  const candidate = bestPick.hasValue ? bestPick.label : "No clear value candidate";
  const evidenceTrail = [
    ...evidence.slice(0, 5).map((item) => `${item.category}: ${item.label} - ${item.detail}`),
    ...oddsIntelligence.topCandidates.slice(0, 3).map((item) => `odds: ${item.label} - ${item.reason}`),
    `coverage: ${dataCoverage.summary}`,
    `committee: ${committee.finalRationale}`
  ].slice(0, 10);
  const dataGaps = Array.from(
    new Set([
      ...missingSignals,
      ...dataCoverage.requiredBeforeTrust.map((item) => item.split(":")[0]),
      ...(learningProfile?.active ? [] : ["Real historical training sample"])
    ])
  ).slice(0, 8);
  const requiredChecks = Array.from(
    new Set([
      ...monitoringPlan.tasks.slice(0, 4).map((task) => `${task.label}: ${task.action}`),
      ...actionability.requiredBeforeAction.slice(0, 4),
      ...reviewLoop.releaseCriteria.slice(0, 3),
      ...robustness.requiredRechecks.slice(0, 3),
      ...evaluationPlan.requiredOutcomeSignals
        .filter((signal) => signal.status === "required")
        .slice(0, 2)
        .map((signal) => `${signal.label}: ${signal.detail}`)
    ])
  ).slice(0, 10);
  const marketThesis = bestPick.hasValue
    ? `Market disagreement exists: model ${formatPercent(bestPick.modelProbability)} versus no-vig ${formatPercent(
        bestPick.noVigImpliedProbability
      )}, edge ${formatSignedPercent(bestPick.edge)}, EV ${formatSignedPercent(bestPick.expectedValue)}, quoted odds ${formatOdds(bestPick.odds)}.`
    : "Market thesis is neutral: no selection clears positive edge and expected-value guardrails.";
  const riskThesis =
    status === "blocked"
      ? `Risk thesis blocks the recommendation: ${actionability.blockers[0] ?? reviewLoop.unresolvedIssues[0] ?? "required gates did not clear"}.`
      : robustness.status === "robust"
        ? `Risk thesis is controlled: ${robustness.summary}`
        : `Risk thesis requires monitoring: ${robustness.summary}`;
  const decisionClock = `Belief expires at ${formatDecisionClockTime(beliefState.expiresAt)}; next review is ${formatDecisionClockTime(
    monitoringPlan.nextReviewAt
  )}.`;
  const analystPosture =
    status === "ready"
      ? "Show as an inspectable value candidate only with fresh odds and responsible-use language."
      : status === "watchlist"
        ? "Keep on watchlist until required checks refresh odds, context, and review-loop warnings."
        : "Block public recommendation until failed gates, missing data, or invalid memory conditions are repaired.";
  const headline =
    status === "ready"
      ? `Research-led value thesis: ${candidate}.`
      : status === "watchlist"
        ? `Watchlist thesis requires more evidence before trust: ${candidate}.`
        : `${fixtureLabel} is blocked from a public recommendation.`;

  return {
    status,
    headline,
    executiveSummary: `${summary} The research brief says ${analystPosture.toLowerCase()}`,
    modelThesis: deliberation.primaryThesis,
    marketThesis,
    riskThesis,
    dataGaps,
    requiredChecks,
    evidenceTrail,
    analystPosture,
    decisionClock
  };
}
