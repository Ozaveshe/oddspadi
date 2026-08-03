import { detectCorrelations, resolveCombinationBasis, type CombinationBasis } from "@/lib/workspace/correlation";
import type { AnalysedLeg } from "@/lib/workspace/selection";
import { assessBand, bandFor, type BandEvidence } from "@/lib/accumulator/calibratedBands";

/**
 * The daily double: two legs, around evens, built only from calibrated ground.
 *
 * Combining short prices into a ~2.0 is how this audience actually bets, and
 * refusing to help with it does not stop anyone — it just means they build the
 * slip without the maths. So the product should build it, and build it
 * honestly.
 *
 * Two facts shape the design.
 *
 * The first is that accumulating multiplies error. Two legs each overconfident
 * by 5% do not produce a slip that is 5% optimistic; the combined probability
 * is out by roughly 10%, and four legs by nearly 19%. Any leg drawn from an
 * unmeasured probability band poisons the whole slip, which is why legs come
 * only from bands with real settled sample behind them.
 *
 * The second is that accumulating multiplies the bookmaker's margin too. Two
 * legs at a 4% margin each yield a combined margin near 8%. That is the single
 * most under-explained fact about accumulator betting and the receipt states it
 * outright rather than quietly absorbing it into a combined price.
 *
 * Measured on 2026-08-03, the calibrated bands sit at implied odds 1.35 to
 * 2.22. Two legs from there land between 1.8 and 4.9 — the target range is
 * reachable without touching the tails where the model is unmeasured.
 */

export type DoubleCandidate = {
  fixtureId: string;
  competition: string;
  sport: string;
  kickoffAt: string;
  market: string;
  selection: string;
  selectionLabel: string;
  /** Calibrated model probability for this selection. */
  modelProbability: number;
  /** Executable decimal price. */
  decimalOdds: number;
  /** Margin-free market probability, where the panel supports removing it. */
  noVigProbability: number | null;
  bookmakerCount: number;
};

export type DoubleLeg = DoubleCandidate & {
  /** Why this leg was allowed in. */
  bandNote: string;
  /** Model probability minus the margin-free market probability. */
  edge: number;
};

export type DailyDouble = {
  status: "built" | "insufficient-candidates";
  legs: DoubleLeg[];
  /** Product of the leg prices. */
  combinedOdds: number;
  /**
   * Product of the leg probabilities.
   *
   * Only meaningful when the legs are independent, which is why the basis is
   * carried alongside it rather than being assumed.
   */
  combinedProbability: number;
  /** What the combined price implies, before removing margin. */
  combinedImpliedProbability: number;
  /**
   * Margin carried by the slip as a whole. Explicit because it is the cost
   * that compounds and the one punters are least likely to have priced in.
   */
  combinedMargin: number;
  basis: CombinationBasis;
  /** Plain statements a reader needs, never omitted to make the slip look better. */
  notes: string[];
};

/** Two legs is the default: each extra leg compounds both error and margin. */
export const DEFAULT_LEG_COUNT = 2;
export const DEFAULT_TARGET_ODDS = { min: 1.8, max: 2.6 } as const;

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Legs that survive the calibration bands and carry a real edge.
 *
 * A candidate with no margin-free market probability is dropped rather than
 * compared against the raw price: the raw price contains the bookmaker's
 * margin, so an "edge" measured against it is partly just the vig and would
 * flatter every selection.
 */
export function eligibleLegs(candidates: DoubleCandidate[], bands: BandEvidence[]): DoubleLeg[] {
  const legs: DoubleLeg[] = [];
  for (const candidate of candidates) {
    if (candidate.noVigProbability === null) continue;
    if (!(candidate.decimalOdds > 1)) continue;
    const band = bandFor(candidate.modelProbability, bands);
    if (!band) continue;
    const verdict = assessBand(band);
    if (!verdict.supported) continue;

    const edge = candidate.modelProbability - candidate.noVigProbability;
    // The band premium is the price of imperfect calibration in that band.
    if (edge <= verdict.edgePremium) continue;
    legs.push({ ...candidate, edge: round(edge), bandNote: verdict.reason });
  }
  return legs.sort((a, b) => b.edge - a.edge);
}

/**
 * Pick the best combination that lands inside the target price.
 *
 * Ranked by combined model probability rather than by combined odds: the point
 * of the slip is the likeliest route to roughly evens, not the biggest number
 * that happens to fit. One leg per fixture and per competition, so a bad
 * afternoon in one league cannot take both legs down — the correlation module
 * then re-checks the pair for anything subtler.
 */
export function buildDailyDouble(
  candidates: DoubleCandidate[],
  bands: BandEvidence[],
  options: { legCount?: number; target?: { min: number; max: number } } = {}
): DailyDouble {
  const legCount = options.legCount ?? DEFAULT_LEG_COUNT;
  const target = options.target ?? DEFAULT_TARGET_ODDS;
  const pool = eligibleLegs(candidates, bands);

  const empty: DailyDouble = {
    status: "insufficient-candidates",
    legs: [],
    combinedOdds: 0,
    combinedProbability: 0,
    combinedImpliedProbability: 0,
    combinedMargin: 0,
    basis: "combined-unavailable",
    notes: [
      pool.length
        ? `Only ${pool.length} selection${pool.length === 1 ? "" : "s"} cleared the calibrated bands today, so no ${legCount}-leg slip could be built inside ${target.min}–${target.max}.`
        : "No selection cleared the calibrated probability bands today."
    ]
  };
  if (pool.length < legCount) return empty;

  let best: { legs: DoubleLeg[]; probability: number; odds: number } | null = null;
  const walk = (start: number, chosen: DoubleLeg[]) => {
    if (chosen.length === legCount) {
      const odds = chosen.reduce((product, leg) => product * leg.decimalOdds, 1);
      if (odds < target.min || odds > target.max) return;
      const probability = chosen.reduce((product, leg) => product * leg.modelProbability, 1);
      if (!best || probability > best.probability) best = { legs: [...chosen], probability, odds };
      return;
    }
    for (let index = start; index < pool.length; index += 1) {
      const leg = pool[index];
      // One leg per fixture: two selections from the same match are the same
      // bet twice, and no correlation model rescues that.
      //
      // Deliberately *not* one leg per competition. That rule sounded prudent
      // and was quietly fatal: a tennis "competition" is a single tournament,
      // so a whole day's slate sits under two or three of them and every pair
      // was rejected before it could be scored — 76 eligible legs, zero slips.
      // Two different matches in one tournament share no player and no result;
      // the real risk is a shared participant, which is what
      // `detectCorrelations` below exists to find.
      if (chosen.some((existing) => existing.fixtureId === leg.fixtureId)) continue;
      walk(index + 1, [...chosen, leg]);
    }
  };
  walk(0, []);

  if (!best) return empty;
  const winner = best as { legs: DoubleLeg[]; probability: number; odds: number };

  const analysed = winner.legs.map(
    (leg) =>
      ({
        selection: {
          fixtureId: leg.fixtureId,
          competition: leg.competition,
          sport: leg.sport,
          kickoffAt: leg.kickoffAt,
          market: leg.market,
          selection: leg.selection
        }
      }) as unknown as AnalysedLeg
  );
  const findings = detectCorrelations(analysed);
  const basis = resolveCombinationBasis(analysed, findings);

  const combinedImplied = 1 / winner.odds;
  // Margin the slip carries as a whole: what the price implies minus the
  // margin-free probability the same legs imply.
  const fairCombined = winner.legs.reduce((product, leg) => product * (leg.noVigProbability ?? 0), 1);
  const combinedMargin = fairCombined > 0 ? combinedImplied - fairCombined : 0;

  const notes = [
    `Combining ${winner.legs.length} legs multiplies the bookmaker's margin: this slip carries about ${(combinedMargin * 100).toFixed(1)}% against ${(((combinedImplied / (fairCombined || 1)) ** (1 / winner.legs.length) - 1) * 100).toFixed(1)}% per leg.`,
    `Every leg comes from a probability band with measured accuracy. Bands outside that range are excluded, however attractive the price.`,
    `Both legs must win. A ${(winner.probability * 100).toFixed(0)}% combined chance means this slip loses more often than it wins across a season of similar slips.`
  ];
  if (basis !== "independently-modelled") {
    notes.push("The combined probability assumes the legs are independent; the correlation check did not fully confirm that, so treat it as an upper bound.");
  }

  return {
    status: "built",
    legs: winner.legs,
    combinedOdds: round(winner.odds, 2),
    combinedProbability: round(winner.probability),
    combinedImpliedProbability: round(combinedImplied),
    combinedMargin: round(combinedMargin),
    basis,
    notes
  };
}
