import { describe, expect, it } from "vitest";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { buildPrediction } from "@/lib/sports/service";

const multiBookBasketballEvent = {
  id: "multi-book-101",
  sport_key: "basketball_wnba",
  sport_title: "WNBA",
  commence_time: "2026-07-10T19:30:00Z",
  home_team: "Connecticut Sun",
  away_team: "Golden State Valkyries",
  bookmakers: [
    {
      title: "Book A",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Connecticut Sun", price: 1.62 },
            { name: "Golden State Valkyries", price: 2.35 }
          ]
        },
        {
          key: "spreads",
          outcomes: [
            { name: "Connecticut Sun", price: 1.91, point: -3.5 },
            { name: "Golden State Valkyries", price: 1.91, point: 3.5 }
          ]
        },
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: 1.91, point: 154.5 },
            { name: "Under", price: 1.91, point: 154.5 }
          ]
        }
      ]
    },
    {
      title: "Book B",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Connecticut Sun", price: 1.58 },
            { name: "Golden State Valkyries", price: 2.42 }
          ]
        },
        {
          key: "spreads",
          outcomes: [
            { name: "Connecticut Sun", price: 1.9, point: -4 },
            { name: "Golden State Valkyries", price: 1.92, point: 4 }
          ]
        },
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: 1.9, point: 153.5 },
            { name: "Under", price: 1.92, point: 153.5 }
          ]
        }
      ]
    },
    {
      title: "Book C",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Connecticut Sun", price: 1.6 },
            { name: "Golden State Valkyries", price: 2.38 }
          ]
        },
        {
          key: "spreads",
          outcomes: [
            { name: "Connecticut Sun", price: 1.93, point: -3.5 },
            { name: "Golden State Valkyries", price: 1.89, point: 3.5 }
          ]
        },
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: 1.92, point: 154.5 },
            { name: "Under", price: 1.9, point: 154.5 }
          ]
        }
      ]
    }
  ]
};

describe("provider odds market coherence", () => {
  it("keeps one complete quote and one consensus line per multi-book market", async () => {
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_wnba"
      },
      fetchImpl: async (input) => {
        const url = input.toString();
        const payload = url.includes("/scores/") ? [] : [multiBookBasketballEvent];
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const [match] = await provider.getFixtures("2026-07-10", "basketball");

    expect(match.oddsMarkets.map((market) => market.id)).toEqual(["match_winner", "spread", "total_points"]);
    expect(match.oddsMarkets.every((market) => market.selections.length === 2)).toBe(true);
    expect(match.oddsMarkets.find((market) => market.id === "spread")?.selections.map((selection) => selection.label)).toEqual([
      "Connecticut Sun -3.5",
      "Golden State Valkyries +3.5"
    ]);
    expect(match.oddsMarkets.find((market) => market.id === "total_points")?.selections.map((selection) => selection.label)).toEqual([
      "Over 154.5",
      "Under 154.5"
    ]);

    for (const market of match.oddsMarkets) {
      const margin = market.selections.reduce((sum, selection) => sum + 1 / selection.decimalOdds, 0) - 1;
      expect(margin).toBeGreaterThan(-0.05);
      expect(margin).toBeLessThan(0.15);
    }

    const prediction = buildPrediction(match);
    for (const market of prediction.decision.oddsIntelligence.marketAudits) {
      expect(market.selections).toHaveLength(2);
      expect(market.bookmakerMargin).toBeGreaterThan(-0.05);
      expect(market.bookmakerMargin).toBeLessThan(0.15);
      expect(market.selections.reduce((sum, selection) => sum + selection.noVigImpliedProbability, 0)).toBeCloseTo(1, 6);
    }

    const board = buildDecisionOddsBoard({ date: "2026-07-10", slates: [{ sport: "basketball", rows: [{ match, prediction }] }] });
    const proof = buildDecisionOddsIntelligenceProof({ board });
    expect(proof.proofChecks.find((check) => check.id === "no-vig-margin-removal")?.status).toBe("pass");
    expect(proof.totals.averageMargin).toBeLessThan(0.15);

    const corruptedPrediction = structuredClone(prediction);
    for (const market of corruptedPrediction.decision.oddsIntelligence.marketAudits) {
      for (const selection of market.selections) selection.bookmakerMargin = 2.5;
    }
    const corruptedBoard = buildDecisionOddsBoard({
      date: "2026-07-10",
      slates: [{ sport: "basketball", rows: [{ match, prediction: corruptedPrediction }] }]
    });
    const corruptedProof = buildDecisionOddsIntelligenceProof({ board: corruptedBoard });
    expect(corruptedProof.status).toBe("blocked");
    expect(corruptedProof.proofChecks.find((check) => check.id === "no-vig-margin-removal")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("implausible bookmaker margin")
    });
  });
});
