import { describe, expect, it } from "vitest";

import {
  runBasketballBacktest,
  type HistoricalBasketballFixture
} from "@/lib/sports/training/basketballBacktest";
import {
  runTennisBacktest,
  type HistoricalTennisMatch
} from "@/lib/sports/training/tennisBacktest";

function basketballHistory(reverseHoldout = false): HistoricalBasketballFixture[] {
  return Array.from({ length: 40 }, (_, index) => {
    const reverse = reverseHoldout && index >= 20;
    return {
      fixtureExternalId: `basketball-benchmark:${index}`,
      kickoffAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
      homeTeamExternalId: "home",
      awayTeamExternalId: "away",
      homeScore: reverse ? 90 : 110,
      awayScore: reverse ? 110 : 90,
      dataQuality: 0.9,
      odds: [
        { market: "moneyline", selection: "home", decimalOdds: 2, observedAt: new Date(Date.UTC(2024, 0, index + 1, -4)).toISOString() },
        { market: "moneyline", selection: "away", decimalOdds: 2, observedAt: new Date(Date.UTC(2024, 0, index + 1, -4)).toISOString() }
      ]
    };
  });
}

function tennisHistory(reverseHoldout = false): HistoricalTennisMatch[] {
  return Array.from({ length: 40 }, (_, index) => {
    const reverse = reverseHoldout && index >= 20;
    return {
      fixtureExternalId: `tennis-benchmark:${index}`,
      kickoffAt: new Date(Date.UTC(2024, 2, index + 1)).toISOString(),
      surface: "hard",
      homePlayerExternalId: "home",
      awayPlayerExternalId: "away",
      homeSets: reverse ? 0 : 2,
      awaySets: reverse ? 2 : 0,
      dataQuality: 0.9,
      odds: [
        { market: "match_winner", selection: "home", decimalOdds: 2, observedAt: new Date(Date.UTC(2024, 2, index + 1, -4)).toISOString() },
        { market: "match_winner", selection: "away", decimalOdds: 2, observedAt: new Date(Date.UTC(2024, 2, index + 1, -4)).toISOString() }
      ]
    };
  });
}

describe("two-way benchmark chronological learning provenance", () => {
  it("does not let basketball holdout outcomes tune learned weights", () => {
    const homeHoldout = runBasketballBacktest(basketballHistory(false), { trainRatio: 0.5, minEdge: 0, minModelProbability: 0.05 });
    const awayHoldout = runBasketballBacktest(basketballHistory(true), { trainRatio: 0.5, minEdge: 0, minModelProbability: 0.05 });

    expect(homeHoldout.pickCount).toBeGreaterThan(0);
    expect(homeHoldout.learnedWeights).toEqual(awayHoldout.learnedWeights);
    expect(homeHoldout.learnedWeightsProvenance).toEqual(awayHoldout.learnedWeightsProvenance);
    expect(homeHoldout.learnedWeightsProvenance).toMatchObject({ source: "training-window", sampleSize: 20 });
    expect(Date.parse(homeHoldout.learnedWeightsProvenance.windowEnd!)).toBeLessThan(
      Date.parse(homeHoldout.learnedWeightsProvenance.holdoutWindowStart!)
    );
  });

  it("does not let tennis holdout outcomes tune learned weights", () => {
    const homeHoldout = runTennisBacktest(tennisHistory(false), { trainRatio: 0.5, minEdge: 0, minModelProbability: 0.05 });
    const awayHoldout = runTennisBacktest(tennisHistory(true), { trainRatio: 0.5, minEdge: 0, minModelProbability: 0.05 });

    expect(homeHoldout.pickCount).toBeGreaterThan(0);
    expect(homeHoldout.learnedWeights).toEqual(awayHoldout.learnedWeights);
    expect(homeHoldout.learnedWeightsProvenance).toEqual(awayHoldout.learnedWeightsProvenance);
    expect(homeHoldout.learnedWeightsProvenance).toMatchObject({ source: "training-window", sampleSize: 20 });
    expect(Date.parse(homeHoldout.learnedWeightsProvenance.windowEnd!)).toBeLessThan(
      Date.parse(homeHoldout.learnedWeightsProvenance.holdoutWindowStart!)
    );
  });
});
