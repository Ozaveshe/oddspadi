import type { UncertaintyEstimate } from "@/lib/model/uncertainty";

/**
 * The decision policy: from a calibrated probability and its context to one of
 * six public states.
 *
 * Two rules organise everything below.
 *
 * **An unread or failed input becomes Unavailable, never Pass.** A pass is a
 * conclusion — "we looked, and there is no value here". Rendering a failed read
 * as a pass publishes a conclusion nobody reached. This codebase has been
 * burned by error-becomes-empty enough times that the rule is structural: every
 * input is tri-state, and null routes to Unavailable before any threshold is
 * consulted.
 *
 * **Edges are computed on the conservative bound, not the point estimate.** A
 * pick made on the point and defended with the interval is a pick made on
 * optimism. The point estimate decides nothing here.
 */

export type PolicyDecision = "pick" | "lean" | "watch" | "pass" | "withheld" | "unavailable";

export type PolicyInput = {
  uncertainty: UncertaintyEstimate | null;
  /** No-vig market probability for the same selection. */
  marketProbability: number | null;
  decimalOdds: number | null;
  /** Whether the price is inside its freshness window. */
  oddsAreFresh: boolean | null;
  /** Distinct books behind the quote. */
  sourceDepth: number | null;
  /** Evidence readiness, 0..1 — the weakest dimension, not an average. */
  dataReadiness: number | null;
  /** Whether a calibration profile covers this sport/market/band. */
  calibrationSupported: boolean | null;
  minutesToKickoff: number | null;
};

export type PolicyThresholds = {
  pickEdge: number;
  leanEdge: number;
  watchEdge: number;
  minReadiness: number;
  minSourceDepth: number;
  /** Odds outside this band are unpublishable however good the edge. */
  minOdds: number;
  maxOdds: number;
};

export const DEFAULT_POLICY: PolicyThresholds = {
  pickEdge: 0.04,
  leanEdge: 0.02,
  watchEdge: 0.0,
  minReadiness: 0.5,
  minSourceDepth: 1,
  // The longshot ceiling exists because this book has measured what happens
  // without one: argmax(model − market) selected 25%-hit-rate longshots, and
  // the odds-based CLV on them flattered a fiction.
  minOdds: 1.2,
  maxOdds: 6.0
};

export type PolicyResult = {
  decision: PolicyDecision;
  /** The edge actually staked on: conservative probability minus market. */
  conservativeEdge: number | null;
  reason: string;
};

export function decidePolicy(input: PolicyInput, thresholds: PolicyThresholds = DEFAULT_POLICY): PolicyResult {
  // Nulls first, before any threshold. Order matters: a null readiness with a
  // superb edge must land here, not at "pick".
  const required: Array<[unknown, string]> = [
    [input.uncertainty, "the model produced no calibrated probability"],
    [input.marketProbability, "no de-vigged market probability could be read"],
    [input.decimalOdds, "no price could be read"],
    [input.oddsAreFresh, "odds freshness could not be determined"],
    [input.dataReadiness, "evidence readiness could not be determined"],
    [input.calibrationSupported, "calibration support could not be determined"]
  ];
  for (const [value, why] of required) {
    if (value === null || value === undefined) {
      return { decision: "unavailable", conservativeEdge: null, reason: `Unavailable: ${why}.` };
    }
  }

  const uncertainty = input.uncertainty!;
  const market = input.marketProbability!;
  const odds = input.decimalOdds!;
  const conservativeEdge = uncertainty.conservativeProbability - market;

  // Withheld: we have a view but refuse to act on it — stale price, thin
  // market, unsupported calibration, or a price outside the publishable band.
  // Distinct from unavailable (no view) and from pass (a view of no value).
  if (!input.oddsAreFresh) {
    return { decision: "withheld", conservativeEdge, reason: "Withheld: the price is outside its freshness window." };
  }
  if (!input.calibrationSupported) {
    return {
      decision: "withheld",
      conservativeEdge,
      reason: "Withheld: no calibration profile covers this market, so the probability is a guess wearing a decimal."
    };
  }
  if (input.dataReadiness! < thresholds.minReadiness) {
    return {
      decision: "withheld",
      conservativeEdge,
      reason: `Withheld: evidence readiness ${input.dataReadiness!.toFixed(2)} is below ${thresholds.minReadiness}.`
    };
  }
  if ((input.sourceDepth ?? 0) < thresholds.minSourceDepth) {
    return { decision: "withheld", conservativeEdge, reason: "Withheld: not enough books behind the quote." };
  }
  if (odds < thresholds.minOdds || odds > thresholds.maxOdds) {
    return {
      decision: "withheld",
      conservativeEdge,
      reason: `Withheld: ${odds.toFixed(2)} is outside the ${thresholds.minOdds}–${thresholds.maxOdds} publishable band.`
    };
  }

  if (conservativeEdge >= thresholds.pickEdge) {
    return {
      decision: "pick",
      conservativeEdge,
      reason: `Pick: even the conservative probability clears the market by ${(conservativeEdge * 100).toFixed(1)} points.`
    };
  }
  if (conservativeEdge >= thresholds.leanEdge) {
    return { decision: "lean", conservativeEdge, reason: "Lean: a modest conservative edge over the market." };
  }
  if (conservativeEdge >= thresholds.watchEdge) {
    return { decision: "watch", conservativeEdge, reason: "Watch: at or barely above the market; worth following, not staking." };
  }
  // A pass is a completed analysis: we looked, and the market's number is
  // better than our conservative one. It remains a legitimate state, and it is
  // never a place a failure can land.
  return {
    decision: "pass",
    conservativeEdge,
    reason: `Pass: the market's ${(market * 100).toFixed(1)}% beats our conservative ${(uncertainty.conservativeProbability * 100).toFixed(1)}%.`
  };
}
