import { describe, expect, it, vi } from "vitest";

const serverState = vi.hoisted(() => ({ signals: [] as Array<{ rpc: string; signal: AbortSignal }> }));

vi.mock("@/lib/supabase/server", () => ({
  ODDSPADI_SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
  getSupabaseRuntimeStatus: () => ({
    projectRef: "wncwtzqipnoqwmqlznqn",
    urlProjectRef: "wncwtzqipnoqwmqlznqn",
    serverWriteReady: true,
    targetMatchesExpected: true
  }),
  getSupabaseServerClient: () => ({
    rpc(name: string) {
      return {
        abortSignal(signal: AbortSignal) {
          serverState.signals.push({ rpc: name, signal });
          if (name === "op_training_snapshot_counts") {
            return Promise.resolve({ data: ["football", "basketball", "tennis"].map((sport) => ({ sport })), error: null });
          }
          if (name === "op_player_performance_corpus_counts") {
            return Promise.resolve({ data: ["football", "basketball", "tennis"].map((sport) => ({ sport, player_performance_rows: 0 })), error: null });
          }
          return Promise.resolve({ data: null, error: { message: "unexpected RPC" } });
        }
      };
    }
  })
}));

import { buildSupabaseTrainingCorpusCensus, readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

describe("Supabase training corpus census", () => {
  it("gives sequential census RPC stages independent timeout signals", async () => {
    serverState.signals.length = 0;

    const census = await readSupabaseTrainingCorpusCensus({
      env: { SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co", SUPABASE_SECRET_KEY: "test-only" },
      origin: "https://oddspadi.com",
      fresh: true,
      now: new Date("2026-07-17T01:45:00.000Z")
    });

    expect(census.status).toBe("empty-corpus");
    expect(serverState.signals.map(({ rpc }) => rpc)).toEqual([
      "op_training_snapshot_counts",
      "op_player_performance_corpus_counts"
    ]);
    expect(serverState.signals[0].signal).not.toBe(serverState.signals[1].signal);
  });

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
