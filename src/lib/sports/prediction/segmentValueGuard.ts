import type {
  EmpiricalValueGuardBucket,
  PredictionSegmentDimension,
  SegmentValueGuardDecision,
  SegmentValueGuardPolicy,
  SegmentValueGuardSegment
} from "@/lib/sports/types";
import {
  buildEmpiricalValueBuckets,
  EMPIRICAL_VALUE_CONFIDENCE_LEVEL,
  EMPIRICAL_VALUE_REGIME_CONFIDENCE_LEVEL,
  type ProbabilityObservation,
  validProbabilityObservation
} from "./empiricalValueGuard";
import { strictChronologicalSplitIndex } from "./probabilityTemperatureScaling";

export type SegmentProbabilityObservation = ProbabilityObservation & { segmentKey: string | null };

const DEFAULT_MINIMUM_REGIME_SAMPLE = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function selectionCount(rows: readonly ProbabilityObservation[]): number {
  return rows.reduce((sum, row) => sum + Object.keys(row.probabilities).length, 0);
}

function segmentRows(rows: readonly SegmentProbabilityObservation[], segmentKey: string): ProbabilityObservation[] {
  return rows.filter((row) => row.segmentKey === segmentKey);
}

export function learnSegmentValueGuardPolicy({
  trainingRows,
  holdoutWindowStart,
  segmentDimension,
  minimumRegimeSample = DEFAULT_MINIMUM_REGIME_SAMPLE
}: {
  trainingRows: readonly SegmentProbabilityObservation[];
  holdoutWindowStart: string | null;
  segmentDimension: PredictionSegmentDimension;
  minimumRegimeSample?: number;
}): SegmentValueGuardPolicy {
  const rows = trainingRows
    .filter((row) => validProbabilityObservation(row))
    .sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
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
  const segmentKeys = [...new Set(rows.map((row) => row.segmentKey!))].sort();
  const segments: SegmentValueGuardSegment[] = segmentKeys.map((segmentKey) => {
    const all = segmentRows(rows, segmentKey);
    const earlier = segmentRows(earlierRows, segmentKey);
    const recent = segmentRows(recentRows, segmentKey);
    return {
      segmentKey,
      sampleSize: selectionCount(all),
      earlierSampleSize: selectionCount(earlier),
      recentSampleSize: selectionCount(recent),
      buckets: buildEmpiricalValueBuckets({
        earlierRows: earlier,
        recentRows: recent,
        minimumBucketSample: resolvedBucketMinimum,
        minimumRegimeSample: resolvedRegimeMinimum
      })
    };
  });
  const hasEligibleSegment = segments.some((segment) => segment.buckets.some((bucket) => bucket.eligible));
  return {
    version: "segment-value-guard-v1",
    source: "chronological-final-posterior-segment-regime-windows",
    status: chronologyValid && hasEligibleSegment ? "active" : "abstain",
    segmentDimension,
    confidenceLevel: EMPIRICAL_VALUE_CONFIDENCE_LEVEL,
    regimeConfidenceLevel: EMPIRICAL_VALUE_REGIME_CONFIDENCE_LEVEL,
    minimumBucketSample: resolvedBucketMinimum,
    minimumRegimeSample: resolvedRegimeMinimum,
    sampleSize: selectionCount(rows),
    unresolvedSampleSize: selectionCount(rows.filter((row) => !row.segmentKey)),
    unresolvedEarlierSampleSize: selectionCount(earlierRows.filter((row) => !row.segmentKey)),
    unresolvedRecentSampleSize: selectionCount(recentRows.filter((row) => !row.segmentKey)),
    windowStart,
    windowEnd,
    holdoutWindowStart,
    earlierWindow: { windowStart: earlierWindowStart, windowEnd: earlierWindowEnd, sampleSize: selectionCount(earlierRows) },
    recentWindow: { windowStart: recentWindowStart, windowEnd: recentWindowEnd, sampleSize: selectionCount(recentRows) },
    segments,
    reason: !chronologyValid
      ? "invalid-chronology"
      : hasEligibleSegment
        ? "eligible-segments"
        : "insufficient-segment-sample"
  };
}

function contains(bucket: EmpiricalValueGuardBucket, probability: number): boolean {
  return probability >= bucket.minProbability &&
    (probability < bucket.maxProbability || (probability === 1 && bucket.maxProbability === 1));
}

function emptyDecision({
  status,
  segmentKey,
  confidenceLevel,
  reason,
  segmentSampleSize = null,
  bucketSampleSize = null
}: {
  status: "blocked" | "not-applied";
  segmentKey: string | null;
  confidenceLevel: number | null;
  reason: string;
  segmentSampleSize?: number | null;
  bucketSampleSize?: number | null;
}): SegmentValueGuardDecision {
  return {
    status,
    segmentKey,
    probabilityFloor: null,
    earlierProbabilityFloor: null,
    recentProbabilityFloor: null,
    regimeObservedRateDrift: null,
    conservativeEdge: null,
    conservativeExpectedValue: null,
    bucketSampleSize,
    segmentSampleSize,
    confidenceLevel,
    reason
  };
}

export function evaluateSegmentValueGuard({
  segmentKey,
  modelProbability,
  impliedProbability,
  odds,
  policy
}: {
  segmentKey: string | null;
  modelProbability: number;
  impliedProbability: number;
  odds: number;
  policy?: SegmentValueGuardPolicy | null;
}): SegmentValueGuardDecision {
  if (!policy) return emptyDecision({ status: "not-applied", segmentKey, confidenceLevel: null, reason: "No governed segment value policy is active for this model." });
  if (policy.status !== "active") {
    return emptyDecision({ status: "blocked", segmentKey, confidenceLevel: policy.confidenceLevel, reason: `The segment value policy abstains (${policy.reason}).` });
  }
  if (!segmentKey) {
    return emptyDecision({ status: "blocked", segmentKey: null, confidenceLevel: policy.confidenceLevel, reason: `The live ${policy.segmentDimension} segment could not be resolved.` });
  }
  const segment = policy.segments.find((candidate) => candidate.segmentKey === segmentKey);
  if (!segment) {
    return emptyDecision({ status: "blocked", segmentKey, confidenceLevel: policy.confidenceLevel, reason: `The ${policy.segmentDimension} segment has no governed historical evidence.` });
  }
  const probability = clamp(modelProbability, 0, 1);
  const bucket = segment.buckets.find((candidate) => contains(candidate, probability));
  if (!bucket?.eligible || bucket.probabilityFloor === null ||
      bucket.earlier.sampleSize < policy.minimumRegimeSample || bucket.recent.sampleSize < policy.minimumRegimeSample) {
    return emptyDecision({
      status: "blocked",
      segmentKey,
      confidenceLevel: policy.confidenceLevel,
      reason: `The selected probability has no sufficiently sampled earlier-and-recent ${policy.segmentDimension} bucket.`,
      segmentSampleSize: segment.sampleSize,
      bucketSampleSize: bucket?.sampleSize ?? null
    });
  }
  const probabilityFloor = bucket.probabilityFloor;
  const conservativeEdge = probabilityFloor - clamp(impliedProbability, 0, 1);
  const conservativeExpectedValue = odds > 1 ? probabilityFloor * odds - 1 : -1;
  const passed = conservativeEdge > 0 && conservativeExpectedValue > 0;
  return {
    status: passed ? "passed" : "blocked",
    segmentKey,
    probabilityFloor,
    earlierProbabilityFloor: bucket.earlier.probabilityFloor,
    recentProbabilityFloor: bucket.recent.probabilityFloor,
    regimeObservedRateDrift: bucket.earlier.observedRate === null || bucket.recent.observedRate === null
      ? null
      : round(bucket.recent.observedRate - bucket.earlier.observedRate),
    conservativeEdge: round(conservativeEdge),
    conservativeExpectedValue: round(conservativeExpectedValue),
    bucketSampleSize: bucket.sampleSize,
    segmentSampleSize: segment.sampleSize,
    confidenceLevel: policy.confidenceLevel,
    reason: passed
      ? `Edge and expected value survive the exact ${policy.segmentDimension}'s earlier-and-recent probability floor.`
      : `Point-estimate value does not survive the exact ${policy.segmentDimension}'s chronological empirical regimes.`
  };
}
