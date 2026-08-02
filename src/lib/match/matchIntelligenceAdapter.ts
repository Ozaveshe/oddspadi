import type { Match, Prediction } from "@/lib/sports/types";
import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import type { FixtureStatus } from "@/lib/domain/states";
import type { MarketQuote, MatchIntelligenceInput, RawFactor, TimelineEvent } from "@/lib/match/matchIntelligence";

/**
 * Maps the page's existing reads onto the single view-model input.
 *
 * This adapter is the only place allowed to interpret provider-shaped data for
 * the match page. Components downstream receive the resolved view, so none of
 * them can reach a different conclusion about the same fixture.
 */
const STATUS_MAP: Record<string, FixtureStatus> = {
  scheduled: "scheduled",
  live: "live",
  finished: "finished",
  postponed: "postponed",
  cancelled: "cancelled",
  suspended: "delayed"
};

/** Quotes older than this are context, not a price you could take. */
const CURRENT_ODDS_MAX_AGE_MS = 24 * 60 * 60_000;

function toQuotes(match: Match, fallbackObservedAt: string): MarketQuote[] {
  const quotes: MarketQuote[] = [];
  for (const market of match.oddsMarkets ?? []) {
    // The consensus block carries the margin-free probabilities; a selection
    // only knows its own price.
    const noVig = market.consensus?.probabilities ?? null;
    for (const selection of market.selections ?? []) {
      const decimalOdds = Number(selection.decimalOdds);
      if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) continue;
      const fair = noVig?.[selection.id];
      quotes.push({
        market: market.id,
        selection: selection.id,
        label: selection.label ?? selection.id,
        decimalOdds,
        bookmaker: selection.bookmaker?.name ?? null,
        observedAt: selection.observedAt ?? fallbackObservedAt,
        noVigProbability: typeof fair === "number" ? fair : null
      });
    }
  }
  return quotes;
}

/**
 * The uncertainty band, when the decision carries a belief state.
 *
 * Both bounds must be present: a half-open interval says less than no
 * interval and invites the reader to infer the missing side.
 */
function intervalFrom(displayed: { beliefState?: { confidenceInterval?: { low: number | null; high: number | null } } } | null | undefined) {
  const bounds = displayed?.beliefState?.confidenceInterval;
  if (!bounds || typeof bounds.low !== "number" || typeof bounds.high !== "number") return null;
  return { low: bounds.low, high: bounds.high };
}

/**
 * Turn engine blockers and market analyses into plain factors.
 *
 * The engine's own vocabulary ("required production evidence incomplete") is
 * not consumer copy, so unmapped blockers become one honest evidence-gap
 * factor rather than being surfaced verbatim.
 */
function toFactors(prediction: Prediction): RawFactor[] {
  const factors: RawFactor[] = [];
  const canonical = prediction.canonicalDecision;
  const displayed = canonical.bestPublishedPick ?? canonical.bestLean ?? canonical.bestWatchlistCandidate;

  if (displayed) {
    const edge = Number(displayed.edge);
    if (Number.isFinite(edge) && Math.abs(edge) > 0.001) {
      factors.push({
        kind: "market-move",
        weight: edge,
        detail:
          edge > 0
            ? `The model's probability sits above the market price for ${displayed.label}.`
            : `The market price is shorter than the model's own probability for ${displayed.label}.`
      });
    }
  }

  const winner = prediction.markets?.find((market) => market.marketId === "match_winner");
  if (winner?.probabilities) {
    const home = Number(winner.probabilities.home ?? 0);
    const away = Number(winner.probabilities.away ?? 0);
    if (Number.isFinite(home) && Number.isFinite(away) && Math.abs(home - away) > 0.02) {
      factors.push({
        kind: "strength",
        weight: home - away,
        detail:
          home > away
            ? "Team strength and home advantage favour the home side."
            : "Team strength favours the away side despite the venue."
      });
    }
  }

  if (canonical.evidenceQuality === "thin" || canonical.evidenceQuality === "missing") {
    factors.push({
      kind: "evidence-gap",
      weight: -0.05,
      detail: "Historical and context evidence for this fixture is thinner than the publication bar requires."
    });
  }
  return factors;
}

function toTimeline(match: Match, prediction: Prediction, publication: OfficialPublicationSummary | null): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const generatedAt = prediction.canonicalDecision.generatedAt;
  if (generatedAt) events.push({ at: generatedAt, kind: "model-generated", summary: "Model view generated" });
  if (publication) {
    events.push({
      at: publication.publishedAt,
      kind: "published",
      summary: `Official pick published: ${publication.selectionLabel} at ${publication.oddsAtPublication.toFixed(2)}`
    });
    if (publication.settledAt) {
      events.push({ at: publication.settledAt, kind: "settlement", summary: `Settled ${publication.settlementStatus}` });
    }
  }
  if (match.kickoffTime) events.push({ at: match.kickoffTime, kind: "kickoff", summary: "Kickoff" });
  if (match.status === "finished" && match.score) {
    events.push({
      at: match.kickoffTime,
      kind: "final-result",
      summary: `Final score ${match.score.home}–${match.score.away}`
    });
  }
  return events;
}

export function toMatchIntelligenceInput({
  match,
  prediction,
  publication,
  oddsUnavailableReason = null,
  now
}: {
  match: Match;
  prediction: Prediction;
  publication: OfficialPublicationSummary | null;
  oddsUnavailableReason?: string | null;
  now?: string;
}): MatchIntelligenceInput {
  const nowMs = now ? Date.parse(now) : Date.now();
  const fallbackObservedAt = prediction.generatedAt ?? new Date(nowMs).toISOString();
  const quotes = toQuotes(match, fallbackObservedAt);
  const current = quotes.filter((quote) => nowMs - Date.parse(quote.observedAt) <= CURRENT_ODDS_MAX_AGE_MS);
  const historical = quotes.filter((quote) => !current.includes(quote));
  const observedAt = quotes.length
    ? quotes.map((quote) => quote.observedAt).sort().at(-1) ?? null
    : null;

  const canonical = prediction.canonicalDecision;
  const winner = prediction.markets?.find((market) => market.marketId === "match_winner");
  const displayed = canonical.bestPublishedPick ?? canonical.bestLean ?? canonical.bestWatchlistCandidate;
  const bookmakerCount = new Set(quotes.map((quote) => quote.bookmaker).filter(Boolean)).size;
  const winnerConsensus = match.oddsMarkets?.find((market) => market.id === "match_winner")?.consensus?.probabilities ?? null;

  return {
    fixture: {
      id: match.id,
      status: STATUS_MAP[match.status] ?? "unknown",
      kickoffAt: match.kickoffTime,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      competition: match.league.name,
      country: match.league.country ?? null,
      venue: match.venue?.name ?? null,
      homeScore: match.score?.home ?? null,
      awayScore: match.score?.away ?? null,
      minute: match.score?.minute ?? null,
      lastVerifiedAt: prediction.generatedAt ?? null
    },
    odds: {
      current,
      historical,
      observedAt,
      bookmakerCount,
      unavailableReason: oddsUnavailableReason
    },
    model: {
      run: winner
        ? {
            // User-readable family, not a registry identifier.
            modelFamily: match.sport === "football" ? "Dixon-Coles score model" : "Two-way probability model",
            modelVersion: prediction.diagnostics?.modelVersion ?? "current",
            generatedAt: canonical.generatedAt,
            evidenceCutoffAt: canonical.generatedAt,
            calibrationState:
              canonical.evidenceQuality === "strong" ? "calibrated" : canonical.evidenceQuality === "thin" ? "provisional" : "uncalibrated",
            probabilities: {
              home: Number(winner.probabilities?.home ?? 0),
              draw: winner.probabilities?.draw === undefined ? null : Number(winner.probabilities.draw),
              away: Number(winner.probabilities?.away ?? 0)
            },
            interval: intervalFrom(prediction.decision),
            // No approved in-play model exists yet; this is asserted, not guessed.
            isLiveRun: false
          }
        : null,
      // Market probabilities come from the odds consensus, not the model.
      marketProbabilities: winnerConsensus
        ? {
            home: Number(winnerConsensus.home ?? 0),
            draw: winnerConsensus.draw === undefined ? null : Number(winnerConsensus.draw),
            away: Number(winnerConsensus.away ?? 0)
          }
        : null
    },
    decision: {
      publicStatus: canonical.publicStatus,
      noPickReason: canonical.noPickReason,
      factors: toFactors(prediction)
    },
    publication: publication
      ? {
          publicationId: publication.publicationId,
          market: publication.market,
          selection: publication.selection,
          selectionLabel: publication.selectionLabel,
          oddsAtPublication: publication.oddsAtPublication,
          publishedAt: publication.publishedAt,
          settlementStatus: publication.settlementStatus,
          settledAt: publication.settledAt
        }
      : null,
    evidence: {
      fixtureIdentityConfidence: match.dataSource?.kind === "provider" ? 0.95 : 0.4,
      teamDataCoverage: typeof match.dataQualityScore === "number" ? match.dataQualityScore : null,
      // Lineups publish ~1h before kickoff; absence before then is expected,
      // not a data failure, so it scores low rather than unknown.
      lineupCoverage: match.providerContextSignals?.some((signal) => signal.category === "lineup") ? 1 : 0.2,
      calibrationSupport: canonical.evidenceQuality === "strong" ? 0.8 : canonical.evidenceQuality === "thin" ? 0.4 : 0.2,
      sourceCoverage: Math.min(1, bookmakerCount / 3)
    },
    timelineEvents: toTimeline(match, prediction, publication),
    now
  };
}
