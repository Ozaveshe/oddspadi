import type { BandEvidence } from "@/lib/accumulator/calibratedBands";
import {
  MAXIMUM_BAND_GAP,
  assessBand,
  bandFor,
  consensusEdgePremium,
  disagreementEdgePremium
} from "@/lib/accumulator/calibratedBands";
import type { PublicationRecord } from "@/lib/domain/publication";
import type {
  CandidateState,
  DecisionFactor,
  PublicDecision,
  PublicDecisionState,
  PublicationState,
  UncertaintyProfile
} from "@/lib/domain/publicDecision";
import { decisionStatusFromSlateStatus } from "@/lib/domain/states";
import type { PublicationCandidate } from "@/lib/publication/selectForPublication";
import { presentBlockers } from "@/lib/sports/prediction/blockerPresentation";
import type { DecisionMarketAnalysis, DecisionSummary } from "@/lib/sports/types";

/**
 * The one place a `PublicDecision` is assembled.
 *
 * Three objects each held part of one decision and none held all of it:
 * `DecisionMarketAnalysis` has the arithmetic, `DecisionSummary.auditSummary`
 * has the fixture-level verdict and two of the versions, and
 * `PublicationCandidate` / `PublicationRecord` are the only carriers of the
 * provenance versions. Surfaces picked two of the three and disagreed.
 *
 * Everything here is pure: `now` is injected, nothing is read, nothing is
 * written, and no `Date.now()` is called. The same inputs always produce the
 * same payload, which is what makes the contract testable.
 *
 * ## What this builder deliberately refuses to do
 *
 * - It never reads `ValueEdge.impliedProbability`. That field holds the
 *   *de-vigged* number while the database column of the same name holds the
 *   vigged one; reading it is how a surface ends up displaying one and
 *   labelling it the other. `marketProbability` comes from
 *   `rawImpliedProbability` and `fairProbability` from
 *   `noVigImpliedProbability`, and neither is called "implied".
 * - It never emits a fair probability it cannot attribute to an estimator.
 *   `noVigImpliedProbability` is `implied / total` over whatever snapshots
 *   existed, so with one selection stored it is exactly `1.0` — a vigged,
 *   degenerate number wearing a de-vigged name.
 * - It never derives `fairOdds` from `modelProbability`. That is the model's
 *   opinion, not a price, and presenting it as "fair odds" turns a forecast
 *   into a fabricated market.
 * - It never invents a version string. `calibrationVersion` and
 *   `featureSetVersion` have no producer in `src/lib`; absent means `null`.
 * - It ignores `expectedRoi`, which is a byte-identical alias of
 *   `expectedValue` (both persisted).
 *
 * Every unknown is `null`. A zero edge and an unestablished edge must not be
 * representable the same way — that identity is how a sidebar came to say "No
 * value" beside a hero saying "Value Pick".
 */

/**
 * The market consensus method, if the caller knows it.
 *
 * `ValueEdge` carries the consensus *bookmaker count* and *spread* but not the
 * method, so an analysis alone cannot say whether its no-vig number came from
 * Shin (`odds.ts:428`) or from proportional normalisation (`odds.ts:557`) — two
 * estimators that disagree, in the same file. A caller holding the `OddsMarket`
 * can pass it through; otherwise the fair price is reported as unknown rather
 * than guessed.
 */
export type ConsensusMethod = "median-no-vig-v1" | "median-shin-no-vig-v2";

export type PublicDecisionSources = {
  /** The per-selection arithmetic, from `classifyAnalysis`. */
  analysis: DecisionMarketAnalysis;
  /** The fixture-level verdict the analysis belongs to. */
  summary: DecisionSummary;
  /** Publication *intent*. Carries provenance versions; is not a publication. */
  candidate?: PublicationCandidate | null;
  /** The official ledger row, when one exists. The only source of publication state. */
  publication?: PublicationRecord | null;
  /**
   * How the market consensus was computed, when the caller knows.
   * `median-no-vig-v1` is proportional; `median-shin-no-vig-v2` is Shin.
   */
  consensusMethod?: ConsensusMethod | null;
  /**
   * How many selections were priced in this market when the no-vig number was
   * computed. Fewer than two makes the no-vig figure degenerate by
   * construction, whatever its value.
   */
  marketSelectionCount?: number | null;
  /** A fair price already stored upstream. Preferred over deriving one. */
  storedFairOdds?: number | null;
  /** Promoted calibration cohorts, for the calibration uncertainty dimension. */
  calibrationBands?: readonly BandEvidence[] | null;
  /**
   * The engine's 0-100 evidence-risk index
   * (`decisionUncertainty.ts`, `method: weighted-evidence-risk-index-v1`).
   * Explicitly `statistical: false` at source — it is a diagnostic ranking, not
   * a probability. Rescaled to 0-1 here purely so the profile has one unit, and
   * it only ever feeds `overallReadiness`, never a named dimension.
   */
  evidenceRiskIndex?: number | null;
  now: Date;
};

const MINUTE_MS = 60_000;

/**
 * At or above this, a "no-vig" probability is not a probability of anything.
 * One selection normalised against itself is exactly 1.
 */
const DEGENERATE_FAIR_PROBABILITY = 0.999;

/**
 * Overround at which market uncertainty is treated as maximal.
 *
 * There is no configured threshold for bookmaker margin anywhere, so this is a
 * stated convention rather than a measured one: typical margins run 2-10%, and
 * a book charging 15% is not offering a price worth reasoning against.
 */
const MAXIMUM_CREDIBLE_MARGIN = 0.15;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function probabilityOrNull(value: number | null | undefined): number | null {
  const numeric = finiteOrNull(value);
  if (numeric === null) return null;
  return numeric >= 0 && numeric <= 1 ? numeric : null;
}

function timestampOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
}

/**
 * Tokens that are already a way of writing "we do not know".
 *
 * `calibrationVersion` is populated with the literal `"legacy-unknown"` by the
 * jobs that write publications. Passing that through would let a surface print
 * it as a provenance version, which is worse than printing nothing: it looks
 * like an answer. The contract's rule is that unknown is `null`, so an
 * explicitly-unknown version resolves to `null` here.
 */
const PLACEHOLDER_VERSIONS: ReadonlySet<string> = new Set([
  "legacy-unknown",
  "unknown",
  "legacy",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "-"
]);

function versionOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VERSIONS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

type FairPrice = {
  probability: number | null;
  method: "shin" | "proportional" | null;
};

/**
 * Establish the margin-free probability, or refuse to.
 *
 * `buildValueEdges` (`odds.ts:564`) sources `noVigImpliedProbability` three
 * ways: the validated market consensus, else proportional normalisation of the
 * selected quote, else the raw vigged number. Only the middle case is
 * self-identifying from an analysis alone. The consensus case is de-vigged by
 * one of two disagreeing estimators and the analysis does not record which, so
 * without the method the number is dropped rather than mislabelled.
 */
function establishFairPrice({
  analysis,
  consensusMethod,
  marketSelectionCount
}: {
  analysis: DecisionMarketAnalysis;
  consensusMethod: ConsensusMethod | null;
  marketSelectionCount: number | null;
}): FairPrice {
  const unknown: FairPrice = { probability: null, method: null };
  const noVig = probabilityOrNull(analysis.noVigImpliedProbability);
  if (noVig === null) return unknown;

  // A market with one priced selection normalises to 1.0 by arithmetic, not by
  // observation. Both tests, because the count is not always known.
  if (noVig >= DEGENERATE_FAIR_PROBABILITY) return unknown;
  if (marketSelectionCount !== null && marketSelectionCount < 2) return unknown;

  // `consensusMaxProbabilitySpread` is `consensus?.maxProbabilitySpread ?? null`
  // at source, so a finite spread is the one reliable tell that the validated
  // consensus path — not the single-quote path — produced this number.
  const consensusBacked = finiteOrNull(analysis.consensusMaxProbabilitySpread) !== null;
  if (!consensusBacked) {
    // `removeBookmakerMargin` is `normalizeImpliedProbabilities`: proportional.
    return { probability: noVig, method: "proportional" };
  }
  if (consensusMethod === "median-shin-no-vig-v2") return { probability: noVig, method: "shin" };
  if (consensusMethod === "median-no-vig-v1") return { probability: noVig, method: "proportional" };
  return unknown;
}

/**
 * Is the price behind this analysis still current?
 *
 * Mirrors `classifyAnalysis` (`canonicalDecision.ts:328-330`), including its
 * treatment of an unknown capture time as stale: a price we cannot date is not
 * a price we can claim is fresh. Re-evaluated against the injected `now`, so a
 * payload assembled long after generation tells the truth about its own age
 * rather than repeating a verdict reached at generation time.
 */
function priceIsStale({
  analysis,
  oddsCapturedAt,
  expiresAt,
  maximumOddsAgeMinutes,
  now
}: {
  analysis: DecisionMarketAnalysis;
  oddsCapturedAt: string | null;
  expiresAt: string | null;
  maximumOddsAgeMinutes: number | null;
  now: Date;
}): boolean {
  if (analysis.analysisStatus === "stale") return true;
  if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) return true;
  if (oddsCapturedAt === null) return true;
  if (maximumOddsAgeMinutes === null) return false;
  const ageMinutes = (now.getTime() - Date.parse(oddsCapturedAt)) / MINUTE_MS;
  return ageMinutes > maximumOddsAgeMinutes;
}

/**
 * Stable codes for the topics `blockerPresentation` already recognises.
 *
 * The topics themselves are a presentation detail of that module; these codes
 * are part of this contract, so they are mapped rather than borrowed verbatim.
 */
const TOPIC_CODES: Readonly<Record<string, string>> = {
  abstained: "engine.abstained",
  depth: "market.thin_panel",
  disagreement: "market.disagreement",
  "odds-range": "price.out_of_range",
  stale: "price.stale",
  unproven: "evidence.unproven_model",
  implausible: "model.implausible_edge",
  data: "evidence.insufficient_data",
  confidence: "model.low_confidence",
  timing: "timing.kickoff_close",
  fragile: "model.fragile"
};

/** Blockers `blockerPresentation` has no rule for but this contract must still name. */
const EXTRA_CODE_RULES: ReadonlyArray<{ match: RegExp; code: string }> = [
  { match: /not provider-backed/i, code: "fixture.not_provider_backed" },
  { match: /not open for pre-match publication/i, code: "fixture.suspended" },
  { match: /odds snapshot is missing/i, code: "price.missing" },
  { match: /odds snapshot is stale/i, code: "price.stale" },
  { match: /best-price (method|source|timestamp)/i, code: "price.integrity" },
  { match: /no bookmaker price supports this selection/i, code: "market.no_price" },
  { match: /bookmaker panel needs/i, code: "market.thin_panel" },
  { match: /empirical 95% lower-bound edge/i, code: "value.floor_edge_short" },
  { match: /empirical 95% lower-bound EV/i, code: "value.floor_ev_short" },
  { match: /probability band is not publishable/i, code: "calibration.band_unsupported" }
];

function codeForBlocker(blocker: string): string {
  const [presented] = presentBlockers([blocker], 1);
  const topic = presented?.topic ?? "";
  // `raw:` is `presentBlockers`' own marker for "no rule matched".
  if (topic && !topic.startsWith("raw:")) return TOPIC_CODES[topic] ?? `blocker.${topic}`;
  const extra = EXTRA_CODE_RULES.find((rule) => rule.match.test(blocker));
  return extra?.code ?? "blocker.unclassified";
}

/**
 * Which blocker best explains the decision.
 *
 * Ordered by how fundamental the obstacle is: a fixture we cannot price at all
 * outranks a price outside the publication window. Anything unlisted sorts last
 * but is never dropped — a new engine gate must still reach the reader.
 */
const BLOCKER_PRIORITY: readonly string[] = [
  "fixture.not_provider_backed",
  "fixture.suspended",
  "price.missing",
  "market.no_price",
  "price.stale",
  "evidence.insufficient_data",
  "engine.abstained",
  "model.implausible_edge",
  "calibration.band_unsupported",
  "evidence.unproven_model",
  "value.floor_edge_short",
  "value.floor_ev_short",
  "model.fragile",
  "model.low_confidence",
  "price.integrity",
  "market.thin_panel",
  "market.disagreement",
  "price.out_of_range",
  "timing.kickoff_close"
];

function blockerRank(code: string): number {
  const index = BLOCKER_PRIORITY.indexOf(code);
  return index === -1 ? BLOCKER_PRIORITY.length : index;
}

/**
 * Blockers, in the order they most explain the decision.
 *
 * The engine's own wording is kept verbatim: these strings are already written
 * for a reader, and rewriting them here would create a second vocabulary for
 * the same facts. Only the `code` is added.
 */
function blockerFactors(analysis: DecisionMarketAnalysis): DecisionFactor[] {
  const polarity: DecisionFactor["polarity"] = analysis.publicationEligible ? "limiting" : "blocking";
  const seen = new Set<string>();
  const factors: Array<{ factor: DecisionFactor; order: number }> = [];

  for (const blocker of analysis.blockers ?? []) {
    const text = typeof blocker === "string" ? blocker.trim() : "";
    if (!text) continue;
    const code = codeForBlocker(text);
    const key = `${code}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    factors.push({ factor: { code, text, polarity }, order: factors.length });
  }

  return factors
    .sort((left, right) => {
      const rank = blockerRank(left.factor.code) - blockerRank(right.factor.code);
      return rank !== 0 ? rank : left.order - right.order;
    })
    .map((entry) => entry.factor);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** The positive case, stated from the numbers rather than written free-hand. */
function supportingFactor({
  rawEdge,
  expectedValue
}: {
  rawEdge: number | null;
  expectedValue: number | null;
}): DecisionFactor {
  if (rawEdge !== null && rawEdge > 0) {
    return {
      code: "value.edge_over_fair_price",
      text: `The model rates this selection ${percent(rawEdge)} more likely than the margin-free market price.`,
      polarity: "supporting"
    };
  }
  if (expectedValue !== null && expectedValue > 0) {
    return {
      code: "value.positive_expected_value",
      text: `At the quoted price this selection carries ${percent(expectedValue)} expected value.`,
      polarity: "supporting"
    };
  }
  return {
    code: "value.gates_cleared",
    text: "This selection cleared every publication gate.",
    polarity: "supporting"
  };
}

/**
 * Risks that exist independently of any blocker.
 *
 * A published pick usually has an empty blocker list — that is what publishing
 * means — and "no blockers" is not the same as "nothing could make this wrong".
 */
function derivedRiskFactors({
  analysis,
  fair,
  stale
}: {
  analysis: DecisionMarketAnalysis;
  fair: FairPrice;
  stale: boolean;
}): DecisionFactor[] {
  const factors: DecisionFactor[] = [];

  if (stale && !(analysis.blockers ?? []).some((blocker) => codeForBlocker(blocker) === "price.stale")) {
    factors.push({
      code: "price.stale",
      text: "The price this analysis was struck against is no longer current.",
      polarity: "limiting"
    });
  }
  if (fair.probability === null) {
    factors.push({
      code: "market.fair_price_unknown",
      text: "No margin-free market price could be established, so the edge cannot be separated from the bookmaker's margin.",
      polarity: "limiting"
    });
  }
  if (analysis.economicConfidence?.status === "unavailable") {
    factors.push({
      code: "value.floor_unverified",
      text: "No settled-outcome floor has been measured for this runtime, so the value claim is unverified.",
      polarity: "limiting"
    });
  }
  if (analysis.evidenceQuality === "missing" || analysis.evidenceQuality === "thin") {
    factors.push({
      code: "evidence.thin",
      text: `The evidence behind this read is ${analysis.evidenceQuality}.`,
      polarity: "limiting"
    });
  }
  if (analysis.risk === "high") {
    factors.push({
      code: "model.high_risk",
      text: "The engine rates this selection high risk at the quoted price.",
      polarity: "limiting"
    });
  }
  return factors;
}

/** How much of the expected evidence was actually there. */
function dataCoverageUncertainty(analysis: DecisionMarketAnalysis): number | null {
  const quality = finiteOrNull(analysis.dataQuality);
  const fromScore = quality === null ? null : 1 - clamp01(quality);
  const fromEvidence =
    analysis.evidenceQuality === "strong"
      ? 0
      : analysis.evidenceQuality === "acceptable"
        ? 0.15
        : analysis.evidenceQuality === "thin"
          ? 0.5
          : analysis.evidenceQuality === "missing"
            ? 1
            : null;

  const sourced = [fromScore, fromEvidence].filter((value): value is number => value !== null);
  if (!sourced.length) return null;
  // The worst of the two. Averaging lets a high numeric score bury a "missing"
  // evidence verdict, which is precisely the mistake this dimension exists for.
  return clamp01(Math.max(...sourced));
}

/**
 * Disagreement across bookmakers, and the size of the overround.
 *
 * Depth and disagreement are scaled by the premiums the publication rules
 * already charge for them, so the dimension moves with a bar the product has
 * committed to rather than with a constant invented here.
 */
function marketUncertainty(analysis: DecisionMarketAnalysis): number | null {
  const components: number[] = [];

  const margin = finiteOrNull(analysis.bookmakerMargin);
  if (margin !== null) components.push(clamp01(margin / MAXIMUM_CREDIBLE_MARGIN));

  const bookmakerCount = finiteOrNull(analysis.consensusBookmakerCount);
  if (bookmakerCount !== null) {
    const premium = consensusEdgePremium(bookmakerCount);
    // A single book carries the largest finite premium the ladder charges.
    components.push(Number.isFinite(premium) ? clamp01(Math.max(0, premium) / consensusEdgePremium(1)) : 1);
  }

  const spread = finiteOrNull(analysis.consensusMaxProbabilitySpread);
  if (spread !== null) {
    const premium = disagreementEdgePremium(spread);
    // `null` means the books are pricing different events; no median is credible.
    const worstPremium = disagreementEdgePremium(0.15) ?? 0;
    components.push(premium === null || worstPremium <= 0 ? 1 : clamp01(premium / worstPremium));
  }

  if (!components.length) return null;
  return clamp01(Math.max(...components));
}

/** How far this probability sits from a cohort the model has been measured in. */
function calibrationUncertainty({
  modelProbability,
  bands
}: {
  modelProbability: number | null;
  bands: readonly BandEvidence[] | null;
}): number | null {
  if (!bands || !bands.length || modelProbability === null) return null;
  const band = bandFor(modelProbability, [...bands]);
  // Knowing that no promoted cohort covers this probability is a measurement,
  // not an absence of one.
  if (!band) return 1;
  const verdict = assessBand(band);
  if (!verdict.supported) return 1;
  const gap = finiteOrNull(band.calibrationGap);
  if (gap === null) return 1;
  return clamp01(Math.abs(gap) / MAXIMUM_BAND_GAP);
}

/**
 * Spread of the estimate itself.
 *
 * The empirical bucket interval is the only interval anything in the codebase
 * exposes for a probability, and only when it was actually measured. An
 * `unavailable` receipt means no interval exists, which is `null`, not zero.
 */
function modelUncertainty(analysis: DecisionMarketAnalysis): number | null {
  const economic = analysis.economicConfidence;
  if (!economic || economic.status !== "verified") return null;
  const low = probabilityOrNull(economic.probabilityLow);
  const high = probabilityOrNull(economic.probabilityHigh);
  if (low === null || high === null || high < low) return null;
  return clamp01(high - low);
}

function buildUncertainty({
  analysis,
  modelProbability,
  bands,
  evidenceRiskIndex
}: {
  analysis: DecisionMarketAnalysis;
  modelProbability: number | null;
  bands: readonly BandEvidence[] | null;
  evidenceRiskIndex: number | null;
}): UncertaintyProfile {
  const model = modelUncertainty(analysis);
  const dataCoverage = dataCoverageUncertainty(analysis);
  const market = marketUncertainty(analysis);
  const calibration = calibrationUncertainty({ modelProbability, bands });

  // Nothing in the decision pipeline scores fixture/team/market match
  // confidence, and nothing scores missing lineups, rest or travel as a
  // magnitude. Both stay null: a fabricated zero here reads as "certain".
  const identity = null;
  const context = null;

  const sourced = [model, dataCoverage, market, calibration].filter((value): value is number => value !== null);
  const index = finiteOrNull(evidenceRiskIndex);
  const overallReadiness =
    index !== null
      ? clamp01(1 - clamp01(index / 100))
      : sourced.length
        ? clamp01(1 - sourced.reduce((sum, value) => sum + value, 0) / sourced.length)
        : null;

  return { model, dataCoverage, market, identity, context, calibration, overallReadiness };
}

/**
 * What the arithmetic says, independent of whether anything was published.
 *
 * `unsupported_candidate` and `stale_candidate` are both defined by the
 * contract as *positive on paper* variants, so a negative candidate stays
 * negative however stale its price is.
 */
function resolveCandidateState({
  rawEdge,
  expectedValue,
  stale,
  evidenceSupports
}: {
  rawEdge: number | null;
  expectedValue: number | null;
  stale: boolean;
  evidenceSupports: boolean;
}): CandidateState {
  const positive = rawEdge !== null ? rawEdge > 0 : expectedValue !== null ? expectedValue > 0 : null;
  // No establishable arithmetic is not a negative verdict; it is no verdict.
  if (positive === null) return "unsupported_candidate";
  if (!positive) return "negative_candidate";
  if (stale) return "stale_candidate";
  if (!evidenceSupports) return "unsupported_candidate";
  return "positive_candidate";
}

/**
 * Policy's verdict, via the existing slate translation.
 *
 * `SLATE_STATUS_TO_DECISION` (`states.ts:155`) is reused rather than
 * reinvented. It is lossy in two places worth naming: `settled` and
 * `no_clear_value` both become `pass`, so a finished fixture is indistinguishable
 * from one we declined; and `stale` and `needs_data` both become `withheld`, so
 * an expired price is indistinguishable from an absent one. Neither collapse is
 * reachable from `analysisStatus` alone — `settled` is a slate-only word — but
 * both matter when the fixture-level status is the one being mapped.
 */
function resolveDecisionState(analysis: DecisionMarketAnalysis, summary: DecisionSummary): PublicDecisionState {
  // `published_value_pick` is the analysis-level spelling of the slate's
  // `value_pick`; every other analysis status is already a slate word.
  const slateWord = analysis.analysisStatus === "published_value_pick" ? "value_pick" : analysis.analysisStatus;
  const fromAnalysis = decisionStatusFromSlateStatus(slateWord);
  const fromSummary = decisionStatusFromSlateStatus(summary.publicStatus);
  // A suspended or non-provider-backed fixture invalidates every market inside
  // it, so the fixture-level verdict wins in that one direction only.
  return fromSummary === "unavailable" ? "unavailable" : fromAnalysis;
}

function resolvePublicationState(publication: PublicationRecord | null): PublicationState {
  if (!publication) return "unpublished";
  switch (publication.publicationStatus) {
    case "published":
      return "published";
    case "corrected":
      return "corrected";
    case "retracted":
      return "retracted";
    default:
      // A draft is intent, not a publication.
      return "unpublished";
  }
}

export function buildPublicDecision({
  analysis,
  summary,
  candidate = null,
  publication = null,
  consensusMethod = null,
  marketSelectionCount = null,
  storedFairOdds = null,
  calibrationBands = null,
  evidenceRiskIndex = null,
  now
}: PublicDecisionSources): PublicDecision {
  const thresholds = summary.auditSummary?.thresholds ?? null;

  const modelProbability = probabilityOrNull(analysis.modelProbability);
  const conservativeProbability = probabilityOrNull(analysis.economicConfidence?.probabilityLow);

  // Odds of 1.0 or less carry no information; treat them as absent rather than
  // as a price of one.
  const quotedOdds = (() => {
    const odds = finiteOrNull(analysis.odds);
    return odds !== null && odds > 1 ? odds : null;
  })();

  const oddsCapturedAt =
    timestampOrNull(analysis.oddsCapturedAt) ??
    timestampOrNull(analysis.priceObservedAt) ??
    timestampOrNull(candidate?.oddsSnapshotAt) ??
    null;
  const expiresAt = timestampOrNull(analysis.expiresAt);

  const marketProbability = probabilityOrNull(analysis.rawImpliedProbability);
  const fair = establishFairPrice({ analysis, consensusMethod, marketSelectionCount });

  // Recomputed from the two fields the contract names, not copied from
  // `analysis.edge` — that was measured against `impliedProbability`, which is
  // the possibly-degenerate no-vig number under a misleading name.
  const rawEdge = modelProbability !== null && fair.probability !== null ? modelProbability - fair.probability : null;

  // `expectedValue` is `modelProbability × odds − 1` at source, and returns a
  // sentinel −1 for unusable odds. With no usable price there is no expected
  // value to state.
  const expectedValue =
    quotedOdds === null
      ? null
      : (finiteOrNull(analysis.expectedValue) ??
        (modelProbability !== null ? modelProbability * quotedOdds - 1 : null));

  const storedFair = finiteOrNull(storedFairOdds);
  const fairOdds =
    storedFair !== null && storedFair > 1
      ? storedFair
      : fair.probability !== null && fair.probability > 0
        ? 1 / fair.probability
        : null;

  const stale = priceIsStale({
    analysis,
    oddsCapturedAt,
    expiresAt,
    maximumOddsAgeMinutes: finiteOrNull(thresholds?.maximumOddsAgeMinutes),
    now
  });

  const minimumDataQuality = finiteOrNull(thresholds?.minimumDataQuality);
  const dataQuality = finiteOrNull(analysis.dataQuality);
  const evidenceSupports =
    analysis.evidenceQuality !== "missing" &&
    analysis.evidenceQuality !== "thin" &&
    !(minimumDataQuality !== null && dataQuality !== null && dataQuality < minimumDataQuality);

  const candidateState = resolveCandidateState({ rawEdge, expectedValue, stale, evidenceSupports });
  const decisionState = resolveDecisionState(analysis, summary);
  const publicationState = resolvePublicationState(publication);

  const blockers = blockerFactors(analysis);
  const risks = derivedRiskFactors({ analysis, fair, stale });

  // A pick is explained by its value; anything else is explained by whatever
  // stopped it. `noPickReason` is the fixture-level fallback when the engine
  // recorded no blocker at all.
  const mainReason: DecisionFactor = (() => {
    if (decisionState === "pick") return supportingFactor({ rawEdge, expectedValue });
    if (blockers.length) return blockers[0]!;
    if (candidateState === "negative_candidate") {
      return {
        code: "value.no_edge",
        text: "The model does not rate this selection above the market price.",
        polarity: "limiting"
      };
    }
    const noPickReason = summary.noPickReason?.trim();
    if (noPickReason) {
      return { code: "decision.no_pick_reason", text: noPickReason, polarity: "limiting" };
    }
    return {
      code: "decision.unexplained",
      text: "No qualifying reason was recorded for this decision.",
      polarity: "limiting"
    };
  })();

  const riskPool = [...(decisionState === "pick" ? blockers : blockers.slice(1)), ...risks].filter(
    (factor) => factor.code !== mainReason.code
  );
  const primaryRisk = riskPool[0] ?? null;

  const usedCodes = new Set([mainReason.code, ...(primaryRisk ? [primaryRisk.code] : [])]);
  const factors: DecisionFactor[] = [];
  const seenCodes = new Set(usedCodes);
  for (const factor of [
    ...(decisionState === "pick" ? [supportingFactor({ rawEdge, expectedValue })] : []),
    ...blockers,
    ...risks
  ]) {
    if (seenCodes.has(factor.code)) continue;
    seenCodes.add(factor.code);
    factors.push(factor);
  }

  return {
    contractVersion: 1,

    fixtureId: summary.fixtureId,
    marketId: analysis.marketId,
    selectionId: analysis.selectionId,

    modelVersion: versionOrNull(candidate?.modelVersion) ?? versionOrNull(summary.auditSummary?.modelVersion),
    // No producer exists in `src/lib` for either of the next two. Whatever the
    // publication path supplies is passed through; nothing is manufactured.
    calibrationVersion: versionOrNull(candidate?.calibrationVersion) ?? versionOrNull(publication?.calibrationVersion),
    // `engineVersion` is the de-facto decision-policy version — it is what the
    // audit records about the ruleset that produced the verdict — but it is not
    // named as such anywhere, so it is only used when the publication path,
    // which does name it, has nothing to say.
    decisionPolicyVersion:
      versionOrNull(candidate?.decisionPolicyVersion) ??
      versionOrNull(publication?.decisionPolicyVersion) ??
      versionOrNull(summary.auditSummary?.engineVersion),

    modelProbability,
    conservativeProbability,

    quotedOdds,
    oddsCapturedAt,

    marketProbability,
    fairProbability: fair.probability,
    fairMethod: fair.method,
    fairOdds,

    rawEdge,
    expectedValue,

    uncertainty: buildUncertainty({ analysis, modelProbability, bands: calibrationBands, evidenceRiskIndex }),

    candidateState,
    decisionState,
    publicationState,

    mainReason,
    primaryRisk,
    factors,

    // The contract requires a timestamp. An unparseable one is worse than the
    // assembly time, which is at least true of this payload.
    generatedAt: timestampOrNull(summary.generatedAt) ?? now.toISOString(),
    expiresAt
  };
}
