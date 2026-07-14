import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import { publicWatchlistReason } from "@/lib/sports/prediction/publicDecisionCopy";
import type { Match } from "@/lib/sports/types";

describe("thin-history football probability discipline", () => {
  it("does not advertise a four-match longshot signal as strong model evidence", async () => {
    const [base] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const capturedAt = new Date().toISOString();
    const match: Match = {
      ...base,
      id: "api-football:thin-history-regression",
      kickoffTime: "2026-08-21T19:00:00.000Z",
      homeTeam: {
        id: "api-football:42",
        name: "Arsenal",
        rating: 96,
        ratingEvidence: { source: "api-football-recent-fixtures-form-rating-v1", sampleSize: 4 }
      },
      awayTeam: {
        id: "api-football:1346",
        name: "Coventry",
        rating: 92,
        ratingEvidence: { source: "api-football-recent-fixtures-form-rating-v1", sampleSize: 4 }
      },
      homeForm: {
        teamId: "api-football:42",
        recentResults: ["W", "W", "W", "W"],
        goalsFor: 1.5,
        goalsAgainst: 0,
        xgFor: 1.44,
        xgAgainst: 0.96,
        attackStrength: 0.99,
        defenseStrength: 1.28
      },
      awayForm: {
        teamId: "api-football:1346",
        recentResults: ["W", "D", "D", "W"],
        goalsFor: 2,
        goalsAgainst: 0.25,
        xgFor: 2.08,
        xgAgainst: 1.02,
        attackStrength: 1.04,
        defenseStrength: 1.19
      },
      oddsMarkets: [
        {
          id: "match_winner",
          name: "Match Winner",
          selections: [
            { id: "home", label: "Arsenal", decimalOdds: 1.2 },
            { id: "draw", label: "Draw", decimalOdds: 8 },
            { id: "away", label: "Coventry", decimalOdds: 21 }
          ]
        }
      ],
      dataQualityScore: 0.92,
      providerContextSignals: [],
      dataSource: {
        kind: "provider",
        fixtureProvider: "api-football",
        fixtureProviderId: "thin-history-regression",
        oddsProvider: "the-odds-api",
        oddsProviderEventId: "thin-history-odds",
        oddsCapturedAt: capturedAt,
        formProvider: "api-football-recent-fixtures",
        strengthProvider: "api-football-recent-fixtures-form-rating-v1",
        fetchedAt: capturedAt
      }
    };

    const prediction = buildPrediction(match);
    const winner = prediction.markets.find((market) => market.marketId === "match_winner");
    const winnerAdjustment = prediction.marketPriorAdjustment.markets.find((market) => market.marketId === "match_winner");

    expect(winnerAdjustment?.weight).toBeGreaterThanOrEqual(0.85);
    expect(winner?.probabilities.away).toBeLessThan(0.1);
    expect(prediction.marketPriorAdjustment.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("only 4 matches")])
    );
    expect(prediction.decision.dataCoverage.signals.find((signal) => signal.id === "historical-results")?.status).toBe("computed");
    expect(prediction.canonicalDecision.evidenceQuality).toBe("thin");
    expect(prediction.canonicalDecision.bestPublishedPick).toBeNull();
    expect(publicWatchlistReason(prediction.canonicalDecision)).toBe(
      "Watchlist — historical and context evidence is too thin for publication."
    );
  });
});
