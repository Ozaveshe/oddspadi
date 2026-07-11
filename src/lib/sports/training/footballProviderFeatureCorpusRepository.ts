import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { HistoricalFootballFixtureInput } from "./historicalIngestion";

export type RawProviderPayloadRow = {
  id: string;
  ingestion_run_id: string | null;
  provider: string;
  payload_hash: string | null;
  observed_at: string;
  payload: unknown;
};

export type FootballProviderCorpusSource = {
  kind: "supabase-raw-provider-payload";
  provider: string;
  batchRows: number;
  materializedBatches: number;
  compactBatchesSkipped: number;
  candidateFixtures: number;
  duplicateFixtures: number;
  invalidFixtures: number;
  rawPayloadLinkedFixtures: number;
  storedOddsFixtures?: number;
  storedOddsRows?: number;
  fixtureLimit: number;
  batchIds: string[];
  ingestionRunIds: string[];
  payloadHashes: string[];
};

type StoredOddsRow = {
  fixture_external_id: string;
  provider: string;
  bookmaker: string;
  market: string;
  selection: string;
  decimal_odds: number | string;
  is_closing: boolean;
  observed_at: string;
  metadata: Record<string, unknown> | null;
};

export type StoredFootballProviderFixtures = {
  provider: string;
  fixtures: HistoricalFootballFixtureInput[];
  source: FootballProviderCorpusSource;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isFixture(value: unknown): value is HistoricalFootballFixtureInput {
  const row = objectRecord(value);
  const league = objectRecord(row.league);
  const homeTeam = objectRecord(row.homeTeam);
  const awayTeam = objectRecord(row.awayTeam);
  const kickoffAt = cleanText(row.kickoffAt);
  return Boolean(
    cleanText(row.externalId) &&
      kickoffAt &&
      Number.isFinite(Date.parse(kickoffAt)) &&
      cleanText(league.externalId) &&
      cleanText(homeTeam.externalId) &&
      cleanText(awayTeam.externalId)
  );
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function mergeArrays<T>(newer: T[] | undefined, older: T[] | undefined): T[] | undefined {
  if (!newer && !older) return undefined;
  const values = [...(newer ?? []), ...(older ?? [])];
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeRecords<T extends object>(older: T | undefined, newer: T | undefined): T | undefined {
  if (!older && !newer) return undefined;
  return { ...(older ?? {}), ...(newer ?? {}) } as T;
}

function mergeFixtureMetadata(
  newer: HistoricalFootballFixtureInput,
  older: HistoricalFootballFixtureInput,
  olderRow: RawProviderPayloadRow
): Record<string, unknown> {
  const newerMetadata = newer.metadata ?? {};
  const olderMetadata = older.metadata ?? {};
  const newerFetch = objectRecord(newerMetadata.providerFetchEvidence);
  const olderFetch = objectRecord(olderMetadata.providerFetchEvidence);
  const rawPayloadLineage = uniqueStrings([
    ...(Array.isArray(newerMetadata.rawPayloadLineage) ? newerMetadata.rawPayloadLineage.map(cleanText) : []),
    cleanText(newerMetadata.rawPayloadId),
    olderRow.id
  ]);
  const ingestionRunLineage = uniqueStrings([
    ...(Array.isArray(newerMetadata.ingestionRunLineage) ? newerMetadata.ingestionRunLineage.map(cleanText) : []),
    cleanText(newerMetadata.ingestionRunId),
    olderRow.ingestion_run_id
  ]);
  const payloadHashLineage = uniqueStrings([
    ...(Array.isArray(newerMetadata.payloadHashLineage) ? newerMetadata.payloadHashLineage.map(cleanText) : []),
    cleanText(newerMetadata.payloadHash),
    olderRow.payload_hash
  ]);
  return {
    ...olderMetadata,
    ...newerMetadata,
    providerFetchEvidence: { ...olderFetch, ...newerFetch },
    rawPayloadLineage,
    ingestionRunLineage,
    payloadHashLineage
  };
}

function mergeDuplicateFixture(
  newer: HistoricalFootballFixtureInput,
  older: HistoricalFootballFixtureInput,
  olderRow: RawProviderPayloadRow
): HistoricalFootballFixtureInput {
  return {
    ...older,
    ...newer,
    league: { ...older.league, ...newer.league },
    homeTeam: { ...older.homeTeam, ...newer.homeTeam },
    awayTeam: { ...older.awayTeam, ...newer.awayTeam },
    homeScore: newer.homeScore ?? older.homeScore,
    awayScore: newer.awayScore ?? older.awayScore,
    homeXg: newer.homeXg ?? older.homeXg,
    awayXg: newer.awayXg ?? older.awayXg,
    dataQuality: Math.max(newer.dataQuality ?? 0, older.dataQuality ?? 0) || null,
    homeFeatures: mergeRecords(older.homeFeatures, newer.homeFeatures),
    awayFeatures: mergeRecords(older.awayFeatures, newer.awayFeatures),
    odds: mergeArrays(newer.odds, older.odds),
    events: mergeArrays(newer.events, older.events),
    news: mergeArrays(newer.news, older.news),
    standings: mergeArrays(newer.standings, older.standings),
    availability: mergeArrays(newer.availability, older.availability),
    lineups: mergeArrays(newer.lineups, older.lineups),
    weather: mergeArrays(newer.weather, older.weather),
    metadata: mergeFixtureMetadata(newer, older, olderRow)
  };
}

export function extractStoredFootballProviderFixtures({
  rows,
  provider = "api_football",
  limit = 100,
  season,
  leagueExternalId
}: {
  rows: RawProviderPayloadRow[];
  provider?: string;
  limit?: number;
  season?: string;
  leagueExternalId?: string;
}): StoredFootballProviderFixtures {
  const fixtureLimit = boundedInteger(limit, 100, 1, 3000);
  const fixtureByExternalId = new Map<string, HistoricalFootballFixtureInput>();
  let candidateFixtures = 0;
  let duplicateFixtures = 0;
  let invalidFixtures = 0;
  let compactBatchesSkipped = 0;
  let materializedBatches = 0;

  for (const row of rows) {
    const payload = objectRecord(row.payload);
    const payloadFixtures = Array.isArray(payload.fixtures) ? payload.fixtures : null;
    if (!payloadFixtures) {
      compactBatchesSkipped += 1;
      continue;
    }
    materializedBatches += 1;

    for (const value of payloadFixtures) {
      candidateFixtures += 1;
      if (!isFixture(value)) {
        invalidFixtures += 1;
        continue;
      }
      if (value.sport && value.sport !== "football") continue;
      if (season && cleanText(value.season) !== season) continue;
      if (leagueExternalId && cleanText(value.league.externalId) !== leagueExternalId) continue;
      if (value.status !== "finished" || typeof value.homeScore !== "number" || typeof value.awayScore !== "number") continue;
      const existingFixture = fixtureByExternalId.get(value.externalId);
      if (existingFixture) {
        duplicateFixtures += 1;
        fixtureByExternalId.set(value.externalId, mergeDuplicateFixture(existingFixture, value, row));
        continue;
      }

      fixtureByExternalId.set(value.externalId, {
        ...value,
        metadata: {
          ...(value.metadata ?? {}),
          rawPayloadId: row.id,
          ingestionRunId: row.ingestion_run_id,
          payloadHash: row.payload_hash,
          rawPayloadObservedAt: row.observed_at
        }
      });
    }
  }

  const fixtures = [...fixtureByExternalId.values()]
    .sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt))
    .slice(0, fixtureLimit);

  return {
    provider,
    fixtures,
    source: {
      kind: "supabase-raw-provider-payload",
      provider,
      batchRows: rows.length,
      materializedBatches,
      compactBatchesSkipped,
      candidateFixtures,
      duplicateFixtures,
      invalidFixtures,
      rawPayloadLinkedFixtures: fixtures.length,
      fixtureLimit,
      batchIds: uniqueStrings(rows.map((row) => row.id)),
      ingestionRunIds: uniqueStrings(rows.map((row) => row.ingestion_run_id)),
      payloadHashes: uniqueStrings(rows.map((row) => row.payload_hash))
    }
  };
}

export async function readStoredFootballProviderFixtures({
  provider = "api_football",
  limit = 100,
  batchLimit = 10,
  season,
  leagueExternalId
}: {
  provider?: string;
  limit?: number;
  batchLimit?: number;
  season?: string;
  leagueExternalId?: string;
} = {}): Promise<StoredFootballProviderFixtures | { error: string }> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { error: `Supabase server reads are not configured for OddsPadi. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const safeBatchLimit = boundedInteger(batchLimit, 50, 1, 1000);
  const { data, error } = await client
    .from("op_raw_provider_payloads")
    .select("id, ingestion_run_id, provider, payload_hash, observed_at, payload")
    .eq("sport", "football")
    .eq("provider", provider)
    .eq("payload_type", "historical_fixture_batch")
    .order("observed_at", { ascending: false })
    .limit(safeBatchLimit);

  if (error) return { error: error.message };
  const corpus = extractStoredFootballProviderFixtures({
    rows: (data ?? []) as RawProviderPayloadRow[],
    provider,
    limit,
    season,
    leagueExternalId
  });
  if (!corpus.fixtures.length) return corpus;

  const oddsRows: StoredOddsRow[] = [];
  const fixtureExternalIds = corpus.fixtures.map((fixture) => fixture.externalId);
  for (let index = 0; index < fixtureExternalIds.length; index += 50) {
    const chunk = fixtureExternalIds.slice(index, index + 50);
    const pageSize = 1000;
    for (let pageFrom = 0; ; pageFrom += pageSize) {
      const { data: storedOdds, error: oddsError } = await client
        .from("op_odds_snapshots")
        .select("fixture_external_id, provider, bookmaker, market, selection, decimal_odds, is_closing, observed_at, metadata")
        .eq("sport", "football")
        .eq("market", "match_winner")
        .in("fixture_external_id", chunk)
        .order("fixture_external_id", { ascending: true })
        .order("observed_at", { ascending: true })
        .order("bookmaker", { ascending: true })
        .order("selection", { ascending: true })
        .range(pageFrom, pageFrom + pageSize - 1);
      if (oddsError) return { error: oddsError.message };
      const page = (storedOdds ?? []) as StoredOddsRow[];
      oddsRows.push(...page);
      if (page.length < pageSize) break;
    }
  }

  const oddsByFixture = new Map<string, NonNullable<HistoricalFootballFixtureInput["odds"]>>();
  for (const row of oddsRows) {
    const decimalOdds = Number(row.decimal_odds);
    if (
      !Number.isFinite(decimalOdds) ||
      decimalOdds <= 1 ||
      (row.selection !== "home" && row.selection !== "draw" && row.selection !== "away")
    ) {
      continue;
    }
    oddsByFixture.set(row.fixture_external_id, [
      ...(oddsByFixture.get(row.fixture_external_id) ?? []),
      {
        bookmaker: row.bookmaker || row.provider,
        market: "match_winner",
        selection: row.selection,
        decimalOdds,
        isClosing: Boolean(row.is_closing),
        observedAt: row.observed_at,
        metadata: { ...(row.metadata ?? {}), oddsProvider: row.provider }
      }
    ]);
  }

  const fixtures = corpus.fixtures.map((fixture) => ({
    ...fixture,
    odds: [...(fixture.odds ?? []), ...(oddsByFixture.get(fixture.externalId) ?? [])]
  }));
  return {
    ...corpus,
    fixtures,
    source: {
      ...corpus.source,
      storedOddsFixtures: fixtures.filter((fixture) => (oddsByFixture.get(fixture.externalId)?.length ?? 0) > 0).length,
      storedOddsRows: oddsRows.length
    }
  };
}
