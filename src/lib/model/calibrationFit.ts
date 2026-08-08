import type { Forecast } from "@/lib/model/evalMetrics";
import { logLoss } from "@/lib/model/evalMetrics";

/**
 * Calibration methods, fitted on validation folds only.
 *
 * The selection rule is stated once and enforced by the harness: whichever
 * method wins on validation log loss is applied — untouched — to the holdout.
 * A calibrator that has seen the holdout has spent it, and the holdout is the
 * one set that cannot be bought twice.
 *
 * Two families, chosen for the sample sizes actually available (~1,700
 * matches per validation window):
 *
 * - **Temperature scaling** (one parameter): sharpens or softens all classes
 *   at once. Nearly impossible to overfit; the honest default at this scale.
 * - **Isotonic per class, renormalised**: monotone free-form per outcome.
 *   More expressive, needs more data, and the renormalisation step is what
 *   keeps 1X2 coherent after three independent fits.
 */

export type Calibrator = {
  method: "identity" | "temperature" | "isotonic";
  apply(probabilities: number[]): number[];
  describe: string;
};

export const identityCalibrator: Calibrator = {
  method: "identity",
  apply: (probabilities) => probabilities,
  describe: "identity (no calibration)"
};

/** Temperature scaling in logit space; T fitted by golden-section on log loss. */
export function fitTemperature(validation: Forecast[]): Calibrator {
  const scale = (probabilities: number[], t: number): number[] => {
    const logits = probabilities.map((p) => Math.log(Math.max(1e-12, p)));
    const scaled = logits.map((l) => l / t);
    const max = Math.max(...scaled);
    const exp = scaled.map((l) => Math.exp(l - max));
    const total = exp.reduce((sum, value) => sum + value, 0);
    return exp.map((value) => value / total);
  };

  const lossAt = (t: number): number =>
    logLoss(validation.map((f) => ({ ...f, probabilities: scale(f.probabilities, t) }))) ?? Infinity;

  // Golden-section over a generous bracket; the loss is unimodal in T.
  let low = 0.25;
  let high = 4;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = high - phi * (high - low);
  let d = low + phi * (high - low);
  for (let step = 0; step < 60; step += 1) {
    if (lossAt(c) < lossAt(d)) {
      high = d;
    } else {
      low = c;
    }
    c = high - phi * (high - low);
    d = low + phi * (high - low);
  }
  const t = (low + high) / 2;

  return {
    method: "temperature",
    apply: (probabilities) => scale(probabilities, t),
    describe: `temperature scaling (T=${t.toFixed(3)})`
  };
}

/**
 * Pool-adjacent-violators, the isotonic regression workhorse.
 * Returns a step function mapping raw probability → calibrated frequency.
 */
function pav(pairs: Array<{ x: number; y: number }>): (x: number) => number {
  // Aggregate tied x values first. Without this, a run of identical inputs
  // becomes many single-point blocks whose means PAV sorts into a monotone
  // staircase, and lookup at that x returns the *first* step — the lowest
  // mean of the tie group, not its average. Constant or coarsely-quantised
  // forecasters then get a wildly wrong curve.
  const grouped = new Map<number, { sum: number; n: number }>();
  for (const pair of pairs) {
    const entry = grouped.get(pair.x) ?? { sum: 0, n: 0 };
    entry.sum += pair.y;
    entry.n += 1;
    grouped.set(pair.x, entry);
  }
  const sorted = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  const blocks = sorted.map(([x, entry]) => ({ sum: entry.sum, n: entry.n, minX: x, maxX: x }));
  let index = 0;
  while (index < blocks.length - 1) {
    const current = blocks[index]!;
    const next = blocks[index + 1]!;
    if (current.sum / current.n > next.sum / next.n) {
      current.sum += next.sum;
      current.n += next.n;
      current.maxX = next.maxX;
      blocks.splice(index + 1, 1);
      if (index > 0) index -= 1;
    } else {
      index += 1;
    }
  }
  const steps = blocks.map((block) => ({ upTo: block.maxX, value: block.sum / block.n }));
  return (x: number) => {
    for (const step of steps) {
      if (x <= step.upTo) return step.value;
    }
    return steps.length ? steps[steps.length - 1]!.value : x;
  };
}

export function fitIsotonic(validation: Forecast[], classes?: number): Calibrator {
  // Infer the class count from the data — the same machinery serves football
  // 1X2 (3) and tennis match-winner (2).
  const classCount = classes ?? validation[0]?.probabilities.length ?? 3;
  const maps: Array<(x: number) => number> = [];
  for (let k = 0; k < classCount; k += 1) {
    maps.push(
      pav(
        validation.map((forecast) => ({
          x: forecast.probabilities[k]!,
          y: forecast.outcome === k ? 1 : 0
        }))
      )
    );
  }
  return {
    method: "isotonic",
    apply: (probabilities) => {
      // Clamp away from zero before renormalising: isotonic happily outputs an
      // exact 0 for a thin tail bin, and a zero-probability outcome that then
      // happens costs infinite log loss for what is really a data-sparsity
      // artefact.
      const mapped = probabilities.map((p, k) => Math.max(0.005, maps[k]!(p)));
      const total = mapped.reduce((sum, value) => sum + value, 0);
      return mapped.map((value) => value / total);
    },
    describe: "isotonic per class, renormalised, floored at 0.5%"
  };
}

/**
 * Pick the calibrator by validation log loss — including "do nothing".
 *
 * Isotonic needs a sample floor. The first live run selected it on 802
 * validation matches, where it duly won validation and then collapsed on the
 * holdout (ECE 0.067 → 0.108): three free-form monotone curves fitted to that
 * little data memorise the fold. The floor is a capacity rule decided from
 * that run — and because that holdout has now been seen once, the run that
 * taught us this keeps its honest numbers rather than being re-selected.
 */
export const ISOTONIC_MIN_SAMPLE = 2000;

export function selectCalibrator(validation: Forecast[]): Calibrator {
  const candidates = [identityCalibrator, fitTemperature(validation)];
  if (validation.length >= ISOTONIC_MIN_SAMPLE) candidates.push(fitIsotonic(validation));
  let best = candidates[0]!;
  let bestLoss = Infinity;
  for (const candidate of candidates) {
    const loss =
      logLoss(validation.map((f) => ({ ...f, probabilities: candidate.apply(f.probabilities) }))) ?? Infinity;
    if (loss < bestLoss) {
      bestLoss = loss;
      best = candidate;
    }
  }
  return best;
}

/**
 * Log-opinion-pool blend of model and market: p ∝ model^w · market^(1−w).
 *
 * The weight is fitted on validation by grid, and the grid deliberately
 * includes 0 — "the market alone" must be a reachable answer, or the blend
 * asserts the model helps before checking. A weak independent model should
 * lose this fit, visibly, in the report.
 */
export function fitBlendWeight(
  modelForecasts: Forecast[],
  marketForecasts: Forecast[]
): { weight: number; blend: (model: number[], market: number[]) => number[] } {
  const blendAt = (model: number[], market: number[], w: number): number[] => {
    const mixed = model.map((p, k) => Math.max(1e-12, p) ** w * Math.max(1e-12, market[k]!) ** (1 - w));
    const total = mixed.reduce((sum, value) => sum + value, 0);
    return mixed.map((value) => value / total);
  };

  let bestWeight = 0;
  let bestLoss = Infinity;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const loss =
      logLoss(
        modelForecasts.map((forecast, index) => ({
          outcome: forecast.outcome,
          probabilities: blendAt(forecast.probabilities, marketForecasts[index]!.probabilities, w)
        }))
      ) ?? Infinity;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestWeight = w;
    }
  }
  return { weight: bestWeight, blend: (model, market) => blendAt(model, market, bestWeight) };
}
