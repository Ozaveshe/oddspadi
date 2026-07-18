import { describe, expect, it } from "vitest";

import { historicalModelCompatibility } from "@/lib/sports/prediction/modelIdentity";
import { footballRuntimeReplayIdentityReceipt, runFootballRuntimeReplay } from "@/lib/sports/training/footballRuntimeReplay";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";
import type { PlayerMatchPerformance } from "@/lib/sports/training/playerPerformance";

function history(lastScore: [number, number] = [2, 1]): HistoricalFootballFixtureInput[] {
  const scores: Array<[number, number]> = [
    [2, 0], [1, 1], [0, 1], [3, 1], [1, 0], [2, 2], [0, 2], [2, 0], [1, 1], lastScore
  ];
  return scores.map(([homeScore, awayScore], index) => {
    const kickoffAt = new Date(Date.UTC(2025, 0, index + 1, 15)).toISOString();
    const observedAt = new Date(Date.UTC(2025, 0, index + 1, 9)).toISOString();
    return {
      externalId: `fixture:${index + 1}`,
      kickoffAt,
      league: { externalId: "39", name: "Premier League", country: "England" },
      season: "2025",
      round: String(index + 1),
      status: "finished",
      homeTeam: { externalId: "team:a", name: "Alpha FC" },
      awayTeam: { externalId: "team:b", name: "Beta FC" },
      homeScore,
      awayScore,
      dataQuality: 0.86,
      odds: [
        { market: "match_winner", selection: "home", decimalOdds: 2.1, bookmaker: "test", observedAt },
        { market: "match_winner", selection: "draw", decimalOdds: 3.3, bookmaker: "test", observedAt },
        { market: "match_winner", selection: "away", decimalOdds: 3.7, bookmaker: "test", observedAt }
      ],
      metadata: { provider: "api_football" }
    };
  });
}

function playerPerformances(): PlayerMatchPerformance[] {
  return Array.from({ length: 5 }, (_, matchIndex) =>
    (["team:a", "team:b"] as const).flatMap((teamExternalId) =>
      Array.from({ length: 11 }, (_, playerIndex) => ({
        sport: "football" as const,
        provider: "api_football",
        sourceKind: "real" as const,
        fixtureExternalId: `fixture:${matchIndex + 1}`,
        fixtureKickoffAt: new Date(Date.UTC(2025, 0, matchIndex + 1, 15)).toISOString(),
        teamExternalId,
        playerExternalId: `${teamExternalId}:player:${playerIndex}`,
        playerName: `${teamExternalId} Player ${playerIndex}`,
        position: null,
        shirtNumber: playerIndex + 1,
        minutes: 90,
        started: true,
        captain: playerIndex === 0,
        rating: teamExternalId === "team:a" ? 7.8 : 6.1,
        goals: teamExternalId === "team:a" && playerIndex === 0 ? 1 : 0,
        assists: teamExternalId === "team:a" && playerIndex === 1 ? 1 : 0,
        shotsTotal: 0,
        shotsOnTarget: 0,
        passesTotal: 30,
        keyPasses: 0,
        passAccuracy: 80,
        tackles: teamExternalId === "team:a" ? 2 : 1,
        interceptions: 1,
        saves: 0,
        yellowCards: 0,
        redCards: 0,
        dataQuality: 0.9,
        metrics: {},
        observedAt: new Date(Date.UTC(2025, 0, matchIndex + 1, 18)).toISOString()
      }))
    )
  ).flat();
}

describe("football exact runtime replay", () => {
  it("refuses to mint an identity receipt when no runtime fixture was evaluated", () => {
    const result = runFootballRuntimeReplay([]);
    expect(result.featureContract.status).toBe("failed");
    expect(() => footballRuntimeReplayIdentityReceipt(result)).toThrow("failed football feature contract");
  });

  it("executes each holdout row through the runtime entrypoint with a passed feature contract", () => {
    const result = runFootballRuntimeReplay(history(), { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.status).toBe("completed");
    expect(result.modelKey).toBe("football-poisson-v3");
    expect(result.featureContract.version).toBe("football-runtime-features-v3");
    expect(result.featureContract.chronologyVersion).toBe("football-provider-chronology-v3");
    expect(result.featureContract.status).toBe("passed");
    expect(result.featureContract.entrypointInvocations).toBe(result.testSize);
    expect(result.featureContract.evaluatedFixtures).toBe(result.testSize);
    expect(result.featureContract.trainingEntrypointInvocations).toBe(result.trainSize);
    expect(result.featureContract.trainingEvaluatedFixtures).toBe(result.trainSize);
    expect(result.learnedWeightsProvenance).toMatchObject({
      source: "training-window",
      sampleSize: result.trainSize,
      holdoutWindowStart: result.testWindowStart
    });
    expect(result.executionHash).toMatch(/^fnv1a-[a-f0-9]{8}$/);
    expect(result.results.every((row) => Math.abs(Object.values(row.probabilities).reduce((sum, value) => sum + value, 0) - 1) < 0.001)).toBe(true);
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
    expect(result.empiricalValueGuardPolicy).toMatchObject({
      source: "chronological-final-posterior-regime-windows",
      status: "abstain",
      reason: expect.stringMatching(/insufficient-regime-sample|invalid-chronology/)
    });
    expect(result.empiricalValueGuardComparison.selected.pickCount).toBeLessThanOrEqual(
      result.empiricalValueGuardComparison.baseline.pickCount
    );
    expect(result.empiricalValueGuardComparison.picksRemoved).toBe(
      result.empiricalValueGuardComparison.baseline.pickCount - result.empiricalValueGuardComparison.selected.pickCount
    );
    expect(result.marketPriorEvidence).toMatchObject({
      version: "runtime-market-prior-parity-v1",
      status: "applied",
      evaluatedFixtures: result.testSize,
      adjustedFixtures: result.testSize,
      coverage: 1
    });
    expect(result.marketPriorEvidence.probabilityComparison.baseline.sampleSize).toBe(result.testSize);
    expect(result.marketPriorEvidence.probabilityComparison.calibrated.sampleSize).toBe(result.testSize);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("Holdout selection used the training-window fallback minimum edge")
    ]));
    expect(result.learnedWeights).not.toHaveProperty("homeAdvantageElo");
    expect(historicalModelCompatibility({
      sport: "football",
      evidenceModelKey: result.modelKey,
      config: { modelIdentity: footballRuntimeReplayIdentityReceipt(result) }
    })).toBe("exact-runtime-parity");
  });

  it("does not leak the evaluated fixture score into its probability vector", () => {
    const homeWin = runFootballRuntimeReplay(history([8, 0]), { trainRatio: 0.5, minPriorMatches: 3 });
    const awayWin = runFootballRuntimeReplay(history([0, 8]), { trainRatio: 0.5, minPriorMatches: 3 });
    const homeWinLast = homeWin.results.find((row) => row.fixtureExternalId === "fixture:10");
    const awayWinLast = awayWin.results.find((row) => row.fixtureExternalId === "fixture:10");

    expect(homeWinLast?.probabilities).toEqual(awayWinLast?.probabilities);
    expect(homeWinLast?.actualOutcome).toBe("home");
    expect(awayWinLast?.actualOutcome).toBe("away");
    expect(homeWin.learnedWeights).toEqual(awayWin.learnedWeights);
    expect(homeWin.learnedWeightsProvenance).toEqual(awayWin.learnedWeightsProvenance);
    expect(homeWin.selectionPolicy).toEqual(awayWin.selectionPolicy);
    expect(homeWin.probabilityCalibrationPolicy).toEqual(awayWin.probabilityCalibrationPolicy);
    expect(homeWin.marketPriorScalingPolicy).toEqual(awayWin.marketPriorScalingPolicy);
    expect(homeWin.empiricalValueGuardPolicy).toEqual(awayWin.empiricalValueGuardPolicy);
  });

  it("keeps explicit closing prices out of the final posterior while retaining them for evaluation", () => {
    const baselineFixtures = history();
    const withClosing = history();
    const last = withClosing[9]!;
    const closingAt = new Date(Date.parse(last.kickoffAt) - 5 * 60_000).toISOString();
    last.odds = [
      ...(last.odds ?? []),
      { market: "match_winner", selection: "home", decimalOdds: 1.08, bookmaker: "test", observedAt: closingAt, isClosing: true },
      { market: "match_winner", selection: "draw", decimalOdds: 12, bookmaker: "test", observedAt: closingAt, isClosing: true },
      { market: "match_winner", selection: "away", decimalOdds: 18, bookmaker: "test", observedAt: closingAt, isClosing: true }
    ];
    const config = { trainRatio: 0.5, minPriorMatches: 3 };
    const baseline = runFootballRuntimeReplay(baselineFixtures, config);
    const replay = runFootballRuntimeReplay(withClosing, config);
    const finalProbability = (result: ReturnType<typeof runFootballRuntimeReplay>) =>
      result.results.find((row) => row.fixtureExternalId === "fixture:10")!.probabilities;

    expect(finalProbability(replay)).toEqual(finalProbability(baseline));
    expect(replay.marketPriorEvidence).toEqual(baseline.marketPriorEvidence);
  });

  it("fails closed for neutral venues the runtime Match contract cannot represent", () => {
    const fixtures = history();
    fixtures[9] = { ...fixtures[9]!, neutralVenue: true };
    const result = runFootballRuntimeReplay(fixtures, { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.rejections.find((item) => item.fixtureExternalId === "fixture:10")?.reasons).toContain(
      "neutral venue is unsupported by the runtime Match contract"
    );
    expect(result.results.some((row) => row.fixtureExternalId === "fixture:10")).toBe(false);
  });

  it("replays timestamped player availability at the historical kickoff clock and rejects stale context", () => {
    const baselineFixtures = history();
    const freshFixtures = history();
    freshFixtures[9] = {
      ...freshFixtures[9]!,
      availability: [{
        teamExternalId: "team:a",
        playerExternalId: "player:9",
        playerName: "Key Forward",
        status: "injured",
        impactScore: 1,
        reason: "hamstring",
        observedAt: "2025-01-10T14:00:00.000Z"
      }]
    };
    const staleFixtures = history();
    staleFixtures[9] = {
      ...staleFixtures[9]!,
      availability: [{
        teamExternalId: "team:a",
        playerExternalId: "player:9",
        playerName: "Key Forward",
        status: "injured",
        impactScore: 1,
        observedAt: "2025-01-09T14:00:00.000Z"
      }]
    };

    const config = { trainRatio: 0.5, minPriorMatches: 3 };
    const baseline = runFootballRuntimeReplay(baselineFixtures, config);
    const fresh = runFootballRuntimeReplay(freshFixtures, config);
    const stale = runFootballRuntimeReplay(staleFixtures, config);
    const homeProbability = (result: ReturnType<typeof runFootballRuntimeReplay>) =>
      result.results.find((row) => row.fixtureExternalId === "fixture:10")!.probabilities.home;

    expect(fresh.featureContract.optionalCoverage.contextSignalFixtures).toBe(1);
    expect(homeProbability(fresh)).toBeLessThan(homeProbability(baseline));
    expect(homeProbability(stale)).toBe(homeProbability(baseline));
  });

  it("executes leakage-safe player-form evidence through the exact runtime entrypoint", () => {
    const fixtures = history();
    const config = { trainRatio: 0.5, minPriorMatches: 3 };
    const baseline = runFootballRuntimeReplay(fixtures, config);
    const withPlayers = runFootballRuntimeReplay(fixtures, config, { playerPerformances: playerPerformances() });
    const lastHomeProbability = (result: ReturnType<typeof runFootballRuntimeReplay>) =>
      result.results.find((row) => row.fixtureExternalId === "fixture:10")!.probabilities.home;

    expect(withPlayers.featureContract.optionalCoverage.playerFormFixtures).toBeGreaterThan(0);
    expect(withPlayers.featureContract.optionalCoverage.playerFormReadyFixtures).toBeGreaterThan(0);
    expect(withPlayers.featureContract.optionalCoverage.playerFormTrainingReadyFixtures).toBeGreaterThan(0);
    expect(withPlayers.featureContract.optionalCoverage.playerFormHoldoutReadyFixtures).toBeGreaterThan(0);
    expect(withPlayers.notes.some((note) => note.includes("leakage-safe player-form evidence"))).toBe(true);
    expect(lastHomeProbability(withPlayers)).toBeGreaterThan(lastHomeProbability(baseline));
  });

  it("consolidates cross-provider copies before chronology and keeps the player-capable identity", () => {
    const apiFixtures = history();
    const csvDuplicates = apiFixtures.map((fixture) => ({
      ...fixture,
      externalId: `football-data:${fixture.externalId}`,
      kickoffAt: `${fixture.kickoffAt.slice(0, 10)}T00:00:00.000Z`,
      homeTeam: { ...fixture.homeTeam, externalId: `csv:${fixture.homeTeam.externalId}` },
      awayTeam: { ...fixture.awayTeam, externalId: `csv:${fixture.awayTeam.externalId}` },
      metadata: { provider: "football_data_csv" }
    }));
    const result = runFootballRuntimeReplay([...csvDuplicates, ...apiFixtures], { trainRatio: 0.5, minPriorMatches: 3 }, {
      playerPerformances: playerPerformances()
    });

    expect(result.featureContract.sourceFixtures).toBe(20);
    expect(result.featureContract.duplicateFixtureGroups).toBe(10);
    expect(result.featureContract.duplicateSourceFixturesCollapsed).toBe(10);
    expect(result.featureContract.conflictingDuplicateGroups).toBe(0);
    expect(result.featureContract.eligibleFixtures).toBe(runFootballRuntimeReplay(apiFixtures, { trainRatio: 0.5, minPriorMatches: 3 }).featureContract.eligibleFixtures);
    expect(result.results.every((row) => !row.fixtureExternalId.startsWith("football-data:"))).toBe(true);
    expect(result.featureContract.optionalCoverage.playerFormFixtures).toBeGreaterThan(0);
  });

  it("fails closed when duplicate providers disagree on the final score", () => {
    const fixtures = history();
    const conflict = {
      ...fixtures[9]!,
      externalId: "football-data:conflicting-final",
      kickoffAt: `${fixtures[9]!.kickoffAt.slice(0, 10)}T00:00:00.000Z`,
      homeScore: (fixtures[9]!.homeScore ?? 0) + 1,
      metadata: { provider: "football_data_csv" }
    };
    const result = runFootballRuntimeReplay([...fixtures, conflict], { trainRatio: 0.5, minPriorMatches: 3 });

    expect(result.featureContract.duplicateFixtureGroups).toBe(1);
    expect(result.featureContract.duplicateSourceFixturesCollapsed).toBe(0);
    expect(result.featureContract.conflictingDuplicateGroups).toBe(1);
    expect(result.rejections.filter((item) => item.reasons.includes("duplicate provider records disagree on the final score"))).toHaveLength(2);
    expect(result.results.some((row) => row.fixtureExternalId === fixtures[9]!.externalId)).toBe(false);
  });
});
