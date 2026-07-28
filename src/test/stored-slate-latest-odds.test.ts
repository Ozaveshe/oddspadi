import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStoredSlate } from "@/lib/sports/intelligence/repository";

const now = new Date("2026-07-28T12:00:00.000Z");
const syncedAt = "2026-07-28T11:45:00.000Z";

function fixtureRow(id: string, externalId: string) {
  return {
    id,
    sport: "football",
    provider: "api-football",
    external_id: externalId,
    provider_fixture_id: externalId,
    league_external_id: "api-football:39",
    league_name: "Premier League",
    season: 2026,
    kickoff_at: "2026-07-28T15:00:00.000Z",
    status: "scheduled",
    home_team_external_id: "api-football:1",
    away_team_external_id: "api-football:2",
    home_team_name: "Home",
    away_team_name: "Away",
    home_score: null,
    away_score: null,
    country: "England",
    data_quality: "complete",
    last_synced_at: syncedAt,
    metadata: {}
  };
}

function oddsRow(fixtureId: string, externalId: string, selection: string, decimalOdds: number, capturedAt: string) {
  return {
    id: `odds-${fixtureId}-${selection}-${capturedAt}`,
    fixture_id: fixtureId,
    fixture_external_id: externalId,
    provider: "the-odds-api",
    bookmaker: "book",
    market: "1x2",
    selection,
    decimal_odds: decimalOdds,
    captured_at: capturedAt,
    source: "the-odds-api",
    is_live: false,
    expires_at: "2026-07-28T15:00:00.000Z",
    metadata: { label: selection }
  };
}

/**
 * Minimal PostgREST stand-in: every builder method returns `this`, and the
 * builder resolves to whatever rows the table was seeded with.
 */
function stubClient(tables: Record<string, unknown[]>, rpc: ReturnType<typeof vi.fn>) {
  const builder = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      data: rows,
      error: null,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null })
    };
    for (const method of ["select", "gte", "lt", "in", "is", "order", "limit", "eq"]) {
      chain[method] = () => chain;
    }
    return chain;
  };
  return {
    from: (table: string) => builder(tables[table] ?? []),
    rpc
  } as unknown as SupabaseClient;
}

describe("stored slate odds read", () => {
  it("sources odds from the de-duplicating RPC and keeps the newest price per selection", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        oddsRow("fixture-a", "api-football:9001", "home", 2.1, "2026-07-28T11:50:00.000Z"),
        oddsRow("fixture-b", "api-football:9002", "home", 3.4, "2026-07-28T11:55:00.000Z")
      ],
      error: null
    }));

    const client = stubClient(
      {
        op_fixtures: [fixtureRow("fixture-a", "api-football:9001"), fixtureRow("fixture-b", "api-football:9002")],
        op_market_decisions: [],
        op_fixture_decision_summaries: [],
        op_teams: [],
        op_leagues: [],
        op_provider_ingestion_runs: []
      },
      rpc
    );

    const slate = await readStoredSlate({
      scope: "daily",
      from: "2026-07-28T00:00:00.000Z",
      toExclusive: "2026-07-29T00:00:00.000Z",
      jobTypes: ["run-daily-engine"],
      client,
      now,
      maxFixtureAgeMs: 6 * 60 * 60 * 1000
    });

    expect(rpc).toHaveBeenCalledWith("op_latest_odds_for_fixtures", {
      p_fixture_ids: ["fixture-a", "fixture-b"]
    });
    // Both fixtures keep their odds: the old query capped by capture time and
    // could drop a fixture's prices entirely.
    expect(slate?.fixtures).toHaveLength(2);
  });

  it("prefers the newer snapshot when one external fixture id appears twice", async () => {
    // Two provider rows can share an external id, so the RPC's per-fixture_id
    // de-duplication is not enough on its own.
    const rpc = vi.fn(async () => ({
      data: [
        oddsRow("fixture-a", "api-football:9001", "home", 2.1, "2026-07-28T11:00:00.000Z"),
        oddsRow("fixture-b", "api-football:9001", "home", 4.9, "2026-07-28T11:58:00.000Z")
      ],
      error: null
    }));

    const client = stubClient(
      {
        op_fixtures: [fixtureRow("fixture-a", "api-football:9001")],
        op_market_decisions: [],
        op_fixture_decision_summaries: [],
        op_teams: [],
        op_leagues: [],
        op_provider_ingestion_runs: []
      },
      rpc
    );

    const slate = await readStoredSlate({
      scope: "daily",
      from: "2026-07-28T00:00:00.000Z",
      toExclusive: "2026-07-29T00:00:00.000Z",
      jobTypes: ["run-daily-engine"],
      client,
      now,
      maxFixtureAgeMs: 6 * 60 * 60 * 1000
    });

    const prices = slate?.fixtures?.[0]?.odds ?? [];
    expect(prices.find((price) => price.selection === "home")?.decimalOdds).toBe(4.9);
  });
});
