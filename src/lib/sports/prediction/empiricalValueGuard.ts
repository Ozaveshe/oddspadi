import type {
  EmpiricalValueGuardBucket,
  EmpiricalValueGuardDecision,
  EmpiricalValueGuardPolicy
} from "@/lib/sports/types";

type ProbabilityObservation = {
  kickoffAt: string;
  probabilities: Record<string, number>;
  actualOutcome: string;
};

const CONFIDENCE_LEVEL = 0.95 as const;
const ONE_SIDED_NINETY_FIVE_PERCENT_Z = 1.6448536269514722;
const DEFAULT_MINIMUM_BUCKET_SAMPLE = 30;
const BUCKET_SIZE = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validObservation(row: ProbabilityObservation): boolean {
  const probabilities = Object.values(row.probabilities);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(Date.parse(row.kickoffAt)) &&
    probabilities.length >= 2 &&
    probabilities.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    Math.abs(total - 1) < 0.01 &&
    typeof row.probabilities[row.actualOutcome] === "number";
}

function wilsonLowerBound(observedRate: number, sampleSize: number): number {
  const zSquared = ONE_SIDED_NINETY_FIVE_PERCENT_Z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (observedRate + zSquared / (2 * sampleSize)) / denominator;
  const margin = ONE_SIDED_NINETY_FIVE_PERCENT_Z * Math.sqrt(
    (observedRate * (1 - observedRate)) / sampleSize + zSquared / (4 * sampleSize * sampleSize)
  ) / denominator;
  return clamp(center - margin, 0, 1);
}

function buildBuckets(rows: readonly ProbabilityObservation[], minimumBucketSample: number): EmpiricalValueGuardBucket[] {
  const entries = rows.flatMap((row) => Object.entries(row.probabilities).map(([selection, probability]) => ({
    probability,
    occurred: selection === row.actualOutcome
  })));
  const groups = Array.from({ length: 10 }, () => [] as typeof entries);
  for (const entry of entries) {
    const bucketIndex = Math.min(9, Math.floor(clamp(entry.probability, 0, 1) * 10 + 0.000000001));
    groups[bucketIndex]!.push(entry);
  }

  return groups.flatMap((group, index) => {
    if (!group.length) return [];
    const sampleSize = group.length;
    const averageProbability = group.reduce((sum, entry) => sum + entry.probability, 0) / sampleSize;
    const observedRate = group.filter((entry) => entry.occurred).length / sampleSize;
    const eligible = sampleSize >= minimumBucketSample;
    return [{
      minProbability: round(index * BUCKET_SIZE, 3)!,
      maxProbability: round(Math.min(1, (index + 1) * BUCKET_SIZE), 3)!,
      sampleSize,
      averageProbability: round(averageProbability)!,
      observedRate: round(observedRate)!,
      probabilityFloor: eligible ? round(wilsonLowerBound(observedRate, sampleSize)) : null,
      eligible
    }];
  });
}

/** Learn conservative outcome-rate floors from a final-posterior training window only. */
export function learnEmpiricalValueGuardPolicy({
  trainingRows,
  holdoutWindowStart,
  minimumBucketSample = DEFAULT_MINIMUM_BUCKET_SAMPLE
}: {
  trainingRows: readonly ProbabilityObservation[];
  holdoutWindowStart: string | null;
  minimumBucketSample?: number;
}): EmpiricalValueGuardPolicy {
  const rows = trainingRows.filter(validObservation).sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
  const resolvedMinimum = Math.max(10, Math.floor(minimumBucketSample));
  const windowStart = rows[0]?.kickoffAt ?? null;
  const windowEnd = rows.at(-1)?.kickoffAt ?? null;
  const chronologyValid = Boolean(
    windowStart && windowEnd && holdoutWindowStart &&
    Date.parse(windowStart) <= Date.parse(windowEnd) &&
    Date.parse(windowEnd) < Date.parse(holdoutWindowStart)
  );
  const buckets = buildBuckets(rows, resolvedMinimum);
  const hasEligibleBucket = buckets.some((bucket) => bucket.eligible);
  return {
    version: "empirical-value-guard-v1",
    source: "chronological-final-posterior-training-window",
    status: chronologyValid && hasEligibleBucket ? "active" : "abstain",
    confidenceLevel: CONFIDENCE_LEVEL,
    minimumBucketSample: resolvedMinimum,
    sampleSize: rows.reduce((sum, row) => sum + Object.keys(row.probabilities).length, 0),
    windowStart,
    windowEnd,
    holdoutWindowStart,
    buckets,
    reason: !chronologyValid
      ? "invalid-chronology"
      : hasEligibleBucket
        ? "eligible-probability-buckets"
        : "insufficient-bucket-sample"
  };
}

function contains(bucket: EmpiricalValueGuardBucket, probability: number): boolean {
  return probability >= bucket.minProbability &&
    (probability < bucket.maxProbability || (probability === 1 && bucket.maxProbability === 1));
}

/** Require both edge and EV to remain positive at the calibrated probability floor. */
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
  if (!policy) {
    return {
      status: "not-applied",
      probabilityFloor: null,
      conservativeEdge: null,
      conservativeExpectedValue: null,
      bucketSampleSize: null,
      confidenceLevel: null,
      reason: "No governed empirical value policy is active for this model."
    };
  }
  if (policy.status !== "active") {
    return {
      status: "blocked",
      probabilityFloor: null,
      conservativeEdge: null,
      conservativeExpectedValue: null,
      bucketSampleSize: null,
      confidenceLevel: policy.confidenceLevel,
      reason: `The empirical value policy abstains (${policy.reason}).`
    };
  }
  const probability = clamp(modelProbability, 0, 1);
  const bucket = policy.buckets.find((candidate) => contains(candidate, probability));
  if (!bucket?.eligible || bucket.probabilityFloor === null || bucket.sampleSize < policy.minimumBucketSample) {
    return {
      status: "blocked",
      probabilityFloor: null,
      conservativeEdge: null,
      conservativeExpectedValue: null,
      bucketSampleSize: bucket?.sampleSize ?? null,
      confidenceLevel: policy.confidenceLevel,
      reason: "The selected probability has no sufficiently sampled empirical calibration bucket."
    };
  }
  const probabilityFloor = bucket.probabilityFloor;
  const conservativeEdge = probabilityFloor - clamp(impliedProbability, 0, 1);
  const conservativeExpectedValue = odds > 1 ? probabilityFloor * odds - 1 : -1;
  const passed = conservativeEdge > 0 && conservativeExpectedValue > 0;
  return {
    status: passed ? "passed" : "blocked",
    probabilityFloor,
    conservativeEdge: round(conservativeEdge),
    conservativeExpectedValue: round(conservativeExpectedValue),
    bucketSampleSize: bucket.sampleSize,
    confidenceLevel: policy.confidenceLevel,
    reason: passed
      ? "Edge and expected value remain positive at the one-sided 95% empirical probability floor."
      : "Point-estimate value disappears at the one-sided 95% empirical probability floor."
  };
}
