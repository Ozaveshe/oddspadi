import type { StateCell } from "@/lib/domain/stateMatrix";
import type { PublicationRecord } from "@/lib/domain/publication";
import type { FixtureStatus, SettlementStatus } from "@/lib/domain/states";
import {
  buildMatchIntelligence,
  type MarketQuote,
  type MatchIntelligence,
  type MatchIntelligenceInput
} from "@/lib/match/matchIntelligence";
import type {
  CanonicalDecision,
  DecisionStatus as IntelligenceDecisionStatus,
  CanonicalFixture,
  CanonicalFixtureStatus,
  CanonicalOddsSnapshot,
  SlateFixture,
  SlatePublicStatus
} from "@/lib/sports/intelligence/types";
import type {
  DecisionMarketAnalysis,
  DecisionSummary,
  DecisionSummaryPublicStatus,
  DecisionThresholdConfig
} from "@/lib/sports/types";

/**
 * One state cell in, every surface's source shape out.
 *
 * The whole point of the cross-surface suite is that the surfaces are fed from
 * a single source of truth. If each surface got its own hand-built fixture the
 * test would prove nothing: the objects would agree because I typed the same
 * numbers twice, and drift the moment one was edited. So the world is built
 * once per cell and every surface derives from it.
 *
 * Everything is deterministic. No `Date.now()`, no randomness, no incrementing
 * counters — a snapshot or a claim comparison that changes between runs is a
 * flake that will be silenced rather than fixed.
 */

/** Fixed clock. Every timestamp in a world is derived from this instant. */
export const WORLD_NOW = "2026-08-02T18:00:00.000Z";
const HOUR = 3_600_000;

function iso(offsetMs: number): string {
  return new Date(Date.parse(WORLD_NOW) + offsetMs).toISOString();
}

/** Canonical lifecycle → the provider vocabulary the slate still speaks. */
const TO_CANONICAL_STATUS: Record<FixtureStatus, CanonicalFixtureStatus> = {
  scheduled: "scheduled",
  delayed: "suspended",
  live: "live",
  finished: "finished",
  postponed: "postponed",
  cancelled: "cancelled",
  abandoned: "abandoned",
  unknown: "scheduled"
};

const TO_SLATE_STATUS: Record<StateCell["decision"], DecisionSummaryPublicStatus> = {
  pick: "value_pick",
  lean: "lean",
  watch: "watchlist",
  pass: "no_clear_value",
  withheld: "stale",
  unavailable: "needs_data"
};

/** The legacy engine vocabulary the slate row still stores. */
const TO_INTELLIGENCE_DECISION: Record<StateCell["decision"], IntelligenceDecisionStatus> = {
  pick: "published_value_pick",
  lean: "published_lean",
  watch: "watchlist",
  pass: "avoid",
  withheld: "stale",
  unavailable: "needs_data"
};

const TO_LEGACY_SETTLEMENT: Record<SettlementStatus, CanonicalDecision["settlementStatus"]> = {
  unsettled: "pending",
  won: "won",
  lost: "lost",
  push: "push",
  void: "void",
  cancelled: "void",
  pending_verification: "needs_review"
};

export type CanonicalWorld = {
  id: string;
  cell: StateCell;
  fixtureId: string;
  kickoffAt: string;
  score: { home: number; away: number } | null;
  fixture: CanonicalFixture;
  slateRow: SlateFixture;
  publication: PublicationRecord | null;
  intelligence: MatchIntelligence;
  /** What every surface must agree the availability is. */
  availability: StateCell["data"];
};

function quote(observedAt: string): MarketQuote {
  return {
    market: "match_result",
    selection: "home",
    label: "Home win",
    decimalOdds: 1.95,
    bookmaker: "consensus",
    observedAt,
    noVigProbability: 0.52
  };
}

/** A score exists only where the lifecycle permits one. */
function scoreFor(cell: StateCell): { home: number; away: number } | null {
  if (cell.fixture === "live") return { home: 1, away: 0 };
  if (cell.fixture === "finished") return { home: 2, away: 1 };
  if (cell.fixture === "abandoned") return { home: 0, away: 0 };
  return null;
}

const THRESHOLDS: DecisionThresholdConfig = {
  minimumValueEdge: 0.04,
  minimumExpectedValue: 0.03,
  minimumConfidenceForValuePick: "medium",
  minimumDataQuality: 0.62,
  maximumOddsAgeMinutes: 60,
  minimumConsensusBookmakers: 3,
  maximumConsensusProbabilitySpread: 0.1,
  minimumOdds: 1.2,
  maximumOdds: 5,
  minimumKickoffLeadMinutes: 10,
  maxMarketsPerFixture: 3,
  uncalibratedMinimumValueEdge: 0.08,
  uncalibratedMinimumExpectedValue: 0.06,
  uncalibratedMaximumValueEdge: 0.15
};

function marketAnalysis(id: string, cell: StateCell, oddsCapturedAt: string): DecisionMarketAnalysis {
  const eligible = cell.decision === "pick";
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home win",
    modelProbability: 0.58,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.52,
    impliedProbability: 0.52,
    bookmakerMargin: 0.04,
    edge: 0.06,
    expectedValue: 0.11,
    expectedRoi: 0.11,
    odds: 1.95,
    confidence: "medium",
    risk: "medium",
    analysisStatus: eligible ? "published_value_pick" : "watchlist",
    oddsSnapshotId: `${id}-snapshot`,
    oddsCapturedAt,
    expiresAt: null,
    dataQuality: cell.data === "complete" ? 0.95 : 0.6,
    evidenceQuality: cell.data === "complete" ? "strong" : "thin",
    publicationEligible: eligible,
    blockers: eligible ? [] : ["Below the publication gate."]
  };
}

export function buildWorld(id: string, cell: StateCell): CanonicalWorld {
  const fixtureId = `wf-${id}`;
  // Kickoff is in the past for anything that has started, ahead for the rest,
  // so "before kickoff" language is genuinely wrong where the test says it is.
  const started = cell.fixture !== "scheduled" && cell.fixture !== "delayed" && cell.fixture !== "postponed";
  const kickoffAt = iso(started ? -3 * HOUR : 4 * HOUR);
  const score = scoreFor(cell);
  const generatedAt = iso(-4 * HOUR);
  const oddsObservedAt = iso(-4 * HOUR);

  const fixtureDataQuality = cell.data === "complete" ? 0.95 : cell.data === "partial" ? 0.6 : 0.3;

  const fixture: CanonicalFixture = {
    fixtureId,
    providerFixtureId: `provider-${id}`,
    sport: "football",
    league: "Premier League",
    leagueId: "epl",
    country: "England",
    season: "2026",
    kickoffAt,
    homeTeam: { id: "home-1", name: "Enyimba", country: "Nigeria" },
    awayTeam: { id: "away-1", name: "Kaizer Chiefs", country: "South Africa" },
    status: TO_CANONICAL_STATUS[cell.fixture],
    score,
    provider: "api-football",
    lastSyncedAt: iso(-30 * 60_000),
    dataQuality: fixtureDataQuality
  };

  // No odds where the read failed or the market is genuinely empty. This is
  // what makes "stored odds + no odds available" detectable rather than
  // assumed.
  const hasOdds = cell.data === "complete" || cell.data === "partial" || cell.data === "stale";
  const odds: CanonicalOddsSnapshot[] = hasOdds
    ? [
        {
          oddsSnapshotId: `${id}-snapshot`,
          fixtureId,
          market: "1x2",
          selection: "home",
          label: "Home win",
          decimalOdds: 1.95,
          bookmaker: "consensus",
          provider: "the-odds-api",
          capturedAt: oddsObservedAt,
          source: "consensus",
          isLive: cell.fixture === "live",
          expiresAt: iso(6 * HOUR)
        }
      ]
    : [];

  const analysis = marketAnalysis(id, cell, oddsObservedAt);
  const decision: CanonicalDecision = {
    decisionId: `${id}-decision`,
    fixtureId,
    market: "match_result",
    selection: "home",
    label: "Home win",
    oddsSnapshotId: `${id}-snapshot`,
    modelVersion: "test-model-v1",
    engineVersion: "test-engine-v1",
    modelProbability: 0.58,
    impliedProbability: 0.5,
    noVigProbability: 0.52,
    valueEdge: 0.06,
    expectedValue: 0.11,
    decimalOdds: 1.95,
    confidence: "medium",
    risk: "medium",
    dataQuality: fixtureDataQuality,
    evidenceQuality: cell.data === "complete" ? "strong" : "thin",
    decisionStatus: TO_INTELLIGENCE_DECISION[cell.decision],
    publicStatus: TO_SLATE_STATUS[cell.decision],
    reason: `Deterministic decision for ${id}.`,
    generatedAt,
    expiresAt: null,
    supersededBy: null,
    settlementStatus: TO_LEGACY_SETTLEMENT[cell.settlement],
    isPreliminary: cell.data === "partial",
    provider: "oddspadi",
    marketPriorWeight: 0.4,
    marketPriorApplied: true
  };

  const publicStatus = TO_SLATE_STATUS[cell.decision];
  const decisionSummary: DecisionSummary = {
    fixtureId,
    bestPublishedPick: cell.decision === "pick" ? analysis : null,
    bestLean: cell.decision === "lean" ? analysis : null,
    bestWatchlistCandidate: cell.decision === "watch" ? analysis : null,
    noPickReason: cell.decision === "pass" ? "No priced edge above the gate." : null,
    allMarketAnalyses: [analysis],
    publicStatus,
    engineStatus: cell.decision === "pick" ? "published" : "no-pick",
    dataQuality: fixtureDataQuality,
    evidenceQuality: cell.data === "complete" ? "strong" : "thin",
    confidence: "medium",
    risk: "medium",
    generatedAt,
    expiresAt: null,
    auditSummary: {
      modelVersion: "test-model-v1",
      engineVersion: "test-engine-v1",
      thresholdProfile: "football",
      thresholds: THRESHOLDS,
      marketsAnalysed: 1,
      publishedCandidates: cell.decision === "pick" ? 1 : 0,
      leanCandidates: cell.decision === "lean" ? 1 : 0,
      watchlistCandidates: cell.decision === "watch" ? 1 : 0,
      staleCandidates: cell.decision === "withheld" ? 1 : 0,
      enginePublicationAllowed: cell.decision === "pick",
      providerBacked: cell.data !== "unavailable",
      contextSignalsSeen: 4,
      blockers: cell.decision === "pick" ? [] : ["Below the publication gate."],
      publicInvariantPassed: true
    }
  };

  const slateRow: SlateFixture = {
    fixture,
    odds,
    decisions: [decision],
    decisionSummary,
    publicStatus,
    bestDecision: cell.decision === "pick" ? decision : null
  };

  const publication: PublicationRecord | null =
    cell.publication === null
      ? null
      : ({
          publicationId: `pub-${id}`,
          fixtureId,
          sport: "football",
          competition: "Premier League",
          market: "1x2",
          selection: "home",
          selectionLabel: "Home win",
          marketLine: null,
          modelVersion: "test-model-v1",
          featureSetVersion: "test-features-v1",
          calibrationVersion: "test-calibration-v1",
          decisionPolicyVersion: "test-policy-v1",
          modelProbability: 0.58,
          oddsAtPublication: 1.95,
          impliedProbability: 0.5,
          // Always before kickoff. A publication that postdates kickoff is one
          // of the prohibited states, constructed explicitly where needed.
          publishedAt: iso(started ? -5 * HOUR : 1 * HOUR),
          kickoffAt,
          evidenceCutoffAt: iso(started ? -5.5 * HOUR : 0.5 * HOUR),
          oddsSnapshotAt: oddsObservedAt,
          oddsSnapshotId: `${id}-snapshot`,
          dataQuality: cell.data,
          decisionStatus: cell.decision,
          publicCopyRef: null,
          publicationStatus: cell.publication,
          settlementStatus: cell.settlement,
          settledAt: cell.settlement === "unsettled" ? null : iso(-1 * HOUR),
          correctionReason: cell.publication === "corrected" ? "Provider corrected the final score." : null,
          supersedesPublicationId: null,
          recordClass: "official_public_pick"
        } satisfies PublicationRecord);

  const intelligenceInput: MatchIntelligenceInput = {
    fixture: {
      id: fixtureId,
      status: cell.fixture,
      kickoffAt,
      homeTeam: fixture.homeTeam.name,
      awayTeam: fixture.awayTeam.name,
      competition: fixture.league,
      country: fixture.country,
      venue: "Aba",
      homeScore: score?.home ?? null,
      awayScore: score?.away ?? null,
      minute: cell.fixture === "live" ? 63 : null,
      lastVerifiedAt: fixture.lastSyncedAt
    },
    odds: {
      current: hasOdds && cell.data !== "stale" ? [quote(oddsObservedAt)] : [],
      historical: cell.data === "stale" ? [quote(oddsObservedAt)] : [],
      observedAt: hasOdds ? oddsObservedAt : null,
      bookmakerCount: hasOdds ? 4 : 0,
      unavailableReason: cell.data === "unavailable" ? "Odds read failed." : null
    },
    model: {
      run:
        cell.data === "unavailable"
          ? null
          : {
              modelFamily: "poisson",
              modelVersion: "test-model-v1",
              generatedAt,
              evidenceCutoffAt: generatedAt,
              calibrationState: "calibrated",
              probabilities: { home: 0.58, draw: 0.22, away: 0.2 },
              interval: { low: 0.52, high: 0.64 },
              // Never claim a live run for a fixture that is not live.
              isLiveRun: false
            },
      marketProbabilities: hasOdds ? { home: 0.52, draw: 0.24, away: 0.24 } : null
    },
    decision: {
      publicStatus,
      noPickReason: decisionSummary.noPickReason,
      factors: []
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
      fixtureIdentityConfidence: 0.99,
      teamDataCoverage: cell.data === "complete" ? 0.95 : 0.5,
      lineupCoverage: cell.data === "complete" ? 0.9 : 0.2,
      calibrationSupport: 0.8,
      sourceCoverage: hasOdds ? 0.8 : 0
    },
    timelineEvents: [],
    now: WORLD_NOW
  };

  return {
    id,
    cell,
    fixtureId,
    kickoffAt,
    score,
    fixture,
    slateRow,
    publication,
    intelligence: buildMatchIntelligence(intelligenceInput),
    availability: cell.data
  };
}
