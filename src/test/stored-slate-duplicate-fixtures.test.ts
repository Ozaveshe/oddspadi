import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStoredSlate } from "@/lib/sports/intelligence/repository";

/**
 * `op_fixtures` is keyed on `(provider, sport, external_id)`, so one real match
 * held by two providers is two rows and the board counts it twice. Measured
 * 2026-08-03: 200 such groups, and in 39 of them every stored bookmaker sat on
 * the row a naive exclusion would drop — `api-football | Nashville SC vs Atlanta
 * United` carried no prices at all while its Odds API twin carried six.
 */
const now = new Date("2026-08-03T12:00:00.000Z");
const syncedAt = "2026-08-03T11:45:00.000Z";

function fixtureRow(overrides: Record<string, unknown>) {
  return {
    id: "fixture-canonical",
    sport: "football",
    provider: "api-football",
    external_id: "api-football:1493040",
    provider_fixture_id: "api-football:1493040",
    league_external_id: "api-football:128",
    league_name: "Liga Profesional Argentina",
    season: 2026,
    kickoff_at: "2026-08-03T15:00:00.000Z",
    status: "scheduled",
    home_team_external_id: "api-football:1",
    away_team_external_id: "api-football:2",
    home_team_name: "Lanus",
    away_team_name: "Instituto Cordoba",
    home_score: null,
    away_score: null,
    country: "Argentina",
    data_quality: "complete",
    last_synced_at: syncedAt,
    metadata: {},
    ...overrides
  };
}

function oddsRow(fixtureId: string, externalId: string, selection: string, decimalOdds: number) {
  return {
    id: `odds-${fixtureId}-${selection}`,
    fixture_id: fixtureId,
    fixture_external_id: externalId,
    provider: "the-odds-api",
    bookmaker: "pinnacle",
    market: "1x2",
    selection,
    decimal_odds: decimalOdds,
    captured_at: "2026-08-03T11:50:00.000Z",
    source: "the-odds-api",
    is_live: false,
    expires_at: "2026-08-03T15:00:00.000Z",
    metadata: { label: selection }
  };
}

function stubClient(tables: Record<string, unknown[]>, rpc: ReturnType<typeof vi.fn>) {
  const builder = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      data: rows,
      error: null,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null })
    };
    for (const method of ["select", "gte", "lt", "in", "is", "order", "limit", "eq"]) chain[method] = () => chain;
    return chain;
  };
  return { from: (table: string) => builder(tables[table] ?? []), rpc } as unknown as SupabaseClient;
}

async function slateFor(fixtures: unknown[], rpc: ReturnType<typeof vi.fn>) {
  return readStoredSlate({
    scope: "daily",
    from: "2026-08-03T00:00:00.000Z",
    toExclusive: "2026-08-04T00:00:00.000Z",
    jobTypes: ["run-daily-engine"],
    client: stubClient(
      {
        op_fixtures: fixtures,
        op_market_decisions: [],
        op_fixture_decision_summaries: [],
        op_teams: [],
        op_leagues: [],
        op_provider_ingestion_runs: []
      },
      rpc
    ),
    now,
    maxFixtureAgeMs: 6 * 60 * 60 * 1000
  });
}

const oddsOnlyTwin = fixtureRow({
  id: "fixture-duplicate",
  provider: "the-odds-api-events",
  external_id: "the-odds-api:25b07fc0",
  provider_fixture_id: "the-odds-api:25b07fc0",
  league_name: "Primera División - Argentina",
  home_team_external_id: "the-odds-api:lanus",
  away_team_external_id: "the-odds-api:instituto",
  away_team_name: "Instituto de Córdoba"
});

describe("stored slate cross-provider duplicates", () => {
  it("publishes one fixture for a match two providers both stored", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    const slate = await slateFor([oddsOnlyTwin, fixtureRow({})], rpc);

    expect(slate?.fixtures).toHaveLength(1);
    expect(slate?.fixtures[0].fixture.provider).toBe("api-football");
  });

  it("keeps the dropped row's prices by reading its odds and attributing them to the canonical fixture", async () => {
    const rpc = vi.fn(async (_name: string, _args: { p_fixture_ids: string[] }) => ({
      data: [oddsRow("fixture-duplicate", "the-odds-api:25b07fc0", "home", 2.35)],
      error: null
    }));

    const slate = await slateFor([oddsOnlyTwin, fixtureRow({})], rpc);

    // The odds read must still cover the duplicate, or its prices are unreachable.
    expect(rpc.mock.calls[0][1].p_fixture_ids).toEqual(expect.arrayContaining(["fixture-canonical", "fixture-duplicate"]));
    const canonical = slate?.fixtures.find((entry) => entry.fixture.provider === "api-football");
    expect(canonical?.odds.find((price) => price.selection === "home")?.decimalOdds).toBe(2.35);
    // Provenance is not rewritten: the price still says which book quoted it.
    expect(canonical?.odds.find((price) => price.selection === "home")?.bookmaker).toBe("pinnacle");
  });

  it("says how many rows it merged away rather than silently shrinking the board", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    const slate = await slateFor([oddsOnlyTwin, fixtureRow({})], rpc);

    expect(slate?.provider.errors.some((entry) => entry.includes("duplicate"))).toBe(true);
  });

  it("leaves two genuinely different matches at one kickoff alone", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    const otherMatch = fixtureRow({
      id: "fixture-other",
      provider: "the-odds-api-events",
      external_id: "the-odds-api:other",
      home_team_name: "Boca Juniors",
      away_team_name: "River Plate"
    });

    const slate = await slateFor([otherMatch, fixtureRow({})], rpc);

    expect(slate?.fixtures).toHaveLength(2);
  });
});
