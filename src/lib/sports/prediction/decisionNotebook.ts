import type {
  BestPickResult,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionActionabilityAudit,
  DecisionBeliefState,
  DecisionCaseMemory,
  DecisionDataCoverageAudit,
  DecisionEvaluationPlan,
  DecisionLearningProfile,
  DecisionMonitoringPlan,
  DecisionNotebook,
  DecisionNotebookItem,
  DecisionResearchBrief,
  DecisionReviewLoop,
  DecisionRobustnessAudit,
  Match
} from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";
import { formatFairOdds } from "./decisionMarketIntelligence";

function notebookItem({
  id,
  label,
  priority,
  status,
  source,
  detail,
  action,
  dueAt = null
}: DecisionNotebookItem): DecisionNotebookItem {
  return {
    id,
    label,
    priority,
    status,
    source,
    detail,
    action,
    dueAt
  };
}
/**
 * Builds the auditable assumption, falsifier, refresh, and operator-check ledger for a decision.
 * The notebook is pure and keeps blocked conditions explicit for downstream monitoring.
 */
export function buildDecisionNotebook({
  match,
  bestPick,
  action,
  missingSignals,
  abstentionRules,
  dataCoverage,
  beliefState,
  monitoringPlan,
  actionability,
  reviewLoop,
  robustness,
  evaluationPlan,
  caseMemory,
  researchBrief,
  learningProfile
}: {
  match: Match;
  bestPick: BestPickResult;
  action: DecisionAction;
  missingSignals: string[];
  abstentionRules: DecisionAbstentionRule[];
  dataCoverage: DecisionDataCoverageAudit;
  beliefState: DecisionBeliefState;
  monitoringPlan: DecisionMonitoringPlan;
  actionability: DecisionActionabilityAudit;
  reviewLoop: DecisionReviewLoop;
  robustness: DecisionRobustnessAudit;
  evaluationPlan: DecisionEvaluationPlan;
  caseMemory: DecisionCaseMemory;
  researchBrief: DecisionResearchBrief;
  learningProfile?: DecisionLearningProfile;
}): DecisionNotebook {
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const status: DecisionNotebook["status"] =
    actionability.status === "blocked" || triggeredRules.length ? "blocked" : actionability.status === "watch-only" || reviewLoop.status !== "cleared" ? "needs-review" : "ready";
  const candidate = bestPick.hasValue ? bestPick.label : "No clear value candidate";
  const assumptions: DecisionNotebookItem[] = [
    notebookItem({
      id: "model-probability-holds",
      label: "Model probability remains valid",
      priority: bestPick.hasValue ? "high" : "medium",
      status: bestPick.hasValue ? "open" : "blocked",
      source: "model",
      detail: bestPick.hasValue
        ? `${candidate} is currently modeled at ${formatPercent(bestPick.modelProbability)} with ${formatSignedPercent(bestPick.edge)} no-vig edge.`
        : "No modeled candidate clears the value guardrail.",
      action: "Rerun the sport model after any lineup, injury, weather, odds, or live-state update.",
      dueAt: beliefState.expiresAt
    }),
    notebookItem({
      id: "market-price-still-available",
      label: "Market price still supports the thesis",
      priority: "critical",
      status: bestPick.hasValue && bestPick.expectedValue > 0 ? "open" : "blocked",
      source: "market",
      detail: bestPick.hasValue
        ? `Quoted odds ${formatOdds(bestPick.odds)} imply EV ${formatSignedPercent(bestPick.expectedValue)} after margin removal.`
        : "Market prices do not create positive expected value.",
      action: "Refresh bookmaker odds and recompute raw implied probability, no-vig probability, edge, and EV.",
      dueAt: monitoringPlan.tasks.find((task) => task.id === "odds-refresh")?.dueAt ?? monitoringPlan.nextReviewAt
    }),
    notebookItem({
      id: "missing-context-not-adverse",
      label: "Missing context does not overturn the thesis",
      priority: missingSignals.length >= 3 ? "high" : "medium",
      status: missingSignals.length >= 5 ? "blocked" : "open",
      source: "context",
      detail: missingSignals.length ? `Open context gaps: ${missingSignals.slice(0, 5).join(", ")}.` : "No major missing context was recorded by the decision engine.",
      action: "Fetch the highest-priority missing provider signals before keeping the same action.",
      dueAt: monitoringPlan.nextReviewAt
    }),
    notebookItem({
      id: "memory-does-not-abstain",
      label: "Stored case memory does not block the pattern",
      priority: caseMemory.adjustment === "abstain" ? "critical" : caseMemory.adjustment === "discount" ? "high" : "low",
      status: caseMemory.adjustment === "abstain" ? "blocked" : caseMemory.status === "ready" ? "satisfied" : "open",
      source: "memory",
      detail: caseMemory.summary,
      action: caseMemory.status === "ready" ? "Use similar-case results in the next calibration review." : "Connect valid Supabase credentials and collect stored decisions.",
      dueAt: null
    }),
    notebookItem({
      id: "training-profile-eligible",
      label: "Historical training profile is eligible",
      priority: learningProfile?.active ? "low" : "medium",
      status: learningProfile?.active ? "satisfied" : "open",
      source: "training",
      detail: learningProfile?.reason ?? "Real historical training guardrails are not active yet.",
      action: learningProfile?.active ? "Keep monitoring learned thresholds against settled outcomes." : "Import real historical fixtures, odds, features, and closing prices before activating learned guardrails.",
      dueAt: null
    })
  ];

  const falsifiers: DecisionNotebookItem[] = [
    notebookItem({
      id: "odds-shorten-below-edge",
      label: "Odds shorten enough to erase value",
      priority: "critical",
      status: bestPick.hasValue ? "open" : "blocked",
      source: "market",
      detail: bestPick.hasValue
        ? `Remove the thesis if refreshed edge or EV is no longer positive; current fair odds ${formatFairOdds(bestPick.modelProbability)}.`
        : "No value thesis exists to falsify.",
      action: "Downgrade to avoid when no-vig edge or EV falls to zero or below.",
      dueAt: monitoringPlan.nextReviewAt
    }),
    notebookItem({
      id: "adverse-provider-context",
      label: "Adverse injury, lineup, weather, or live event appears",
      priority: missingSignals.length ? "high" : "medium",
      status: "open",
      source: "context",
      detail: robustness.cases.find((item) => item.id === "adverse-context")?.detail ?? "Adverse context can invalidate the current probability view.",
      action: "Apply the provider context update and rerun actionability before showing the pick.",
      dueAt: monitoringPlan.nextReviewAt
    }),
    notebookItem({
      id: "belief-expires",
      label: "Belief expires before refresh",
      priority: "high",
      status: "open",
      source: "risk",
      detail: beliefState.summary,
      action: "Hide or downgrade the recommendation if the belief expires without a fresh decision run.",
      dueAt: beliefState.expiresAt
    }),
    notebookItem({
      id: "review-loop-blocks",
      label: "Review loop blocks or downgrades the action",
      priority: reviewLoop.status === "blocked" ? "critical" : reviewLoop.status === "downgraded" ? "high" : "medium",
      status: reviewLoop.status === "blocked" ? "blocked" : reviewLoop.status === "cleared" ? "satisfied" : "open",
      source: "risk",
      detail: reviewLoop.summary,
      action: reviewLoop.releaseCriteria[0] ?? "Clear review-loop release criteria before raising trust.",
      dueAt: monitoringPlan.nextReviewAt
    }),
    ...triggeredRules.slice(0, 3).map((rule) =>
      notebookItem({
        id: `abstention-${rule.id}`,
        label: `Abstention gate: ${rule.label}`,
        priority: "critical",
        status: "blocked",
        source: "risk",
        detail: rule.detail,
        action: "Keep the decision avoided until this gate clears.",
        dueAt: monitoringPlan.nextReviewAt
      })
    )
  ];

  const refreshTriggers: DecisionNotebookItem[] = monitoringPlan.tasks.slice(0, 6).map((task) =>
    notebookItem({
      id: `refresh-${task.id}`,
      label: task.label,
      priority: task.priority,
      status: "open",
      source: task.source === "market" ? "market" : task.source === "memory" ? "memory" : task.source === "training" ? "training" : "context",
      detail: task.trigger,
      action: task.action,
      dueAt: task.dueAt
    })
  );

  const operatorChecklist: DecisionNotebookItem[] = Array.from(
    new Set([
      ...researchBrief.requiredChecks,
      ...actionability.requiredBeforeAction,
      ...dataCoverage.requiredBeforeTrust,
      ...evaluationPlan.requiredOutcomeSignals.filter((signal) => signal.status === "required").map((signal) => `${signal.label}: ${signal.detail}`)
    ])
  )
    .slice(0, 10)
    .map((item, index) =>
      notebookItem({
        id: `operator-check-${index + 1}`,
        label: item.split(":")[0] || `Operator check ${index + 1}`,
        priority: index < 2 ? "high" : "medium",
        status: item.toLowerCase().includes("invalid") || item.toLowerCase().includes("missing") ? "blocked" : "open",
        source: item.toLowerCase().includes("odds") ? "market" : item.toLowerCase().includes("settled") ? "settlement" : "operator",
        detail: item,
        action: "Complete this check, then rerun the decision engine before trusting the current posture.",
        dueAt: index < 4 ? monitoringPlan.nextReviewAt : null
      })
    );

  const auditTrail = [
    `Notebook opened for ${match.homeTeam.name} vs ${match.awayTeam.name}.`,
    `Candidate: ${candidate}; action: ${action}; notebook status: ${status}.`,
    `Research posture: ${researchBrief.analystPosture}`,
    `Data coverage: ${dataCoverage.summary}`,
    `Actionability: ${actionability.summary}`,
    `Review loop: ${reviewLoop.summary}`,
    `Robustness: ${robustness.summary}`
  ];

  return {
    status,
    summary:
      status === "ready"
        ? `Notebook is ready: assumptions are tracked and no blocking operator item is open for ${candidate}.`
        : status === "needs-review"
          ? `Notebook needs review: ${operatorChecklist.filter((item) => item.status !== "satisfied").length} operator check(s) remain before trusting ${candidate}.`
          : `Notebook is blocked: ${falsifiers.filter((item) => item.status === "blocked").length} falsifier or abstention condition(s) prevent public trust.`,
    assumptions,
    falsifiers,
    refreshTriggers,
    operatorChecklist,
    auditTrail,
    nextReviewAt: monitoringPlan.nextReviewAt
  };
}
