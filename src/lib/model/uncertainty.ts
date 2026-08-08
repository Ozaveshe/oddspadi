/**
 * Uncertainty, synthesised from named sources.
 *
 * A model outputs a point probability; the product needs to know how much that
 * number can be leaned on, and *why* it cannot. One blended "confidence" score
 * makes the second question unanswerable — so every source keeps its name, and
 * the output carries the widest contributors alongside the interval.
 *
 * The conservative bound is the number the decision policy actually stakes on.
 * A pick made on the point estimate and defended with the interval is a pick
 * made on optimism.
 */

export type UncertaintySource = {
  id:
    | "ensemble_dispersion"
    | "bootstrap"
    | "data_missingness"
    | "calibration_uncertainty"
    | "market_disagreement"
    | "identity_uncertainty"
    | "lineup_uncertainty";
  /** Width contribution in probability points, >= 0. */
  width: number;
  detail: string;
};

export type UncertaintyEstimate = {
  pointProbability: number;
  /**
   * The bound the policy stakes on: point minus the combined half-width,
   * floored at a nominal epsilon rather than zero because a zero-probability
   * claim is not a bet, it is a refusal wearing numbers.
   */
  conservativeProbability: number;
  interval: { low: number; high: number };
  /** Widest first, so "why is this uncertain" reads off the top. */
  mainSources: UncertaintySource[];
  totalWidth: number;
};

const EPSILON = 0.01;

export function estimateUncertainty(pointProbability: number, sources: UncertaintySource[]): UncertaintyEstimate {
  const point = Math.min(1 - EPSILON, Math.max(EPSILON, pointProbability));
  const usable = sources.filter((source) => Number.isFinite(source.width) && source.width > 0);

  /**
   * Root-sum-square rather than a plain sum. The sources are not perfectly
   * correlated — ensemble spread and lineup doubt do not stack linearly — and a
   * plain sum grows so fast that every fixture with three named doubts becomes
   * unpublishable, which teaches people to stop naming doubts.
   */
  const totalWidth = Math.sqrt(usable.reduce((sum, source) => sum + source.width * source.width, 0));

  const low = Math.max(EPSILON, point - totalWidth);
  const high = Math.min(1 - EPSILON, point + totalWidth);

  return {
    pointProbability: point,
    conservativeProbability: low,
    interval: { low, high },
    mainSources: [...usable].sort((a, b) => b.width - a.width).slice(0, 3),
    totalWidth
  };
}
