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
  readFreshStoredOdds: vi.fn(),
  readStoredSlate,
  startProviderRun: vi.fn()
}));

vi.mock("@/lib/sports/results/publicPicks", () => ({
  persistCanonicalPublicPicks: vi.fn()
}));

import { getDailySlate, getWeeklySlate } from "@/lib/sports/intelligence/pipeline";
import { buildSportsSlate } from "@/lib/sports/intelligence/canonical";
import { buildDailyTipsProduct, filterDailyTipsProductBySport } from "@/lib/sports/tips/product";

describe("read-only slate retrieval", () => {
  beforeEach(() => {
    getFixtures.mockReset();
    getPredictions.mockReset();
    readStoredSlate.mockReset();
  });

  it.each([
    ["Africa/Lagos", "2026-09-13T03:00:00Z", 0, "2026-09-13", "2026-09-12T23:00:00.000Z", "2026-09-13T23:00:00.000Z"],
    ["Africa/Lagos", "2026-09-13T03:00:00Z", 1, "2026-09-14", "2026-09-13T23:00:00.000Z", "2026-09-14T23:00:00.000Z"],
    ["Africa/Lagos", "2026-09-13T03:00:00Z", -1, "2026-09-12", "2026-09-11T23:00:00.000Z", "2026-09-12T23:00:00.000Z"],
    ["UTC", "2026-09-13T03:00:00Z", 0, "2026-09-13", "2026-09-13T00:00:00.000Z", "2026-09-14T00:00:00.000Z"],
    ["America/Los_Angeles", "2026-09-13T03:00:00Z", 0, "2026-09-12", "2026-09-12T07:00:00.000Z", "2026-09-13T07:00:00.000Z"],
    ["Australia/Sydney", "2026-09-13T03:00:00Z", 0, "2026-09-13", "2026-09-12T14:00:00.000Z", "2026-09-13T14:00:00.000Z"],
    ["America/New_York", "2026-03-08T12:00:00Z", 0, "2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]
  ])("labels stored %s at %s offset %s by its local calendar date", async (timeZone, instant, offset, date, from, toExclusive) => {
    const dayOffset = Number(offset);
    const now = new Date(instant);
    // The repository labels its range in UTC; a local day can span two UTC dates.
    const stored = buildSportsSlate({
      scope: "daily",
      fixtures: [{
        fixtureId: "synthetic-boundary-fixture", providerFixtureId: "synthetic-boundary-fixture",
        sport: "football", league: "Test League", leagueId: "test", country: "England", season: "2026",
        kickoffAt: from, homeTeam: { id: "h", name: "Test Home" }, awayTeam: { id: "a", name: "Test Away" },
        status: "scheduled", score: null, provider: "api-football", lastSyncedAt: instant, dataQuality: 0.8
      }],
      oddsByFixture: new Map(), decisionsByFixture: new Map(), decisionSummariesByFixture: new Map(),
      range: { from: from.slice(0, 10), to: new Date(Date.parse(toExclusive) - 1).toISOString().slice(0, 10) },
      providerStatus: "failed", providerErrors: ["Stored provider receipt failed"], generatedAt: instant
    });
    readStoredSlate.mockResolvedValue(stored);

    const result = await getDailySlate({ now, ensure: false, timeZone, dayOffset });
    expect(readStoredSlate).toHaveBeenCalledWith(expect.objectContaining({ from, toExclusive }));
    expect(result.range).toEqual({ from: date, to: date });
    expect(result.groupedByDate).toEqual([{ date, fixtures: stored.fixtures }]);
    expect(result.fixtures).toBe(stored.fixtures);
    expect(result.provider).toBe(stored.provider);
    expect(result.summary).toBe(stored.summary);
    expect(result.generatedAt).toBe(instant);
    const product = buildDailyTipsProduct(result, { day: dayOffset === 1 ? "tomorrow" : "today", asOf: now });
    expect(product.date).toBe(date);
    expect(filterDailyTipsProductBySport(product, "football").date).toBe(date);
    expect(getFixtures).not.toHaveBeenCalled();
    expect(getPredictions).not.toHaveBeenCalled();
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
