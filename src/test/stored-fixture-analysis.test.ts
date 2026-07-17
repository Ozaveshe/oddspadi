import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const readLatestDecisionSummary = vi.hoisted(() => vi.fn());
const readFixtureOddsHistory = vi.hoisted(() => vi.fn());
const storedFixtureArtwork = vi.hoisted(() => vi.fn(() => ({
  leagueLogo: "https://cdn.test/league.png",
  leagueFlag: "https://cdn.test/flag.svg",
  homeLogo: "https://cdn.test/home.png",
  awayLogo: "https://cdn.test/away.png",
  homeCountry: "United States",
  awayCountry: "Canada"
})));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/sports/intelligence/repository", () => ({
  readLatestDecisionSummary,
  readFixtureOddsHistory,
  storedFixtureArtwork
}));

import { readStoredFixtureAnalysis } from "@/lib/sports/intelligence/storedFixture";

function clientWithFixture(data: Record<string, unknown> | null, identityError: Error | null = null) {
  const fixtureQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null }))
  };
  fixtureQuery.select.mockReturnValue(fixtureQuery);
  fixtureQuery.eq.mockReturnValue(fixtureQuery);
  fixtureQuery.limit.mockReturnValue(fixtureQuery);
  const identityQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: identityError }))
  };
  identityQuery.select.mockReturnValue(identityQuery);
  identityQuery.eq.mockReturnValue(identityQuery);
  identityQuery.in.mockReturnValue(identityQuery);
  identityQuery.limit.mockReturnValue(identityQuery);
  return { from: vi.fn((table: string) => table === "op_fixtures" ? fixtureQuery : identityQuery) };
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
      score: null,
      homeTeam: { logo: "https://cdn.test/home.png", country: "United States" },
      awayTeam: { logo: "https://cdn.test/away.png", country: "Canada" }
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

  it("keeps the archived page resolvable when optional identity enrichment is unavailable", async () => {
    getSupabaseServerClient.mockReturnValue(clientWithFixture({
      sport: "football", provider: "api-football", external_id: "api-football:old", league_name: "Cup",
      kickoff_at: "2026-07-10T18:00:00.000Z", status: "finished", home_team_name: "Home", away_team_name: "Away",
      country: "World", data_quality: "0.7", last_synced_at: "2026-07-10T20:00:00.000Z", metadata: {}
    }, new Error("identity store unavailable")));

    await expect(readStoredFixtureAnalysis("api-football:old", { now: new Date("2026-07-17T00:00:00.000Z") })).resolves.toMatchObject({
      status: "ready",
      analysis: { fixtureId: "api-football:old", stale: true }
    });
  });
});
