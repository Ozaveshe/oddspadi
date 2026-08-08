import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";
import type { DecisionMarketAnalysis } from "@/lib/sports/types";
import { resolveStructuredLeg, type ResolveResult } from "@/lib/workspace/resolve";
import type { LegEntryPoint } from "@/lib/workspace/selection";
import { FIXTURE_STATUSES, type DecisionStatus, type FixtureStatus } from "@/lib/domain/states";

/**
 * Building a workspace leg from a prediction surface.
 *
 * Every entry point that shows a modelled candidate — Today, Explore, Match
 * Intelligence, an official publication row, a watchlist candidate — carries
 * a `DecisionMarketAnalysis`, and this is the one bridge from that shape to a
 * workspace leg. One bridge means one place where the add-time evidence
 * (odds timestamp, model timestamp, no-vig probability, decision state) is
 * captured, instead of each surface improvising its own subset.
 *
 * Adding a leg reads the decision; it never writes one. No entry point
 * creates an official pick.
 */

const CANDIDATE_STATES: Record<string, DecisionStatus> = {
  published_value_pick: "pick",
  lean: "lean",
  watchlist: "watch"
};

/** The candidate a surface may offer for adding: pick, lean or watchlist. */
export function addableCandidate(prediction: PredictionSummary): DecisionMarketAnalysis | null {
  const canonical = prediction.canonicalDecision;
  const candidate = canonical.bestPublishedPick ?? canonical.bestLean ?? canonical.bestDisplayCandidate;
  if (!candidate) return null;
  if (!(candidate.analysisStatus in CANDIDATE_STATES)) return null;
  if (candidate.odds <= 1 || candidate.modelProbability <= 0 || candidate.modelProbability > 1) return null;
  return candidate;
}

export function legInputFromPrediction(
  match: MatchSummary,
  prediction: PredictionSummary,
  entryPoint: LegEntryPoint,
  legId: string
): ResolveResult | null {
  const candidate = addableCandidate(prediction);
  if (!candidate) return null;

  const sport =
    match.sport === "football" || match.sport === "basketball" || match.sport === "tennis" ? match.sport : null;
  const interval =
    candidate.economicConfidence &&
    candidate.economicConfidence.status === "verified" &&
    candidate.economicConfidence.probabilityLow !== null &&
    candidate.economicConfidence.probabilityHigh !== null
      ? { low: candidate.economicConfidence.probabilityLow, high: candidate.economicConfidence.probabilityHigh }
      : null;

  return resolveStructuredLeg(
    {
      fixtureId: match.id,
      sport,
      marketId: candidate.marketId,
      selectionId: candidate.selectionId,
      marketLine: null,
      label: candidate.label,
      fixtureLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      competition: match.league.name,
      source: candidate.bookmaker?.name ?? "Consensus",
      entryPoint,
      userOdds: candidate.odds,
      oddsObservedAt: candidate.priceObservedAt ?? candidate.oddsCapturedAt ?? null,
      marketNoVigProbability: candidate.noVigImpliedProbability,
      modelProbability: candidate.modelProbability,
      modelGeneratedAt: prediction.generatedAt,
      decisionState: CANDIDATE_STATES[candidate.analysisStatus] ?? null,
      // The publication id attaches on recheck, from the publication read
      // itself. Inferring it here from "published_value_pick" would claim a
      // ledger row this surface has not actually seen.
      publicationId: null,
      kickoffAt: match.kickoffTime,
      fixtureStatus: (FIXTURE_STATUSES as readonly string[]).includes(match.status)
        ? (match.status as FixtureStatus)
        : "scheduled",
      marketSupported: true,
      modelInterval: interval
    },
    legId
  );
}
