export type ProbabilityCalibrationEntry = {
  probability: number;
  occurred: boolean;
};

export type ProbabilityCalibrationBucket = {
  id: string;
  label: string;
  minProbability: number;
  maxProbability: number;
  sampleSize: number;
  averageProbability: number;
  observedRate: number;
  calibrationError: number;
  brierScore: number;
};

export type ProbabilityCalibrationSummary = {
  buckets: ProbabilityCalibrationBucket[];
  expectedCalibrationError: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function buildProbabilityCalibration(
  entries: ProbabilityCalibrationEntry[],
  bucketSize = 0.1
): ProbabilityCalibrationSummary {
  const cleanEntries = entries.filter((entry) => Number.isFinite(entry.probability));
  if (!cleanEntries.length) {
    return {
      buckets: [],
      expectedCalibrationError: null
    };
  }

  const normalizedBucketSize = clamp(bucketSize, 0.05, 0.5);
  const bucketCount = Math.ceil(1 / normalizedBucketSize);
  const groups: ProbabilityCalibrationEntry[][] = Array.from({ length: bucketCount }, () => []);

  for (const entry of cleanEntries) {
    const probability = clamp(entry.probability, 0, 1);
    const index = Math.min(bucketCount - 1, Math.floor(probability / normalizedBucketSize));
    groups[index].push({ probability, occurred: entry.occurred });
  }

  const buckets = groups.flatMap((group, index) => {
    if (!group.length) return [];
    const minProbability = round(index * normalizedBucketSize, 3);
    const maxProbability = round(Math.min(1, (index + 1) * normalizedBucketSize), 3);
    const probabilities = group.map((entry) => entry.probability);
    const outcomes = group.map((entry) => (entry.occurred ? 1 : 0));
    const averageProbability = average(probabilities) ?? 0;
    const observedRate = average(outcomes) ?? 0;
    const brierScore = average(group.map((entry) => (entry.probability - (entry.occurred ? 1 : 0)) ** 2)) ?? 0;

    return [
      {
        id: `p${String(index).padStart(2, "0")}`,
        label: `${minProbability.toFixed(1)}-${maxProbability.toFixed(1)}`,
        minProbability,
        maxProbability,
        sampleSize: group.length,
        averageProbability: round(averageProbability),
        observedRate: round(observedRate),
        calibrationError: round(Math.abs(averageProbability - observedRate)),
        brierScore: round(brierScore)
      }
    ];
  });

  const expectedCalibrationError = buckets.reduce(
    (sum, bucket) => sum + (bucket.sampleSize / cleanEntries.length) * bucket.calibrationError,
    0
  );

  return {
    buckets,
    expectedCalibrationError: round(expectedCalibrationError)
  };
}
