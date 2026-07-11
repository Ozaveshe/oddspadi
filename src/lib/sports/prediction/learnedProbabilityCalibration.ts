import type {
  DecisionLearningProfile,
  FootballModelDiagnostics,
  LearnedProbabilityCalibrationAdjustment,
  PredictionMarket
} from "@/lib/sports/types";

const MIN_PROBABILITY = 0.005;
const MAX_PROBABILITY = 0.995;

function clampProbability(value: number): number {
  return Math.max(MIN_PROBABILITY, Math.min(MAX_PROBABILITY, value));
}

function usableBuckets(profile: DecisionLearningProfile | undefined) {
  return (profile?.calibrationBuckets ?? [])
    .filter(
      (bucket) =>
        Number.isFinite(bucket.minProbability) &&
        Number.isFinite(bucket.maxProbability) &&
        Number.isFinite(bucket.sampleSize) &&
        Number.isFinite(bucket.averageProbability) &&
        Number.isFinite(bucket.observedRate) &&
        bucket.sampleSize > 0 &&
        bucket.minProbability >= 0 &&
        bucket.maxProbability <= 1 &&
        bucket.maxProbability > bucket.minProbability &&
        bucket.averageProbability >= 0 &&
        bucket.averageProbability <= 1 &&
        bucket.observedRate >= 0 &&
        bucket.observedRate <= 1
    )
    .sort((left, right) => left.minProbability - right.minProbability);
}

function closestBucket(
  probability: number,
  buckets: ReturnType<typeof usableBuckets>
): ReturnType<typeof usableBuckets>[number] | null {
  const withinRange = buckets.find((bucket) => probability >= bucket.minProbability && probability <= bucket.maxProbability);
  if (withinRange) return withinRange;
  if (!buckets.length) return null;
  return buckets.reduce((closest, bucket) => {
    const distance = Math.abs(probability - bucket.averageProbability);
    const closestDistance = Math.abs(probability - closest.averageProbability);
    return distance < closestDistance ? bucket : closest;
  });
}

function calibratedProbability(probability: number, bucket: ReturnType<typeof usableBuckets>[number]): number {
  // Shrink observed-rate residuals so sparse calibration buckets cannot create sharp probability jumps.
  const shrinkage = Math.min(0.7, Math.sqrt(bucket.sampleSize / (bucket.sampleSize + 80)));
  const residual = bucket.observedRate - bucket.averageProbability;
  return clampProbability(probability + residual * shrinkage);
}

function normalize(probabilities: Record<string, number>): Record<string, number> {
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return probabilities;
  return Object.fromEntries(Object.entries(probabilities).map(([selection, probability]) => [selection, probability / total]));
}

function baseAdjustment(profile: DecisionLearningProfile | undefined): LearnedProbabilityCalibrationAdjustment {
  const buckets = usableBuckets(profile);
  const totalBucketSample = buckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0);
  if (!profile?.active) {
    return {
      status: "inactive",
      source: profile?.source ?? null,
      modelKey: null,
      bucketCount: buckets.length,
      totalBucketSample,
      calibratedMarkets: [],
      meanAbsoluteShift: 0,
      summary: "Probability calibration remains inactive until a real-data backtest receives explicit live-guardrail promotion."
    };
  }
  if (buckets.length < 2 || totalBucketSample < profile.minimumRecommendedFixtures) {
    return {
      status: "insufficient-evidence",
      source: profile.source,
      modelKey: null,
      bucketCount: buckets.length,
      totalBucketSample,
      calibratedMarkets: [],
      meanAbsoluteShift: 0,
      summary: "Live promotion exists, but the stored calibration curve has too little bucket evidence to adjust probabilities."
    };
  }
  return {
    status: "applied",
    source: profile.source,
    modelKey: null,
    bucketCount: buckets.length,
    totalBucketSample,
    calibratedMarkets: [],
    meanAbsoluteShift: 0,
    summary: "Validated calibration is ready to adjust match-winner probabilities before market-prior blending."
  };
}

export function applyLearnedProbabilityCalibration({
  markets,
  profile,
  modelKey,
  engineVersion
}: {
  markets: PredictionMarket[];
  profile?: DecisionLearningProfile;
  modelKey: string;
  engineVersion?: string;
}): { markets: PredictionMarket[]; adjustment: LearnedProbabilityCalibrationAdjustment } {
  const profileTargetsDifferentModel = Boolean(profile?.modelKey && profile.modelKey !== modelKey);
  const profileTargetsDifferentEngine = Boolean(profile?.engineVersion && engineVersion && profile.engineVersion !== engineVersion);
  if (profileTargetsDifferentModel || profileTargetsDifferentEngine) {
    const buckets = usableBuckets(profile);
    return {
      markets,
      adjustment: {
        status: "inactive",
        source: profile?.source ?? null,
        modelKey,
        bucketCount: buckets.length,
        totalBucketSample: buckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0),
        calibratedMarkets: [],
        meanAbsoluteShift: 0,
        summary: "Stored calibration is scoped to a different model or engine version, so it cannot adjust this prediction."
      }
    };
  }
  const adjustment = { ...baseAdjustment(profile), modelKey };
  if (adjustment.status !== "applied") return { markets, adjustment };

  const buckets = usableBuckets(profile);
  const shifts: number[] = [];
  const calibratedMarkets: string[] = [];
  const adjustedMarkets = markets.map((market) => {
    if (market.marketId !== "match_winner") return market;
    const updated = Object.fromEntries(
      Object.entries(market.probabilities).map(([selection, probability]) => {
        if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return [selection, probability];
        const bucket = closestBucket(probability, buckets);
        if (!bucket) return [selection, probability];
        const calibrated = calibratedProbability(probability, bucket);
        shifts.push(Math.abs(calibrated - probability));
        return [selection, calibrated];
      })
    ) as Record<string, number>;
    calibratedMarkets.push(market.marketId);
    return { ...market, probabilities: normalize(updated) };
  });
  const meanAbsoluteShift = shifts.length ? shifts.reduce((sum, shift) => sum + shift, 0) / shifts.length : 0;
  return {
    markets: adjustedMarkets,
    adjustment: {
      ...adjustment,
      calibratedMarkets,
      meanAbsoluteShift,
      summary: `Applied a ${buckets.length}-bucket promoted calibration curve to match-winner probabilities; mean absolute pre-normalization shift ${(meanAbsoluteShift * 100).toFixed(2)} percentage points.`
    }
  };
}

export function applyLearnedProbabilityCalibrationToDiagnostics({
  diagnostics,
  adjustment
}: {
  diagnostics: FootballModelDiagnostics;
  adjustment: LearnedProbabilityCalibrationAdjustment;
}): FootballModelDiagnostics {
  if (adjustment.status !== "applied") return diagnostics;
  return {
    ...diagnostics,
    signalScores: [
      ...diagnostics.signalScores,
      {
        label: "Promoted probability calibration",
        value: adjustment.meanAbsoluteShift,
        note: adjustment.summary
      }
    ],
    calibrationNotes: [...diagnostics.calibrationNotes, adjustment.summary]
  };
}
