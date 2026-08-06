/**
 * The one payload every public surface reads.
 *
 * Audited 2026-08-06. Nothing in the codebase carried these fields together:
 * `DecisionMarketAnalysis` had ~13 of them, `CanonicalDecision` a different
 * overlapping set, and `PublicationCandidate` was the only object holding all
 * four provenance versions — while recomputing edge itself rather than reading
 * it. Surfaces therefore assembled their own view from two or three of those,
 * and disagreed.
 *
 * This type is deliberately *flat and total*. No optional escape hatches on the
 * numbers: if a value cannot be established the field is `null`, and `null`
 * means "we could not establish this", never "zero". A `0` edge and an unknown
 * edge rendered identically is how a sidebar came to say "No value" beside a
 * hero saying "Value Pick".
 *
 * ## Three names that meant the wrong thing
 *
 * These are fixed here by construction, and the fixes are the reason the field
 * names below differ from their historical counterparts:
 *
 * 1. `ValueEdge.impliedProbability` held the **de-vigged** value while the DB
 *    column `implied_probability` held the **vigged** one — a direct inversion
 *    between memory and storage. Here they are `marketProbability` (vigged,
 *    what the punter is actually offered) and `fairProbability` (de-vigged),
 *    and neither is called "implied".
 * 2. `no_vig_probability` was computed as `implied / total` over whatever
 *    snapshots existed for a market. With one selection stored that is `1.0` —
 *    a vigged, often degenerate number under a de-vigged name. `fairProbability`
 *    is null unless `fairMethod` says how it was derived.
 * 3. `expectedRoi` was a byte-identical alias of `expectedValue`, both
 *    persisted. Only `expectedValue` survives.
 */

/**
 * What the maths says about a market, independent of whether we would publish
 * it. A market can be a strong positive candidate and still never be shown.
 */
export const CANDIDATE_STATES = [
  "positive_candidate",
  "negative_candidate",
  /** Positive on paper, but the evidence behind it does not support acting. */
  "unsupported_candidate",
  /** Positive when priced, but the price is no longer current. */
  "stale_candidate"
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/**
 * What we are willing to say publicly. Distinct from `CandidateState`: this is
 * the output of policy, not of arithmetic.
 */
export const PUBLIC_DECISION_STATES = ["pick", "lean", "watch", "pass", "withheld", "unavailable"] as const;
export type PublicDecisionState = (typeof PUBLIC_DECISION_STATES)[number];

/** Whether an official, immutable publication exists for this selection. */
export const PUBLICATION_STATES = ["unpublished", "published", "corrected", "retracted"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/**
 * Named uncertainty dimensions.
 *
 * "Uncertainty" previously meant three unrelated things at once: a `RiskLevel`
 * derived from data quality, a 0-100 non-statistical evidence index, and an
 * unbounded ranking score. A surface could therefore print "low uncertainty"
 * while a different dimension was extreme, because nothing said *which*
 * dimension was being described.
 *
 * Every value here is 0-1, where **0 is certain and 1 is maximally uncertain**,
 * and each must name its dimension wherever it is displayed. `overallReadiness`
 * is the only one that may be shown without a qualifier, and it is inverted:
 * 0-1 where 1 is ready.
 */
export type UncertaintyProfile = {
  /** Spread of the model's own estimate. Null when the model exposes no interval. */
  model: number | null;
  /** How much of the expected input data was actually present. */
  dataCoverage: number | null;
  /** Disagreement across bookmakers, and the size of the overround. */
  market: number | null;
  /** Confidence that the fixture, teams and market were matched correctly. */
  identity: number | null;
  /** Missing context: lineups, rest, travel, motivation. */
  context: number | null;
  /** How far this probability band sits from a promoted calibration cohort. */
  calibration: number | null;
  /** 0-1, higher is readier. Never a substitute for the dimensions above. */
  overallReadiness: number | null;
};

/**
 * A structured reason. Public copy is generated *from* these, never written
 * free-hand at a surface, so two surfaces cannot describe one decision
 * differently.
 *
 * `code` is stable and machine-readable; `text` is the sanctioned public
 * sentence. Neither may contain model deliberation, agent transcripts or
 * operator repair instructions — see docs/explanation-boundaries.md.
 */
export type DecisionFactor = {
  code: string;
  text: string;
  /** Whether this factor argues for the decision, against it, or blocks it. */
  polarity: "supporting" | "limiting" | "blocking";
};

export type PublicDecision = {
  /** Bumped whenever the shape or the meaning of a field changes. */
  contractVersion: 1;

  fixtureId: string;
  marketId: string;
  selectionId: string;

  modelVersion: string | null;
  calibrationVersion: string | null;
  decisionPolicyVersion: string | null;

  /** The model's probability for this selection, after any calibration. */
  modelProbability: number | null;
  /** Conservative lower bound (Wilson floor). Claims are made against this. */
  conservativeProbability: number | null;

  /** The price actually offered, and when it was captured. */
  quotedOdds: number | null;
  oddsCapturedAt: string | null;

  /** Vigged. What the offered price implies, margin included. */
  marketProbability: number | null;
  /** De-vigged. Null unless `fairMethod` records how. */
  fairProbability: number | null;
  /** Which estimator produced `fairProbability`. Shin and proportional disagree. */
  fairMethod: "shin" | "proportional" | null;
  /** 1 / fairProbability. Stored, never recomputed at a surface. */
  fairOdds: number | null;

  /** modelProbability − fairProbability. Null if either side is null. */
  rawEdge: number | null;
  /** modelProbability × quotedOdds − 1. */
  expectedValue: number | null;

  uncertainty: UncertaintyProfile;

  candidateState: CandidateState;
  decisionState: PublicDecisionState;
  publicationState: PublicationState;

  /** The single factor that most explains the decision. */
  mainReason: DecisionFactor;
  /** The single most material thing that could make it wrong. */
  primaryRisk: DecisionFactor | null;
  /** Everything else, for the advanced fold. */
  factors: DecisionFactor[];

  generatedAt: string;
  expiresAt: string | null;
};

/**
 * Whether this payload may back a public claim of value.
 *
 * Deliberately stricter than "the maths is positive". A positive candidate that
 * policy withheld is still a legitimate analysis; it is not evidence of an
 * edge, and no surface may present it as one.
 */
export function supportsValueClaim(decision: PublicDecision): boolean {
  return (
    decision.decisionState === "pick" &&
    decision.publicationState === "published" &&
    decision.candidateState === "positive_candidate" &&
    decision.conservativeProbability !== null
  );
}

/**
 * True when the two are describing the same market differently.
 *
 * A positive candidate under a `pass` is *expected* and not a contradiction —
 * that is the separation working. What must never happen is the inverse: a
 * decision we published while the arithmetic says the candidate is negative or
 * its price is gone.
 */
export function isContradictory(decision: PublicDecision): boolean {
  const published = decision.decisionState === "pick" || decision.publicationState === "published";
  return published && (decision.candidateState === "negative_candidate" || decision.candidateState === "stale_candidate");
}
