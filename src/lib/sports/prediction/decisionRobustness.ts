import type {
  BestPickResult,
  DecisionAction,
  DecisionActionabilityAudit,
  DecisionMonitoringPlan,
  DecisionReviewLoop,
  DecisionRobustnessAudit,
  DecisionRobustnessCase,
  FootballModelDiagnostics,
  SaferAlternative
} from "@/lib/sports/types";
import { formatPercent } from "./format";
import { edgeAfterOddsMultiplier } from "./decisionMarketIntelligence";

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
function robustnessAction(edge: number | null, expectedValue: number | null, baseAction: DecisionAction): DecisionAction {
  if (edge === null || expectedValue === null) return "avoid";
  if (edge <= 0 || expectedValue <= 0) return "avoid";
  if (edge < 0.035 || expectedValue < 0.035) return "monitor";
  return baseAction === "avoid" ? "monitor" : baseAction;
}

function robustnessCase({
  id,
  label,
  probabilityShift,
  bestPick,
  action,
  detail,
  repair
}: {
  id: string;
  label: string;
  probabilityShift: number;
  bestPick: BestPickResult;
  action: DecisionAction;
  detail: string;
  repair: string;
}): DecisionRobustnessCase {
  const edgeAfterShock = bestPick.hasValue ? bestPick.edge + probabilityShift : null;
  const expectedValueAfterShock = bestPick.hasValue ? bestPick.expectedValue + probabilityShift * bestPick.odds : null;
  const actionAfterShock = robustnessAction(edgeAfterShock, expectedValueAfterShock, action);
  const status: DecisionRobustnessCase["status"] =
    actionAfterShock === "avoid" ? "breaks" : actionAfterShock === action ? "survives" : "downgrades";

  return {
    id,
    label,
    status,
    probabilityShift,
    edgeAfterShock,
    expectedValueAfterShock,
    actionAfterShock,
    detail,
    repair
  };
}

/**
 * Stress-tests a selected decision against price, context, data, freshness, review, and actionability shocks.
 * This function is pure and deliberately fails closed when no priced candidate exists.
 */
export function buildDecisionRobustnessAudit({
  bestPick,
  action,
  diagnostics,
  missingSignals,
  monitoringPlan,
  actionability,
  reviewLoop,
  saferAlternatives
}: {
  bestPick: BestPickResult;
  action: DecisionAction;
  diagnostics: FootballModelDiagnostics;
  missingSignals: string[];
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  saferAlternatives: SaferAlternative[];
}): DecisionRobustnessAudit {
  const confidencePenalty = bestPick.hasValue ? (bestPick.confidence === "high" ? -0.018 : bestPick.confidence === "medium" ? -0.04 : -0.065) : -0.08;
  const dataPenalty = -Math.max(0.015, (1 - diagnostics.dataQualityScore) * 0.12);
  const missingPenalty = -Math.min(0.09, Math.max(0.02, missingSignals.length * 0.018));
  const repairPenalty = reviewLoop.status === "cleared" ? -0.01 : reviewLoop.status === "repaired" ? -0.025 : reviewLoop.status === "downgraded" ? -0.055 : -0.09;
  const monitoringPenalty = monitoringPlan.status === "active" ? -0.015 : monitoringPlan.status === "watching" ? -0.035 : -0.07;
  const actionabilityPenalty = actionability.status === "actionable" ? -0.012 : actionability.status === "watch-only" ? -0.045 : -0.08;
  const oddsShock = bestPick.hasValue ? Math.min(-0.018, edgeAfterOddsMultiplier(bestPick, 0.95) - bestPick.edge) : -0.08;
  const cases = [
    robustnessCase({
      id: "odds-shortening",
      label: "Bookmaker price shortens",
      probabilityShift: oddsShock,
      bestPick,
      action,
      detail: bestPick.hasValue
        ? `A 5% odds shortening projects a smaller no-vig edge for ${bestPick.label}.`
        : "No candidate exists, so odds movement cannot rescue the decision without a fresh market.",
      repair: "Refresh bookmaker odds and remove the pick if edge or EV is no longer positive."
    }),
    robustnessCase({
      id: "adverse-context",
      label: "Adverse team news or weather",
      probabilityShift: missingSignals.length ? missingPenalty : -0.018,
      bestPick,
      action,
      detail: missingSignals.length ? `Stress applies unresolved context gaps: ${missingSignals.slice(0, 3).join(", ")}.` : "Stress applies a moderate adverse context update.",
      repair: "Fetch lineups, injuries, suspensions, weather, and news before keeping the same action."
    }),
    robustnessCase({
      id: "data-quality-decay",
      label: "Data quality decays",
      probabilityShift: dataPenalty,
      bestPick,
      action,
      detail: `Data-quality stress reflects current data score ${formatPercent(diagnostics.dataQualityScore)} and provider uncertainty.`,
      repair: "Improve provider coverage or downgrade confidence until real data fills the gap."
    }),
    robustnessCase({
      id: "belief-expiry",
      label: "Belief expires before refresh",
      probabilityShift: monitoringPenalty,
      bestPick,
      action,
      detail: `Monitoring state is ${monitoringPlan.status}; stale belief should reduce trust in the edge.`,
      repair: "Rerun the belief state and monitoring plan before showing the candidate again."
    }),
    robustnessCase({
      id: "review-repair-pressure",
      label: "Review-loop repair pressure",
      probabilityShift: repairPenalty,
      bestPick,
      action,
      detail: `Review loop status is ${reviewLoop.status}; unresolved repairs should be priced into the decision.`,
      repair: reviewLoop.repairsApplied[0] ?? "Clear the review-loop release criteria before raising trust."
    }),
    robustnessCase({
      id: "actionability-downgrade",
      label: "Actionability downgrade",
      probabilityShift: actionabilityPenalty + confidencePenalty,
      bestPick,
      action,
      detail: `Actionability status is ${actionability.status} with score ${actionability.score}/100.`,
      repair: actionability.requiredBeforeAction[0] ?? "Clear actionability warnings and failed gates."
    })
  ];
  const survives = cases.filter((item) => item.status === "survives").length;
  const survivalRate = cases.length ? survives / cases.length : 0;
  const worstCase = cases.reduce((worst, item) => {
    const itemScore = item.edgeAfterShock ?? -1;
    const worstScore = worst.edgeAfterShock ?? -1;
    return itemScore < worstScore ? item : worst;
  }, cases[0]);
  const score = boundScore(
    survivalRate * 68 +
      (bestPick.hasValue ? Math.max(0, Math.min(18, bestPick.edge * 120)) : 0) +
      (actionability.status === "actionable" ? 8 : actionability.status === "watch-only" ? 3 : 0) +
      (reviewLoop.status === "cleared" || reviewLoop.status === "repaired" ? 6 : 0)
  );
  const status: DecisionRobustnessAudit["status"] = score >= 78 && survivalRate >= 0.75 ? "robust" : score >= 48 && survivalRate >= 0.45 ? "sensitive" : "fragile";
  const hedgeSuggestions = saferAlternatives
    .filter((alternative) => alternative.risk === "low" || alternative.risk === "medium")
    .slice(0, 4)
    .map((alternative) => `${alternative.market}: ${alternative.selection} at model ${formatPercent(alternative.modelProbability)}.`);
  const requiredRechecks = Array.from(
    new Set([
      ...cases.filter((item) => item.status !== "survives").map((item) => `${item.label}: ${item.repair}`),
      ...monitoringPlan.tasks.slice(0, 2).map((task) => `${task.label}: ${task.action}`),
      ...reviewLoop.releaseCriteria.slice(0, 2)
    ])
  ).slice(0, 8);
  const summary =
    status === "robust"
      ? `Robustness is ${score}/100: ${survives}/${cases.length} stress tests preserve the current action.`
      : status === "sensitive"
        ? `Robustness is ${score}/100: ${survives}/${cases.length} stress tests survive; keep rechecks active before trust.`
        : `Robustness is ${score}/100: only ${survives}/${cases.length} stress tests survive, so the recommendation is fragile.`;

  return {
    status,
    score,
    survivalRate,
    worstCase,
    summary,
    cases,
    hedgeSuggestions,
    requiredRechecks
  };
}
