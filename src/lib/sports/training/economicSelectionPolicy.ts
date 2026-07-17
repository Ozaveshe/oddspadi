export type EconomicConfidenceBand = "low" | "medium" | "high";

export type EconomicSelectionBandEvidence = {
  confidence: EconomicConfidenceBand;
  sampleSize: number;
  roiUnits: number;
  yield: number | null;
  returnStandardDeviation: number | null;
  yieldLowerBound: number | null;
  eligible: boolean;
  reason:
    | "eligible-positive-lower-bound"
    | "baseline-excluded"
    | "below-minimum-sample"
    | "non-positive-yield"
    | "lower-bound-not-positive"
    | "no-picks";
};

export type EconomicSelectionPolicy = {
  version: "economic-confidence-bands-v1";
  source: "chronological-training-window";
  status: "active" | "abstain";
  familyConfidenceLevel: 0.9;
  perBandConfidenceLevel: 0.95;
  minimumSamplesPerBand: number;
  trainingPickCount: number;
  trainingYield: number | null;
  allowedConfidenceBands: EconomicConfidenceBand[];
  bands: EconomicSelectionBandEvidence[];
};

export type EconomicSelectionMetrics = {
  pickCount: number;
  roiUnits: number;
  yield: number | null;
};

export type EconomicSelectionComparison = {
  baseline: EconomicSelectionMetrics;
  selected: EconomicSelectionMetrics;
  picksRemoved: number;
};

type SettledPick = {
  confidence: EconomicConfidenceBand;
  unitReturn: number;
};

type ResultWithPick<TPick extends SettledPick> = {
  pick: TPick | null;
};

const BAND_ORDER: EconomicConfidenceBand[] = ["low", "medium", "high"];
const DEFAULT_ELIGIBLE_BANDS: EconomicConfidenceBand[] = ["medium", "high"];
// Two eligible bands use a Bonferroni-adjusted 5% one-sided test each,
// producing at least 90% family-wise confidence across the policy search.
const ONE_SIDED_NINETY_FIVE_PERCENT_Z = 1.644854;

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values: number[], average: number): number | null {
  if (values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function bandEvidence(
  confidence: EconomicConfidenceBand,
  picks: SettledPick[],
  minimumSamplesPerBand: number,
  eligibleBands: ReadonlySet<EconomicConfidenceBand>
): EconomicSelectionBandEvidence {
  const returns = picks.filter((pick) => pick.confidence === confidence).map((pick) => pick.unitReturn);
  const average = mean(returns);
  const deviation = average === null ? null : sampleStandardDeviation(returns, average);
  const lowerBound =
    average === null
      ? null
      : deviation === null
        ? average
        : average - ONE_SIDED_NINETY_FIVE_PERCENT_Z * (deviation / Math.sqrt(returns.length));

  let reason: EconomicSelectionBandEvidence["reason"];
  if (!eligibleBands.has(confidence)) reason = "baseline-excluded";
  else if (!returns.length) reason = "no-picks";
  else if (returns.length < minimumSamplesPerBand) reason = "below-minimum-sample";
  else if (average === null || average <= 0) reason = "non-positive-yield";
  else if (lowerBound === null || lowerBound <= 0) reason = "lower-bound-not-positive";
  else reason = "eligible-positive-lower-bound";

  return {
    confidence,
    sampleSize: returns.length,
    roiUnits: round(returns.reduce((sum, value) => sum + value, 0)) ?? 0,
    yield: round(average),
    returnStandardDeviation: round(deviation),
    yieldLowerBound: round(lowerBound),
    eligible: reason === "eligible-positive-lower-bound",
    reason
  };
}

/**
 * Learn a deliberately coarse economic gate from settled training-window picks.
 *
 * Confidence describes model certainty, not price quality. A band is admitted only
 * when it has enough observations and its Bonferroni-adjusted one-sided lower
 * confidence bound for unit return is positive. Low confidence remains baseline-
 * excluded, while the two eligible bands receive 95% per-band bounds for at least
 * 90% family-wise confidence. No qualifying band means the learned action is abstain.
 */
export function learnEconomicSelectionPolicy(
  results: ReadonlyArray<ResultWithPick<SettledPick>>,
  {
    minimumSamplesPerBand = 30,
    eligibleConfidenceBands = DEFAULT_ELIGIBLE_BANDS
  }: {
    minimumSamplesPerBand?: number;
    eligibleConfidenceBands?: EconomicConfidenceBand[];
  } = {}
): EconomicSelectionPolicy {
  const resolvedMinimum = Math.max(2, Math.floor(minimumSamplesPerBand));
  const eligibleBands = new Set(eligibleConfidenceBands);
  const picks = results.flatMap((result) => (result.pick ? [result.pick] : []));
  const bands = BAND_ORDER.map((band) => bandEvidence(band, picks, resolvedMinimum, eligibleBands));
  const allowedConfidenceBands = bands.filter((band) => band.eligible).map((band) => band.confidence);

  return {
    version: "economic-confidence-bands-v1",
    source: "chronological-training-window",
    status: allowedConfidenceBands.length ? "active" : "abstain",
    familyConfidenceLevel: 0.9,
    perBandConfidenceLevel: 0.95,
    minimumSamplesPerBand: resolvedMinimum,
    trainingPickCount: picks.length,
    trainingYield: round(mean(picks.map((pick) => pick.unitReturn))),
    allowedConfidenceBands,
    bands
  };
}

function economicMetrics<TPick extends SettledPick>(results: ReadonlyArray<ResultWithPick<TPick>>): EconomicSelectionMetrics {
  const picks = results.flatMap((result) => (result.pick ? [result.pick] : []));
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  return {
    pickCount: picks.length,
    roiUnits: round(roiUnits) ?? 0,
    yield: round(picks.length ? roiUnits / picks.length : null)
  };
}

export function buildEconomicSelectionComparison(
  baseline: ReadonlyArray<ResultWithPick<SettledPick>>,
  selected: ReadonlyArray<ResultWithPick<SettledPick>>
): EconomicSelectionComparison {
  const baselineMetrics = economicMetrics(baseline);
  const selectedMetrics = economicMetrics(selected);
  return {
    baseline: baselineMetrics,
    selected: selectedMetrics,
    picksRemoved: Math.max(0, baselineMetrics.pickCount - selectedMetrics.pickCount)
  };
}

export function applyEconomicSelectionPolicy<
  TPick extends SettledPick,
  TResult extends ResultWithPick<TPick>
>(results: ReadonlyArray<TResult>, policy: EconomicSelectionPolicy): TResult[] {
  const allowed = new Set(policy.allowedConfidenceBands);
  return results.map((result) =>
    result.pick && allowed.has(result.pick.confidence)
      ? { ...result }
      : ({ ...result, pick: null } as TResult)
  );
}

export function applyMinimumEdgeToResults<
  TPick extends SettledPick & { edge: number },
  TResult extends ResultWithPick<TPick>
>(results: ReadonlyArray<TResult>, minimumEdge: number): TResult[] {
  return results.map((result) =>
    result.pick && result.pick.edge >= minimumEdge
      ? { ...result }
      : ({ ...result, pick: null } as TResult)
  );
}
