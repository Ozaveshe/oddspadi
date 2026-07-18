import type {
  ProbabilityCalibrationComparison,
  ProbabilityCalibrationScoreSummary,
  ProbabilityTemperatureScalingPolicy
} from "@/lib/sports/types";

type ProbabilityObservation = {
  kickoffAt: string;
  probabilities: Record<string, number>;
  actualOutcome: string;
};

const MIN_PROBABILITY = 0.000001;
const MIN_FIT_SAMPLE = 40;
const MIN_VALIDATION_SAMPLE = 20;
const FIT_RATIO = 0.7;
const MIN_LOG_LOSS_IMPROVEMENT = 0.0005;
const MAX_BRIER_REGRESSION = 0.00025;

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validObservation(row: ProbabilityObservation): boolean {
  const values = Object.values(row.probabilities);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    Number.isFinite(Date.parse(row.kickoffAt)) &&
    values.length >= 2 &&
    values.every((value) => Number.isFinite(value) && value > 0 && value < 1) &&
    Math.abs(total - 1) < 0.01 &&
    typeof row.probabilities[row.actualOutcome] === "number"
  );
}

export function applyProbabilityTemperatureScaling(
  probabilities: Record<string, number>,
  temperature: number
): Record<string, number> {
  if (!Number.isFinite(temperature) || temperature <= 0 || Math.abs(temperature - 1) < 0.000001) {
    return { ...probabilities };
  }
  const entries = Object.entries(probabilities);
  const logits = entries.map(([, probability]) => Math.log(Math.max(MIN_PROBABILITY, probability)) / temperature);
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return { ...probabilities };
  return Object.fromEntries(entries.map(([selection], index) => [selection, exponentials[index]! / total]));
}

function score(rows: readonly ProbabilityObservation[], temperature: number): ProbabilityCalibrationScoreSummary {
  if (!rows.length) return { sampleSize: 0, brierScore: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const probabilities = applyProbabilityTemperatureScaling(row.probabilities, temperature);
    const selections = Object.keys(probabilities);
    brier += selections.reduce(
      (sum, selection) => sum + (probabilities[selection]! - (selection === row.actualOutcome ? 1 : 0)) ** 2,
      0
    ) / selections.length;
    logLoss += -Math.log(Math.max(MIN_PROBABILITY, probabilities[row.actualOutcome] ?? MIN_PROBABILITY));
  }
  return {
    sampleSize: rows.length,
    brierScore: round(brier / rows.length),
    logLoss: round(logLoss / rows.length)
  };
}

function emptyPolicy(
  rows: readonly ProbabilityObservation[],
  holdoutWindowStart: string | null,
  reason: ProbabilityTemperatureScalingPolicy["reason"]
): ProbabilityTemperatureScalingPolicy {
  const baseline = score(rows, 1);
  return {
    version: "temperature-scaling-v1",
    source: "chronological-training-window",
    status: "identity",
    temperature: 1,
    fitSampleSize: rows.length,
    validationSampleSize: 0,
    fitWindowStart: rows[0]?.kickoffAt ?? null,
    fitWindowEnd: rows.at(-1)?.kickoffAt ?? null,
    validationWindowStart: null,
    validationWindowEnd: null,
    holdoutWindowStart,
    baselineValidation: baseline,
    calibratedValidation: baseline,
    reason
  };
}

function candidateTemperatures(): number[] {
  const values = new Set<number>([1]);
  for (let value = 0.55; value <= 2.5 + 0.0001; value += 0.025) values.add(Number(value.toFixed(3)));
  return [...values].sort((left, right) => left - right);
}

function bestTemperature(rows: readonly ProbabilityObservation[]): number {
  return candidateTemperatures().reduce((best, candidate) => {
    const candidateLoss = score(rows, candidate).logLoss ?? Number.POSITIVE_INFINITY;
    const bestLoss = score(rows, best).logLoss ?? Number.POSITIVE_INFINITY;
    if (candidateLoss < bestLoss - 0.0000005) return candidate;
    if (Math.abs(candidateLoss - bestLoss) <= 0.0000005 && Math.abs(candidate - 1) < Math.abs(best - 1)) return candidate;
    return best;
  }, 1);
}

/** Choose the nearest split that never places an identical kickoff timestamp in both windows. */
export function strictChronologicalSplitIndex<T extends { kickoffAt: string }>(
  rows: readonly T[],
  desiredSize: number,
  { minimumLeft = 1, minimumRight = 1 }: { minimumLeft?: number; minimumRight?: number } = {}
): number {
  if (rows.length < minimumLeft + minimumRight) return Math.max(0, Math.min(rows.length, desiredSize));
  const minimum = Math.max(1, minimumLeft);
  const maximum = Math.min(rows.length - 1, rows.length - minimumRight);
  const candidates: number[] = [];
  for (let index = minimum; index <= maximum; index += 1) {
    const left = Date.parse(rows[index - 1]!.kickoffAt);
    const right = Date.parse(rows[index]!.kickoffAt);
    if (Number.isFinite(left) && Number.isFinite(right) && left < right) candidates.push(index);
  }
  // A numeric fallback would split an identical kickoff cohort across windows.
  // Return 0 so callers fail closed when no strict timestamp boundary exists.
  if (!candidates.length) return 0;
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate - desiredSize);
    const bestDistance = Math.abs(best - desiredSize);
    return distance < bestDistance || (distance === bestDistance && candidate < best) ? candidate : best;
  });
}

/**
 * Fit on the early development window, accept only on its later validation slice,
 * then freeze the transform before the untouched outer holdout begins.
 */
export function learnProbabilityTemperaturePolicy({
  trainingRows,
  holdoutWindowStart
}: {
  trainingRows: readonly ProbabilityObservation[];
  holdoutWindowStart: string | null;
}): ProbabilityTemperatureScalingPolicy {
  const rows = trainingRows.filter(validObservation).sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
  if (rows.length < MIN_FIT_SAMPLE + MIN_VALIDATION_SAMPLE) {
    return emptyPolicy(rows, holdoutWindowStart, "insufficient-training-sample");
  }
  const fitSize = strictChronologicalSplitIndex(rows, Math.floor(rows.length * FIT_RATIO), {
    minimumLeft: MIN_FIT_SAMPLE,
    minimumRight: MIN_VALIDATION_SAMPLE
  });
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
  if (!chronologyValid) return emptyPolicy(rows, holdoutWindowStart, "invalid-chronology");

  const temperature = bestTemperature(fitRows);
  const baselineValidation = score(validationRows, 1);
  const calibratedValidation = score(validationRows, temperature);
  const baselineLogLoss = baselineValidation.logLoss;
  const calibratedLogLoss = calibratedValidation.logLoss;
  const baselineBrier = baselineValidation.brierScore;
  const calibratedBrier = calibratedValidation.brierScore;
  const identityWon = Math.abs(temperature - 1) < 0.000001;
  const improved =
    !identityWon &&
    baselineLogLoss !== null &&
    calibratedLogLoss !== null &&
    baselineBrier !== null &&
    calibratedBrier !== null &&
    baselineLogLoss - calibratedLogLoss >= MIN_LOG_LOSS_IMPROVEMENT &&
    calibratedBrier - baselineBrier <= MAX_BRIER_REGRESSION;

  return {
    version: "temperature-scaling-v1",
    source: "chronological-training-window",
    status: improved ? "active" : "identity",
    temperature: improved ? temperature : 1,
    fitSampleSize: fitRows.length,
    validationSampleSize: validationRows.length,
    fitWindowStart: fitRows[0]?.kickoffAt ?? null,
    fitWindowEnd,
    validationWindowStart,
    validationWindowEnd,
    holdoutWindowStart,
    baselineValidation,
    calibratedValidation: improved ? calibratedValidation : baselineValidation,
    reason: improved ? "validated-proper-score-improvement" : identityWon ? "identity-won-fit" : "validation-did-not-improve"
  };
}

export function applyProbabilityTemperaturePolicy(
  probabilities: Record<string, number>,
  policy: ProbabilityTemperatureScalingPolicy
): Record<string, number> {
  return applyProbabilityTemperatureScaling(probabilities, policy.status === "active" ? policy.temperature : 1);
}

/** Use the prospective inner-validation slice for downstream threshold learning when it is complete. */
export function probabilityPolicyValidationRows<T extends { kickoffAt: string }>(
  rows: readonly T[],
  policy: ProbabilityTemperatureScalingPolicy
): T[] {
  if (!policy.validationWindowStart || !policy.validationWindowEnd || policy.validationSampleSize < MIN_VALIDATION_SAMPLE) {
    return [...rows];
  }
  const start = Date.parse(policy.validationWindowStart);
  const end = Date.parse(policy.validationWindowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [...rows];
  const validationRows = rows.filter((row) => {
    const kickoff = Date.parse(row.kickoffAt);
    return Number.isFinite(kickoff) && kickoff >= start && kickoff <= end;
  });
  return validationRows.length === policy.validationSampleSize ? validationRows : [...rows];
}

export function buildProbabilityCalibrationComparison({
  baselineRows,
  calibratedRows
}: {
  baselineRows: readonly ProbabilityObservation[];
  calibratedRows: readonly ProbabilityObservation[];
}): ProbabilityCalibrationComparison {
  const baseline = score(baselineRows.filter(validObservation), 1);
  const calibrated = score(calibratedRows.filter(validObservation), 1);
  return {
    baseline,
    calibrated,
    brierDelta: round(baseline.brierScore === null || calibrated.brierScore === null ? null : calibrated.brierScore - baseline.brierScore),
    logLossDelta: round(baseline.logLoss === null || calibrated.logLoss === null ? null : calibrated.logLoss - baseline.logLoss)
  };
}
