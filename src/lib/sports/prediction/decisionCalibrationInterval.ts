import type { DecisionBeliefState, DecisionLearningProfile } from "@/lib/sports/types";

const CONFIDENCE_LEVEL = 0.95;
const Z_95 = 1.959963984540054;
const MIN_EMPIRICAL_SAMPLE = 30;

type ProbabilityInterval = DecisionBeliefState["confidenceInterval"];

function unavailable({
  detail,
  source = null,
  sampleSize = null
}: {
  detail: string;
  source?: string | null;
  sampleSize?: number | null;
}): ProbabilityInterval {
  return {
    low: null,
    high: null,
    method: "unavailable",
    confidenceLevel: null,
    sampleSize,
    source,
    detail
  };
}

function validBucket(bucket: NonNullable<DecisionLearningProfile["calibrationBuckets"]>[number]): boolean {
  return (
    Number.isFinite(bucket.minProbability) &&
    Number.isFinite(bucket.maxProbability) &&
    Number.isFinite(bucket.sampleSize) &&
    Number.isFinite(bucket.observedRate) &&
    bucket.minProbability >= 0 &&
    bucket.maxProbability <= 1 &&
    bucket.maxProbability > bucket.minProbability &&
    bucket.sampleSize > 0 &&
    bucket.observedRate >= 0 &&
    bucket.observedRate <= 1
  );
}

function containsProbability(
  bucket: NonNullable<DecisionLearningProfile["calibrationBuckets"]>[number],
  probability: number
): boolean {
  return probability >= bucket.minProbability && (probability < bucket.maxProbability || (probability === 1 && bucket.maxProbability === 1));
}

function wilsonInterval(observedRate: number, sampleSize: number): { low: number; high: number } {
  const zSquared = Z_95 * Z_95;
  const denominator = 1 + zSquared / sampleSize;
  const center = (observedRate + zSquared / (2 * sampleSize)) / denominator;
  const margin =
    (Z_95 * Math.sqrt((observedRate * (1 - observedRate)) / sampleSize + zSquared / (4 * sampleSize * sampleSize))) / denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
}

/**
 * Estimates a 95% empirical outcome-rate interval from the promoted
 * calibration bucket that contains the selected runtime probability.
 * No interval is emitted when calibrated historical evidence is unavailable.
 */
export function buildDecisionCalibrationInterval({
  probability,
  learningProfile
}: {
  probability: number | null;
  learningProfile?: DecisionLearningProfile;
}): ProbabilityInterval {
  if (probability === null || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    return unavailable({ detail: "No selected runtime probability is available for an empirical calibration interval." });
  }
  if (!learningProfile?.active) {
    return unavailable({
      detail: "Empirical interval unavailable: no active, model-matched calibration profile is allowed to influence this decision.",
      source: learningProfile?.source ?? null
    });
  }
  if (!learningProfile.calibrationPromotion || learningProfile.calibrationBucketSource !== "promoted-cohort") {
    return unavailable({
      detail: "Empirical interval unavailable: live guardrails are active, but their probability curve is still the historical backtest fallback. A sufficiently large approved settled-outcome cohort is required for a publication-time economic floor.",
      source: learningProfile.source
    });
  }
  if (learningProfile.modelCompatibility !== "exact-runtime-parity") {
    return unavailable({
      detail: "Empirical interval unavailable: the promoted calibration cohort is not attached to an exact-runtime model identity receipt.",
      source: learningProfile.source
    });
  }

  const buckets = (learningProfile.calibrationBuckets ?? []).filter(validBucket).sort((left, right) => left.minProbability - right.minProbability);
  const bucket = buckets.find((item) => containsProbability(item, probability));
  if (!bucket) {
    return unavailable({
      detail: `Empirical interval unavailable: the active calibration profile has no valid bucket containing probability ${(probability * 100).toFixed(1)}%.`,
      source: learningProfile.source
    });
  }

  const sampleSize = Math.trunc(bucket.sampleSize);
  if (sampleSize < MIN_EMPIRICAL_SAMPLE) {
    return unavailable({
      detail: `Empirical interval unavailable: the matching calibration bucket has ${sampleSize} result${sampleSize === 1 ? "" : "s"}; at least ${MIN_EMPIRICAL_SAMPLE} are required.`,
      source: learningProfile.source,
      sampleSize
    });
  }

  const interval = wilsonInterval(bucket.observedRate, sampleSize);
  const promotionSource = `calibration-promotion:${learningProfile.calibrationPromotion.id}/candidate:${learningProfile.calibrationPromotion.candidateId}`;
  return {
    low: interval.low,
    high: interval.high,
    method: "wilson-calibration-bucket",
    confidenceLevel: CONFIDENCE_LEVEL,
    sampleSize,
    source: promotionSource,
    detail: `Wilson 95% interval for the observed outcome rate in the approved exact-runtime ${(bucket.minProbability * 100).toFixed(0)}-${(
      bucket.maxProbability * 100
    ).toFixed(0)}% calibration bucket (${sampleSize} settled win/loss predictions; promotion ${learningProfile.calibrationPromotion.id}, candidate ${learningProfile.calibrationPromotion.candidateId}).`
  };
}
