/**
 * Evaluation metrics for multiclass probabilistic forecasts.
 *
 * Standalone and pure rather than reusing `advancedMetrics.ts`: those functions
 * are shaped around production performance records, and an evaluation harness
 * that has to construct fake production rows to score a backtest ends up
 * testing the adapter instead of the model.
 *
 * Every summary carries its sample size, and the bootstrap works on *paired*
 * differences — two models are compared on the same matches, so the noise that
 * cancels between them must be allowed to cancel, or every comparison drowns
 * in variance that isn't there.
 */

export type Forecast = {
  /** Probabilities in a fixed outcome order, summing to ~1. */
  probabilities: number[];
  /** Index of the outcome that happened. */
  outcome: number;
};

const EPSILON = 1e-12;

/** Multiclass Brier: mean squared error over the full probability vector. */
export function brier(forecasts: Forecast[]): number | null {
  if (!forecasts.length) return null;
  let total = 0;
  for (const forecast of forecasts) {
    for (let k = 0; k < forecast.probabilities.length; k += 1) {
      const target = k === forecast.outcome ? 1 : 0;
      total += (forecast.probabilities[k]! - target) ** 2;
    }
  }
  return total / forecasts.length;
}

export function logLoss(forecasts: Forecast[]): number | null {
  if (!forecasts.length) return null;
  let total = 0;
  for (const forecast of forecasts) {
    total += -Math.log(Math.max(EPSILON, forecast.probabilities[forecast.outcome] ?? 0));
  }
  return total / forecasts.length;
}

/**
 * Ranked probability score, for ordered outcomes (home > draw > away in goal
 * terms). Penalises putting mass far from the truth in *order* terms, which
 * Brier cannot see.
 */
export function rps(forecasts: Forecast[]): number | null {
  if (!forecasts.length) return null;
  let total = 0;
  for (const forecast of forecasts) {
    const k = forecast.probabilities.length;
    let cumulativeForecast = 0;
    let cumulativeOutcome = 0;
    let score = 0;
    for (let index = 0; index < k - 1; index += 1) {
      cumulativeForecast += forecast.probabilities[index]!;
      cumulativeOutcome += index === forecast.outcome ? 1 : 0;
      score += (cumulativeForecast - cumulativeOutcome) ** 2;
    }
    total += score / (k - 1);
  }
  return total / forecasts.length;
}

/**
 * Expected calibration error over the maximum-probability class, ten bins.
 *
 * The max-class convention matches how the number is used downstream: the
 * question a reader's pick asks is "when you say 60%, does it happen 60% of
 * the time", and the pick is always the argmax.
 */
export function ece(forecasts: Forecast[], bins = 10): number | null {
  if (!forecasts.length) return null;
  const buckets = Array.from({ length: bins }, () => ({ n: 0, confidence: 0, hits: 0 }));
  for (const forecast of forecasts) {
    let best = 0;
    for (let k = 1; k < forecast.probabilities.length; k += 1) {
      if (forecast.probabilities[k]! > forecast.probabilities[best]!) best = k;
    }
    const confidence = forecast.probabilities[best]!;
    const bucket = buckets[Math.min(bins - 1, Math.floor(confidence * bins))]!;
    bucket.n += 1;
    bucket.confidence += confidence;
    bucket.hits += best === forecast.outcome ? 1 : 0;
  }
  let weighted = 0;
  for (const bucket of buckets) {
    if (bucket.n === 0) continue;
    weighted += (bucket.n / forecasts.length) * Math.abs(bucket.hits / bucket.n - bucket.confidence / bucket.n);
  }
  return weighted;
}

/** Sharpness: mean max-class probability. Calibrated-but-vague is visible here. */
export function sharpness(forecasts: Forecast[]): number | null {
  if (!forecasts.length) return null;
  let total = 0;
  for (const forecast of forecasts) {
    total += Math.max(...forecast.probabilities);
  }
  return total / forecasts.length;
}

export type MetricSummary = {
  n: number;
  brier: number | null;
  logLoss: number | null;
  rps: number | null;
  ece: number | null;
  sharpness: number | null;
};

export function summarise(forecasts: Forecast[]): MetricSummary {
  return {
    n: forecasts.length,
    brier: brier(forecasts),
    logLoss: logLoss(forecasts),
    rps: rps(forecasts),
    ece: ece(forecasts),
    sharpness: sharpness(forecasts)
  };
}

/**
 * Paired bootstrap for a metric difference between two models scored on the
 * SAME matches.
 *
 * Paired, because the match-to-match noise is common to both models and
 * cancels in the difference; resampling each model independently would bury a
 * real 0.002 Brier gap under variance both models share. Deterministic seed,
 * because an evaluation that changes on re-run is not evidence.
 */
export function pairedBootstrapDiff(
  a: Forecast[],
  b: Forecast[],
  metric: (forecasts: Forecast[]) => number | null,
  { resamples = 2000, seed = 1337 }: { resamples?: number; seed?: number } = {}
): { diff: number; low95: number; high95: number } | null {
  if (a.length !== b.length || a.length === 0) return null;
  const base = (metric(a) ?? 0) - (metric(b) ?? 0);

  // Mulberry32 — small, deterministic, good enough for resampling indices.
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const diffs: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    const sampleA: Forecast[] = [];
    const sampleB: Forecast[] = [];
    for (let index = 0; index < a.length; index += 1) {
      const pick = Math.floor(random() * a.length);
      sampleA.push(a[pick]!);
      sampleB.push(b[pick]!);
    }
    diffs.push((metric(sampleA) ?? 0) - (metric(sampleB) ?? 0));
  }
  diffs.sort((x, y) => x - y);
  return {
    diff: base,
    low95: diffs[Math.floor(resamples * 0.025)]!,
    high95: diffs[Math.floor(resamples * 0.975)]!
  };
}
