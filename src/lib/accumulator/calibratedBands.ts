/**
 * Where the model has earned the right to be believed.
 *
 * Publication used a hardcoded odds range of 1.20 to 5.00. That number is not
 * wrong so much as it is expressed in the wrong variable: what actually limits
 * a claim is whether the model has been *measured* at that probability, not
 * what the price happens to be.
 *
 * Measured on 2026-08-03 against 932 settled tennis outcomes and 481 football:
 *
 *   band      implied odds   n     calibration gap
 *   p40-50        2.22      217        +0.007
 *   p50-60        1.82      221        +0.024
 *   p60-70        1.55      162        +0.034
 *   p70-80        1.35       77        +0.024
 *   p80-90        1.20        7        +0.259   <- claimed 83%, hit 57%
 *   p90-100       1.04        1        +0.959
 *   p10-20        5.91        7        +0.259
 *
 * The middle is well calibrated on real sample. Both tails are unmeasured, and
 * the sliver of evidence that exists there says the model is badly
 * overconfident in both directions.
 *
 * So the bound is derived rather than declared: a band is publishable when it
 * has enough settled outcomes and its calibration gap is small enough. The
 * range widens by itself as evidence accumulates, and narrows if a band starts
 * drifting — neither of which a hardcoded 1.20 can do.
 */

export type BandEvidence = {
  /** Lower probability edge of the band, e.g. 0.7 for p70-80. */
  lowerBound: number;
  upperBound: number;
  settledSize: number;
  /** |predicted − actual| for the band. */
  calibrationGap: number | null;
};

export type BandVerdict = {
  supported: boolean;
  reason: string;
  /** Extra edge required because the band's evidence is thin. */
  edgePremium: number;
};

/**
 * Minimum settled outcomes before a band's calibration means anything.
 *
 * 30 is the same floor the calibration profile itself uses. Below it the
 * observed win rate is dominated by noise: the p80-90 band read 57% on seven
 * outcomes, which is neither evidence the model is broken nor evidence it
 * works.
 */
export const MINIMUM_BAND_SAMPLE = 30;

/**
 * Largest calibration gap a band may carry and still be publishable.
 *
 * 0.05 is deliberately close to the typical published edge. A band whose
 * predictions are off by more than the edge being claimed cannot support that
 * claim, whatever the point estimate says.
 */
export const MAXIMUM_BAND_GAP = 0.05;

/** Extra edge demanded per unit of calibration gap, once a band qualifies. */
const GAP_TO_PREMIUM = 1.0;

export function assessBand(band: BandEvidence): BandVerdict {
  if (band.settledSize < MINIMUM_BAND_SAMPLE) {
    return {
      supported: false,
      reason: `only ${band.settledSize} settled outcome${band.settledSize === 1 ? "" : "s"} in this probability band; ${MINIMUM_BAND_SAMPLE} needed before its accuracy means anything`,
      edgePremium: 0
    };
  }
  if (band.calibrationGap === null) {
    return { supported: false, reason: "no calibration measurement exists for this band", edgePremium: 0 };
  }
  if (band.calibrationGap > MAXIMUM_BAND_GAP) {
    return {
      supported: false,
      reason: `the model is off by ${(band.calibrationGap * 100).toFixed(1)}% in this band, which exceeds the edge a pick here could claim`,
      edgePremium: 0
    };
  }
  return {
    supported: true,
    // A band that is calibrated but not perfectly so still costs something.
    edgePremium: Math.max(0, band.calibrationGap * GAP_TO_PREMIUM),
    reason: `${band.settledSize} settled outcomes, calibration gap ${(band.calibrationGap * 100).toFixed(1)}%`
  };
}

export function bandFor(probability: number, bands: BandEvidence[]): BandEvidence | null {
  return bands.find((band) => probability >= band.lowerBound && probability < band.upperBound) ?? null;
}

/**
 * How much extra edge a thin bookmaker panel has to pay for.
 *
 * The old rule was a hard floor of three books. The purpose of a panel is to
 * locate the fair price: one book tells you its own opinion plus its margin,
 * three let you take a median and see the spread. But "fewer than three" is not
 * the same as "unusable" — it is *less certain*, and uncertainty is exactly the
 * thing an edge requirement is denominated in.
 *
 * So the panel scales the requirement instead of gating it. One book has to
 * clear a materially higher bar; a deep panel earns a small discount. A single
 * book is still allowed to produce a pick, which the hard floor forbade
 * outright — that alone accounted for 13.9% of otherwise-qualified decisions.
 */
export function consensusEdgePremium(bookmakerCount: number): number {
  if (bookmakerCount <= 0) return Number.POSITIVE_INFINITY; // no price, no claim
  if (bookmakerCount === 1) return 0.03;
  if (bookmakerCount === 2) return 0.015;
  if (bookmakerCount <= 4) return 0;
  return -0.005; // a deep, agreeing panel is genuinely better evidence
}

/**
 * Wider disagreement means the fair price is less certain, so ask for more.
 * Beyond 15% the books are pricing different events and no median is credible.
 */
export function disagreementEdgePremium(maxProbabilitySpread: number): number | null {
  if (maxProbabilitySpread > 0.15) return null;
  if (maxProbabilitySpread <= 0.04) return 0;
  return (maxProbabilitySpread - 0.04) * 0.5;
}

export type PublicationRequirement = {
  publishable: boolean;
  /** Total edge the selection must show, after every premium. */
  requiredEdge: number;
  reasons: string[];
};

/**
 * The one place a publication bar is computed.
 *
 * Every input is a measured uncertainty rather than a category, so a selection
 * is judged on how well its own evidence is understood — not on whether its
 * price fell inside a range somebody typed once.
 */
export function publicationRequirement({
  baseEdge,
  band,
  bookmakerCount,
  maxProbabilitySpread
}: {
  baseEdge: number;
  band: BandEvidence | null;
  bookmakerCount: number;
  maxProbabilitySpread: number;
}): PublicationRequirement {
  const reasons: string[] = [];
  if (!band) {
    return { publishable: false, requiredEdge: Number.POSITIVE_INFINITY, reasons: ["no calibration band covers this probability"] };
  }

  const verdict = assessBand(band);
  if (!verdict.supported) {
    return { publishable: false, requiredEdge: Number.POSITIVE_INFINITY, reasons: [verdict.reason] };
  }
  reasons.push(`band supported: ${verdict.reason}`);

  const consensus = consensusEdgePremium(bookmakerCount);
  if (!Number.isFinite(consensus)) {
    return { publishable: false, requiredEdge: Number.POSITIVE_INFINITY, reasons: ["no bookmaker price"] };
  }
  if (consensus > 0) reasons.push(`thin panel (${bookmakerCount} book${bookmakerCount === 1 ? "" : "s"}): +${(consensus * 100).toFixed(1)}% edge required`);
  if (consensus < 0) reasons.push(`deep panel (${bookmakerCount} books): ${(consensus * 100).toFixed(1)}% edge discount`);

  const disagreement = disagreementEdgePremium(maxProbabilitySpread);
  if (disagreement === null) {
    return {
      publishable: false,
      requiredEdge: Number.POSITIVE_INFINITY,
      reasons: [`bookmakers disagree by ${(maxProbabilitySpread * 100).toFixed(1)}%, so no fair price can be established`]
    };
  }
  if (disagreement > 0) reasons.push(`book spread ${(maxProbabilitySpread * 100).toFixed(1)}%: +${(disagreement * 100).toFixed(1)}% edge required`);

  const requiredEdge = baseEdge + verdict.edgePremium + consensus + disagreement;
  return { publishable: true, requiredEdge: Math.max(0.01, requiredEdge), reasons };
}
