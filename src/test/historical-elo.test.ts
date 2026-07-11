import { describe, expect, it } from "vitest";
import {
  HISTORICAL_ELO_INITIAL_RATING,
  buildHistoricalFootballElo,
  canonicalFootballTeamKey,
  getHistoricalFootballElo,
  type HistoricalFootballEloRow
} from "@/lib/sports/prediction/historicalElo";

function fixture(overrides: Partial<HistoricalFootballEloRow> = {}): HistoricalFootballEloRow {
  return {
    external_id: "football-data:E0:2324:1",
    provider: "football_data_csv",
    sport: "football",
    status: "finished",
    kickoff_at: "2023-08-12T15:00:00.000Z",
    season: "2023/24",
    home_team_external_id: "football-data:epl:arsenal",
    away_team_external_id: "football-data:epl:chelsea",
    home_score: 2,
    away_score: 1,
    neutral_venue: false,
    data_quality: 0.74,
    metadata: { source: "football-data-csv", sourceKind: "real" },
    ...overrides
  };
}

function isoDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day, 15)).toISOString();
}

describe("historical football Elo", () => {
  it("is deterministic regardless of input order", () => {
    const rows = [
      fixture({
        external_id: "football-data:E0:2324:3",
        kickoff_at: "2023-08-19T15:00:00.000Z",
        home_team_external_id: "football-data:epl:chelsea",
        away_team_external_id: "football-data:epl:brighton",
        home_score: 1,
        away_score: 1
      }),
      fixture({
        external_id: "football-data:E0:2324:2",
        home_team_external_id: "football-data:epl:man-city",
        away_team_external_id: "football-data:epl:newcastle",
        home_score: 3,
        away_score: 0
      }),
      fixture({ external_id: "football-data:E0:2324:1" })
    ];

    const chronological = buildHistoricalFootballElo(rows);
    const reversed = buildHistoricalFootballElo([...rows].reverse());

    expect([...reversed.entries()]).toEqual([...chronological.entries()]);
    expect(getHistoricalFootballElo(chronological, "Chelsea")?.asOf).toBe("2023-08-19T15:00:00.000Z");
  });

  it("rewards favorites less than underdogs and moves both sides in the result direction", () => {
    const prelude: HistoricalFootballEloRow[] = [];
    for (let index = 0; index < 6; index += 1) {
      prelude.push(
        fixture({
          external_id: `favorite-${index}`,
          kickoff_at: isoDay(2023, 7, index + 1),
          home_team_external_id: "football-data:epl:favorite",
          away_team_external_id: `football-data:epl:favorite-rival-${index}`,
          home_score: 2,
          away_score: 0,
          neutral_venue: true
        }),
        fixture({
          external_id: `underdog-${index}`,
          kickoff_at: isoDay(2023, 7, index + 1),
          home_team_external_id: `football-data:epl:underdog-rival-${index}`,
          away_team_external_id: "football-data:epl:underdog",
          home_score: 2,
          away_score: 0,
          neutral_venue: true
        })
      );
    }

    const before = buildHistoricalFootballElo(prelude);
    const favoriteBefore = getHistoricalFootballElo(before, "favorite")!;
    const underdogBefore = getHistoricalFootballElo(before, "underdog")!;
    expect(favoriteBefore.rawElo).toBeGreaterThan(underdogBefore.rawElo);

    const matchup = {
      external_id: "favorite-v-underdog",
      kickoff_at: "2023-08-20T15:00:00.000Z",
      home_team_external_id: "football-data:epl:favorite",
      away_team_external_id: "football-data:epl:underdog",
      neutral_venue: true
    };
    const favoriteWin = buildHistoricalFootballElo([...prelude, fixture({ ...matchup, home_score: 1, away_score: 0 })]);
    const underdogWin = buildHistoricalFootballElo([...prelude, fixture({ ...matchup, home_score: 0, away_score: 1 })]);
    const favoriteAfterWin = getHistoricalFootballElo(favoriteWin, "favorite")!;
    const underdogAfterLoss = getHistoricalFootballElo(favoriteWin, "underdog")!;
    const favoriteAfterLoss = getHistoricalFootballElo(underdogWin, "favorite")!;
    const underdogAfterWin = getHistoricalFootballElo(underdogWin, "underdog")!;

    expect(favoriteAfterWin.rawElo).toBeGreaterThan(favoriteBefore.rawElo);
    expect(underdogAfterLoss.rawElo).toBeLessThan(underdogBefore.rawElo);
    expect(favoriteAfterLoss.rawElo).toBeLessThan(favoriteBefore.rawElo);
    expect(underdogAfterWin.rawElo).toBeGreaterThan(underdogBefore.rawElo);
    expect(underdogAfterWin.rawElo - underdogBefore.rawElo).toBeGreaterThan(
      favoriteAfterWin.rawElo - favoriteBefore.rawElo
    );
  });

  it("regresses existing ratings toward 1500 at a season boundary", () => {
    const firstSeason = [
      fixture({
        external_id: "season-one",
        season: "2023/24",
        home_team_external_id: "football-data:epl:arsenal",
        away_team_external_id: "football-data:epl:chelsea",
        home_score: 4,
        away_score: 0,
        neutral_venue: true
      })
    ];
    const before = getHistoricalFootballElo(buildHistoricalFootballElo(firstSeason), "Arsenal")!;
    const afterMap = buildHistoricalFootballElo([
      ...firstSeason,
      fixture({
        external_id: "season-two",
        season: "2024/25",
        kickoff_at: "2024-08-10T15:00:00.000Z",
        home_team_external_id: "football-data:epl:leicester",
        away_team_external_id: "football-data:epl:ipswich",
        home_score: 0,
        away_score: 0,
        neutral_venue: true
      })
    ]);
    const after = getHistoricalFootballElo(afterMap, "Arsenal")!;
    const expected = HISTORICAL_ELO_INITIAL_RATING + (before.rawElo - HISTORICAL_ELO_INITIAL_RATING) * 0.75;

    expect(after.rawElo).toBeCloseTo(expected, 3);
    expect(Math.abs(after.rawElo - HISTORICAL_ELO_INITIAL_RATING)).toBeLessThan(
      Math.abs(before.rawElo - HISTORICAL_ELO_INITIAL_RATING)
    );
    expect(after.matchCount).toBe(1);
    expect(after.asOf).toBe("2023-08-12T15:00:00.000Z");
  });

  it("excludes demo, non-provider, non-finished, and invalid-score rows", () => {
    const rows = [
      fixture({ external_id: "real-row" }),
      fixture({ external_id: "demo-provider", provider: "demo_seed", home_team_external_id: "football-data:epl:demo-provider" }),
      fixture({
        external_id: "demo-metadata",
        metadata: { source: "football-data-csv", sourceKind: "demo" },
        home_team_external_id: "football-data:epl:demo-metadata"
      }),
      fixture({ external_id: "wrong-provider", provider: "api_football", home_team_external_id: "football-data:epl:wrong-provider" }),
      fixture({ external_id: "scheduled", status: "scheduled", home_team_external_id: "football-data:epl:scheduled" }),
      fixture({ external_id: "negative-score", home_score: -1 }),
      fixture({ external_id: "fractional-score", away_score: 1.5 }),
      fixture({ external_id: "missing-score", home_score: null })
    ];

    const ratings = buildHistoricalFootballElo(rows);

    expect([...ratings.keys()]).toEqual(["arsenal", "chelsea"]);
    expect(getHistoricalFootballElo(ratings, "Arsenal")?.matchCount).toBe(1);
    expect(getHistoricalFootballElo(ratings, "demo provider")).toBeUndefined();
  });

  it("matches football-data slugs to API-Football names and common aliases", () => {
    const aliases: Array<[string, string[]]> = [
      ["football-data:epl:man-city", ["Manchester City", "Man City"]],
      ["football-data:epl:man-united", ["Manchester United", "Man United", "Man Utd"]],
      ["football-data:epl:newcastle", ["Newcastle United", "Newcastle"]],
      ["football-data:epl:nott-m-forest", ["Nottingham Forest", "Nott'm Forest"]],
      ["football-data:epl:tottenham", ["Tottenham Hotspur", "Spurs"]],
      ["football-data:epl:west-ham", ["West Ham United", "West Ham"]],
      ["football-data:epl:wolves", ["Wolverhampton Wanderers", "Wolves"]],
      ["football-data:epl:brighton", ["Brighton and Hove Albion", "Brighton & Hove Albion", "Brighton"]]
    ];

    for (const [footballDataId, names] of aliases) {
      const canonical = canonicalFootballTeamKey(footballDataId);
      for (const name of names) expect(canonicalFootballTeamKey(name)).toBe(canonical);
    }

    const ratings = buildHistoricalFootballElo([
      fixture({
        external_id: "alias-lookup",
        home_team_external_id: "football-data:epl:man-city",
        away_team_external_id: "football-data:epl:man-united"
      })
    ]);
    expect(getHistoricalFootballElo(ratings, "Manchester City")).toEqual(getHistoricalFootballElo(ratings, "Man City"));
    expect(getHistoricalFootballElo(ratings, "Manchester United")).toEqual(getHistoricalFootballElo(ratings, "Man Utd"));
  });

  it("bounds K-factor movement and every model rating to 60-100", () => {
    const maximumK = buildHistoricalFootballElo([
      fixture({
        external_id: "maximum-k",
        home_team_external_id: "football-data:epl:dominant",
        away_team_external_id: "football-data:epl:weak",
        home_score: 30,
        away_score: 0,
        neutral_venue: true,
        data_quality: 1
      })
    ]);
    expect(getHistoricalFootballElo(maximumK, "dominant")?.rawElo).toBe(1520);
    expect(getHistoricalFootballElo(maximumK, "weak")?.rawElo).toBe(1480);

    const highQuality = buildHistoricalFootballElo([
      fixture({ external_id: "high-quality", neutral_venue: true, data_quality: 1, home_score: 1, away_score: 0 })
    ]);
    const lowQuality = buildHistoricalFootballElo([
      fixture({ external_id: "low-quality", neutral_venue: true, data_quality: 0.1, home_score: 1, away_score: 0 })
    ]);
    expect(getHistoricalFootballElo(highQuality, "Arsenal")!.rawElo).toBeGreaterThan(
      getHistoricalFootballElo(lowQuality, "Arsenal")!.rawElo
    );

    const extremeRows = Array.from({ length: 180 }, (_, index) =>
      fixture({
        external_id: `extreme-${index}`,
        kickoff_at: isoDay(2023 + Math.floor(index / 120), 7, (index % 28) + 1),
        season: index < 120 ? "2023/24" : "2024/25",
        home_team_external_id: "football-data:epl:dominant",
        away_team_external_id: "football-data:epl:weak",
        home_score: 10,
        away_score: 0,
        data_quality: 1
      })
    );
    for (const rating of buildHistoricalFootballElo(extremeRows).values()) {
      expect(Number.isFinite(rating.rawElo)).toBe(true);
      expect(rating.modelRating).toBeGreaterThanOrEqual(60);
      expect(rating.modelRating).toBeLessThanOrEqual(100);
    }
  });
});
