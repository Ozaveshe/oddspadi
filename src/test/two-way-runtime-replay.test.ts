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
});
