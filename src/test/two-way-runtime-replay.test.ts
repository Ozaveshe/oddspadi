import { describe, expect, it } from "vitest";

import { historicalModelCompatibility } from "@/lib/sports/prediction/modelIdentity";
import type { HistoricalBasketballFixture } from "@/lib/sports/training/basketballBacktest";
import type { HistoricalTennisMatch } from "@/lib/sports/training/tennisBacktest";
import {
  runBasketballRuntimeReplay,
  runTennisRuntimeReplay,
  twoWayRuntimeReplayIdentityReceipt
} from "@/lib/sports/training/twoWayRuntimeReplay";

function basketballHistory(lastScore: [number, number] = [112, 104]): HistoricalBasketballFixture[] {
  return Array.from({ length: 12 }, (_, index) => ({
    fixtureExternalId: `basketball:${index + 1}`,
    kickoffAt: new Date(Date.UTC(2025, 0, index + 1, 20)).toISOString(),
    leagueExternalId: "nba",
    season: "2025",
    homeTeamExternalId: "team:a",
    awayTeamExternalId: "team:b",
    homeScore: index === 11 ? lastScore[0] : index % 3 === 0 ? 98 : 110,
    awayScore: index === 11 ? lastScore[1] : index % 3 === 0 ? 106 : 102,
    dataQuality: 0.88,
    odds: [
      { market: "moneyline", selection: "home", decimalOdds: 1.92, observedAt: new Date(Date.UTC(2025, 0, index + 1, 12)).toISOString() },
      { market: "moneyline", selection: "away", decimalOdds: 2.02, observedAt: new Date(Date.UTC(2025, 0, index + 1, 12)).toISOString() }
    ]
  }));
}

function tennisHistory(lastSets: [number, number] = [2, 0]): HistoricalTennisMatch[] {
  return Array.from({ length: 12 }, (_, index) => ({
    fixtureExternalId: `tennis:${index + 1}`,
    kickoffAt: new Date(Date.UTC(2025, 1, index + 1, 13)).toISOString(),
    tournamentExternalId: "atp-test",
    season: "2025",
    surface: index % 2 ? "clay" : "hard",
    round: index === 11 ? "Final" : "Round 1",
    homePlayerExternalId: "player:a",
    awayPlayerExternalId: "player:b",
    homeSets: index === 11 ? lastSets[0] : index % 3 === 0 ? 0 : 2,
    awaySets: index === 11 ? lastSets[1] : index % 3 === 0 ? 2 : 1,
    dataQuality: 0.9,
    odds: [
      { market: "match_winner", selection: "home", decimalOdds: 1.86, observedAt: new Date(Date.UTC(2025, 1, index + 1, 8)).toISOString() },
      { market: "match_winner", selection: "away", decimalOdds: 2.1, observedAt: new Date(Date.UTC(2025, 1, index + 1, 8)).toISOString() }
    ]
  }));
}

describe("basketball and tennis exact runtime replay", () => {
  it("executes basketball holdout rows through the live runtime model and mints exact-parity evidence", () => {
    const result = runBasketballRuntimeReplay(basketballHistory(), { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.status).toBe("completed");
    expect(result.modelKey).toBe("basketball-efficiency-v3");
    expect(result.featureContract).toMatchObject({
      status: "passed",
      version: "basketball-runtime-features-v3",
      chronologyVersion: "basketball-outcome-chronology-v1",
      evaluatedFixtures: result.testSize,
      entrypointInvocations: result.testSize
    });
    expect(result.results.every((row) => row.pick === null || row.pick.edge >= result.learnedWeights.minimumEdge)).toBe(true);
    expect(result.selectionPolicy).toMatchObject({
      source: "chronological-training-window",
      status: "abstain",
      allowedConfidenceBands: []
    });
    expect(result.economicSelectionComparison.selected.pickCount).toBe(result.pickCount);
    expect(result.economicSelectionComparison.baseline.pickCount).toBeGreaterThanOrEqual(result.pickCount);
    expect(result.probabilityCalibrationPolicy).toMatchObject({
      source: "chronological-training-window",
      status: "identity",
      temperature: 1,
      reason: "insufficient-training-sample"
    });
    expect(result.probabilityCalibrationComparison.baseline.sampleSize).toBe(result.testSize);
    expect(result.marketPriorScalingPolicy).toMatchObject({
      source: "chronological-priced-training-window",
      status: "identity",
      weightScale: 1,
      reason: "insufficient-priced-sample"
    });
    expect(result.marketPriorEvidence).toMatchObject({
      version: "runtime-market-prior-parity-v1",
      status: "applied",
      evaluatedFixtures: result.testSize,
      adjustedFixtures: result.testSize,
      coverage: 1
    });
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("set the holdout minimum edge")
    ]));
    expect(historicalModelCompatibility({
      sport: "basketball",
      evidenceModelKey: result.modelKey,
      config: { modelIdentity: twoWayRuntimeReplayIdentityReceipt(result) }
    })).toBe("exact-runtime-parity");
  });

  it("does not leak the evaluated basketball score into its probability vector", () => {
    const home = runBasketballRuntimeReplay(basketballHistory([140, 80]), { trainRatio: 0.5, minPriorMatches: 3 });
    const away = runBasketballRuntimeReplay(basketballHistory([80, 140]), { trainRatio: 0.5, minPriorMatches: 3 });
    const last = (result: ReturnType<typeof runBasketballRuntimeReplay>) => result.results.find((row) => row.fixtureExternalId === "basketball:12")!;

    expect(last(home).probabilities).toEqual(last(away).probabilities);
    expect(last(home).actualOutcome).toBe("home");
    expect(last(away).actualOutcome).toBe("away");
    expect(home.learnedWeights).toEqual(away.learnedWeights);
    expect(home.selectionPolicy).toEqual(away.selectionPolicy);
    expect(home.probabilityCalibrationPolicy).toEqual(away.probabilityCalibrationPolicy);
    expect(home.marketPriorScalingPolicy).toEqual(away.marketPriorScalingPolicy);
  });

  it("uses coherent decision prices for the basketball posterior and never closing or post-kickoff prices", () => {
    const baselineFixtures = basketballHistory();
    const contaminated = basketballHistory();
    const last = contaminated[11]!;
    const kickoff = Date.parse(last.kickoffAt);
    last.odds = [
      ...last.odds,
      { market: "moneyline", selection: "home", decimalOdds: 1.05, observedAt: new Date(kickoff - 5 * 60_000).toISOString(), isClosing: true },
      { market: "moneyline", selection: "away", decimalOdds: 15, observedAt: new Date(kickoff - 5 * 60_000).toISOString(), isClosing: true },
      { market: "moneyline", selection: "home", decimalOdds: 1.01, observedAt: new Date(kickoff + 60_000).toISOString() },
      { market: "moneyline", selection: "away", decimalOdds: 30, observedAt: new Date(kickoff + 60_000).toISOString() }
    ];
    const config = { trainRatio: 0.5, minPriorMatches: 3 };
    const baseline = runBasketballRuntimeReplay(baselineFixtures, config);
    const replay = runBasketballRuntimeReplay(contaminated, config);
    const finalProbability = (result: ReturnType<typeof runBasketballRuntimeReplay>) =>
      result.results.find((row) => row.fixtureExternalId === "basketball:12")!.probabilities;

    expect(finalProbability(replay)).toEqual(finalProbability(baseline));
    expect(replay.marketPriorEvidence).toEqual(baseline.marketPriorEvidence);
  });

  it("refuses to synthesize a market posterior from different bookmaker snapshots", () => {
    const mismatched = basketballHistory();
    const noOdds = basketballHistory();
    const last = mismatched[11]!;
    const observedAt = new Date(Date.parse(last.kickoffAt) - 8 * 60 * 60_000).toISOString();
    last.odds = [
      { market: "moneyline", selection: "home", decimalOdds: 1.3, bookmaker: "book-a", observedAt },
      { market: "moneyline", selection: "away", decimalOdds: 4.2, bookmaker: "book-b", observedAt }
    ];
    noOdds[11] = { ...noOdds[11]!, odds: [] };
    const config = { trainRatio: 0.5, minPriorMatches: 3 };
    const mismatchedReplay = runBasketballRuntimeReplay(mismatched, config);
    const noOddsReplay = runBasketballRuntimeReplay(noOdds, config);
    const finalProbability = (result: ReturnType<typeof runBasketballRuntimeReplay>) =>
      result.results.find((row) => row.fixtureExternalId === "basketball:12")!.probabilities;

    expect(finalProbability(mismatchedReplay)).toEqual(finalProbability(noOddsReplay));
    expect(mismatchedReplay.marketPriorEvidence.adjustedFixtures).toBe(mismatchedReplay.testSize - 1);
    expect(mismatchedReplay.results.find((row) => row.fixtureExternalId === "basketball:12")?.pick).toBeNull();
  });

  it("fails closed for neutral basketball rows", () => {
    const fixtures = basketballHistory();
    fixtures[11] = { ...fixtures[11]!, neutralVenue: true };
    const result = runBasketballRuntimeReplay(fixtures, { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.rejections.find((row) => row.fixtureExternalId === "basketball:12")?.reasons).toContain(
      "neutral venue is unsupported by the runtime Match contract"
    );
    expect(result.results.some((row) => row.fixtureExternalId === "basketball:12")).toBe(false);
  });

  it("executes tennis holdout rows through the live surface model without result leakage", () => {
    const home = runTennisRuntimeReplay(tennisHistory([2, 0]), { trainRatio: 0.5, minPriorMatches: 3 });
    const away = runTennisRuntimeReplay(tennisHistory([0, 2]), { trainRatio: 0.5, minPriorMatches: 3 });
    const last = (result: ReturnType<typeof runTennisRuntimeReplay>) => result.results.find((row) => row.fixtureExternalId === "tennis:12")!;

    expect(home.status).toBe("completed");
    expect(home.modelKey).toBe("tennis-surface-elo-v3");
    expect(home.featureContract).toMatchObject({
      status: "passed",
      version: "tennis-runtime-features-v3",
      chronologyVersion: "tennis-outcome-surface-chronology-v1",
      evaluatedFixtures: home.testSize,
      entrypointInvocations: home.testSize
    });
    expect(last(home).probabilities).toEqual(last(away).probabilities);
    expect(last(home).actualOutcome).toBe("home");
    expect(last(away).actualOutcome).toBe("away");
    expect(home.selectionPolicy).toEqual(away.selectionPolicy);
    expect(home.probabilityCalibrationPolicy).toEqual(away.probabilityCalibrationPolicy);
    expect(home.marketPriorScalingPolicy).toEqual(away.marketPriorScalingPolicy);
    expect(home.marketPriorEvidence.status).toBe("applied");
    expect(historicalModelCompatibility({
      sport: "tennis",
      evidenceModelKey: home.modelKey,
      config: { modelIdentity: twoWayRuntimeReplayIdentityReceipt(home) }
    })).toBe("exact-runtime-parity");
  });

  it("refuses identity receipts when no runtime row was evaluated", () => {
    const basketball = runBasketballRuntimeReplay([]);
    const tennis = runTennisRuntimeReplay([]);
    expect(basketball.featureContract.status).toBe("failed");
    expect(tennis.featureContract.status).toBe("failed");
    expect(() => twoWayRuntimeReplayIdentityReceipt(basketball)).toThrow("failed feature contract");
    expect(() => twoWayRuntimeReplayIdentityReceipt(tennis)).toThrow("failed feature contract");
  });

  it("fails the outer replay contract when no strict kickoff boundary exists", () => {
    const fixtures = basketballHistory().map((fixture) => ({
      ...fixture,
      kickoffAt: "2025-01-01T20:00:00.000Z"
    }));
    const result = runBasketballRuntimeReplay(fixtures, { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.trainSize).toBe(0);
    expect(result.featureContract.status).toBe("failed");
    expect(() => twoWayRuntimeReplayIdentityReceipt(result)).toThrow("failed feature contract");
  });
});
