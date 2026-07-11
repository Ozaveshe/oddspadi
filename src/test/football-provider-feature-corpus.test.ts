import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getMaterializer } from "@/app/api/sports/decision/training/football-provider-feature-materializer/route";
import { GET as getStorageReceipt } from "@/app/api/sports/decision/training/football-provider-feature-storage-receipt/route";
import { materializeFootballProviderCorpus } from "@/lib/sports/training/footballProviderFeatureCorpusRequest";
import {
  extractStoredFootballProviderFixtures,
  type FootballProviderCorpusSource,
  type RawProviderPayloadRow
} from "@/lib/sports/training/footballProviderFeatureCorpusRepository";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";

function fixture(externalId: string, kickoffAt: string, season = "2025"): HistoricalFootballFixtureInput {
  return {
    sport: "football",
    externalId,
    kickoffAt,
    season,
    status: "finished",
    league: { externalId: "api-football:39", name: "Premier League", country: "England" },
    homeTeam: { externalId: `${externalId}:home`, name: "Home FC" },
    awayTeam: { externalId: `${externalId}:away`, name: "Away FC" },
    homeScore: 2,
    awayScore: 1,
    homeFeatures: { eloRating: 1580, attackStrength: 1.12, defenseStrength: 0.93, injuriesCount: 1 },
    awayFeatures: { eloRating: 1490, attackStrength: 0.98, defenseStrength: 1.07 },
    odds: [
      { market: "match_winner", selection: "home", decimalOdds: 2.05, bookmaker: "provider-book" },
      { market: "match_winner", selection: "draw", decimalOdds: 3.35, bookmaker: "provider-book" },
      { market: "match_winner", selection: "away", decimalOdds: 3.9, bookmaker: "provider-book" }
    ],
    standings: [],
    availability: [{ teamExternalId: `${externalId}:home`, playerName: "Home Starter", status: "injured" }],
    lineups: [],
    events: [],
    news: [],
    weather: []
  };
}

function rawRow(
  id: string,
  fixtures: unknown[] | null,
  observedAt: string,
  ingestionRunId = `ingestion-${id}`
): RawProviderPayloadRow {
  return {
    id,
    ingestion_run_id: ingestionRunId,
    provider: "api_football",
    payload_hash: `hash-${id}`,
    observed_at: observedAt,
    payload: fixtures ? { sourceKind: "real", fixtures } : { sourceKind: "real", fixtureCount: 800 }
  };
}

function source(fixtures: number): FootballProviderCorpusSource {
  return {
    kind: "supabase-raw-provider-payload",
    provider: "api_football",
    batchRows: 1,
    materializedBatches: 1,
    compactBatchesSkipped: 0,
    candidateFixtures: fixtures,
    duplicateFixtures: 0,
    invalidFixtures: 0,
    rawPayloadLinkedFixtures: fixtures,
    fixtureLimit: 25,
    batchIds: ["raw-1"],
    ingestionRunIds: ["ingestion-1"],
    payloadHashes: ["hash-1"]
  };
}

describe("stored football provider feature corpus", () => {
  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("deduplicates raw batches, rejects invalid rows, and attaches exact payload provenance", () => {
    const newest = fixture("fixture-a", "2025-08-16T14:00:00.000Z");
    const olderDuplicate = fixture("fixture-a", "2025-08-16T14:00:00.000Z");
    newest.availability = [];
    newest.events = [];
    olderDuplicate.events = [{ eventExternalId: "event-1", eventType: "goal", minute: 42 }];
    olderDuplicate.availability = [{ teamExternalId: "fixture-a:home", playerName: "Older Evidence", status: "injured" }];
    olderDuplicate.metadata = {
      providerFetchEvidence: {
        events: { attempted: true, succeeded: true, rows: 1, error: null },
        availability: { attempted: true, succeeded: true, rows: 1, error: null }
      }
    };
    const second = fixture("fixture-b", "2025-08-15T19:00:00.000Z");
    const corpus = extractStoredFootballProviderFixtures({
      rows: [
        rawRow("raw-new", [newest, { externalId: "invalid" }], "2026-07-10T10:00:00.000Z"),
        rawRow("raw-old", [olderDuplicate, second], "2026-07-09T10:00:00.000Z"),
        rawRow("raw-compact", null, "2026-07-08T10:00:00.000Z")
      ],
      provider: "api_football",
      season: "2025",
      leagueExternalId: "api-football:39",
      limit: 25
    });

    expect(corpus.fixtures.map((row) => row.externalId)).toEqual(["fixture-b", "fixture-a"]);
    expect(corpus.fixtures[1]?.metadata).toEqual(
      expect.objectContaining({
        rawPayloadId: "raw-new",
        ingestionRunId: "ingestion-raw-new",
        payloadHash: "hash-raw-new",
        rawPayloadLineage: ["raw-new", "raw-old"],
        providerFetchEvidence: expect.objectContaining({
          events: expect.objectContaining({ succeeded: true, rows: 1 })
        })
      })
    );
    expect(corpus.fixtures[1]?.events).toEqual([expect.objectContaining({ eventExternalId: "event-1" })]);
    expect(corpus.fixtures[1]?.availability).toEqual([expect.objectContaining({ playerName: "Older Evidence" })]);
    expect(corpus.source).toEqual(
      expect.objectContaining({
        batchRows: 3,
        materializedBatches: 2,
        compactBatchesSkipped: 1,
        candidateFixtures: 4,
        duplicateFixtures: 1,
        invalidFixtures: 1,
        rawPayloadLinkedFixtures: 2
      })
    );
  });

  it("uses stored provider batches by default and does not invent settlement evidence from an empty event list", async () => {
    const storedFixture = fixture("fixture-real", "2025-08-16T14:00:00.000Z");
    storedFixture.metadata = { rawPayloadId: "raw-1", ingestionRunId: "ingestion-1", payloadHash: "hash-1" };
    const reader = vi.fn(async () => ({ provider: "api_football", fixtures: [storedFixture], source: source(1) }));
    const receipt = await materializeFootballProviderCorpus({
      url: new URL(
        "http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-materializer?limit=25&batches=2&season=2025&league=api-football%3A39"
      ),
      reader
    });

    expect(reader).toHaveBeenCalledWith({
      provider: "api_football",
      limit: 25,
      batchLimit: 2,
      season: "2025",
      leagueExternalId: "api-football:39"
    });
    expect("error" in receipt).toBe(false);
    if ("error" in receipt) return;
    expect(receipt.provider).toBe("api_football");
    expect(receipt.source.kind).toBe("supabase-raw-provider-payload");
    expect(receipt.corpus.rowsPreviewed).toBe(1);
    const features = receipt.previewRows[0]?.features as { evidence?: { rawPayloadLinked?: boolean; liveAndSettlement?: boolean } } | null;
    expect(features?.evidence?.rawPayloadLinked).toBe(true);
    expect(features?.evidence?.liveAndSettlement).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
  });

  it("treats successful zero-row provider checks as evidence without inventing findings", async () => {
    const checkedFixture = fixture("fixture-checked", "2025-08-16T14:00:00.000Z");
    checkedFixture.events = [];
    checkedFixture.availability = [];
    checkedFixture.metadata = {
      rawPayloadId: "raw-1",
      ingestionRunId: "ingestion-1",
      payloadHash: "hash-1",
      providerFetchEvidence: {
        events: { attempted: true, succeeded: true, rows: 0, error: null },
        availability: { attempted: true, succeeded: true, rows: 0, error: null }
      }
    };
    const receipt = await materializeFootballProviderCorpus({
      url: new URL("http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-materializer?limit=25"),
      reader: async () => ({ provider: "api_football", fixtures: [checkedFixture], source: source(1) })
    });

    expect("error" in receipt).toBe(false);
    if ("error" in receipt) return;
    expect(checkedFixture.events).toEqual([]);
    expect(checkedFixture.availability).toEqual([]);
    expect(receipt.previewRows[0]?.features).toEqual(expect.objectContaining({
      evidence: expect.objectContaining({
        availabilityContext: true,
        liveAndSettlement: true
      }),
      contextCounts: expect.objectContaining({ availability: 0, events: 0 })
    }));
  });

  it("keeps demo data explicit and bypasses stored-corpus reads", async () => {
    const reader = vi.fn();
    const receipt = await materializeFootballProviderCorpus({
      url: new URL("http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-materializer?demo=1"),
      reader
    });

    expect(reader).not.toHaveBeenCalled();
    expect("error" in receipt).toBe(false);
    if ("error" in receipt) return;
    expect(receipt.provider).toBe("demo_provider");
    expect(receipt.source.kind).toBe("in-memory");
  });

  it("allows one bounded three-season chronology corpus", async () => {
    const storedFixture = fixture("fixture-unified", "2025-08-16T14:00:00.000Z");
    const reader = vi.fn(async () => ({ provider: "api_football", fixtures: [storedFixture], source: source(1) }));
    await materializeFootballProviderCorpus({
      url: new URL("http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-materializer?limit=9999&batches=100"),
      reader
    });

    expect(reader).toHaveBeenCalledWith(expect.objectContaining({ limit: 3000, batchLimit: 100, season: undefined }));
  });

  it("rejects unsafe materializer writes and unauthorized storage runs before corpus work", async () => {
    const materializerResponse = await getMaterializer(
      new Request("http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-materializer?dryRun=0")
    );
    expect(materializerResponse.status).toBe(400);

    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    const storageResponse = await getStorageReceipt(
      new Request("http://127.0.0.1:3025/api/sports/decision/training/football-provider-feature-storage-receipt?run=1")
    );
    expect(storageResponse.status).toBe(401);
  });
});
