import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFixtures, getPredictions, readStoredSlate } = vi.hoisted(() => ({
  getFixtures: vi.fn(),
  getPredictions: vi.fn(),
  readStoredSlate: vi.fn()
}));

vi.mock("@/lib/sports/service", () => ({
  getPredictions,
  sportsProvider: { getFixtures }
}));

vi.mock("@/lib/sports/providers/providerBackedProvider", () => ({
  getRecentSportsProviderIssues: vi.fn(() => []),
  getSportsProviderRuntimeStatus: vi.fn(() => ({ liveRuntimeBacked: true }))
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRuntimeStatus: vi.fn(() => ({ serverWriteReady: false }))
}));

vi.mock("@/lib/sports/intelligence/repository", () => ({
  finishProviderRun: vi.fn(),
  persistFixturesAndOdds: vi.fn(),
  persistMarketDecisions: vi.fn(),
  persistDecisionSummaries: vi.fn(),
  readStoredSlate,
  startProviderRun: vi.fn()
}));

vi.mock("@/lib/sports/results/publicPicks", () => ({
  persistCanonicalPublicPicks: vi.fn()
}));

import { getDailySlate, getWeeklySlate } from "@/lib/sports/intelligence/pipeline";

describe("read-only slate retrieval", () => {
  beforeEach(() => {
    getFixtures.mockReset();
    getPredictions.mockReset();
    readStoredSlate.mockReset();
  });

  it("returns an explicit unavailable daily slate without invoking providers when storage is empty", async () => {
    readStoredSlate.mockResolvedValue(null);

    const slate = await getDailySlate({ now: new Date("2026-07-15T09:00:00.000Z"), ensure: false });

    expect(slate.provider.status).toBe("unavailable");
    expect(slate.provider.errors).toContain("No stored daily engine run is available. This public read did not invoke live providers.");
    expect(slate.range).toEqual({ from: "2026-07-15", to: "2026-07-15" });
    expect(getFixtures).not.toHaveBeenCalled();
    expect(getPredictions).not.toHaveBeenCalled();
  });

  it("preserves repository failure as unavailable evidence without invoking weekly providers", async () => {
    readStoredSlate.mockRejectedValue(new Error("read timed out"));

    const slate = await getWeeklySlate({ now: new Date("2026-07-15T09:00:00.000Z"), ensure: false });

    expect(slate.provider.status).toBe("unavailable");
    expect(slate.provider.errors[0]).toContain("read timed out");
    expect(slate.range).toEqual({ from: "2026-07-15", to: "2026-07-21" });
    expect(getFixtures).not.toHaveBeenCalled();
    expect(getPredictions).not.toHaveBeenCalled();
  });
});
