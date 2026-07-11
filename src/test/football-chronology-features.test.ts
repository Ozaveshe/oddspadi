import { describe, expect, it } from "vitest";

import { deriveFootballChronologyFeatures } from "@/lib/sports/training/footballChronologyFeatures";
import { buildFootballProviderFeatureMaterializer } from "@/lib/sports/training/footballDataProviderFeatureMaterializer";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";

function fixture({
  id,
  kickoffAt,
  home,
  away,
  homeScore,
  awayScore,
  season = "2025",
  odds = false
}: {
  id: string;
  kickoffAt: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  season?: string;
  odds?: boolean;
}): HistoricalFootballFixtureInput {
  return {
    externalId: id,
    kickoffAt,
    league: { externalId: "league:1", name: "Test League" },
    season,
    status: "finished",
    homeTeam: { externalId: `team:${home}`, name: home },
    awayTeam: { externalId: `team:${away}`, name: away },
    homeScore,
    awayScore,
    odds: odds
      ? [
          { market: "match_winner", selection: "home", decimalOdds: 2.1, bookmaker: "test" },
          { market: "match_winner", selection: "draw", decimalOdds: 3.4, bookmaker: "test" },
          { market: "match_winner", selection: "away", decimalOdds: 3.6, bookmaker: "test" }
        ]
      : []
  };
}

function chronology(fixtureInput: HistoricalFootballFixtureInput, side: "home" | "away") {
  const features = side === "home" ? fixtureInput.homeFeatures : fixtureInput.awayFeatures;
  return features?.metadata?.chronology as Record<string, unknown>;
}

describe("football chronology features", () => {
  it("derives later team strength from prior results only", () => {
    const derived = deriveFootballChronologyFeatures([
      fixture({ id: "one", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 4, awayScore: 0 }),
      fixture({ id: "two", kickoffAt: "2025-01-08T15:00:00.000Z", home: "A", away: "B", homeScore: 1, awayScore: 1 })
    ]);

    expect(derived[0].homeFeatures?.eloRating).toBe(1500);
    expect(chronology(derived[0], "home").priorMatches).toBe(0);
    expect(chronology(derived[1], "home").priorMatches).toBe(1);
    expect(derived[1].homeFeatures?.eloRating).toBeGreaterThan(1500);
    expect(derived[1].homeFeatures?.attackStrength).toBeGreaterThan(1);
    expect(derived[1].awayFeatures?.defenseStrength).toBeLessThan(1);
  });

  it("does not leak the current fixture outcome into its pre-match features", () => {
    const history = fixture({ id: "history", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 2, awayScore: 0 });
    const homeWin = deriveFootballChronologyFeatures([
      history,
      fixture({ id: "current", kickoffAt: "2025-01-08T15:00:00.000Z", home: "A", away: "B", homeScore: 8, awayScore: 0 })
    ])[1];
    const awayWin = deriveFootballChronologyFeatures([
      history,
      fixture({ id: "current", kickoffAt: "2025-01-08T15:00:00.000Z", home: "A", away: "B", homeScore: 0, awayScore: 8 })
    ])[1];

    expect(homeWin.homeFeatures).toEqual(awayWin.homeFeatures);
    expect(homeWin.awayFeatures).toEqual(awayWin.awayFeatures);
  });

  it("groups simultaneous kickoffs before updating the league prior", () => {
    const highScoring = deriveFootballChronologyFeatures([
      fixture({ id: "a", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 10, awayScore: 0 }),
      fixture({ id: "b", kickoffAt: "2025-01-01T15:00:00.000Z", home: "C", away: "D", homeScore: 1, awayScore: 1 })
    ])[1];
    const lowScoring = deriveFootballChronologyFeatures([
      fixture({ id: "a", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 0, awayScore: 0 }),
      fixture({ id: "b", kickoffAt: "2025-01-01T15:00:00.000Z", home: "C", away: "D", homeScore: 1, awayScore: 1 })
    ])[1];

    expect(highScoring.homeFeatures).toEqual(lowScoring.homeFeatures);
    expect(chronology(highScoring, "home").leaguePriorMatches).toBe(0);
  });

  it("preserves finite provider features while adding chronology provenance", () => {
    const input = fixture({ id: "provider", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 1, awayScore: 0 });
    input.homeFeatures = { eloRating: 1725, injuriesCount: 2, metadata: { provider: "api_football" } };
    const derived = deriveFootballChronologyFeatures([input])[0];

    expect(derived.homeFeatures?.eloRating).toBe(1725);
    expect(derived.homeFeatures?.injuriesCount).toBe(2);
    expect(derived.homeFeatures?.metadata?.provider).toBe("api_football");
    expect((derived.homeFeatures?.metadata?.chronology as Record<string, unknown>).leakageSafe).toBe(true);
  });

  it("feeds changing pre-match probabilities into provider materialization", () => {
    const materializer = buildFootballProviderFeatureMaterializer({
      provider: "api_football",
      fixtures: [
        fixture({ id: "first", kickoffAt: "2025-01-01T15:00:00.000Z", home: "A", away: "B", homeScore: 4, awayScore: 0, odds: true }),
        fixture({ id: "second", kickoffAt: "2025-01-08T15:00:00.000Z", home: "A", away: "B", homeScore: 1, awayScore: 0, odds: true })
      ],
      now: new Date("2026-07-10T10:00:00.000Z")
    });
    const first = materializer.previewRows.find((row) => row.fixture_external_id === "first")!;
    const second = materializer.previewRows.find((row) => row.fixture_external_id === "second")!;

    expect(materializer.corpus.withChronologyFeatures).toBe(2);
    expect(materializer.corpus.chronologyWarmupFixtures).toBe(1);
    expect((second.features!.modelProbabilities as Record<string, number>).home).toBeGreaterThan(
      (first.features!.modelProbabilities as Record<string, number>).home
    );
  });

  it("carries regressed Elo and bounded strength across seasons", () => {
    const derived = deriveFootballChronologyFeatures([
      fixture({ id: "old", kickoffAt: "2023-05-20T15:00:00.000Z", season: "2023", home: "A", away: "B", homeScore: 4, awayScore: 0 }),
      fixture({ id: "new", kickoffAt: "2024-08-17T15:00:00.000Z", season: "2024", home: "A", away: "B", homeScore: 1, awayScore: 1 })
    ]);
    const newHome = chronology(derived[1], "home");

    expect(derived[1].homeFeatures?.eloRating).toBeGreaterThan(1500);
    expect(newHome.version).toBe("football-provider-chronology-v2");
    expect(newHome.priorSeasons).toEqual(["2023"]);
    expect(newHome.crossSeasonHistory).toBe(true);
    expect(newHome.seasonRegression).toBe(0.25);
    expect(newHome.strengthMatches).toBe(1);
  });

  it("bounds team scoring evidence to the latest configured result window", () => {
    const history = (openingHomeScore: number) => [
      fixture({ id: "oldest", kickoffAt: "2023-01-01T15:00:00.000Z", season: "2023", home: "A", away: "B", homeScore: openingHomeScore, awayScore: 0 }),
      ...Array.from({ length: 20 }, (_, index) => fixture({
        id: `rolling-${index}`,
        kickoffAt: new Date(Date.UTC(2023, 0, index + 2, 15)).toISOString(),
        season: "2023",
        home: "A",
        away: "B",
        homeScore: 1,
        awayScore: 1
      })),
      fixture({ id: "current", kickoffAt: "2024-08-17T15:00:00.000Z", season: "2024", home: "A", away: "B", homeScore: 2, awayScore: 1 })
    ];
    const highOutlier = deriveFootballChronologyFeatures(history(10)).at(-1)!;
    const lowOutlier = deriveFootballChronologyFeatures(history(0)).at(-1)!;

    expect(chronology(highOutlier, "home").strengthMatches).toBe(20);
    expect(chronology(highOutlier, "home").strengthGoalsForPerMatch).toBe(1);
    expect(chronology(highOutlier, "home").strengthGoalsForPerMatch).toBe(
      chronology(lowOutlier, "home").strengthGoalsForPerMatch
    );
    expect(chronology(highOutlier, "home").strengthGoalsAgainstPerMatch).toBe(
      chronology(lowOutlier, "home").strengthGoalsAgainstPerMatch
    );
  });
});
