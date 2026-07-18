import type {
  BestPickResult,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionBoundary,
  DecisionBoundaryMetric,
  DecisionBoundaryMetricStatus,
  DecisionDataCoverageAudit,
  DecisionLearningProfile,
  DecisionMarketMovement,
  DecisionProbabilityTrace,
  DecisionRobustnessAudit,
  DecisionUncertaintyDecomposition,
  FootballModelDiagnostics
} from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";
import { BASELINE_MINIMUM_VALUE_EDGE } from "./odds";

function learnedNumber(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
function boundaryMetricStatus(margin: number | null, nearBand: number): DecisionBoundaryMetricStatus {
  if (margin === null) return "breached";
  if (margin <= 0) return "breached";
  if (margin <= nearBand) return "near";
  return "safe";
}

function formatBoundaryValue(kind: DecisionBoundaryMetric["kind"], value: number | null, role: "value" | "margin" = "value"): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (kind === "odds-floor") {
    if (role === "margin") return `${value >= 0 ? "+" : ""}${value.toFixed(2)} odds`;
    return formatOdds(value);
  }
  if (kind === "score-floor" || kind === "data-quality-floor" || kind === "uncertainty-ceiling") {
    if (role === "margin") return `${value >= 0 ? "+" : ""}${Math.round(value)} pts`;
    return `${Math.round(value)}/100`;
  }
  if (role === "margin") return formatSignedPercent(value);
  if (kind === "probability-floor" || kind === "price-shortening") return formatPercent(value);
  return formatSignedPercent(value);
}

function buildBoundaryMetric({
  id,
  kind,
  label,
  current,
  threshold,
  higherIsBetter = true,
  nearBand,
  detail
}: {
  id: string;
  kind: DecisionBoundaryMetric["kind"];
  label: string;
  current: number | null;
  threshold: number | null;
  higherIsBetter?: boolean;
  nearBand: number;
  detail: string;
}): DecisionBoundaryMetric {
  const hasNumbers = typeof current === "number" && Number.isFinite(current) && typeof threshold === "number" && Number.isFinite(threshold);
  const margin = hasNumbers ? (higherIsBetter ? current - threshold : threshold - current) : null;
  return {
    id,
    kind,
    label,
    current,
    threshold,
    margin,
    status: boundaryMetricStatus(margin, nearBand),
    detail
  };
}

/**
 * Computes the measurable thresholds that would preserve or flip a public decision.
 * This function is pure: every boundary is derived from the supplied report state.
 */
export function buildDecisionBoundary({
  diagnostics,
  bestPick,
  action,
  decisionScore,
  learningProfile,
  probabilityTrace,
  marketMovement,
  dataCoverage,
  uncertainty,
  robustness,
  abstentionRules
}: {
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  action: DecisionAction;
  decisionScore: number;
  learningProfile?: DecisionLearningProfile;
  probabilityTrace: DecisionProbabilityTrace;
  marketMovement: DecisionMarketMovement;
  dataCoverage: DecisionDataCoverageAudit;
  uncertainty: DecisionUncertaintyDecomposition;
  robustness: DecisionRobustnessAudit;
  abstentionRules: DecisionAbstentionRule[];
}): DecisionBoundary {
  const learnedMinimumEdge = learningProfile?.active ? learnedNumber(learningProfile.minimumEdge, 0.035, 0.02, 0.09) : null;
  const minimumEdge = learnedMinimumEdge ?? BASELINE_MINIMUM_VALUE_EDGE;
  const currentProbability = bestPick.hasValue ? (probabilityTrace.posteriorProbability ?? bestPick.modelProbability) : null;
  const breakEvenProbability = bestPick.hasValue ? 1 / bestPick.odds : null;
  const posteriorFairOdds = currentProbability && currentProbability > 0 ? 1 / currentProbability : null;
  const currentOdds = bestPick.hasValue ? bestPick.odds : null;
  const currentEdge = bestPick.hasValue ? (probabilityTrace.posteriorEdge ?? bestPick.edge) : null;
  const currentExpectedValue = bestPick.hasValue ? (probabilityTrace.posteriorExpectedValue ?? bestPick.expectedValue) : null;
  const dataQualityScore = diagnostics.dataQualityScore * 100;
  const shockTolerance =
    bestPick.hasValue && robustness.worstCase
      ? Math.min(robustness.worstCase.edgeAfterShock ?? bestPick.edge, robustness.worstCase.expectedValueAfterShock ?? bestPick.expectedValue)
      : null;
  const priceShorteningRoom = marketMovement.maxShorteningBeforeNoValue;
  const noVigFloor = bestPick.hasValue ? bestPick.noVigImpliedProbability : null;
  const edgeNearBand = Math.max(0.03, minimumEdge);

  const metrics = [
    buildBoundaryMetric({
      id: "probability-floor",
      kind: "probability-floor",
      label: "Probability floor",
      current: currentProbability,
      threshold: breakEvenProbability,
      nearBand: 0.025,
      detail:
        currentProbability !== null && breakEvenProbability !== null
          ? `Posterior probability is ${formatPercent(currentProbability)} versus break-even ${formatPercent(
              breakEvenProbability
            )}; no-vig market floor is ${noVigFloor === null ? "N/A" : formatPercent(noVigFloor)}.`
          : "No priced candidate exists, so the probability floor is breached."
    }),
    buildBoundaryMetric({
      id: "odds-floor",
      kind: "odds-floor",
      label: "Odds floor",
      current: currentOdds,
      threshold: posteriorFairOdds,
      nearBand: 0.04,
      detail:
        currentOdds !== null && posteriorFairOdds !== null
          ? `Quoted odds ${formatOdds(currentOdds)} must stay at or above posterior fair odds ${formatOdds(posteriorFairOdds)}.`
          : "No offered odds or posterior probability exists for a fair-odds floor."
    }),
    buildBoundaryMetric({
      id: "edge-floor",
      kind: "edge-floor",
      label: "No-vig edge floor",
      current: currentEdge,
      threshold: minimumEdge,
      nearBand: edgeNearBand,
      detail:
        currentEdge !== null
          ? `Current edge is ${formatSignedPercent(currentEdge)}; ${
              learnedMinimumEdge !== null
                ? `learned minimum edge is ${formatSignedPercent(learnedMinimumEdge)}`
                : `conservative baseline is ${formatSignedPercent(BASELINE_MINIMUM_VALUE_EDGE)}`
            }.`
          : "No priced candidate exists, so no-vig edge cannot clear the floor."
    }),
    buildBoundaryMetric({
      id: "ev-floor",
      kind: "ev-floor",
      label: "Expected-value floor",
      current: currentExpectedValue,
      threshold: 0,
      nearBand: 0.035,
      detail:
        currentExpectedValue !== null
          ? `Current expected value is ${formatSignedPercent(currentExpectedValue)}; EV at or below zero removes value.`
          : "No priced candidate exists, so expected value cannot clear the floor."
    }),
    buildBoundaryMetric({
      id: "score-floor",
      kind: "score-floor",
      label: "Decision-score floor",
      current: decisionScore,
      threshold: 24,
      nearBand: 6,
      detail: `Decision score is ${decisionScore}/100; lean-value consideration starts at 24, while strong value starts at 42 with high confidence.`
    }),
    buildBoundaryMetric({
      id: "data-quality-floor",
      kind: "data-quality-floor",
      label: "Data-quality floor",
      current: dataQualityScore,
      threshold: 62,
      nearBand: 8,
      detail: `Model data quality is ${formatPercent(diagnostics.dataQualityScore)} and coverage audit score is ${dataCoverage.score}/100; below 62/100 hard-blocks trust.`
    }),
    buildBoundaryMetric({
      id: "uncertainty-ceiling",
      kind: "uncertainty-ceiling",
      label: "Uncertainty ceiling",
      current: uncertainty.score,
      threshold: 66,
      higherIsBetter: false,
      nearBand: 10,
      detail: `Uncertainty score is ${uncertainty.score}/100; 66/100 or higher is high-risk unless mitigated.`
    }),
    buildBoundaryMetric({
      id: "context-shock",
      kind: "context-shock",
      label: "Context-shock tolerance",
      current: shockTolerance,
      threshold: 0,
      nearBand: 0.025,
      detail:
        shockTolerance !== null
          ? `Worst-case stress still leaves minimum edge/EV margin at ${formatSignedPercent(shockTolerance)}.`
          : "No selected side exists, so context-shock tolerance is unavailable."
    }),
    buildBoundaryMetric({
      id: "price-shortening",
      kind: "price-shortening",
      label: "Price-shortening room",
      current: priceShorteningRoom,
      threshold: 0.03,
      nearBand: 0.02,
      detail:
        priceShorteningRoom !== null
          ? `The price can shorten about ${formatPercent(priceShorteningRoom)} before value disappears; below 3% is execution-sensitive.`
          : "No market movement buffer exists without a priced candidate."
    })
  ];

  const triggeredAbstentions = abstentionRules.filter((rule) => rule.triggered);
  const breachedMetrics = metrics.filter((metric) => metric.status === "breached");
  const nearMetrics = metrics.filter((metric) => metric.status === "near");
  const nearest =
    [...breachedMetrics, ...nearMetrics].sort((a, b) => Math.abs(a.margin ?? 0) - Math.abs(b.margin ?? 0))[0] ??
    metrics
      .filter((metric) => metric.margin !== null)
      .sort((a, b) => Math.abs(a.margin ?? Number.POSITIVE_INFINITY) - Math.abs(b.margin ?? Number.POSITIVE_INFINITY))[0] ??
    metrics[0];
  const status: DecisionBoundary["status"] =
    action === "avoid" || breachedMetrics.length > 0 || triggeredAbstentions.length > 0
      ? "blocked"
      : nearMetrics.length > 0
        ? "near-flip"
        : uncertainty.status !== "controlled" || dataCoverage.status !== "provider-backed" || action !== "consider"
          ? "at-risk"
          : "comfortable";
  const flipTriggers = Array.from(
    new Set([
      ...breachedMetrics.map((metric) => `${metric.label} breached: ${metric.detail}`),
      ...nearMetrics.map((metric) => `${metric.label} is near the boundary: ${metric.detail}`),
      ...triggeredAbstentions.map((rule) => `${rule.label}: ${rule.detail}`)
    ])
  ).slice(0, 10);
  const requiredToStayConsider = bestPick.hasValue
    ? [
        `${bestPick.label} posterior probability stays above break-even ${formatBoundaryValue("probability-floor", breakEvenProbability)}.`,
        `Quoted odds stay at or above posterior fair odds ${formatBoundaryValue("odds-floor", posteriorFairOdds)}.`,
        learnedMinimumEdge !== null
          ? `No-vig edge stays above learned minimum ${formatSignedPercent(learnedMinimumEdge)}.`
          : `No-vig edge stays above the conservative baseline ${formatSignedPercent(BASELINE_MINIMUM_VALUE_EDGE)}.`,
        "Decision score stays at or above 24 and no hard abstention gate triggers.",
        "Model data quality stays at or above 62/100.",
        "Uncertainty stays below 66/100 and context-shock stress keeps value above zero."
      ]
    : [
        "Load a priced candidate that clears positive no-vig edge and positive expected value.",
        "Raise decision score to at least 24 without triggering data-quality, live-model, learned-edge, or case-memory abstention gates.",
        "Connect enough provider data to keep model data quality at or above 62/100."
      ];
  const nearestMargin = nearest?.margin ?? null;
  const nearestFlip = nearest
    ? `${nearest.label}: ${
        nearestMargin === null ? "no measurable margin" : formatBoundaryValue(nearest.kind, nearestMargin, "margin")
      } ${nearest.status === "breached" ? "past the boundary" : nearest.status === "near" ? "from flip" : "clearance"}.`
    : "No decision boundary metric was available.";
  const nextAction =
    status === "comfortable"
      ? "Keep the candidate visible only after fresh odds and context are confirmed."
      : status === "at-risk"
        ? "Use watchlist posture until data coverage or uncertainty improves."
        : status === "near-flip"
          ? "Refresh odds and priority context before treating this as a value candidate."
          : `Do not show as public value; clear ${breachedMetrics[0]?.label ?? triggeredAbstentions[0]?.label ?? "the blocking boundary"} and rerun.`;

  return {
    status,
    summary:
      status === "comfortable"
        ? `Decision boundary is comfortable; nearest flip is ${nearestFlip}`
        : status === "at-risk"
          ? `Decision boundary is at-risk; nearest flip is ${nearestFlip}`
          : status === "near-flip"
            ? `Decision boundary is near-flip; nearest flip is ${nearestFlip}`
            : `Decision boundary is blocked; nearest flip is ${nearestFlip}`,
    nearestFlip,
    flipMargin: nearestMargin,
    metrics,
    requiredToStayConsider,
    flipTriggers: flipTriggers.length ? flipTriggers : ["No active boundary pressure; refresh odds and context before public display."],
    nextAction
  };
}
