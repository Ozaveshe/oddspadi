import { describe, expect, it } from "vitest";
import {
  buildHistoricalTennisStrength,
  canonicalTennisPlayerKey,
  canonicalTennisSurface,
  clearHistoricalTennisStrengthCache,
  getHistoricalTennisStrength,
  loadHistoricalTennisStrength,
  tennisModelRatingFromElo,
  tennisPlayerAliasKeys,
  type HistoricalTennisFeatureSnapshotRow,
  type HistoricalTennisFixtureRow
} from "@/lib/sports/prediction/historicalTennisStrength";

type PlayerInput = {
  name: string;
  externalId: string;
  rawElo: number;
  restDays?: number | null;
  recentFormPoints?: number | null;
  rank?: number | null;
  rankingPoints?: number | null;
  metadata?: Record<string, unknown>;
};

const FRITZ: PlayerInput = {
  name: "Fritz T.",
  externalId: "tennis-data:atp:player:fritz-t",
  rawElo: 2320,
  restDays: 8,
  recentFormPoints: 8.6,
  rank: 10,
  rankingPoints: 3150
};

const MEDVEDEV: PlayerInput = {
  name: "Medvedev D.",
  externalId: "tennis-data:atp:player:medvedev-d",
  rawElo: 2290,
  restDays: 6,
  recentFormPoints: 8.1,
  rank: 12,
  rankingPoints: 2880
};

function fixture(
  externalId: string,
  kickoffAt: string,
  surface: string,
  overrides: Partial<HistoricalTennisFixtureRow> = {}
): HistoricalTennisFixtureRow {
  return {
    external_id: externalId,
    provider: "tennis_data_xlsx",
    sport: "tennis",
    status: "finished",
    kickoff_at: kickoffAt,
    home_team_external_id: FRITZ.externalId,
    away_team_external_id: MEDVEDEV.externalId,
    metadata: { source: "tennis-data-xlsx", sourceKind: "real", surface },
    ...overrides
  };
}

function sideFeature(player: PlayerInput, surface: string): Record<string, unknown> {
  return {
    eloRating: player.rawElo,
    attackStrength: 0.72,
    defenseStrength: 0.69,
    restDays: player.restDays ?? null,
    recentFormPoints: player.recentFormPoints ?? null,
    metadata: {
      source: "tennis-data-xlsx",
      surface,
      rank: player.rank ?? null,
      rankingPoints: player.rankingPoints ?? null,
      ...(player.metadata ?? {})
    }
  };
}

function snapshot(
  fixtureExternalId: string,
  generatedAt: string,
  surface: string,
  home: PlayerInput = FRITZ,
  away: PlayerInput = MEDVEDEV,
  overrides: Partial<HistoricalTennisFeatureSnapshotRow> = {}
): HistoricalTennisFeatureSnapshotRow {
  return {
    id: `snapshot:${fixtureExternalId}:${generatedAt}`,
    fixture_external_id: fixtureExternalId,
    sport: "tennis",
    model_key: "tennis-surface-elo-match-winner-v1",
    generated_at: generatedAt,
    features: {
      league: { metadata: { source: "tennis-data-xlsx", surface } },
      homeTeam: { name: home.name, externalId: home.externalId, metadata: { source: "tennis-data-xlsx" } },
      awayTeam: { name: away.name, externalId: away.externalId, metadata: { source: "tennis-data-xlsx" } },
      homeFeatures: sideFeature(home, surface),
      awayFeatures: sideFeature(away, surface)
    },
    split: "train",
    source: "tennis_data_xlsx",
    feature_hash: `hash:${fixtureExternalId}`,
    ...overrides
  };
}

describe("historical tennis strength", () => {
  it("matches initial-surname and full-name player identities", () => {
    expect(canonicalTennisPlayerKey("Fritz T.")).toBe(canonicalTennisPlayerKey("Taylor Fritz"));
    expect(canonicalTennisPlayerKey("tennis-data:atp:player:fritz-t")).toBe(canonicalTennisPlayerKey("T. Fritz"));
    expect(canonicalTennisPlayerKey("Auger-Aliassime F.")).toBe(canonicalTennisPlayerKey("Felix Auger Aliassime"));
    expect(tennisPlayerAliasKeys("Facundo Diaz Acosta")).toContain("diaz-acosta:f");
  });

  it("canonicalizes supported court surfaces", () => {
    expect(canonicalTennisSurface("Outdoor Hard Court")).toBe("hard");
    expect(canonicalTennisSurface("Indoor Hard")).toBe("indoor");
    expect(canonicalTennisSurface("Clay")).toBe("clay");
    expect(canonicalTennisSurface("Grass")).toBe("grass");
  });

  it("is deterministic and selects latest overall plus latest surface state", () => {
    const fixtures = [
      fixture("hard-old", "2025-01-10T12:00:00.000Z", "hard"),
      fixture("clay-new", "2025-04-15T12:00:00.000Z", "clay")
    ];
    const snapshots = [
      snapshot("hard-old", "2026-07-02T00:00:00.000Z", "hard", { ...FRITZ, rawElo: 2250 }),
      snapshot("clay-new", "2026-07-01T00:00:00.000Z", "clay", { ...FRITZ, rawElo: 2340, restDays: 5 })
    ];

    const ordered = buildHistoricalTennisStrength(fixtures, snapshots);
    const reversed = buildHistoricalTennisStrength([...fixtures].reverse(), [...snapshots].reverse());
    expect([...reversed.entries()]).toEqual([...ordered.entries()]);

    const overall = getHistoricalTennisStrength(ordered, "Taylor Fritz");
    const hard = getHistoricalTennisStrength(ordered, "Fritz T.", "hard");
    const clay = getHistoricalTennisStrength(ordered, "T. Fritz", "clay");
    expect(overall).toMatchObject({ rawElo: 2340, restDays: 5, sampleSize: 2, asOf: "2025-04-15T12:00:00.000Z" });
    expect(hard).toMatchObject({ rawElo: 2250, scope: "surface", surface: "hard", sampleSize: 1 });
    expect(clay).toMatchObject({ rawElo: 2340, scope: "surface", surface: "clay", sampleSize: 1 });
  });

  it("honors a strict pre-match cutoff", () => {
    const fixtures = [
      fixture("before", "2025-01-10T12:00:00.000Z", "hard"),
      fixture("after", "2025-02-10T12:00:00.000Z", "hard")
    ];
    const strengths = buildHistoricalTennisStrength(
      fixtures,
      [
        snapshot("before", "2026-07-01T00:00:00.000Z", "hard", { ...FRITZ, rawElo: 2200 }),
        snapshot("after", "2026-07-01T00:00:00.000Z", "hard", { ...FRITZ, rawElo: 2400 })
      ],
      { beforeKickoff: "2025-02-01T00:00:00.000Z" }
    );

    expect(getHistoricalTennisStrength(strengths, "Taylor Fritz")?.rawElo).toBe(2200);
    expect(getHistoricalTennisStrength(strengths, "Taylor Fritz")?.sampleSize).toBe(1);
  });

  it("excludes non-real fixtures, feature metadata, sports, and sources", () => {
    const fixtures = [
      fixture("real", "2025-03-01T12:00:00.000Z", "hard"),
      fixture("demo-row", "2025-03-02T12:00:00.000Z", "hard"),
      fixture("metadata-row", "2025-03-03T12:00:00.000Z", "hard", { metadata: { sourceKind: "demo", surface: "hard" } })
    ];
    const invalidFeature = snapshot("real", "2026-07-02T00:00:00.000Z", "hard", {
      ...FRITZ,
      rawElo: 2440,
      metadata: { synthetic: true }
    });
    const strengths = buildHistoricalTennisStrength(fixtures, [
      snapshot("real", "2026-07-01T00:00:00.000Z", "hard"),
      snapshot("demo-row", "2026-07-01T00:00:00.000Z", "hard"),
      snapshot("metadata-row", "2026-07-01T00:00:00.000Z", "hard"),
      invalidFeature,
      { ...snapshot("real", "2026-07-03T00:00:00.000Z", "hard"), sport: "football" },
      { ...snapshot("real", "2026-07-04T00:00:00.000Z", "hard"), source: "mock_provider" }
    ]);

    expect([...strengths.keys()]).toEqual(["fritz:t", "medvedev:d"]);
    expect(getHistoricalTennisStrength(strengths, "Taylor Fritz")?.rawElo).toBe(FRITZ.rawElo);
  });

  it("bounds live model ratings while preserving explicit provenance", () => {
    expect(tennisModelRatingFromElo(-1000)).toBe(60);
    expect(tennisModelRatingFromElo(9000)).toBe(100);
    const strengths = buildHistoricalTennisStrength(
      [fixture("provenance", "2025-05-01T12:00:00.000Z", "grass")],
      [snapshot("provenance", "2026-07-01T00:00:00.000Z", "grass")]
    );
    const rating = getHistoricalTennisStrength(strengths, "Taylor Fritz", "grass");

    expect(rating?.modelRating).toBeGreaterThanOrEqual(60);
    expect(rating?.modelRating).toBeLessThanOrEqual(100);
    expect(rating?.source).toBe("tennis_data_xlsx");
    expect(rating?.provenance).toMatchObject({ fixtureExternalId: "provenance", fixtureProvider: "tennis_data_xlsx", side: "home" });
  });

  it("returns an empty map when the OddsPadi Supabase runtime is unavailable", async () => {
    clearHistoricalTennisStrengthCache();
    await expect(loadHistoricalTennisStrength({})).resolves.toEqual(new Map());
    clearHistoricalTennisStrengthCache();
  });
});
