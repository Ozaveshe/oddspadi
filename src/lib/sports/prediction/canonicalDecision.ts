import { assessBand, bandFor, consensusEdgePremium, type BandEvidence } from "@/lib/accumulator/calibratedBands";
import type {
  BestPickResult,
  ConfidenceLevel,
  DecisionEngineReport,
  DecisionMarketAnalysis,
  DecisionMarketAnalysisStatus,
  DecisionSummary,
  DecisionSummaryEngineStatus,
  DecisionSummaryPublicStatus,
  DecisionThresholdConfig,
  EvidenceQuality,
  FootballModelDiagnostics,
  MarketPriorAdjustment,
  Match,
  MatchContextSignal,
  OddsMarket,
  Sport,
  ValueEdge
} from "@/lib/sports/types";
import { isRequiredProductionDataSignalBlocked } from "./contextSignalPolicy";
import { governedHoldoutPublicationBlockers, unprovenSportPublicationBlockers } from "./decisionEngine";
import { withDecisionSummaryHash } from "./decisionSnapshotIdentity";

const MINUTE_MS = 60_000;

export const SPORT_DECISION_THRESHOLDS: Record<Extract<Sport, "football" | "basketball" | "tennis">, DecisionThresholdConfig> = {
  football: {
    minimumValueEdge: 0.04,
    minimumExpectedValue: 0.03,
    minimumConfidenceForValuePick: "medium",
    minimumDataQuality: 0.62,
    maximumOddsAgeMinutes: 60,
    minimumConsensusBookmakers: 3,
    maximumConsensusProbabilitySpread: 0.1,
    minimumOdds: 1.25,
    maximumOdds: 4.5,
    minimumKickoffLeadMinutes: 15,
    maxMarketsPerFixture: 6,
    uncalibratedMinimumValueEdge: 0.05,
    uncalibratedMinimumExpectedValue: 0.04,
    uncalibratedMaximumValueEdge: 0.15
  },
  basketball: {
    minimumValueEdge: 0.035,
    minimumExpectedValue: 0.025,
    minimumConfidenceForValuePick: "medium",
    minimumDataQuality: 0.6,
    maximumOddsAgeMinutes: 45,
    minimumConsensusBookmakers: 3,
    maximumConsensusProbabilitySpread: 0.1,
    minimumOdds: 1.2,
    maximumOdds: 4,
    minimumKickoffLeadMinutes: 10,
    maxMarketsPerFixture: 6,
    uncalibratedMinimumValueEdge: 0.045,
    uncalibratedMinimumExpectedValue: 0.035,
    uncalibratedMaximumValueEdge: 0.15
  },
  tennis: {
    minimumValueEdge: 0.04,
    minimumExpectedValue: 0.03,
    minimumConfidenceForValuePick: "medium",
    minimumDataQuality: 0.62,
    maximumOddsAgeMinutes: 60,
    minimumConsensusBookmakers: 3,
    maximumConsensusProbabilitySpread: 0.1,
    minimumOdds: 1.25,
    maximumOdds: 4.5,
    minimumKickoffLeadMinutes: 15,
    maxMarketsPerFixture: 6,
    uncalibratedMinimumValueEdge: 0.05,
    uncalibratedMinimumExpectedValue: 0.04,
    uncalibratedMaximumValueEdge: 0.15
  }
};

export type DecisionOddsSnapshot = {
  oddsSnapshotId?: string | null;
  fixtureId: string;
  market: string;
  selection: string;
  decimalOdds: number;
  capturedAt: string | null;
  expiresAt?: string | null;
  bookmakerId?: string | null;
  bookmakerName?: string | null;
  priceMethod?: OddsMarket["priceMethod"];
};

export type CanonicalDecisionModelOutput = {
  valueEdges: ValueEdge[];
  diagnostics: Pick<FootballModelDiagnostics, "dataQualityScore">;
  evidenceHash?: string;
  modelVersion?: string;
  engineVersion?: string;
  marketPriorAdjustment?: MarketPriorAdjustment;
  decision?: {
    action?: DecisionEngineReport["action"];
    calibration?: { action?: DecisionEngineReport["calibration"]["action"] };
    actionability?: { status?: DecisionEngineReport["actionability"]["status"] };
    abstentionRules?: Array<{ triggered?: boolean }>;
    dataCoverage?: { signals?: DecisionEngineReport["dataCoverage"]["signals"] };
    robustness?: { status?: DecisionEngineReport["robustness"]["status"] };
    uncertainty?: { status?: DecisionEngineReport["uncertainty"]["status"] };
    learningProfile?: DecisionEngineReport["learningProfile"];
  };
  generatedAt?: string;
};

export type BuildCanonicalDecisionOptions = {
  now?: Date;
  thresholds?: Partial<DecisionThresholdConfig>;
  allowMockFixtures?: boolean;
  /**
   * Measured accuracy per probability band, from the promoted calibration
   * profile.
   *
   * When supplied, the publishable price range and the bookmaker-panel
   * requirement are derived from it rather than from the fixed
   * minimumOdds/maximumOdds/minimumConsensusBookmakers constants. When absent
   * the old constants still apply, so a runtime with no profile keeps the
   * conservative behaviour instead of silently opening up.
   */
  calibrationBands?: BandEvidence[];
};

function supportedSport(sport: Sport): Extract<Sport, "football" | "basketball" | "tennis"> {
  return sport === "basketball" || sport === "tennis" ? sport : "football";
}

export function decisionThresholdsForSport(sport: Sport): DecisionThresholdConfig {
  return SPORT_DECISION_THRESHOLDS[supportedSport(sport)];
}

function confidenceRank(value: ConfidenceLevel): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function evidenceQuality(
  dataQuality: number,
  signals: DecisionEngineReport["dataCoverage"]["signals"] = []
): EvidenceQuality {
  const required = signals.filter((signal) => signal.requiredForProduction && signal.status !== "not-applicable");
  if (required.length) {
    const evidenceScore = required.reduce((score, signal) => {
      if (signal.status === "provider-backed") return score + 1;
      if (signal.status === "computed") return score + 0.5;
      if (signal.status === "stale") return score + 0.1;
      return score;
    }, 0) / required.length;
    if (evidenceScore < 0.25) return "missing";
    if (evidenceScore < 0.6) return "thin";
    if (evidenceScore < 0.9) return "acceptable";
  }
  if (dataQuality >= 0.82) return "strong";
  if (dataQuality >= 0.62) return "acceptable";
  if (dataQuality >= 0.45) return "thin";
  return "missing";
}

function finiteMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function analysisScore(analysis: DecisionMarketAnalysis): number {
  const statusWeight: Record<DecisionMarketAnalysisStatus, number> = {
    published_value_pick: 700,
    lean: 600,
    watchlist: 500,
    stale: 400,
    needs_data: 300,
    no_clear_value: 200,
    suspended: 100
  };
  return statusWeight[analysis.analysisStatus] + (analysis.uncertaintyAdjustedScore ?? 0) + analysis.expectedValue * 10 + analysis.edge * 5;
}

/**
 * Statuses whose display candidate must NOT be chosen by claimed value.
 *
 * A watchlist candidate has, by definition, failed the gates that would make
 * its edge trustworthy — yet it is what the product shows when nothing is
 * publishable, which today is every fixture. Ranking that tier by
 * `expectedValue * 10 + edge * 5` hands users argmax(model − market), and the
 * maximum of a noisy difference is systematically the model's biggest
 * overestimate: a longshot. Measured on the 114 settled football fixtures whose
 * pre-kickoff summaries carried a watchlist tip, that rule produced average
 * odds of 5.37, a 25.4% hit rate and −8.49 units. Tipping the model's most
 * probable outcome on the identical fixtures: 54.4% and +9.08 units — ahead of
 * the market favorite (+9.4u over it), which is the model's actual, measured
 * skill showing through instead of its error.
 *
 * Published picks and leans keep value ranking: they passed the gates that make
 * a value claim meaningful.
 */
const PROBABILITY_RANKED_STATUSES: ReadonlySet<DecisionMarketAnalysisStatus> = new Set([
  "watchlist",
  "stale",
  "needs_data"
]);

/**
 * The candidate shown when nothing is publishable.
 *
 * The first version of this fix reordered the watchlist tier by probability —
 * and production data showed it changed nothing (displayed tips averaged 0.280
 * probability after deploy vs 0.303 before). The reason is tier membership:
 * "watchlist" requires positive claimed edge, and the model's favorite usually
 * has NEGATIVE edge against the market, so the favorite never entered the tier
 * being reordered. Argmax over positive-edge selections is still argmax over
 * model error, just filtered.
 *
 * The display candidate therefore ranks by model probability across every
 * non-publishable status, including no_clear_value — the measured rule that
 * hit 54.4% and +9.08 units against the old rule's 25.4% and -8.49 on the same
 * 114 fixtures. Match-winner analyses take precedence so the headline answers
 * "who wins", not "will there be a goal" (over 0.5 would otherwise outrank
 * everything whenever it is priced). Value tiers and gates are untouched:
 * publishing still requires passing them.
 */
const DISPLAY_CANDIDATE_STATUSES: ReadonlySet<DecisionMarketAnalysisStatus> = new Set([
  "watchlist",
  "stale",
  "needs_data",
  "no_clear_value"
]);

/**
 * The best market to *show*, which is not the same as a market we back.
 *
 * `DISPLAY_CANDIDATE_STATUSES` spans watchlist, stale, needs_data and
 * no_clear_value, so the result is routinely a market the engine explicitly
 * declined. That is intentional — a fixture with nothing to publish should
 * still show its strongest reading and say why it was not published.
 *
 * What was not intentional: this fed a field called `bestWatchlistCandidate`,
 * so a `no_clear_value` analysis arrived at the surfaces under a name claiming
 * it was on the watchlist, and `presentation.ts` rendered it as the headline.
 * That is the mechanism behind a summary reading "no clear value" while the
 * card beneath it showed a positive-EV selection. The field is now
 * `bestDisplayCandidate`, and callers must read `analysisStatus` before
 * describing it as anything the engine endorses.
 */
function selectDisplayCandidate(analyses: DecisionMarketAnalysis[]): DecisionMarketAnalysis | null {
  const eligible = analyses.filter((analysis) => DISPLAY_CANDIDATE_STATUSES.has(analysis.analysisStatus));
  if (!eligible.length) return null;
  const matchWinner = eligible.filter((analysis) => analysis.marketId === "match_winner");
  const pool = matchWinner.length ? matchWinner : eligible;
  return pool.sort((left, right) => {
    if (right.modelProbability !== left.modelProbability) return right.modelProbability - left.modelProbability;
    if (right.edge !== left.edge) return right.edge - left.edge;
    return left.odds - right.odds;
  })[0] ?? null;
}

function best(analyses: DecisionMarketAnalysis[], status: DecisionMarketAnalysisStatus): DecisionMarketAnalysis | null {
  const inTier = analyses.filter((analysis) => analysis.analysisStatus === status);
  if (PROBABILITY_RANKED_STATUSES.has(status)) {
    return inTier.sort((left, right) => {
      if (right.modelProbability !== left.modelProbability) return right.modelProbability - left.modelProbability;
      if (right.edge !== left.edge) return right.edge - left.edge;
      return left.odds - right.odds;
    })[0] ?? null;
  }
  return inTier.sort((left, right) => analysisScore(right) - analysisScore(left))[0] ?? null;
}

function enginePublicationAllowed(decision: CanonicalDecisionModelOutput["decision"]): { allowed: boolean; blockers: string[] } {
  if (!decision) return { allowed: true, blockers: [] };
  const blockers: string[] = [];
  if (decision.action && decision.action !== "consider") blockers.push(`engine action is ${decision.action}`);
  if (decision.calibration?.action === "abstain") blockers.push("calibration requires abstention");
  if (decision.actionability?.status && decision.actionability.status !== "actionable") {
    blockers.push(`engine actionability is ${decision.actionability.status}`);
  }
  if (decision.abstentionRules?.some((rule) => rule.triggered)) blockers.push("an abstention rule is active");
  if (decision.dataCoverage?.signals?.some(isRequiredProductionDataSignalBlocked)) {
    blockers.push("required production evidence is missing, stale, mock, or computed-only");
  }
  if (decision.robustness?.status === "fragile") {
    blockers.push("robustness stress tests classify the recommendation as fragile");
  }
  if (decision.uncertainty?.status === "high-risk") {
    blockers.push("uncertainty decomposition classifies the recommendation as high-risk");
  }
  blockers.push(...governedHoldoutPublicationBlockers(decision.learningProfile));
  blockers.push(...unprovenSportPublicationBlockers(decision.learningProfile));
  return { allowed: blockers.length === 0, blockers };
}

function classifyAnalysis({
  edge,
  snapshot,
  thresholds,
  dataQuality,
  providerBacked,
  fixtureSuspended,
  kickoffLeadMinutes,
  now,
  engineAllowed,
  engineBlockers,
  evidenceQuality: analysisEvidenceQuality,
  calibrationBands
}: {
  edge: ValueEdge;
  snapshot: DecisionOddsSnapshot | null;
  thresholds: DecisionThresholdConfig;
  dataQuality: number;
  providerBacked: boolean;
  fixtureSuspended: boolean;
  kickoffLeadMinutes: number | null;
  now: Date;
  engineAllowed: boolean;
  engineBlockers: string[];
  evidenceQuality: EvidenceQuality;
  calibrationBands?: BandEvidence[];
}): DecisionMarketAnalysis {
  const blockers: string[] = [];
  const capturedMs = finiteMs(snapshot?.capturedAt);
  const ageMinutes = capturedMs === null ? null : Math.max(0, (now.getTime() - capturedMs) / MINUTE_MS);
  const stale = ageMinutes === null || ageMinutes > thresholds.maximumOddsAgeMinutes;
  const expiryMs = capturedMs === null ? null : capturedMs + thresholds.maximumOddsAgeMinutes * MINUTE_MS;
  const configuredExpiryMs = finiteMs(snapshot?.expiresAt);
  const effectiveExpiryMs = expiryMs === null
    ? configuredExpiryMs
    : configuredExpiryMs === null
      ? expiryMs
      : Math.min(expiryMs, configuredExpiryMs);
  const expiresAt = effectiveExpiryMs === null ? null : new Date(effectiveExpiryMs).toISOString();
  const positiveEdge = edge.edge > 0;
  const confidencePasses = confidenceRank(edge.confidence) >= confidenceRank(thresholds.minimumConfidenceForValuePick);
  /**
   * The publishable price range, derived from measured accuracy when a
   * calibration profile exists.
   *
   * A fixed 1.20-5.00 window asks the wrong question: what limits a claim is
   * whether the model has been measured at that probability, not what the
   * price happens to be. With bands present the bound moves on its own as a
   * band earns sample, and closes again if one starts drifting. Without them
   * the fixed window still applies, so an uncalibrated runtime stays
   * conservative rather than opening up by default.
   */
  const band = calibrationBands?.length ? bandFor(edge.modelProbability, calibrationBands) : null;
  const bandVerdict = band ? assessBand(band) : null;
  const pricePasses = bandVerdict
    ? bandVerdict.supported
    : edge.odds >= thresholds.minimumOdds && edge.odds <= thresholds.maximumOdds;
  const leadPasses = kickoffLeadMinutes === null || kickoffLeadMinutes >= thresholds.minimumKickoffLeadMinutes;
  const bestPriceIntegrityRequired = edge.priceMethod === "best-price-per-selection-v1";
  const edgeBookmakerId = edge.bookmaker?.id?.trim() ?? "";
  const edgeBookmakerName = edge.bookmaker?.name?.trim() ?? "";
  const snapshotBookmakerId = snapshot?.bookmakerId?.trim() ?? "";
  const edgePriceMs = finiteMs(edge.priceObservedAt);
  const priceMethodPasses = !bestPriceIntegrityRequired || snapshot?.priceMethod === edge.priceMethod;
  const sourcePasses = !bestPriceIntegrityRequired || (
    Boolean(edgeBookmakerId && edgeBookmakerName) &&
    Boolean(snapshotBookmakerId) &&
    edgeBookmakerId === snapshotBookmakerId
  );
  const timestampPasses = !bestPriceIntegrityRequired || (
    edgePriceMs !== null &&
    capturedMs !== null &&
    edgePriceMs === capturedMs &&
    edgePriceMs <= now.getTime() + 5 * MINUTE_MS
  );
  /**
   * A thin bookmaker panel raises the bar instead of closing the door.
   *
   * One book is less certain than five, and uncertainty is what an edge
   * requirement is denominated in — so the panel prices the claim rather than
   * refusing it. The hard floor of three books rejected 13.9% of decisions
   * that were otherwise good enough to publish. A panel of zero still fails:
   * with no price there is nothing to claim an edge against.
   */
  const bookmakerCount = Number.isInteger(edge.consensusBookmakerCount) ? edge.consensusBookmakerCount ?? 0 : 0;
  const panelPremium = calibrationBands?.length ? consensusEdgePremium(bookmakerCount) : Number.NaN;
  const consensusDepthPasses = !bestPriceIntegrityRequired || (
    calibrationBands?.length
      ? Number.isFinite(panelPremium) && edge.edge >= thresholds.minimumValueEdge + panelPremium
      : Number.isInteger(edge.consensusBookmakerCount) && bookmakerCount >= thresholds.minimumConsensusBookmakers
  );
  const consensusDisagreementPasses = !bestPriceIntegrityRequired || (
    typeof edge.consensusMaxProbabilitySpread === "number" &&
    Number.isFinite(edge.consensusMaxProbabilitySpread) &&
    edge.consensusMaxProbabilitySpread >= 0 &&
    edge.consensusMaxProbabilitySpread <= thresholds.maximumConsensusProbabilitySpread
  );
  const executionIntegrityPasses = priceMethodPasses && sourcePasses && timestampPasses && consensusDepthPasses && consensusDisagreementPasses;
  const economicConfidenceTracked = edge.economicConfidence !== undefined;
  const economicConfidenceVerified = !economicConfidenceTracked || edge.economicConfidence?.status === "verified";
  /**
   * "unavailable" means no calibration profile has been promoted yet, so there
   * is no empirical floor to measure against — which is not the same as a pick
   * that was measured and failed. Treating the two identically blocked every
   * publication permanently, including picks with a large modelled edge.
   *
   * A cold-start pick may publish on raw edge alone, but only over the
   * stricter uncalibrated bar. The decision still carries its
   * `economicConfidence` receipt with status "unavailable", so the match page
   * keeps stating that the value floor is unverified.
   */
  const economicConfidenceUnavailable = economicConfidenceTracked && edge.economicConfidence?.status === "unavailable";
  const uncalibratedEdgeImplausible = edge.edge > thresholds.uncalibratedMaximumValueEdge;
  const uncalibratedPasses =
    economicConfidenceUnavailable &&
    edge.edge >= thresholds.uncalibratedMinimumValueEdge &&
    edge.expectedValue >= thresholds.uncalibratedMinimumExpectedValue &&
    !uncalibratedEdgeImplausible;
  const economicEdgePasses = !economicConfidenceTracked || economicConfidenceUnavailable || (
    edge.economicConfidence?.edgeLow !== null &&
    edge.economicConfidence?.edgeLow !== undefined &&
    edge.economicConfidence.edgeLow >= thresholds.minimumValueEdge
  );
  const economicEvPasses = !economicConfidenceTracked || economicConfidenceUnavailable || (
    edge.economicConfidence?.expectedValueLow !== null &&
    edge.economicConfidence?.expectedValueLow !== undefined &&
    edge.economicConfidence.expectedValueLow >= thresholds.minimumExpectedValue
  );
  const economicConfidencePasses = economicConfidenceUnavailable
    ? uncalibratedPasses
    : economicConfidenceVerified && economicEdgePasses && economicEvPasses;

  if (!providerBacked) blockers.push("fixture is not provider-backed");
  if (fixtureSuspended) blockers.push("fixture is not open for pre-match publication");
  if (!snapshot) blockers.push("odds snapshot is missing");
  else if (stale) blockers.push("odds snapshot is stale");
  if (!priceMethodPasses) blockers.push("best-price method is missing or mismatched on the canonical odds snapshot");
  if (!sourcePasses) blockers.push("best-price source does not match the canonical bookmaker snapshot");
  if (!timestampPasses) blockers.push("best-price timestamp is missing, mismatched, or ahead of the decision clock");
  if (!consensusDepthPasses) {
    blockers.push(
      calibrationBands?.length
        ? bookmakerCount === 0
          ? "no bookmaker price supports this selection"
          : `a ${bookmakerCount}-bookmaker panel needs ${Math.round((thresholds.minimumValueEdge + panelPremium) * 100)}% edge; this selection shows ${Math.round(edge.edge * 100)}%`
        : `best-price comparison needs at least ${thresholds.minimumConsensusBookmakers} independent bookmakers`
    );
  }
  if (!consensusDisagreementPasses) blockers.push(`cross-book probability disagreement exceeds ${Math.round(thresholds.maximumConsensusProbabilitySpread * 100)}%`);
  if (!pricePasses) {
    blockers.push(
      bandVerdict
        ? `this probability band is not publishable yet: ${bandVerdict.reason}`
        : "decimal odds are outside the publication range"
    );
  }
  if (economicConfidenceUnavailable && uncalibratedEdgeImplausible) {
    blockers.push(
      `raw edge ${Math.round(edge.edge * 100)}% exceeds the ${Math.round(thresholds.uncalibratedMaximumValueEdge * 100)}% plausibility ceiling for an uncalibrated runtime; treated as a model fault, not value`
    );
  } else if (economicConfidenceUnavailable && !uncalibratedPasses) {
    blockers.push(
      `uncalibrated publication needs at least ${Math.round(thresholds.uncalibratedMinimumValueEdge * 100)}% raw edge and ${Math.round(thresholds.uncalibratedMinimumExpectedValue * 100)}% raw EV until a calibration profile is promoted`
    );
  } else if (!economicConfidenceVerified) blockers.push("empirical 95% value floor is unavailable for this runtime");
  else {
    if (!economicEdgePasses) blockers.push(`empirical 95% lower-bound edge is below ${Math.round(thresholds.minimumValueEdge * 100)}%`);
    if (!economicEvPasses) blockers.push(`empirical 95% lower-bound EV is below ${Math.round(thresholds.minimumExpectedValue * 100)}%`);
  }
  if (dataQuality < thresholds.minimumDataQuality) blockers.push("data quality is below the sport threshold");
  if (!confidencePasses) blockers.push("confidence is below the value-pick threshold");
  if (!leadPasses) blockers.push("kickoff is too close for a new published pick");
  if (!engineAllowed) blockers.push(...engineBlockers);

  const publicationEligible =
    positiveEdge &&
    edge.edge >= thresholds.minimumValueEdge &&
    edge.expectedValue >= thresholds.minimumExpectedValue &&
    providerBacked &&
    !fixtureSuspended &&
    Boolean(snapshot) &&
    !stale &&
    executionIntegrityPasses &&
    economicConfidencePasses &&
    dataQuality >= thresholds.minimumDataQuality &&
    confidencePasses &&
    pricePasses &&
    leadPasses &&
    engineAllowed;

  let analysisStatus: DecisionMarketAnalysisStatus = "no_clear_value";
  if (fixtureSuspended || !providerBacked) analysisStatus = "suspended";
  else if (!positiveEdge) analysisStatus = "no_clear_value";
  else if (publicationEligible) analysisStatus = "published_value_pick";
  else if (snapshot && stale) analysisStatus = "stale";
  else if (!snapshot) analysisStatus = "needs_data";
  else if (
    dataQuality < thresholds.minimumDataQuality ||
    !confidencePasses ||
    !pricePasses ||
    !leadPasses ||
    !executionIntegrityPasses ||
    !economicConfidencePasses ||
    !engineAllowed
  ) {
    analysisStatus = "watchlist";
  } else {
    analysisStatus = "lean";
  }

  return {
    ...edge,
    analysisStatus,
    oddsSnapshotId: snapshot?.oddsSnapshotId ?? null,
    oddsCapturedAt: snapshot?.capturedAt ?? null,
    expiresAt,
    dataQuality,
    evidenceQuality: analysisEvidenceQuality,
    publicationEligible,
    blockers: unique(blockers)
  };
}

function capMarkets(analyses: DecisionMarketAnalysis[], maxMarkets: number): DecisionMarketAnalysis[] {
  const marketOrder = [...new Set(analyses.slice().sort((left, right) => analysisScore(right) - analysisScore(left)).map((analysis) => analysis.marketId))]
    .slice(0, Math.max(1, maxMarkets));
  const allowed = new Set(marketOrder);
  return analyses.filter((analysis) => allowed.has(analysis.marketId)).sort((left, right) => analysisScore(right) - analysisScore(left));
}

function statusFromAnalyses({
  analyses,
  providerBacked,
  fixtureSuspended
}: {
  analyses: DecisionMarketAnalysis[];
  providerBacked: boolean;
  fixtureSuspended: boolean;
}): DecisionSummaryPublicStatus {
  if (fixtureSuspended || !providerBacked) return "suspended";
  if (!analyses.length) return "needs_data";
  if (analyses.some((analysis) => analysis.analysisStatus === "published_value_pick")) return "value_pick";
  if (analyses.some((analysis) => analysis.analysisStatus === "lean")) return "lean";
  if (analyses.some((analysis) => analysis.analysisStatus === "watchlist" || analysis.analysisStatus === "needs_data")) return "watchlist";
  if (analyses.some((analysis) => analysis.analysisStatus === "stale")) return "stale";
  return "no_clear_value";
}

function engineStatus(publicStatus: DecisionSummaryPublicStatus): DecisionSummaryEngineStatus {
  if (publicStatus === "value_pick") return "published";
  if (publicStatus === "lean") return "lean";
  if (publicStatus === "watchlist") return "watch";
  if (publicStatus === "needs_data") return "needs-data";
  if (publicStatus === "stale") return "stale";
  if (publicStatus === "suspended") return "suspended";
  return "no-pick";
}

function noPickReasonFor(status: DecisionSummaryPublicStatus, watch: DecisionMarketAnalysis | null): string | null {
  if (status === "value_pick") return null;
  if (status === "lean") return "No market cleared every value-pick threshold; the strongest positive edge remains a lean.";
  if (status === "watchlist") {
    return `Watchlist — ${watch?.blockers[0] ?? "fresh odds or stronger evidence is required before publication"}.`;
  }
  if (status === "needs_data") return "The engine needs bookmaker odds before it can make a public value decision.";
  if (status === "stale") return "The supporting odds have expired; refresh prices before publication.";
  if (status === "suspended") return "This fixture is not eligible for a new public pre-match decision.";
  return "No clear value found.";
}

export function oddsSnapshotsFromMatch(match: Match, capturedFallback = new Date()): DecisionOddsSnapshot[] {
  const capturedAt = match.dataSource?.oddsCapturedAt ?? match.dataSource?.fetchedAt ?? capturedFallback.toISOString();
  return match.oddsMarkets.flatMap((market) =>
    market.selections.map((selection) => ({
      oddsSnapshotId: null,
      fixtureId: match.id,
      market: market.id,
      selection: selection.id,
      decimalOdds: selection.decimalOdds,
      capturedAt: selection.observedAt ?? capturedAt,
      bookmakerId: selection.bookmaker?.id ?? market.bookmaker?.id ?? null,
      bookmakerName: selection.bookmaker?.name ?? market.bookmaker?.name ?? null,
      priceMethod: market.priceMethod ?? (market.bookmaker ? "selected-coherent-quote" : undefined)
    }))
  );
}

export function buildCanonicalDecision(
  fixture: Match,
  oddsSnapshots: DecisionOddsSnapshot[],
  modelOutput: CanonicalDecisionModelOutput,
  contextSignals: MatchContextSignal[] = [],
  options: BuildCanonicalDecisionOptions = {}
): DecisionSummary {
  const now = options.now ?? new Date();
  const sport = supportedSport(fixture.sport);
  const thresholds = { ...decisionThresholdsForSport(sport), ...options.thresholds };
  const dataQuality = Math.max(0, Math.min(1, modelOutput.diagnostics.dataQualityScore ?? fixture.dataQualityScore));
  const providerBacked = options.allowMockFixtures === true || fixture.dataSource?.kind === "provider";
  const kickoffMs = finiteMs(fixture.kickoffTime);
  const kickoffLeadMinutes = kickoffMs === null ? null : (kickoffMs - now.getTime()) / MINUTE_MS;
  const fixtureSuspended = options.allowMockFixtures !== true &&
    (fixture.status !== "scheduled" || (kickoffLeadMinutes !== null && kickoffLeadMinutes <= 0));
  const engineGate = enginePublicationAllowed(modelOutput.decision);
  const analysisEvidenceQuality = evidenceQuality(dataQuality, modelOutput.decision?.dataCoverage?.signals);
  const snapshotBySelection = new Map(oddsSnapshots.map((snapshot) => [`${snapshot.market}:${snapshot.selection}`, snapshot]));
  const analyses = capMarkets(
    modelOutput.valueEdges.map((edge) =>
      classifyAnalysis({
        edge,
        snapshot: snapshotBySelection.get(`${edge.marketId}:${edge.selectionId}`) ?? null,
        thresholds,
        dataQuality,
        providerBacked,
        fixtureSuspended,
        kickoffLeadMinutes,
        now,
        engineAllowed: engineGate.allowed,
        engineBlockers: engineGate.blockers,
        evidenceQuality: analysisEvidenceQuality,
        calibrationBands: options.calibrationBands
      })
    ),
    thresholds.maxMarketsPerFixture
  );
  const publicStatus = statusFromAnalyses({ analyses, providerBacked, fixtureSuspended });
  const bestPublishedPick = best(analyses, "published_value_pick");
  const bestLean = best(analyses, "lean");
  const bestDisplayCandidate = selectDisplayCandidate(analyses);
  const primary = bestPublishedPick ?? bestLean ?? bestDisplayCandidate ?? analyses[0] ?? null;
  const generatedAt = modelOutput.generatedAt ?? now.toISOString();
  const publicInvariantPassed =
    (publicStatus === "value_pick") === Boolean(bestPublishedPick) &&
    Boolean(bestPublishedPick) === analyses.some((analysis) => analysis.analysisStatus === "published_value_pick");
  const blockers = unique([...engineGate.blockers, ...analyses.flatMap((analysis) => analysis.blockers)]);

  return withDecisionSummaryHash({
    fixtureId: fixture.id,
    bestPublishedPick,
    bestLean,
    bestDisplayCandidate,
    noPickReason: noPickReasonFor(publicStatus, bestDisplayCandidate),
    allMarketAnalyses: analyses,
    publicStatus,
    engineStatus: engineStatus(publicStatus),
    dataQuality,
    evidenceQuality: analysisEvidenceQuality,
    confidence: publicStatus === "value_pick" || publicStatus === "lean" ? primary?.confidence ?? "low" : "low",
    risk: publicStatus === "value_pick" || publicStatus === "lean" ? primary?.risk ?? "high" : "high",
    generatedAt,
    expiresAt: primary?.expiresAt ?? null,
    auditSummary: {
      ...(modelOutput.evidenceHash ? { evidenceHash: modelOutput.evidenceHash } : {}),
      ...(modelOutput.modelVersion ? { modelVersion: modelOutput.modelVersion } : {}),
      ...(modelOutput.engineVersion ? { engineVersion: modelOutput.engineVersion } : {}),
      thresholdProfile: sport,
      thresholds,
      marketsAnalysed: new Set(analyses.map((analysis) => analysis.marketId)).size,
      publishedCandidates: analyses.filter((analysis) => analysis.analysisStatus === "published_value_pick").length,
      leanCandidates: analyses.filter((analysis) => analysis.analysisStatus === "lean").length,
      watchlistCandidates: analyses.filter((analysis) => analysis.analysisStatus === "watchlist" || analysis.analysisStatus === "needs_data").length,
      staleCandidates: analyses.filter((analysis) => analysis.analysisStatus === "stale").length,
      enginePublicationAllowed: engineGate.allowed,
      providerBacked,
      contextSignalsSeen: contextSignals.length,
      blockers,
      publicInvariantPassed,
      ...(modelOutput.marketPriorAdjustment ? { marketPriorAdjustment: modelOutput.marketPriorAdjustment } : {})
    }
  });
}

export function bestPickFromCanonicalDecision(summary: DecisionSummary): BestPickResult {
  return summary.bestPublishedPick
    ? { ...summary.bestPublishedPick, hasValue: true }
    : { hasValue: false, label: "No clear value found" };
}

export function refreshCanonicalDecision(summary: DecisionSummary, now = new Date()): DecisionSummary {
  const expiryMs = finiteMs(summary.expiresAt);
  if (
    expiryMs === null ||
    expiryMs > now.getTime() ||
    summary.publicStatus === "stale" ||
    summary.publicStatus === "suspended" ||
    summary.publicStatus === "needs_data"
  ) {
    return summary;
  }
  const analyses = summary.allMarketAnalyses.map((analysis) => {
    const analysisExpiry = finiteMs(analysis.expiresAt);
    if (analysisExpiry === null || analysisExpiry > now.getTime() || analysis.edge <= 0) return analysis;
    return {
      ...analysis,
      analysisStatus: "stale" as const,
      publicationEligible: false,
      blockers: unique([...analysis.blockers, "odds snapshot is stale"])
    };
  });
  const publicStatus = statusFromAnalyses({
    analyses,
    providerBacked: summary.auditSummary.providerBacked,
    fixtureSuspended: false
  });
  const bestPublishedPick = best(analyses, "published_value_pick");
  const bestLean = best(analyses, "lean");
  const bestDisplayCandidate = selectDisplayCandidate(analyses);
  const primary = bestPublishedPick ?? bestLean ?? bestDisplayCandidate ?? analyses[0] ?? null;
  const publicInvariantPassed =
    (publicStatus === "value_pick") === Boolean(bestPublishedPick) &&
    Boolean(bestPublishedPick) === analyses.some((analysis) => analysis.analysisStatus === "published_value_pick");
  return withDecisionSummaryHash({
    ...summary,
    bestPublishedPick,
    bestLean,
    bestDisplayCandidate,
    allMarketAnalyses: analyses,
    publicStatus,
    engineStatus: engineStatus(publicStatus),
    noPickReason: noPickReasonFor(publicStatus, bestDisplayCandidate),
    confidence: publicStatus === "value_pick" || publicStatus === "lean" ? primary?.confidence ?? "low" : "low",
    risk: publicStatus === "value_pick" || publicStatus === "lean" ? primary?.risk ?? "high" : "high",
    expiresAt: primary?.expiresAt ?? null,
    auditSummary: {
      ...summary.auditSummary,
      publishedCandidates: analyses.filter((analysis) => analysis.analysisStatus === "published_value_pick").length,
      leanCandidates: analyses.filter((analysis) => analysis.analysisStatus === "lean").length,
      watchlistCandidates: analyses.filter((analysis) => analysis.analysisStatus === "watchlist" || analysis.analysisStatus === "needs_data").length,
      staleCandidates: analyses.filter((analysis) => analysis.analysisStatus === "stale").length,
      blockers: unique([...summary.auditSummary.blockers, "odds snapshot is stale"]),
      publicInvariantPassed
    }
  });
}

export function decisionSummaryLabel(summary: DecisionSummary): string {
  if (summary.publicStatus === "value_pick") return "Value Pick";
  if (summary.publicStatus === "lean") return "Lean";
  if (summary.publicStatus === "watchlist") return "Watchlist";
  if (summary.publicStatus === "needs_data") return "Needs data";
  if (summary.publicStatus === "stale") return "Stale";
  if (summary.publicStatus === "suspended") return "Suspended";
  return "No clear value";
}
