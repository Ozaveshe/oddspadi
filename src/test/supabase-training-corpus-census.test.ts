import { describe, expect, it } from "vitest";

import { buildSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

describe("Supabase training corpus census", () => {
  it("reports real player-performance rows as a first-class corpus lane", () => {
    const census = buildSupabaseTrainingCorpusCensus({
      counts: [{
        sport: "football",
        fixtures: 20,
        finishedFixtures: 18,
        epl2026Fixtures: 0,
        oddsSnapshots: 0,
        matchWinnerOddsSnapshots: 0,
        rawProviderPayloads: 20,
        playerPerformanceRows: 396,
        featureSnapshots: 18,
        liveFeatureSnapshots: 0,
        labeledFeatureSnapshots: 18,
        completedBacktests: 0
      }],
      serverReadReady: true,
      targetMatchesExpected: true,
      projectRef: "wncwtzqipnoqwmqlznqn",
      now: new Date("2026-07-14T16:00:00.000Z")
    });

    expect(census.totals.playerPerformanceRows).toBe(396);
    expect(census.sports.find((row) => row.sport === "football")?.playerPerformanceRows).toBe(396);
    expect(census.summary).toContain("396 real player-performance row(s)");
    expect(census.locks[1]).toContain("player-performance");
  });

  it("keeps older count callers compatible while defaulting missing player evidence to zero", () => {
    const census = buildSupabaseTrainingCorpusCensus({
      counts: [{
        sport: "football",
        fixtures: 1,
        finishedFixtures: 1,
        epl2026Fixtures: 0,
        oddsSnapshots: 0,
        matchWinnerOddsSnapshots: 0,
        rawProviderPayloads: 1,
        featureSnapshots: 1,
        liveFeatureSnapshots: 0,
        labeledFeatureSnapshots: 1,
        completedBacktests: 0
      }],
      serverReadReady: true,
      targetMatchesExpected: true,
      projectRef: "wncwtzqipnoqwmqlznqn"
    });

    expect(census.totals.playerPerformanceRows).toBe(0);
  });
});
