import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFixtures: vi.fn(),
  getPredictions: vi.fn(),
  startProviderRun: vi.fn()
}));

vi.mock("@/lib/sports/service", () => ({
  getPredictions: mocks.getPredictions,
  sportsProvider: { getFixtures: mocks.getFixtures }
}));
vi.mock("@/lib/sports/providers/providerBackedProvider", () => ({
  getRecentSportsProviderIssues: vi.fn(() => []),
  getSportsProviderRuntimeStatus: vi.fn(() => ({ liveRuntimeBacked: true }))
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRuntimeStatus: vi.fn(() => ({ serverWriteReady: true }))
}));
vi.mock("@/lib/sports/intelligence/repository", () => ({
  finishProviderRun: vi.fn(),
  persistFixturesAndOdds: vi.fn(),
  persistMarketDecisions: vi.fn(),
  persistDecisionSummaries: vi.fn(),
  readStoredSlate: vi.fn(),
  startProviderRun: mocks.startProviderRun
}));
vi.mock("@/lib/sports/results/publicPicks", () => ({ persistCanonicalPublicPicks: vi.fn() }));

import { runDailyEngine } from "@/lib/sports/intelligence/pipeline";

describe("provider run overlap protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startProviderRun.mockResolvedValue({
      acquired: false,
      run: {
        runId: "active-run",
        providerName: "configured-sports-providers",
        jobType: "run-daily-engine",
        startedAt: "2026-07-16T10:00:00.000Z",
        finishedAt: null,
        status: "running",
        fixturesFound: 0,
        oddsFound: 0,
        predictionsGenerated: 0,
        valuePicksPublished: 0,
        errors: ["Skipped overlapping run-daily-engine run; an active receipt already owns this job."]
      }
    });
  });

  it("does not call providers or persistence when another run owns the job", async () => {
    const result = await runDailyEngine({
      now: new Date("2026-07-16T10:05:00.000Z"),
      persist: true,
      env: { API_FOOTBALL_KEY: "configured", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "secret" }
    });

    expect(result.skippedOverlap).toBe(true);
    expect(result.run.status).toBe("running");
    expect(mocks.getFixtures).not.toHaveBeenCalled();
    expect(mocks.getPredictions).not.toHaveBeenCalled();
  });
});
