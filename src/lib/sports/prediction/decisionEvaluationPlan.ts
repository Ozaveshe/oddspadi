import type {
  BestPickResult,
  DecisionAction,
  DecisionEvaluationPlan,
  DecisionLearningProfile,
  DecisionMonitoringPlan,
  DecisionReviewLoop,
  DecisionRobustnessAudit,
  Match
} from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";

/**
 * Defines how a decision will be settled, calibrated, and learned from after the event.
 * The plan is pure and preserves abstentions as auditable outcomes rather than discarded rows.
 */
export function buildDecisionEvaluationPlan({
  match,
  bestPick,
  action,
  monitoringPlan,
  reviewLoop,
  robustness,
  learningProfile
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  monitoringPlan: DecisionMonitoringPlan;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
  learningProfile?: DecisionLearningProfile;
}): DecisionEvaluationPlan {
  const status: DecisionEvaluationPlan["status"] = action === "consider" && bestPick.hasValue ? "track-value" : action === "monitor" ? "watch-only" : "no-action";
  const hasPick = bestPick.hasValue;
  const marketLabel = hasPick ? bestPick.marketId.replaceAll("_", " ") : null;
  const targetClosingLineValue = status === "track-value" ? 0.02 : null;
  const baseSignals: DecisionEvaluationPlan["requiredOutcomeSignals"] = [
    {
      id: "settled-result",
      label: "Settled match and market result",
      status: hasPick ? "required" : "pending",
      source: "result",
      detail: hasPick
        ? `Settle whether ${bestPick.label} won for ${match.homeTeam.name} vs ${match.awayTeam.name}.`
        : "Store the final match result so no-pick decisions can still be audited."
    },
    {
      id: "closing-odds",
      label: "Closing odds snapshot",
      status: hasPick ? "required" : "optional",
      source: "closing-odds",
      detail: hasPick
        ? `Capture closing odds for ${bestPick.label} and compare them with the quoted ${formatOdds(bestPick.odds)}.`
        : "Closing odds are optional when the engine abstained."
    },
    {
      id: "context-resolution",
      label: "Late context resolution",
      status: monitoringPlan.status === "blocked" ? "required" : "pending",
      source: "context",
      detail: `Record whether monitoring tasks changed the thesis before kickoff: ${monitoringPlan.tasks
        .slice(0, 3)
        .map((task) => task.label)
        .join(", ") || "no open tasks"}.`
    },
    {
      id: "calibration-outcome",
      label: "Calibration outcome row",
      status: "required",
      source: "calibration",
      detail: "Link the settled outcome to this decision run so confidence, health, Brier score, ROI, and CLV can be measured."
    }
  ];
  const successCriteria = hasPick
    ? [
        `${bestPick.label} settles as correct for the chosen market.`,
        `Closing-line value is at least ${targetClosingLineValue === null ? "positive" : formatSignedPercent(targetClosingLineValue)} or the closing no-vig probability confirms the edge.`,
        `Settled outcome improves calibration for ${bestPick.confidence}-confidence ${bestPick.risk}-risk decisions.`,
        `No unresolved review-loop release criterion would have blocked the pick at kickoff.`
      ]
    : [
        "The abstention remains justified after final odds and context are known.",
        "No avoided market closes with a clear positive edge that the current model should have captured."
      ];
  const failureCriteria = hasPick
    ? [
        `${bestPick.label} loses or pushes against the selected market settlement rules.`,
        "Closing odds move against the thesis enough to erase the pre-match value edge.",
        `A required recheck was missed: ${(robustness.requiredRechecks[0] ?? reviewLoop.releaseCriteria[0] ?? "fresh odds and context").replace(/\.$/, "")}.`,
        "The outcome joins similar stored cases that later discount this pattern."
      ]
    : [
        "Final market data shows a positive expected-value pick that the agent missed.",
        "The abstention was caused by provider gaps that should be fixed before similar matches."
      ];
  const learningQuestions = hasPick
    ? [
        `Was ${formatPercent(bestPick.modelProbability)} model probability calibrated against the binary settlement result?`,
        `Did the no-vig market probability of ${formatPercent(bestPick.noVigImpliedProbability)} underprice the selection at decision time?`,
        "Did closing odds validate the edge or expose stale market data?",
        "Did the unresolved monitoring or review-loop checks predict the final risk?"
      ]
    : [
        "Did the no-action decision avoid a false positive?",
        "Which missing provider signal most limited the model?",
        "Would real historical thresholds have changed the abstention?"
      ];
  const postMatchActions = [
    "Store the settled outcome through the decision outcome endpoint with the linked decision_run_id.",
    "Recompute calibration by confidence and decision health after settlement.",
    "Compare quoted odds with closing odds for closing-line value.",
    learningProfile?.active
      ? "Feed the settled row into the next real-data backtest window."
      : "Keep learned thresholds inactive until enough real historical fixtures and odds are imported."
  ];
  const summary =
    status === "track-value" && hasPick
      ? `Evaluation plan will grade ${bestPick.label}: model ${formatPercent(bestPick.modelProbability)}, no-vig ${formatPercent(
          bestPick.noVigImpliedProbability
        )}, break-even ${formatPercent(1 / bestPick.odds)}, edge ${formatSignedPercent(bestPick.edge)}, EV ${formatSignedPercent(bestPick.expectedValue)}.`
      : status === "watch-only"
        ? "Evaluation plan keeps this on watch: settle the final result and inspect whether missing context or price movement would have changed the action."
        : "Evaluation plan records the abstention so future calibration can learn whether avoiding the market was correct.";

  return {
    status,
    settlementMarket: marketLabel,
    settlementSelection: hasPick ? bestPick.label : null,
    modelProbability: hasPick ? bestPick.modelProbability : null,
    noVigMarketProbability: hasPick ? bestPick.noVigImpliedProbability : null,
    breakEvenProbability: hasPick ? 1 / bestPick.odds : null,
    quotedOdds: hasPick ? bestPick.odds : null,
    valueEdge: hasPick ? bestPick.edge : null,
    expectedValue: hasPick ? bestPick.expectedValue : null,
    targetClosingLineValue,
    summary,
    successCriteria,
    failureCriteria,
    learningQuestions,
    requiredOutcomeSignals: baseSignals,
    postMatchActions
  };
}
