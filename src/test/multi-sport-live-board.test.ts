import { describe, expect, it } from "vitest";
import { buildFootballBoardFromPayloads, liveBoardFixtureFromMatch, mergeLiveBoardCoverage } from "@/lib/sports/liveScoreBoard";
import type { Match } from "@/lib/sports/types";

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
});
