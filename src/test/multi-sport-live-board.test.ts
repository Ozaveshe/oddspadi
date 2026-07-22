import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFootballBoardFromPayloads, liveBoardFixtureFromMatch, mergeLiveBoardCoverage, normalizeStoredLiveBoardState, readStoredFixtureRowsForDate, resolveRepositoryCoverage } from "@/lib/sports/liveScoreBoard";
import type { Match } from "@/lib/sports/types";
import type { SupabaseClient } from "@supabase/supabase-js";

function providerMatch(sport: "basketball" | "tennis", kind: "provider" | "mock" = "provider"): Match {
  return {
    id: `${sport}:fixture-1`, sport,
    league: { id: `${sport}:league-1`, name: sport === "basketball" ? "BAL" : "ATP Lagos", country: "Nigeria", strength: .8, flag: "https://example.com/ng.svg" },
    kickoffTime: "2026-07-12T18:00:00Z", status: "live", score: { home: 2, away: 1, minute: 42 },
    homeTeam: { id: "home", name: sport === "tennis" ? "Player One" : "Lagos Legends", rating: 80, logo: "https://example.com/home.svg" },
    awayTeam: { id: "away", name: sport === "tennis" ? "Player Two" : "Kigali Kings", rating: 78, logo: null },
    oddsMarkets: [],
    homeForm: { teamId: "home", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 1, defenseStrength: 1 },
    awayForm: { teamId: "away", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 1, defenseStrength: 1 },
    dataQualityScore: .8,
    dataSource: { kind }
  };
}

describe("multi-sport live board", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes provider-backed basketball and tennis fixtures with visual metadata", () => {
    const basketball = liveBoardFixtureFromMatch(providerMatch("basketball"));
    const tennis = liveBoardFixtureFromMatch(providerMatch("tennis"));
    expect(basketball).toMatchObject({ sport: "basketball", phase: "live", statusLabel: "42'", analysis: true });
    expect(basketball?.league.flag).toContain("ng.svg");
    expect(basketball?.home.logo).toContain("home.svg");
    expect(tennis).toMatchObject({ sport: "tennis", goals: { home: 2, away: 1 } });
  });

  it("does not present mock fixtures as live provider coverage", () => {
    expect(liveBoardFixtureFromMatch(providerMatch("basketball", "mock"))).toBeNull();
  });

  it("keeps non-priority football leagues in the worldwide daily schedule", () => {
    const board = buildFootballBoardFromPayloads([], [{
      fixture: { id: 77, date: "2026-07-12T12:00:00Z", status: { short: "NS" } },
      league: { id: 99999, name: "Regional Premier Division", country: "Japan" },
      teams: { home: { name: "East Club" }, away: { name: "West Club" } }, goals: { home: null, away: null }
    }], "2026-07-12");
    expect(board.fixtures).toHaveLength(1);
    expect(board.fixtures[0]).toMatchObject({ sport: "football", league: { country: "Japan" } });
  });

  it("supplements provider football with stored sports that the providers did not return", () => {
    const football = buildFootballBoardFromPayloads([], [{
      fixture: { id: 77, date: "2026-07-12T12:00:00Z", status: { short: "NS" } },
      league: { id: 39, name: "Premier League", country: "England" },
      teams: { home: { name: "East Club" }, away: { name: "West Club" } }, goals: { home: null, away: null }
    }], "2026-07-12").fixtures;
    const storedBasketball = liveBoardFixtureFromMatch(providerMatch("basketball"));
    const duplicateStoredFootball = { ...football[0], id: "stored-football" };

    expect(mergeLiveBoardCoverage(football, [duplicateStoredFootball, storedBasketball!]).map((fixture) => fixture.sport))
      .toEqual(["football", "basketball"]);
  });

  it("applies the stored fallback cap per sport so a tennis-heavy day cannot hide basketball", async () => {
    const rowsBySport = {
      football: Array.from({ length: 84 }, (_, index) => ({ sport: "football", external_id: `football-${index}` })),
      basketball: Array.from({ length: 18 }, (_, index) => ({ sport: "basketball", external_id: `basketball-${index}` })),
      tennis: Array.from({ length: 500 }, (_, index) => ({ sport: "tennis", external_id: `tennis-${index}` }))
    };
    const requestedSports: string[] = [];
    const requestedLimits: number[] = [];
    const client = {
      from: vi.fn(() => {
        let selectedSport = "";
        const query = {
          select: () => query,
          eq: (_column: string, value: string) => { selectedSport = value; requestedSports.push(value); return query; },
          gte: () => query,
          lt: () => query,
          order: () => query,
          limit: async (value: number) => {
            requestedLimits.push(value);
            return { data: rowsBySport[selectedSport as keyof typeof rowsBySport], error: null };
          }
        };
        return query;
      })
    } as unknown as SupabaseClient;

    const rows = await readStoredFixtureRowsForDate(client, "2026-07-22");

    expect(requestedSports).toEqual(["football", "basketball", "tennis"]);
    expect(requestedLimits).toEqual([500, 500, 500]);
    expect(rows).toHaveLength(602);
    expect(rows.filter((row) => row.sport === "basketball")).toHaveLength(18);
  });

  it("withholds stale partial scores instead of presenting an old stored game as live", () => {
    const state = normalizeStoredLiveBoardState({
      status: "live",
      last_synced_at: "2026-07-17T00:27:21.504Z",
      home_score: 13,
      away_score: 0,
      elapsed: null
    }, new Date("2026-07-17T04:10:00.000Z"));

    expect(state).toEqual({
      phase: "other",
      statusShort: "STALE",
      statusLabel: "Awaiting update",
      elapsed: null,
      goals: { home: null, away: null }
    });
  });

  it("keeps a recently synchronized stored game live", () => {
    const state = normalizeStoredLiveBoardState({
      status: "live",
      last_synced_at: "2026-07-17T04:00:00.000Z",
      home_score: 48,
      away_score: 44,
      elapsed: 28
    }, new Date("2026-07-17T04:10:00.000Z"));

    expect(state).toMatchObject({
      phase: "live",
      statusShort: "LIVE",
      statusLabel: "28'",
      goals: { home: 48, away: 44 }
    });
  });

  it("fails open with an explicit timeout state when stored coverage stalls", async () => {
    vi.useFakeTimers();
    const stalled = new Promise<never>(() => undefined);
    const resultPromise = resolveRepositoryCoverage(stalled, 50);

    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({ fixtures: [], unavailableReason: "timeout" });
  });
});
