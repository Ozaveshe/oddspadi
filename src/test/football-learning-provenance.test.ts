import { describe, expect, it } from "vitest";

import {
  runFootballBacktest,
  type HistoricalFootballFixture
} from "@/lib/sports/training/footballBacktest";
import { auditBacktestOddsCoverage, auditLearnedWeightsProvenance } from "@/lib/sports/performance/report";

function fixture(index: number, homeWon: boolean): HistoricalFootballFixture {
  const kickoffAt = new Date(Date.UTC(2024, 0, index + 1, 15)).toISOString();
  const observedAt = new Date(Date.UTC(2024, 0, index + 1, 9)).toISOString();
  const closingAt = new Date(Date.UTC(2024, 0, index + 1, 14, 50)).toISOString();
  return {
    fixtureExternalId: `learning-${index + 1}`,
    kickoffAt,
    leagueExternalId: "39",
    season: "2023",
    homeTeamExternalId: `home-${index % 3}`,
    awayTeamExternalId: `away-${index % 4}`,
    homeScore: homeWon ? 2 : 0,
    awayScore: homeWon ? 0 : 2,
    dataQuality: 0.9,
    homeElo: 1650,
    awayElo: 1450,
    homeAttackStrength: 1.2,
    awayAttackStrength: 0.9,
    homeDefenseStrength: 1.1,
    awayDefenseStrength: 0.88,
    homeRecentFormPoints: 12,
    awayRecentFormPoints: 5,
    homeRecentGoalsFor: 2,
    awayRecentGoalsFor: 0.9,
    homeRecentGoalsAgainst: 0.8,
    awayRecentGoalsAgainst: 1.7,
    odds: [
      { market: "match_winner", selection: "home", decimalOdds: 2.6, bookmaker: "book-a", observedAt },
      { market: "match_winner", selection: "draw", decimalOdds: 3.5, bookmaker: "book-a", observedAt },
      { market: "match_winner", selection: "away", decimalOdds: 3.4, bookmaker: "book-a", observedAt },
      { market: "match_winner", selection: "home", decimalOdds: 2.4, bookmaker: "book-a", isClosing: true, observedAt: closingAt },
      { market: "match_winner", selection: "draw", decimalOdds: 3.4, bookmaker: "book-a", isClosing: true, observedAt: closingAt },
      { market: "match_winner", selection: "away", decimalOdds: 3.3, bookmaker: "book-a", isClosing: true, observedAt: closingAt }
    ]
  };
}

function corpus(trainingHomeWins: boolean, holdoutHomeWins: boolean): HistoricalFootballFixture[] {
  return Array.from({ length: 10 }, (_, index) => fixture(index, index < 5 ? trainingHomeWins : holdoutHomeWins));
}

describe("football learned-weight chronology", () => {
  it("keeps holdout outcomes out of learned decision weights", () => {
    const baseline = runFootballBacktest(corpus(true, true), { trainRatio: 0.5, minEdge: 0.01 });
    const changedHoldout = runFootballBacktest(corpus(true, false), { trainRatio: 0.5, minEdge: 0.01 });

    expect(baseline.learnedWeightsProvenance).toMatchObject({
      source: "training-window",
      sampleSize: 5,
      windowStart: baseline.trainWindowStart,
      windowEnd: baseline.trainWindowEnd,
      holdoutWindowStart: baseline.testWindowStart
    });
    expect(baseline.learnedWeights).toEqual(changedHoldout.learnedWeights);
    expect(baseline.learnedWeightsProvenance).toEqual(changedHoldout.learnedWeightsProvenance);
    expect(baseline.brierScore).not.toBe(changedHoldout.brierScore);
    expect(baseline.notes.join(" ")).toContain("holdout outcomes remain evaluation-only");
  });

  it("learns from the earlier training window and exposes conservative no-data provenance", () => {
    const positiveTraining = runFootballBacktest(corpus(true, true), { trainRatio: 0.5, minEdge: 0.01 });
    const negativeTraining = runFootballBacktest(corpus(false, true), { trainRatio: 0.5, minEdge: 0.01 });
    const empty = runFootballBacktest([]);

    expect(positiveTraining.learnedWeights).not.toEqual(negativeTraining.learnedWeights);
    expect(Date.parse(positiveTraining.learnedWeightsProvenance.windowEnd!)).toBeLessThan(
      Date.parse(positiveTraining.learnedWeightsProvenance.holdoutWindowStart!)
    );
    expect(empty.learnedWeightsProvenance).toMatchObject({
      source: "defaults-no-training-data",
      sampleSize: 0,
      windowStart: null,
      windowEnd: null,
      holdoutWindowStart: null
    });
  });

  it("labels only chronologically separated stored weights as training-only evidence", () => {
    const valid = auditLearnedWeightsProvenance({
      learnedWeightsProvenance: {
        source: "training-window",
        sampleSize: 700,
        windowEnd: "2025-06-30T12:00:00.000Z",
        holdoutWindowStart: "2025-07-01T12:00:00.000Z"
      }
    });
    const overlapping = auditLearnedWeightsProvenance({
      learnedWeightsProvenance: {
        source: "training-window",
        sampleSize: 700,
        windowEnd: "2025-07-01T12:00:00.000Z",
        holdoutWindowStart: "2025-07-01T12:00:00.000Z"
      }
    });

    expect(valid).toMatchObject({ learnedWeightsSource: "training-window", learnedWeightsSampleSize: 700, learnedWeightsTrainingOnly: true });
    expect(overlapping.learnedWeightsTrainingOnly).toBe(false);
    expect(auditLearnedWeightsProvenance({}).learnedWeightsSource).toBe("unverified");
  });

  it("labels only internally coherent stored odds coverage as verified", () => {
    const valid = auditBacktestOddsCoverage({
      oddsCoverage: {
        evaluatedFixtures: 200,
        coherentDecisionFixtures: 160,
        verifiedClosingFixtures: 120,
        decisionOnlyFixtures: 40,
        missingDecisionFixtures: 40
      }
    });
    const impossible = auditBacktestOddsCoverage({
      oddsCoverage: {
        evaluatedFixtures: 20,
        coherentDecisionFixtures: 21,
        verifiedClosingFixtures: 19,
        decisionOnlyFixtures: 0,
        missingDecisionFixtures: 0
      }
    });

    expect(valid).toMatchObject({
      oddsCoverageVerified: true,
      oddsEvaluatedFixtures: 200,
      oddsCoherentDecisionFixtures: 160,
      oddsVerifiedClosingFixtures: 120
    });
    expect(impossible.oddsCoverageVerified).toBe(false);
    expect(auditBacktestOddsCoverage({}).oddsCoverageVerified).toBe(false);
  });
});
