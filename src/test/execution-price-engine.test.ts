import { describe, expect, it } from "vitest";
import { buildValueEdges } from "@/lib/sports/prediction/odds";

describe("execution price engine boundary", () => {
  it("uses consensus for no-vig edge and the named best quote for expected value", () => {
    const edges = buildValueEdges(
      [{ marketId: "match_winner", probabilities: { home: 0.58, away: 0.42 } }],
      [{
        id: "match_winner",
        name: "Moneyline",
        priceMethod: "best-price-per-selection-v1",
        selections: [
          { id: "home", label: "Home", decimalOdds: 1.82, bookmaker: { id: "book-a", name: "Book A" }, observedAt: "2026-07-18T08:00:00Z" },
          { id: "away", label: "Away", decimalOdds: 2.55, bookmaker: { id: "book-b", name: "Book B" }, observedAt: "2026-07-18T08:01:00Z" }
        ],
        consensus: {
          method: "median-no-vig-v1",
          bookmakerCount: 6,
          probabilities: { home: 0.54, away: 0.46 },
          averageMargin: 0.045,
          maxProbabilitySpread: 0.025
        }
      }],
      0.85
    );

    const home = edges.find((edge) => edge.selectionId === "home");
    const away = edges.find((edge) => edge.selectionId === "away");
    expect(home).toMatchObject({
      noVigImpliedProbability: 0.54,
      bookmakerMargin: 0.045,
      odds: 1.82,
      bookmaker: { id: "book-a", name: "Book A" },
      priceMethod: "best-price-per-selection-v1",
      consensusBookmakerCount: 6,
      consensusMaxProbabilitySpread: 0.025
    });
    expect(home?.edge).toBeCloseTo(0.04, 8);
    expect(home?.expectedValue).toBeCloseTo(0.0556, 8);
    expect(away).toMatchObject({
      noVigImpliedProbability: 0.46,
      bookmakerMargin: 0.045,
      odds: 2.55,
      bookmaker: { id: "book-b", name: "Book B" },
      priceObservedAt: "2026-07-18T08:01:00Z",
      consensusBookmakerCount: 6,
      consensusMaxProbabilitySpread: 0.025
    });
    expect(away?.edge).toBeCloseTo(-0.04, 8);
    expect(away?.expectedValue).toBeCloseTo(0.071, 8);
  });

  it("falls back to one coherent quote when no valid consensus receipt exists", () => {
    const [home, away] = buildValueEdges(
      [{ marketId: "match_winner", probabilities: { home: 0.55, away: 0.45 } }],
      [{ id: "match_winner", name: "Moneyline", bookmaker: { id: "book-a", name: "Book A" }, selections: [
        { id: "home", label: "Home", decimalOdds: 1.8 },
        { id: "away", label: "Away", decimalOdds: 2.2 }
      ] }],
      0.8
    );

    expect((home?.noVigImpliedProbability ?? 0) + (away?.noVigImpliedProbability ?? 0)).toBeCloseTo(1, 8);
    expect(home?.priceMethod).toBe("selected-coherent-quote");
    expect(home?.bookmaker).toEqual({ id: "book-a", name: "Book A" });
    expect(home?.consensusBookmakerCount).toBe(1);
    expect(home?.consensusMaxProbabilitySpread).toBeNull();
  });
});
