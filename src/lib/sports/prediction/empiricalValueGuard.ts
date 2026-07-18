import type {
  EmpiricalValueGuardBucket,
  EmpiricalValueGuardDecision,
  EmpiricalValueGuardPolicy,
  EmpiricalValueGuardRegimeEvidence
} from "@/lib/sports/types";
import { strictChronologicalSplitIndex } from "./probabilityTemperatureScaling";

export type ProbabilityObservation = {
  kickoffAt: string;
  probabilities: Record<string, number>;
  actualOutcome: string;
};

type ProbabilityEntry = {
  probability: number;
  occurred: boolean;
};

export const EMPIRICAL_VALUE_CONFIDENCE_LEVEL = 0.95 as const;
// Two 97.5% one-sided bounds retain at least 95% joint coverage by Bonferroni.
export const EMPIRICAL_VALUE_REGIME_CONFIDENCE_LEVEL = 0.975 as const;
const AGGREGATE_Z = 1.6448536269514722;
const REGIME_Z = 1.959963984540054;
const DEFAULT_MINIMUM_REGIME_SAMPLE = 30;
const BUCKET_SIZE = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function validProbabilityObservation(row: ProbabilityObservation): boolean {
  const probabilities = Object.values(row.probabilities);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(Date.parse(row.kickoffAt)) &&
    probabilities.length >= 2 &&
    probabilities.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    Math.abs(total - 1) < 0.01 &&
    typeof row.probabilities[row.actualOutcome] === "number";
}

function wilsonLowerBound(observedRate: number, sampleSize: number, z: number): number {
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (observedRate + zSquared / (2 * sampleSize)) / denominator;
  const margin = z * Math.sqrt(
    (observedRate * (1 - observedRate)) / sampleSize + zSquared / (4 * sampleSize * sampleSize)
  ) / denominator;
  return clamp(center - margin, 0, 1);
}

function entries(rows: readonly ProbabilityObservation[]): ProbabilityEntry[] {
  return rows.flatMap((row) => Object.entries(row.probabilities).map(([selection, probability]) => ({
    probability,
    occurred: selection === row.actualOutcome
  })));
}

function groupsByBucket(values: readonly ProbabilityEntry[]): ProbabilityEntry[][] {
  const groups = Array.from({ length: 10 }, () => [] as ProbabilityEntry[]);
  for (const entry of values) {
    const bucketIndex = Math.min(9, Math.floor(clamp(entry.probability, 0, 1) * 10 + 0.000000001));
    groups[bucketIndex]!.push(entry);
  }
  return groups;
}

function evidence(values: readonly ProbabilityEntry[], z: number): EmpiricalValueGuardRegimeEvidence {
  if (!values.length) {
    return { sampleSize: 0, averageProbability: null, observedRate: null, probabilityFloor: null };
  }
  const sampleSize = values.length;
  const averageProbability = values.reduce((sum, entry) => sum + entry.probability, 0) / sampleSize;
  const observedRate = values.filter((entry) => entry.occurred).length / sampleSize;
  return {
    sampleSize,
    averageProbability: round(averageProbability),
    observedRate: round(observedRate),
    probabilityFloor: round(wilsonLowerBound(observedRate, sampleSize, z))
  };
}

export function buildEmpiricalValueBuckets({
  earlierRows,
  recentRows,
  minimumBucketSample,
  minimumRegimeSample
}: {
  earlierRows: readonly ProbabilityObservation[];
  recentRows: readonly ProbabilityObservation[];
  minimumBucketSample: number;
  minimumRegimeSample: number;
}): EmpiricalValueGuardBucket[] {
  const earlierGroups = groupsByBucket(entries(earlierRows));
  const recentGroups = groupsByBucket(entries(recentRows));

  return Array.from({ length: 10 }, (_, index) => {
    const earlierEntries = earlierGroups[index]!;
    const recentEntries = recentGroups[index]!;
    const allEntries = [...earlierEntries, ...recentEntries];
    if (!allEntries.length) return null;
    const earlier = evidence(earlierEntries, REGIME_Z);
    const recent = evidence(recentEntries, REGIME_Z);
    const aggregate = evidence(allEntries, AGGREGATE_Z);
    const eligible =
      allEntries.length >= minimumBucketSample &&
      earlier.sampleSize >= minimumRegimeSample &&
      recent.sampleSize >= minimumRegimeSample;
    const probabilityFloor = eligible
      ? Math.min(aggregate.probabilityFloor!, earlier.probabilityFloor!, recent.probabilityFloor!)
      : null;
    return {
      minProbability: round(index * BUCKET_SIZE, 3)!,
      maxProbability: round(Math.min(1, (index + 1) * BUCKET_SIZE), 3)!,
      sampleSize: allEntries.length,
      averageProbability: aggregate.averageProbability!,
      observedRate: aggregate.observedRate!,
      aggregateProbabilityFloor: aggregate.probabilityFloor,
      probabilityFloor: round(probabilityFloor),
      eligible,
      earlier,
      recent
    };
  }).filter((bucket): bucket is EmpiricalValueGuardBucket => bucket !== null);
}

/**
 * Learn a value floor that must survive both an earlier and a recent training regime.
 * The entire policy is frozen before the untouched outer holdout begins.
 */
export function learnEmpiricalValueGuardPolicy({
  trainingRows,
  holdoutWindowStart,
  minimumRegimeSample = DEFAULT_MINIMUM_REGIME_SAMPLE
}: {
  trainingRows: readonly ProbabilityObservation[];
  holdoutWindowStart: string | null;
  minimumRegimeSample?: number;
}): EmpiricalValueGuardPolicy {
  const rows = trainingRows.filter(validProbabilityObservation).sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
  const resolvedRegimeMinimum = Math.max(10, Math.floor(minimumRegimeSample));
  const resolvedBucketMinimum = resolvedRegimeMinimum * 2;
  const splitIndex = strictChronologicalSplitIndex(rows, Math.floor(rows.length / 2));
  const earlierRows = splitIndex > 0 ? rows.slice(0, splitIndex) : [];
  const recentRows = splitIndex > 0 ? rows.slice(splitIndex) : [];
  const windowStart = rows[0]?.kickoffAt ?? null;
  const windowEnd = rows.at(-1)?.kickoffAt ?? null;
  const earlierWindowStart = earlierRows[0]?.kickoffAt ?? null;
  const earlierWindowEnd = earlierRows.at(-1)?.kickoffAt ?? null;
  const recentWindowStart = recentRows[0]?.kickoffAt ?? null;
  const recentWindowEnd = recentRows.at(-1)?.kickoffAt ?? null;
  const chronologyValid = Boolean(
    windowStart && windowEnd && holdoutWindowStart &&
    earlierWindowStart && earlierWindowEnd && recentWindowStart && recentWindowEnd &&
    Date.parse(windowStart) <= Date.parse(earlierWindowEnd) &&
    Date.parse(earlierWindowEnd) < Date.parse(recentWindowStart) &&
    Date.parse(recentWindowStart) <= Date.parse(windowEnd) &&
    Date.parse(windowEnd) < Date.parse(holdoutWindowStart)
  );
  const buckets = buildEmpiricalValueBuckets({
    earlierRows,
    recentRows,
    minimumBucketSample: resolvedBucketMinimum,
    minimumRegimeSample: resolvedRegimeMinimum
  });
  const hasEligibleBucket = buckets.some((bucket) => bucket.eligible);
  const selectionCount = (input: readonly ProbabilityObservation[]) =>
    input.reduce((sum, row) => sum + Object.keys(row.probabilities).length, 0);
  return {
    version: "empirical-value-guard-v2",
    source: "chronological-final-posterior-regime-windows",
    status: chronologyValid && hasEligibleBucket ? "active" : "abstain",
    confidenceLevel: EMPIRICAL_VALUE_CONFIDENCE_LEVEL,
    regimeConfidenceLevel: EMPIRICAL_VALUE_REGIME_CONFIDENCE_LEVEL,
    minimumBucketSample: resolvedBucketMinimum,
    minimumRegimeSample: resolvedRegimeMinimum,
    sampleSize: selectionCount(rows),
    windowStart,
    windowEnd,
    holdoutWindowStart,
    earlierWindow: {
      windowStart: earlierWindowStart,
      windowEnd: earlierWindowEnd,
      sampleSize: selectionCount(earlierRows)
    },
    recentWindow: {
      windowStart: recentWindowStart,
      windowEnd: recentWindowEnd,
      sampleSize: selectionCount(recentRows)
    },
    buckets,
    reason: !chronologyValid
      ? "invalid-chronology"
      : hasEligibleBucket
        ? "stable-regime-buckets"
        : "insufficient-regime-sample"
  };
}

function contains(bucket: EmpiricalValueGuardBucket, probability: number): boolean {
  return probability >= bucket.minProbability &&
    (probability < bucket.maxProbability || (probability === 1 && bucket.maxProbability === 1));
}

function emptyDecision(
  status: "blocked" | "not-applied",
  confidenceLevel: number | null,
  reason: string,
  bucketSampleSize: number | null = null
): EmpiricalValueGuardDecision {
  return {
    status,
    probabilityFloor: null,
    earlierProbabilityFloor: null,
    recentProbabilityFloor: null,
    regimeObservedRateDrift: null,
    conservativeEdge: null,
    conservativeExpectedValue: null,
    bucketSampleSize,
    confidenceLevel,
    reason
  };
}

/** Require edge and EV to remain positive across both historical regimes. */
export function evaluateEmpiricalValueGuard({
  modelProbability,
  impliedProbability,
  odds,
  policy
}: {
  modelProbability: number;
  impliedProbability: number;
  odds: number;
  policy?: EmpiricalValueGuardPolicy | null;
}): EmpiricalValueGuardDecision {
  if (!policy) return emptyDecision("not-applied", null, "No governed empirical value policy is active for this model.");
  if (policy.status !== "active") {
    return emptyDecision("blocked", policy.confidenceLevel, `The empirical value policy abstains (${policy.reason}).`);
  }
  const probability = clamp(modelProbability, 0, 1);
  const bucket = policy.buckets.find((candidate) => contains(candidate, probability));
  if (
    !bucket?.eligible || bucket.probabilityFloor === null ||
    bucket.earlier.sampleSize < policy.minimumRegimeSample ||
    bucket.recent.sampleSize < policy.minimumRegimeSample
  ) {
    return emptyDecision(
      "blocked",
      policy.confidenceLevel,
      "The selected probability has no sufficiently sampled earlier-and-recent empirical regime bucket.",
      bucket?.sampleSize ?? null
    );
  }
  const probabilityFloor = bucket.probabilityFloor;
  const conservativeEdge = probabilityFloor - clamp(impliedProbability, 0, 1);
  const conservativeExpectedValue = odds > 1 ? probabilityFloor * odds - 1 : -1;
  const passed = conservativeEdge > 0 && conservativeExpectedValue > 0;
  return {
    status: passed ? "passed" : "blocked",
    probabilityFloor,
    earlierProbabilityFloor: bucket.earlier.probabilityFloor,
    recentProbabilityFloor: bucket.recent.probabilityFloor,
    regimeObservedRateDrift:
      bucket.earlier.observedRate === null || bucket.recent.observedRate === null
        ? null
        : round(bucket.recent.observedRate - bucket.earlier.observedRate),
    conservativeEdge: round(conservativeEdge),
    conservativeExpectedValue: round(conservativeExpectedValue),
    bucketSampleSize: bucket.sampleSize,
    confidenceLevel: policy.confidenceLevel,
    reason: passed
      ? "Edge and expected value remain positive at the joint-confidence earlier-and-recent probability floor."
      : "Point-estimate value does not survive both chronological empirical regimes."
  };
}
