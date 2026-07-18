import { describe, expect, it } from "vitest";
import { buildNoVigBookmakerConsensus } from "@/lib/sports/oddsConsensus";

function quote(bookmakerId: string, home: number, away: number) {
  return {
    bookmaker: { id: bookmakerId, name: bookmakerId },
    selections: [
      { id: "home", label: "Home", decimalOdds: home },
      { id: "away", label: "Away", decimalOdds: away }
    ]
  };
}

describe("bookmaker no-vig consensus", () => {
  it("builds a normalized median probability receipt without synthesizing odds", () => {
    const consensus = buildNoVigBookmakerConsensus([
      quote("a", 1.9, 1.9),
      quote("b", 1.85, 2),
      quote("c", 1.2, 5)
    ]);

    expect(consensus).toMatchObject({ method: "median-no-vig-v1", bookmakerCount: 3 });
    expect((consensus?.probabilities.home ?? 0) + (consensus?.probabilities.away ?? 0)).toBeCloseTo(1, 6);
    expect(consensus?.probabilities.home).toBeGreaterThan(0.5);
    expect(consensus?.probabilities.home).toBeLessThan(0.55);
    expect(consensus?.maxProbabilitySpread).toBeGreaterThan(0.25);
  });

  it("excludes incomplete quotes and deduplicates bookmaker identities", () => {
    const consensus = buildNoVigBookmakerConsensus([
      quote("a", 1.9, 1.9),
      quote("a", 1.8, 2.05),
      quote("b", 1.92, 1.88),
      {
        bookmaker: { id: "incomplete", name: "Incomplete" },
        selections: [{ id: "home", label: "Home", decimalOdds: 1.7 }]
      }
    ]);

    expect(consensus?.bookmakerCount).toBe(2);
    expect(Object.keys(consensus?.probabilities ?? {})).toEqual(["home", "away"]);
  });
});
