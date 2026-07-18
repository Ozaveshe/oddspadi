import type {
  BestPickResult,
  DecisionAbstentionRule,
  DecisionAction,
  DecisionBeliefState,
  DecisionCalibration,
  DecisionCaseMemory,
  DecisionProbabilityTrace,
  DecisionProbabilityTraceStep,
  FootballModelDiagnostics,
  LearnedProbabilityCalibrationAdjustment,
  MarketPriorAdjustment,
  MatchContextAdjustment
} from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "./format";

export type DecisionProbabilityRuntimeStages = {
  rawModelProbability: number | null;
  contextAdjustedProbability: number | null;
  learnedCalibratedProbability: number | null;
  finalModelProbability: number | null;
};

const TRACE_MIN = 0;
const TRACE_MAX = 1;
const LOG_ODDS_EPSILON = 0.000001;

function boundedProbability(value: number): number {
  return Math.max(TRACE_MIN, Math.min(TRACE_MAX, value));
}

function finiteProbability(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? boundedProbability(value) : null;
}

function probabilityToLogOdds(value: number): number {
  const bounded = Math.max(LOG_ODDS_EPSILON, Math.min(1 - LOG_ODDS_EPSILON, value));
  return Math.log(bounded / (1 - bounded));
}

function runtimeStep({
  id,
  kind,
  label,
  priorProbability,
  posteriorProbability,
  weight,
  confidence,
  detail,
  forceApplied = false
}: {
  id: string;
  kind: DecisionProbabilityTraceStep["kind"];
  label: string;
  priorProbability: number | null;
  posteriorProbability: number | null;
  weight: number;
  confidence: DecisionProbabilityTraceStep["confidence"];
  detail: string;
  forceApplied?: boolean;
}): DecisionProbabilityTraceStep {
  const prior = finiteProbability(priorProbability);
  const posterior = finiteProbability(posteriorProbability);
  if (prior === null || posterior === null) {
    return {
      id,
      kind,
      label,
      status: "skipped",
      priorProbability: prior,
      posteriorProbability: posterior,
      probabilityDelta: null,
      logOddsDelta: 0,
      weight: 0,
      confidence: "low",
      detail: `${detail} This runtime stage did not expose a finite probability snapshot.`
    };
  }

  const probabilityDelta = posterior - prior;
  return {
    id,
    kind,
    label,
    status: forceApplied || Math.abs(probabilityDelta) >= 0.0000001 ? "applied" : "skipped",
    priorProbability: prior,
    posteriorProbability: posterior,
    probabilityDelta,
    logOddsDelta: probabilityToLogOdds(posterior) - probabilityToLogOdds(prior),
    weight: Math.max(0, Math.min(1, weight)),
    confidence,
    detail
  };
}

/**
 * Replays the actual probability snapshots produced by the runtime pipeline.
 * Decision gates can block or downgrade an action, but never invent a second
 * probability update after value edges have already been calculated.
 */
export function buildDecisionProbabilityTrace({
  diagnostics,
  bestPick,
  probabilityStages,
  contextAdjustment,
  probabilityCalibration,
  marketPriorAdjustment,
  caseMemory,
  abstentionRules,
  calibration,
  action,
  beliefState
}: {
  diagnostics: FootballModelDiagnostics;
  bestPick: BestPickResult;
  probabilityStages?: DecisionProbabilityRuntimeStages;
  contextAdjustment?: MatchContextAdjustment;
  probabilityCalibration?: LearnedProbabilityCalibrationAdjustment;
  marketPriorAdjustment?: MarketPriorAdjustment;
  caseMemory: DecisionCaseMemory;
  abstentionRules: DecisionAbstentionRule[];
  calibration: DecisionCalibration;
  action: DecisionAction;
  beliefState: DecisionBeliefState;
}): DecisionProbabilityTrace {
  if (!bestPick.hasValue) {
    return {
      status: "blocked",
      summary: "Probability trace is blocked because no priced selection passed the value guardrail.",
      selection: null,
      marketId: null,
      basePriorProbability: null,
      modelProbability: null,
      posteriorProbability: null,
      posteriorEdge: null,
      posteriorExpectedValue: null,
      disagreement: null,
      confidenceBand: { low: null, high: null },
      clampRange: { min: TRACE_MIN, max: TRACE_MAX },
      steps: [
        {
          id: "no-selection",
          kind: "posterior",
          label: "No priced candidate",
          status: "skipped",
          priorProbability: null,
          posteriorProbability: null,
          probabilityDelta: null,
          logOddsDelta: 0,
          weight: 0,
          confidence: "low",
          detail: "The engine cannot expose a runtime probability path until a selection has model probability, no-vig market probability, and odds."
        }
      ],
      conflicts: ["No selection passed the value, EV, and confidence guardrails."],
      safeguards: [
        "Do not infer a probability path without a priced candidate.",
        "Rerun after fresh odds create a positive no-vig edge and positive expected value."
      ]
    };
  }

  const noVigMarketProbability = boundedProbability(bestPick.noVigImpliedProbability);
  const finalModelProbability = finiteProbability(probabilityStages?.finalModelProbability) ?? boundedProbability(bestPick.modelProbability);
  const rawModelProbability = finiteProbability(probabilityStages?.rawModelProbability);
  const contextAdjustedProbability = finiteProbability(probabilityStages?.contextAdjustedProbability);
  const learnedCalibratedProbability = finiteProbability(probabilityStages?.learnedCalibratedProbability);
  const stageSnapshotMissing = !probabilityStages || [rawModelProbability, contextAdjustedProbability, learnedCalibratedProbability].some((value) => value === null);
  const finalStageMismatch =
    probabilityStages?.finalModelProbability !== null &&
    probabilityStages?.finalModelProbability !== undefined &&
    Math.abs(finalModelProbability - bestPick.modelProbability) > 0.0000001;
  const selectedMarketPrior = marketPriorAdjustment?.markets.find((market) => market.marketId === bestPick.marketId);
  const selectedMarketPriorConfidence = !selectedMarketPrior
    ? "low" as const
    : selectedMarketPrior.priorMethod === "median-no-vig-v1" &&
        selectedMarketPrior.bookmakerCount >= 3 &&
        selectedMarketPrior.maxProbabilitySpread !== null &&
        selectedMarketPrior.maxProbabilitySpread <= 0.06
      ? "high" as const
      : selectedMarketPrior.priorMethod === "median-no-vig-v1"
        ? "medium" as const
        : "low" as const;

  const steps: DecisionProbabilityTraceStep[] = [
    runtimeStep({
      id: "model-evidence",
      kind: "model-evidence",
      label: "Raw sport-model probability",
      priorProbability: rawModelProbability,
      posteriorProbability: rawModelProbability,
      weight: 1,
      confidence: bestPick.confidence,
      forceApplied: rawModelProbability !== null,
      detail: "Probability emitted by the sport model before residual context, promoted calibration, or bookmaker-prior blending."
    }),
    runtimeStep({
      id: "context-evidence",
      kind: "context",
      label: "Residual context adjustment",
      priorProbability: rawModelProbability,
      posteriorProbability: contextAdjustedProbability,
      weight: contextAdjustment?.applied ? 1 : 0,
      confidence: contextAdjustment?.applied ? "medium" : "low",
      detail: contextAdjustment?.applied
        ? `Actual post-context snapshot after ${contextAdjustment.signals.length} structured signal(s).`
        : "No residual context probability shift was applied after the sport model."
    }),
    runtimeStep({
      id: "learned-calibration",
      kind: "calibration",
      label: "Promoted learned calibration",
      priorProbability: contextAdjustedProbability,
      posteriorProbability: learnedCalibratedProbability,
      weight: probabilityCalibration?.status === "applied" ? 1 : 0,
      confidence: probabilityCalibration?.status === "applied" ? "high" : "low",
      detail: probabilityCalibration?.summary ?? "No promoted learned calibration snapshot was supplied."
    }),
    runtimeStep({
      id: "market-calibration",
      kind: "market-calibration",
      label: selectedMarketPrior?.priorMethod === "median-no-vig-v1"
        ? "Multi-book no-vig prior blend"
        : "Single-quote no-vig prior blend",
      priorProbability: learnedCalibratedProbability,
      posteriorProbability: finalModelProbability,
      weight: selectedMarketPrior?.weight ?? 0,
      confidence: selectedMarketPriorConfidence,
      detail: selectedMarketPrior
        ? selectedMarketPrior.priorMethod === "median-no-vig-v1"
          ? `Actual final runtime snapshot after a ${formatPercent(selectedMarketPrior.weight)} median no-vig blend across ${selectedMarketPrior.bookmakerCount} bookmaker${selectedMarketPrior.bookmakerCount === 1 ? "" : "s"}; widest probability disagreement ${formatPercent(selectedMarketPrior.maxProbabilitySpread ?? 0)}.`
          : `Actual final runtime snapshot after a ${formatPercent(selectedMarketPrior.weight)} one-book no-vig blend. No cross-book agreement is claimed.`
        : "No bookmaker-prior blend was applied."
    }),
    runtimeStep({
      id: "market-prior",
      kind: "market-prior",
      label: "No-vig market benchmark",
      priorProbability: noVigMarketProbability,
      posteriorProbability: noVigMarketProbability,
      weight: 1,
      confidence: "medium",
      forceApplied: true,
      detail: `Bookmaker-margin-adjusted market benchmark is ${formatPercent(noVigMarketProbability)}. It is a comparison baseline, not a second probability update.`
    }),
    runtimeStep({
      id: "posterior",
      kind: "posterior",
      label: "Final runtime decision probability",
      priorProbability: finalModelProbability,
      posteriorProbability: finalModelProbability,
      weight: 1,
      confidence: beliefState.grade === "strong" ? "high" : beliefState.grade === "moderate" ? "medium" : "low",
      forceApplied: true,
      detail: `The exact probability used for edge and EV ranking is ${formatPercent(finalModelProbability)}.`
    })
  ];

  const posteriorProbability = finalModelProbability;
  const posteriorEdge = posteriorProbability - noVigMarketProbability;
  const posteriorExpectedValue = posteriorProbability * bestPick.odds - 1;
  const disagreement = posteriorEdge;
  const confidenceBand = {
    low: beliefState.confidenceInterval.low,
    high: beliefState.confidenceInterval.high
  };
  const triggeredRules = abstentionRules.filter((rule) => rule.triggered);
  const conflicts = [
    Math.abs(disagreement) >= 0.1
      ? `Final runtime probability and no-vig market differ by ${formatSignedPercent(disagreement)}.`
      : "",
    diagnostics.dataQualityScore < 0.75 ? `Data quality ${formatPercent(diagnostics.dataQualityScore)} is below production trust level.` : "",
    caseMemory.adjustment !== "none" ? `Case memory requires ${caseMemory.adjustment}; it gates action without changing probability.` : "",
    calibration.action !== "trust" ? `Decision reliability requires ${calibration.action}; it gates trust without changing probability.` : "",
    posteriorExpectedValue <= 0 ? "Final runtime expected value is not positive." : "",
    stageSnapshotMissing ? "One or more upstream runtime probability snapshots are unavailable; the final selected probability remains authoritative." : "",
    finalStageMismatch ? "The supplied final runtime stage does not match the selected model probability." : "",
    ...triggeredRules.map((rule) => `Abstention gate triggered without mutating probability: ${rule.label}.`),
    ...(contextAdjustment?.riskFlags.slice(0, 2) ?? [])
  ].filter(Boolean);
  const status: DecisionProbabilityTrace["status"] =
    action === "avoid" || triggeredRules.length > 0 || posteriorExpectedValue <= 0 || finalStageMismatch
      ? "blocked"
      : action === "monitor" || posteriorExpectedValue < 0.04 || diagnostics.dataQualityScore < 0.72 || caseMemory.adjustment !== "none" || stageSnapshotMissing
        ? "watchlist"
        : "ready";

  return {
    status,
    summary:
      status === "ready"
        ? `Runtime probability trace is ready: final probability ${formatPercent(posteriorProbability)} versus no-vig ${formatPercent(
            noVigMarketProbability
          )}, with ${formatSignedPercent(posteriorEdge)} edge and ${formatSignedPercent(posteriorExpectedValue)} EV.`
        : status === "watchlist"
          ? `Runtime probability trace is on watch: final probability ${formatPercent(posteriorProbability)} is preserved, but evidence or action gates still require review.`
          : `Runtime probability trace is blocked: final probability ${formatPercent(posteriorProbability)} is preserved, but it does not clear the active action gates.`,
    selection: bestPick.label,
    marketId: bestPick.marketId,
    basePriorProbability: noVigMarketProbability,
    modelProbability: posteriorProbability,
    posteriorProbability,
    posteriorEdge,
    posteriorExpectedValue,
    disagreement,
    confidenceBand,
    clampRange: { min: TRACE_MIN, max: TRACE_MAX },
    steps,
    conflicts,
    safeguards: [
      "The trace replays actual runtime probability snapshots; it does not apply a second synthetic evidence-fusion pass.",
      "Case memory, reliability checks, and abstention rules can gate the action but cannot mutate the published probability.",
      "Final probability, edge, and expected value must equal the values used by selection ranking.",
      "Fresh odds, lineups, injuries, live events, and stored outcomes can still invalidate the decision.",
      `Probability snapshots remain bounded between ${formatPercent(TRACE_MIN)} and ${formatPercent(TRACE_MAX)}.`
    ]
  };
}
