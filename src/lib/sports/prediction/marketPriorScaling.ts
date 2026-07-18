import { applyMarketPriorAdjustmentToMarkets, type MarketPriorEvidencePolicy } from "@/lib/sports/prediction/odds";
import { strictChronologicalSplitIndex } from "@/lib/sports/prediction/probabilityTemperatureScaling";
import type {
  MarketPriorScalingPolicy,
  OddsMarket,
  PredictionMarket,
  ProbabilityCalibrationScoreSummary
} from "@/lib/sports/types";

export type MarketPriorScalingObservation = {
  kickoffAt: string;
  markets: PredictionMarket[];
  oddsMarkets: OddsMarket[];
  dataQuality: number;
  actualOutcome: string;
  evidencePolicy?: MarketPriorEvidencePolicy;
};

const MIN_PROBABILITY = 0.000001;
const MIN_FIT_SAMPLE = 20;
const MIN_VALIDATION_SAMPLE = 20;
const FIT_RATIO = 0.5;
const MIN_LOG_LOSS_IMPROVEMENT = 0.0005;
const MAX_BRIER_REGRESSION = 0.00025;

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function posterior(
  row: MarketPriorScalingObservation,
  weightScale: number
): { probabilities: Record<string, number>; applied: boolean } | null {
  const result = applyMarketPriorAdjustmentToMarkets(
    row.markets,
    row.oddsMarkets,
    row.dataQuality,
    row.evidencePolicy,
    { weightScale }
  );
  const probabilities = result.markets.find((market) => market.marketId === "match_winner")?.probabilities;
  if (!probabilities || typeof probabilities[row.actualOutcome] !== "number") return null;
  const values = Object.values(probabilities);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (
    values.length < 2 ||
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    Math.abs(total - 1) >= 0.01
  ) return null;
  return { probabilities, applied: result.adjustment.applied };
}

function pricedObservation(row: MarketPriorScalingObservation): boolean {
  return Number.isFinite(Date.parse(row.kickoffAt)) && posterior(row, 1)?.applied === true;
}

function score(
  rows: readonly MarketPriorScalingObservation[],
  weightScale: number
): ProbabilityCalibrationScoreSummary {
  if (!rows.length) return { sampleSize: 0, brierScore: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  let sampleSize = 0;
  for (const row of rows) {
    const result = posterior(row, weightScale);
    if (!result?.applied) continue;
    const selections = Object.keys(result.probabilities);
    brier += selections.reduce(
      (sum, selection) => sum + (result.probabilities[selection]! - (selection === row.actualOutcome ? 1 : 0)) ** 2,
      0
    ) / selections.length;
    logLoss += -Math.log(Math.max(MIN_PROBABILITY, result.probabilities[row.actualOutcome] ?? MIN_PROBABILITY));
    sampleSize += 1;
  }
  return {
    sampleSize,
    brierScore: round(sampleSize ? brier / sampleSize : null),
    logLoss: round(sampleSize ? logLoss / sampleSize : null)
  };
}

function identityPolicy(
  rows: readonly MarketPriorScalingObservation[],
  holdoutWindowStart: string | null,
  reason: MarketPriorScalingPolicy["reason"]
): MarketPriorScalingPolicy {
  const baseline = score(rows, 1);
  return {
    version: "market-prior-scaling-v1",
    source: "chronological-priced-training-window",
    status: "identity",
    weightScale: 1,
    candidateWeightScale: 1,
    fitSampleSize: rows.length,
    validationSampleSize: 0,
    fitWindowStart: rows[0]?.kickoffAt ?? null,
    fitWindowEnd: rows.at(-1)?.kickoffAt ?? null,
    validationWindowStart: null,
    validationWindowEnd: null,
    holdoutWindowStart,
    baselineFit: baseline,
    candidateFit: baseline,
    baselineValidation: { sampleSize: 0, brierScore: null, logLoss: null },
    candidateValidation: { sampleSize: 0, brierScore: null, logLoss: null },
    reason
  };
}

function candidateWeightScales(): number[] {
  return Array.from({ length: 31 }, (_, index) => index / 10);
}

function bestWeightScale(rows: readonly MarketPriorScalingObservation[]): number {
  return candidateWeightScales().reduce((best, candidate) => {
    const candidateScore = score(rows, candidate);
    const bestScore = score(rows, best);
    const candidateLoss = candidateScore.logLoss ?? Number.POSITIVE_INFINITY;
    const bestLoss = bestScore.logLoss ?? Number.POSITIVE_INFINITY;
    if (candidateLoss < bestLoss - 0.0000005) return candidate;
    if (Math.abs(candidateLoss - bestLoss) <= 0.0000005) {
      const candidateBrier = candidateScore.brierScore ?? Number.POSITIVE_INFINITY;
      const bestBrier = bestScore.brierScore ?? Number.POSITIVE_INFINITY;
      if (candidateBrier < bestBrier - 0.0000005) return candidate;
      if (Math.abs(candidateBrier - bestBrier) <= 0.0000005 && Math.abs(candidate - 1) < Math.abs(best - 1)) {
        return candidate;
      }
    }
    return best;
  }, 1);
}

/**
 * Learn how much of the live no-vig market posterior to admit from an early
 * priced window, validate it later, and freeze the result before outer holdout.
 */
export function learnMarketPriorScalingPolicy({
  trainingRows,
  holdoutWindowStart
}: {
  trainingRows: readonly MarketPriorScalingObservation[];
  holdoutWindowStart: string | null;
}): MarketPriorScalingPolicy {
  const rows = trainingRows
    .filter(pricedObservation)
    .sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
  if (rows.length < MIN_FIT_SAMPLE + MIN_VALIDATION_SAMPLE) {
    return identityPolicy(rows, holdoutWindowStart, "insufficient-priced-sample");
  }
  const fitSize = strictChronologicalSplitIndex(rows, Math.floor(rows.length * FIT_RATIO), {
    minimumLeft: MIN_FIT_SAMPLE,
    minimumRight: MIN_VALIDATION_SAMPLE
  });
  if (fitSize === 0) return identityPolicy(rows, holdoutWindowStart, "invalid-chronology");

  const fitRows = rows.slice(0, fitSize);
  const validationRows = rows.slice(fitSize);
  const fitWindowEnd = fitRows.at(-1)?.kickoffAt ?? null;
  const validationWindowStart = validationRows[0]?.kickoffAt ?? null;
  const validationWindowEnd = validationRows.at(-1)?.kickoffAt ?? null;
  const chronologyValid = Boolean(
    fitWindowEnd &&
    validationWindowStart &&
    validationWindowEnd &&
    holdoutWindowStart &&
    Date.parse(fitWindowEnd) < Date.parse(validationWindowStart) &&
    Date.parse(validationWindowEnd) < Date.parse(holdoutWindowStart)
  );
  if (!chronologyValid) return identityPolicy(rows, holdoutWindowStart, "invalid-chronology");

  const candidateWeightScale = bestWeightScale(fitRows);
  const baselineFit = score(fitRows, 1);
  const candidateFit = score(fitRows, candidateWeightScale);
  const baselineValidation = score(validationRows, 1);
  const candidateValidation = score(validationRows, candidateWeightScale);
  const identityWon = Math.abs(candidateWeightScale - 1) < 0.000001;
  const improved =
    !identityWon &&
    baselineValidation.logLoss !== null &&
    candidateValidation.logLoss !== null &&
    baselineValidation.brierScore !== null &&
    candidateValidation.brierScore !== null &&
    baselineValidation.logLoss - candidateValidation.logLoss >= MIN_LOG_LOSS_IMPROVEMENT &&
    candidateValidation.brierScore - baselineValidation.brierScore <= MAX_BRIER_REGRESSION;

  return {
    version: "market-prior-scaling-v1",
    source: "chronological-priced-training-window",
    status: improved ? "active" : "identity",
    weightScale: improved ? candidateWeightScale : 1,
    candidateWeightScale,
    fitSampleSize: fitRows.length,
    validationSampleSize: validationRows.length,
    fitWindowStart: fitRows[0]?.kickoffAt ?? null,
    fitWindowEnd,
    validationWindowStart,
    validationWindowEnd,
    holdoutWindowStart,
    baselineFit,
    candidateFit,
    baselineValidation,
    candidateValidation,
    reason: improved ? "validated-proper-score-improvement" : identityWon ? "identity-won-fit" : "validation-did-not-improve"
  };
}

/** Use the complete later market-policy validation slice for threshold learning. */
export function marketPriorPolicyValidationRows<T extends { kickoffAt: string }>(
  rows: readonly T[],
  policy: MarketPriorScalingPolicy,
  isPriced: (row: T) => boolean = () => true
): T[] {
  if (!policy.validationWindowStart || !policy.validationWindowEnd || policy.validationSampleSize < MIN_VALIDATION_SAMPLE) {
    return [...rows];
  }
  const start = Date.parse(policy.validationWindowStart);
  const end = Date.parse(policy.validationWindowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [...rows];
  const validationRows = rows.filter((row) => {
    const kickoff = Date.parse(row.kickoffAt);
    return Number.isFinite(kickoff) && kickoff >= start && kickoff <= end && isPriced(row);
  });
  return validationRows.length === policy.validationSampleSize ? validationRows : [...rows];
}
