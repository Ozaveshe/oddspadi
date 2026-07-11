import { describe, expect, it } from "vitest";
import {
  buildHistoricalBasketballStrength,
  canonicalBasketballTeamKey,
  clearHistoricalBasketballStrengthCache,
  getHistoricalBasketballStrength,
  loadHistoricalBasketballStrength,
  type HistoricalBasketballFeatureSnapshotRow,
  type HistoricalBasketballFixtureRow,
  type HistoricalBasketballSource
} from "@/lib/sports/prediction/historicalBasketballStrength";

type TeamInput = {
  name: string;
  externalId: string;
  rawRating: number;
  pace?: number | null;
  offensiveEfficiency?: number | null;
  defensiveEfficiency?: number | null;
  restDays?: number | null;
  recentFormPoints?: number | null;
  sampleSize?: number;
  metadata?: Record<string, unknown>;
};

const LAKERS: TeamInput = {
  name: "Los Angeles Lakers",
  externalId: "basketball-reference:nba:team:los-angeles-lakers",
  rawRating: 1530,
  pace: 99.4,
  offensiveEfficiency: 116.8,
  defensiveEfficiency: 112.1,
  restDays: 2,
  recentFormPoints: 8,
  sampleSize: 28
};

const CELTICS: TeamInput = {
  name: "Boston Celtics",
  externalId: "basketball-reference:nba:team:boston-celtics",
  rawRating: 1575,
  pace: 98.7,
  offensiveEfficiency: 119.2,
  defensiveEfficiency: 109.5,
  restDays: 3,
  recentFormPoints: 10,
  sampleSize: 30
};

function fixture(
  externalId: string,
  kickoffAt: string,
  source: HistoricalBasketballSource = "basketball_reference",
  overrides: Partial<HistoricalBasketballFixtureRow> = {}
): HistoricalBasketballFixtureRow {
  return {
    external_id: externalId,
    provider: source,
    sport: "basketball",
    status: "finished",
    kickoff_at: kickoffAt,
    home_team_external_id: LAKERS.externalId,
    away_team_external_id: CELTICS.externalId,
    metadata: { sourceKind: "real" },
    ...overrides
  };
}

function feature(team: TeamInput): Record<string, unknown> {
  return {
    eloRating: team.rawRating,
    restDays: team.restDays ?? null,
    recentFormPoints: team.recentFormPoints ?? null,
    metadata: {
      source: "basketball-reference",
      rating: team.rawRating,
      pace: team.pace ?? null,
      offensiveEfficiency: team.offensiveEfficiency ?? null,
      defensiveEfficiency: team.defensiveEfficiency ?? null,
      gamesPlayedBeforeTip: team.sampleSize ?? 0,
      ...(team.metadata ?? {})
    }
  };
}

function snapshot(
  fixtureExternalId: string,
  generatedAt: string,
  home: TeamInput = LAKERS,
  away: TeamInput = CELTICS,
  source: HistoricalBasketballSource = "basketball_reference",
  overrides: Partial<HistoricalBasketballFeatureSnapshotRow> = {}
): HistoricalBasketballFeatureSnapshotRow {
  return {
    id: `${source}:${fixtureExternalId}:${generatedAt}`,
    sport: "basketball",
    fixture_external_id: fixtureExternalId,
    model_key: "basketball-efficiency-v1",
    generated_at: generatedAt,
    features: {
      homeTeam: { name: home.name, externalId: home.externalId },
      awayTeam: { name: away.name, externalId: away.externalId },
      homeFeatures: feature(home),
      awayFeatures: feature(away)
    },
    split: "train",
    source,
    feature_hash: `hash:${fixtureExternalId}`,
    created_at: generatedAt,
    ...overrides
  };
}

describe("historical basketball strength", () => {
  it("canonicalizes NBA abbreviations, numeric IDs, provider IDs, and common team suffixes", () => {
    const aliasGroups: string[][] = [
      ["Los Angeles Lakers", "LAL", "LA Lakers", "Lakers", "nba-stats:1610612747", LAKERS.externalId],
      ["Golden State Warriors", "GSW", "Warriors", "Dubs", "nba-stats:1610612744"],
      ["Philadelphia 76ers", "PHI", "76ers", "Sixers", "nba-stats:1610612755"],
      ["Portland Trail Blazers", "POR", "Trailblazers", "Blazers", "nba-stats:1610612757"]
    ];

    for (const aliases of aliasGroups) {
      const canonical = canonicalBasketballTeamKey(aliases[0]);
      for (const alias of aliases) expect(canonicalBasketballTeamKey(alias)).toBe(canonical);
    }
    expect(canonicalBasketballTeamKey("Boston Celtics Basketball Club")).toBe("boston-celtics");

    const strengths = buildHistoricalBasketballStrength(
      [fixture("alias-fixture", "2025-04-01T00:00:00.000Z")],
      [snapshot("alias-fixture", "2026-07-01T00:00:00.000Z")]
    );
    expect(getHistoricalBasketballStrength(strengths, "LAL")).toEqual(
      getHistoricalBasketballStrength(strengths, "nba-stats:1610612747")
    );
  });

  it("is deterministic regardless of fixture and snapshot input order", () => {
    const fixtures = [
      fixture("older", "2025-01-01T00:00:00.000Z"),
      fixture("newer", "2025-02-01T00:00:00.000Z")
    ];
    const snapshots = [
      snapshot("older", "2026-07-03T00:00:00.000Z", { ...LAKERS, rawRating: 1490, sampleSize: 10 }),
      snapshot("newer", "2026-07-02T00:00:00.000Z", { ...LAKERS, rawRating: 1545, sampleSize: 20 })
    ];

    const ordered = buildHistoricalBasketballStrength(fixtures, snapshots);
    const reversed = buildHistoricalBasketballStrength([...fixtures].reverse(), [...snapshots].reverse());

    expect([...reversed.entries()]).toEqual([...ordered.entries()]);
    expect(getHistoricalBasketballStrength(ordered, "Lakers")?.rawRating).toBe(1545);
  });

  it("excludes demo, mock, synthetic, non-real, wrong-sport, and unapproved-source rows", () => {
    const fixtures = [
      fixture("real-fixture", "2025-03-01T00:00:00.000Z"),
      fixture("demo-fixture", "2025-03-02T00:00:00.000Z"),
      fixture("metadata-row", "2025-03-03T00:00:00.000Z", "basketball_reference", {
        metadata: { sourceKind: "demo" }
      }),
      fixture("synthetic-fixture", "2025-03-04T00:00:00.000Z")
    ];
    const snapshots = [
      snapshot("real-fixture", "2026-07-01T00:00:00.000Z"),
      snapshot("demo-fixture", "2026-07-01T00:00:00.000Z"),
      snapshot("metadata-row", "2026-07-01T00:00:00.000Z"),
      snapshot("synthetic-fixture", "2026-07-01T00:00:00.000Z", LAKERS, CELTICS, "basketball_reference", {
        model_key: "synthetic-basketball-model"
      }),
      snapshot("real-fixture", "2026-07-02T00:00:00.000Z", LAKERS, CELTICS, "basketball_reference", {
        id: "feature-flagged-row",
        features: {
          homeTeam: { name: LAKERS.name, externalId: LAKERS.externalId },
          awayTeam: { name: CELTICS.name, externalId: CELTICS.externalId },
          homeFeatures: feature({ ...LAKERS, metadata: { synthetic: true } }),
          awayFeatures: feature(CELTICS)
        }
      }),
      { ...snapshot("real-fixture", "2026-07-03T00:00:00.000Z"), id: "wrong-sport", sport: "football" },
      { ...snapshot("real-fixture", "2026-07-04T00:00:00.000Z"), id: "mock-source", source: "mock_provider" }
    ];

    const strengths = buildHistoricalBasketballStrength(fixtures, snapshots);

    expect([...strengths.keys()]).toEqual(["boston-celtics", "los-angeles-lakers"]);
    expect(getHistoricalBasketballStrength(strengths, "LAL")?.fixtureExternalId).toBe("real-fixture");
    expect(getHistoricalBasketballStrength(strengths, "LAL")?.snapshotGeneratedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("selects the latest pre-match feature state by fixture kickoff, not ingestion time", () => {
    const older = fixture("older-game", "2024-12-01T00:00:00.000Z");
    const newer = fixture("newer-game", "2025-04-15T00:00:00.000Z");
    const rows = [
      snapshot(
        "older-game",
        "2026-07-09T12:00:00.000Z",
        { ...LAKERS, rawRating: 1495, sampleSize: 8, pace: 96.2 },
        CELTICS
      ),
      snapshot(
        "newer-game",
        "2026-06-01T12:00:00.000Z",
        { ...LAKERS, rawRating: 1560, sampleSize: 42, pace: 101.1, restDays: 4, recentFormPoints: 10 },
        CELTICS
      )
    ];

    const strength = getHistoricalBasketballStrength(
      buildHistoricalBasketballStrength([newer, older], rows),
      "Los Angeles Lakers"
    );

    expect(strength).toMatchObject({
      rawRating: 1560,
      pace: 101.1,
      restDays: 4,
      recentFormPoints: 10,
      sampleSize: 42,
      asOf: "2025-04-15T00:00:00.000Z",
      source: "basketball_reference",
      featureSource: "basketball-reference",
      fixtureExternalId: "newer-game",
      snapshotGeneratedAt: "2026-06-01T12:00:00.000Z"
    });
  });

  it("uses stable tie-breakers and preserves explicit source provenance", () => {
    const kickoff = "2025-04-20T00:00:00.000Z";
    const generatedAt = "2026-07-01T00:00:00.000Z";
    const basketballReferenceFixture = fixture("shared-game", kickoff);
    const totalsFixture = fixture("shared-game", kickoff, "nba_team_totals_csv", {
      home_team_external_id: "nba-stats:1610612747",
      away_team_external_id: "nba-stats:1610612738"
    });
    const totalsLakers = {
      ...LAKERS,
      externalId: "nba-stats:1610612747",
      rawRating: 1552,
      sampleSize: 50,
      metadata: { source: "nba-team-totals-csv" }
    };
    const totalsCeltics = { ...CELTICS, externalId: "nba-stats:1610612738" };
    const basketballReferenceSnapshot = snapshot("shared-game", generatedAt);
    const totalsSnapshot = snapshot(
      "shared-game",
      generatedAt,
      totalsLakers,
      totalsCeltics,
      "nba_team_totals_csv"
    );

    const strength = getHistoricalBasketballStrength(
      buildHistoricalBasketballStrength(
        [basketballReferenceFixture, totalsFixture],
        [basketballReferenceSnapshot, totalsSnapshot]
      ),
      "Lakers"
    );

    expect(strength).toMatchObject({
      rawRating: 1552,
      source: "nba_team_totals_csv",
      featureSource: "nba-team-totals-csv",
      fixtureExternalId: "shared-game"
    });
  });

  it("maps raw ratings into bounded live ratings and keeps nullable metrics explicit", () => {
    const highTeam = { ...LAKERS, rawRating: 5000, pace: null, offensiveEfficiency: null, restDays: null };
    const lowTeam = { ...CELTICS, rawRating: -500, pace: null, defensiveEfficiency: null, restDays: null };
    const strengths = buildHistoricalBasketballStrength(
      [fixture("extremes", "2025-05-01T00:00:00.000Z")],
      [snapshot("extremes", "2026-07-01T00:00:00.000Z", highTeam, lowTeam)]
    );
    const high = getHistoricalBasketballStrength(strengths, "LAL")!;
    const low = getHistoricalBasketballStrength(strengths, "BOS")!;

    expect(high.modelRating).toBe(100);
    expect(low.modelRating).toBe(60);
    for (const strength of strengths.values()) {
      expect(strength.modelRating).toBeGreaterThanOrEqual(60);
      expect(strength.modelRating).toBeLessThanOrEqual(100);
      expect(Object.hasOwn(strength, "pace")).toBe(true);
      expect(Object.hasOwn(strength, "offensiveEfficiency")).toBe(true);
      expect(Object.hasOwn(strength, "defensiveEfficiency")).toBe(true);
      expect(Object.hasOwn(strength, "restDays")).toBe(true);
    }
  });

  it("returns an empty map when the OddsPadi Supabase runtime is unavailable", async () => {
    clearHistoricalBasketballStrengthCache();
    await expect(loadHistoricalBasketballStrength({})).resolves.toEqual(new Map());
    clearHistoricalBasketballStrengthCache();
  });
});
