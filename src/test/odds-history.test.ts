import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OddsMovementChart } from "@/components/odds/OddsMovementChart";
import { buildOddsMovementSeries } from "@/lib/sports/intelligence/oddsHistory";
import { readFixtureOddsHistory } from "@/lib/sports/intelligence/repository";
import type { CanonicalOddsSnapshot } from "@/lib/sports/intelligence/types";

function clientResult(data: Array<Record<string, unknown>>, error: { message: string } | null = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(async () => ({ data, error }));
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  return { client, query };
}

function snapshot(overrides: Partial<CanonicalOddsSnapshot>): CanonicalOddsSnapshot {
  return {
    oddsSnapshotId: null,
    fixtureId: "api-football:9001",
    market: "match_winner",
    selection: "home",
    label: "Home",
    decimalOdds: 2,
    bookmaker: "Book A",
    provider: "the-odds-api",
    capturedAt: "2026-07-14T09:00:00.000Z",
    source: "the-odds-api",
    isLive: false,
    expiresAt: "2026-07-14T10:00:00.000Z",
    ...overrides
  };
}

describe("fixture odds history", () => {
  it("reads only valid real pre-match snapshots and preserves chronological order", async () => {
    const { client, query } = clientResult([
      {
        id: "odds-2", fixture_external_id: "api-football:9001", provider: "the-odds-api", bookmaker: "Book A",
        market: "match_winner", selection: "home", decimal_odds: 1.84, captured_at: "2026-07-14T10:00:00.000Z",
        observed_at: "2026-07-14T10:02:00.000Z", source: "the-odds-api", is_live: false,
        expires_at: "2026-07-14T11:00:00.000Z",
        metadata: { label: "Home", bookmakerId: "book-a", priceMethod: "best-price-per-selection-v1" }
      },
      {
        id: "odds-1", fixture_external_id: "api-football:9001", provider: "the-odds-api", bookmaker: "Book A",
        market: "match_winner", selection: "home", decimal_odds: 2.05, captured_at: "2026-07-14T08:00:00.000Z",
        source: "the-odds-api", is_live: false, expires_at: "2026-07-14T09:00:00.000Z", metadata: { label: "Home" }
      },
      {
        id: "mock-1", fixture_external_id: "api-football:9001", provider: "mock-odds", bookmaker: "Demo",
        market: "match_winner", selection: "away", decimal_odds: 3.2, captured_at: "2026-07-14T08:00:00.000Z",
        source: "mock", is_live: false, expires_at: null, metadata: { sourceKind: "mock" }
      }
    ]);

    const result = await readFixtureOddsHistory("api-football:9001", client);

    expect(result.status).toBe("ready");
    expect(result.rowsRead).toBe(2);
    expect(result.snapshots.map((row) => row.decimalOdds)).toEqual([2.05, 1.84]);
    expect(result.snapshots[0]).toMatchObject({ bookmakerId: null, capturedAt: "2026-07-14T08:00:00.000Z" });
    expect(result.snapshots[0]?.priceMethod).toBeUndefined();
    expect(result.snapshots[1]).toMatchObject({
      bookmakerId: "book-a",
      priceMethod: "best-price-per-selection-v1",
      capturedAt: "2026-07-14T10:02:00.000Z"
    });
    expect(query.eq).toHaveBeenCalledWith("fixture_external_id", "api-football:9001");
    expect(query.eq).toHaveBeenCalledWith("is_live", false);
  });

  it("aggregates concurrent bookmaker quotes by median without inventing missing capture times", () => {
    const series = buildOddsMovementSeries([
      snapshot({ decimalOdds: 2, bookmaker: "Book A" }),
      snapshot({ decimalOdds: 2.2, bookmaker: "Book B" }),
      snapshot({ decimalOdds: 1.8, bookmaker: "Book A", capturedAt: "2026-07-14T10:00:00.000Z" }),
      snapshot({ selection: "away", label: "Away", decimalOdds: 3.4 }),
      snapshot({ selection: "away", label: "Away", decimalOdds: 3.7, capturedAt: "2026-07-14T10:00:00.000Z" }),
      snapshot({ selection: "draw", label: "Draw", decimalOdds: 3.1, isLive: true })
    ], "match_winner");

    expect(series.map((row) => row.selection)).toEqual(["home", "away"]);
    expect(series[0]?.points).toEqual([
      { capturedAt: "2026-07-14T09:00:00.000Z", decimalOdds: 2.1, bookmakerCount: 2 },
      { capturedAt: "2026-07-14T10:00:00.000Z", decimalOdds: 1.8, bookmakerCount: 1 }
    ]);
    expect(series[0]?.movement).toBeCloseTo(-0.3);
  });

  it("keeps unavailable, empty, and failed storage states distinct", async () => {
    await expect(readFixtureOddsHistory("api-football:9001", null)).resolves.toMatchObject({ status: "unavailable", rowsRead: 0 });
    await expect(readFixtureOddsHistory("api-football:9001", clientResult([]).client)).resolves.toMatchObject({ status: "no-data", rowsRead: 0 });
    await expect(readFixtureOddsHistory("api-football:9001", clientResult([], { message: "relation missing" }).client)).resolves.toMatchObject({ status: "failed", reason: expect.stringContaining("relation missing") });
  });

  it("server-renders a populated accessible movement chart from verified snapshots", () => {
    const html = renderToStaticMarkup(createElement(OddsMovementChart, {
      history: {
        status: "ready",
        snapshots: [
          snapshot({ decimalOdds: 2.05, capturedAt: "2026-07-14T08:00:00.000Z" }),
          snapshot({ decimalOdds: 1.84, capturedAt: "2026-07-14T10:00:00.000Z" }),
          snapshot({ selection: "draw", label: "Draw", decimalOdds: 3.25, capturedAt: "2026-07-14T08:00:00.000Z" }),
          snapshot({ selection: "draw", label: "Draw", decimalOdds: 3.4, capturedAt: "2026-07-14T10:00:00.000Z" })
        ],
        rowsRead: 4,
        truncated: false,
        reason: null
      },
      market: "match_winner",
      marketLabel: "Match Winner"
    }));

    expect(html).toContain("Verified price tape");
    expect(html).toContain('role="img"');
    expect(html).toContain("Match Winner decimal odds movement");
    expect(html).toContain("2.05");
    expect(html).toContain("1.84");
    expect(html).toContain("shortened 0.21");
  });
});
