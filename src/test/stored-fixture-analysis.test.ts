import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const readLatestDecisionSummary = vi.hoisted(() => vi.fn());
const readFixtureOddsHistory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/sports/intelligence/repository", () => ({
  readLatestDecisionSummary,
  readFixtureOddsHistory
}));

import { readStoredFixtureAnalysis } from "@/lib/sports/intelligence/storedFixture";

function clientWithFixture(data: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null }))
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return { from: vi.fn(() => query) };
}

describe("stored fixture analysis", () => {
  beforeEach(() => {
    getSupabaseServerClient.mockReset();
    readLatestDecisionSummary.mockReset();
    readFixtureOddsHistory.mockReset();
    readLatestDecisionSummary.mockResolvedValue(null);
    readFixtureOddsHistory.mockResolvedValue({ status: "no-data", snapshots: [], rowsRead: 0, truncated: false, reason: null });
  });

  it("keeps a provider-backed fixture resolvable after it ages out of current slates", async () => {
    getSupabaseServerClient.mockReturnValue(clientWithFixture({
      sport: "basketball",
      provider: "api-basketball",
      external_id: "api-basketball:494954",
      provider_fixture_id: "494954",
      league_external_id: "12",
      league_name: "Summer League",
      kickoff_at: "2026-07-15T02:00:00.000Z",
      status: "live",
      home_team_external_id: "home-1",
      away_team_external_id: "away-1",
      home_team_name: "Home",
      away_team_name: "Away",
      home_score: null,
      away_score: null,
      country: "USA",
      data_quality: "0.72",
      last_synced_at: "2026-07-15T01:00:00.000Z",
      metadata: {}
    }));

    const result = await readStoredFixtureAnalysis("api-basketball:494954", {
      now: new Date("2026-07-16T18:00:00.000Z")
    });

    expect(result.status).toBe("ready");
    expect(result.analysis).toMatchObject({
      fixtureId: "api-basketball:494954",
      provider: "api-basketball",
      status: "suspended",
      stale: true,
      score: null
    });
    expect(readLatestDecisionSummary).toHaveBeenCalledWith("api-basketball:494954", expect.anything());
    expect(readFixtureOddsHistory).toHaveBeenCalledWith("api-basketball:494954", expect.anything());
  });

  it("returns a real missing state only when no stored fixture exists", async () => {
    getSupabaseServerClient.mockReturnValue(clientWithFixture(null));

    await expect(readStoredFixtureAnalysis("missing")).resolves.toMatchObject({
      status: "missing",
      analysis: null
    });
  });
});
