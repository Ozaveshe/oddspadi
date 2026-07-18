import { describe, expect, it } from "vitest";
import { buildPredictionPresentation } from "@/lib/sports/prediction/presentation";
import type { SlateFixture, SlatePublicStatus } from "@/lib/sports/intelligence/types";
import type { DecisionMarketAnalysis, DecisionSummary } from "@/lib/sports/types";

const NOW = "2026-07-17T10:00:00.000Z";

function analysis(blockers: string[] = []): DecisionMarketAnalysis {
  return {
    marketId: "draw_no_bet",
    selectionId: "away",
    label: "Away DNB",
    modelProbability: 0.56,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.49,
    impliedProbability: 0.49,
    bookmakerMargin: 0.04,
    edge: 0.07,
    expectedValue: 0.11,
    expectedRoi: 0.11,
    odds: 2.04,
    confidence: "medium",
    risk: "medium",
    analysisStatus: blockers.length ? "watchlist" : "published_value_pick",
    oddsSnapshotId: "odds-1",
    oddsCapturedAt: NOW,
    expiresAt: "2026-07-17T11:00:00.000Z",
    dataQuality: 0.82,
    evidenceQuality: "acceptable",
    publicationEligible: blockers.length === 0,
    blockers
  };
}

function row(status: SlatePublicStatus, blockers: string[] = []): SlateFixture {
  const candidate = analysis(blockers);
  const summary: DecisionSummary = {
    fixtureId: "fixture-1",
    bestPublishedPick: status === "value_pick" ? candidate : null,
    bestLean: status === "lean" ? { ...candidate, analysisStatus: "lean", publicationEligible: false } : null,
    bestWatchlistCandidate: status === "watchlist" || status === "stale" ? { ...candidate, analysisStatus: status, publicationEligible: false } : null,
    noPickReason: status === "no_clear_value" ? "No current market clears the value floor." : null,
    allMarketAnalyses: [candidate],
    publicStatus: status === "preliminary" || status === "ready" || status === "settled" || status === "needs_review" ? "needs_data" : status,
    engineStatus: status === "value_pick" ? "published" : status === "lean" ? "lean" : status === "watchlist" ? "watch" : status === "stale" ? "stale" : "no-pick",
    dataQuality: 0.82,
    evidenceQuality: "acceptable",
    confidence: "medium",
    risk: "medium",
    generatedAt: NOW,
    expiresAt: candidate.expiresAt,
    auditSummary: {
      modelVersion: "football-v4",
      engineVersion: "decision-v3",
      thresholdProfile: "football",
      thresholds: { minimumValueEdge: 0.04, minimumExpectedValue: 0.03, minimumConfidenceForValuePick: "medium", minimumDataQuality: 0.62, maximumOddsAgeMinutes: 60, minimumConsensusBookmakers: 3, maximumConsensusProbabilitySpread: 0.1, minimumOdds: 1.2, maximumOdds: 5, minimumKickoffLeadMinutes: 10, maxMarketsPerFixture: 3 },
      marketsAnalysed: 1,
      publishedCandidates: status === "value_pick" ? 1 : 0,
      leanCandidates: status === "lean" ? 1 : 0,
      watchlistCandidates: status === "watchlist" ? 1 : 0,
      staleCandidates: status === "stale" ? 1 : 0,
      enginePublicationAllowed: status === "value_pick",
      providerBacked: true,
      contextSignalsSeen: 4,
      blockers,
      publicInvariantPassed: true
    }
  };
  return {
    fixture: {
      fixtureId: "fixture-1",
      providerFixtureId: "provider-1",
      sport: "football",
      league: "Premier League",
      leagueId: "39",
      country: "England",
      season: "2026",
      kickoffAt: "2026-07-17T18:00:00.000Z",
      homeTeam: { id: "h", name: "Home FC" },
      awayTeam: { id: "a", name: "Away FC" },
      status: "scheduled",
      score: null,
      provider: "api-football",
      lastSyncedAt: NOW,
      dataQuality: 0.82
    },
    odds: [],
    decisions: [],
    decisionSummary: summary,
    publicStatus: status,
    bestDecision: null
  };
}

describe("fixture-first prediction presentation", () => {
  it("presents a published selection without losing its model identity", () => {
    const result = buildPredictionPresentation(row("value_pick"), NOW);
    expect(result).toMatchObject({ statusLabel: "Value pick", marketLabel: "Draw No Bet", isPublishedPick: true, modelVersion: "football-v4", engineVersion: "decision-v3", freshness: "fresh" });
    expect(result.verdict).toContain("clears the current publication gates");
  });

  it("keeps a blocked positive edge on the watchlist", () => {
    const result = buildPredictionPresentation(row("watchlist", ["Lineup evidence is incomplete."]), NOW);
    expect(result.isPublishedPick).toBe(false);
    expect(result.statusLabel).toBe("Watchlist");
    expect(result.verdict).toContain("still blocked");
    expect(result.primaryRisk).toContain("Lineup evidence");
  });

  it("marks an expired price as stale even when the stored status has not changed", () => {
    expect(buildPredictionPresentation(row("lean"), "2026-07-17T11:01:00.000Z").freshness).toBe("stale");
  });

  it("routes community discussion separately from the model analysis", () => {
    const result = buildPredictionPresentation(row("value_pick"), NOW);
    expect(result.analysisHref).toBe("/predictions/fixture-1");
    expect(result.communityHref).toContain("/community?match=fixture-1");
    expect(result.isCommunityOpinion).toBe(false);
  });
});
