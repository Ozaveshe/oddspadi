import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { freshestOddsPerSelection } from "@/lib/sports/intelligence/pipeline";
import { readFreshStoredOdds } from "@/lib/sports/intelligence/repository";
import type { CanonicalOddsSnapshot } from "@/lib/sports/intelligence/types";

function clientResult(data: Array<Record<string, unknown>>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gt = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(async () => ({ data, error: null }));
  return { client: { from: vi.fn(() => query) } as unknown as SupabaseClient, query };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "odds-1",
    fixture_external_id: "api-football:1",
    provider: "the-odds-api",
    bookmaker: "Pinnacle",
    market: "match_winner",
    selection: "home",
    decimal_odds: 2.1,
    observed_at: "2026-07-19T11:55:00.000Z",
    captured_at: "2026-07-19T11:55:00.000Z",
    source: "the-odds-api",
    is_live: false,
    expires_at: "2026-07-19T12:25:00.000Z",
    metadata: { bookmakerId: "pinnacle", priceMethod: "best-price-per-selection-v1" },
    ...overrides
  };
}

describe("fresh stored bookmaker odds", () => {
  it("returns only the newest still-valid quote with complete bookmaker provenance", async () => {
    const { client, query } = clientResult([
      row(),
      row({ id: "older", decimal_odds: 2, observed_at: "2026-07-19T11:50:00.000Z", captured_at: "2026-07-19T11:50:00.000Z" }),
      row({ id: "missing-book", selection: "away", metadata: {} }),
      row({ id: "other-fixture", fixture_external_id: "api-football:2" })
    ]);
    const result = await readFreshStoredOdds({
      fixtureExternalIds: ["api-football:1"],
      now: new Date("2026-07-19T12:00:00.000Z"),
      client
    });

    expect(result.status).toBe("ready");
    expect(result.rowsRead).toBe(1);
    expect(result.oddsByFixture.get("api-football:1")?.[0]).toMatchObject({
      oddsSnapshotId: "odds-1",
      bookmaker: "Pinnacle",
      bookmakerId: "pinnacle",
      decimalOdds: 2.1
    });
    expect(query.gt).toHaveBeenCalledWith("expires_at", "2026-07-19T12:00:00.000Z");
  });

  it("fails closed when storage is unavailable", async () => {
    const result = await readFreshStoredOdds({
      fixtureExternalIds: ["api-football:1"],
      now: new Date("2026-07-19T12:00:00.000Z"),
      client: null
    });
    expect(result.status).toBe("unavailable");
    expect(result.oddsByFixture.size).toBe(0);
  });

  it("fills missing selections from storage without replacing a newer current quote", () => {
    const snapshot = (selection: string, capturedAt: string, decimalOdds: number): CanonicalOddsSnapshot => ({
      oddsSnapshotId: `${selection}-${capturedAt}`,
      fixtureId: "api-football:1",
      market: "match_winner",
      selection,
      label: selection,
      decimalOdds,
      bookmaker: "Pinnacle",
      bookmakerId: "pinnacle",
      priceMethod: "best-price-per-selection-v1",
      provider: "the-odds-api",
      capturedAt,
      source: "the-odds-api",
      isLive: false,
      expiresAt: "2026-07-19T12:25:00.000Z"
    });
    const current = new Map([["api-football:1", [snapshot("home", "2026-07-19T11:58:00.000Z", 2.2)]]]);
    const stored = new Map([["api-football:1", [
      snapshot("home", "2026-07-19T11:55:00.000Z", 2.1),
      snapshot("away", "2026-07-19T11:56:00.000Z", 3.4)
    ]]]);

    const merged = freshestOddsPerSelection(current, stored);
    expect(merged.oddsByFixture.get("api-football:1")).toEqual([
      expect.objectContaining({ selection: "home", decimalOdds: 2.2 }),
      expect.objectContaining({ selection: "away", decimalOdds: 3.4 })
    ]);
    expect(merged.reusedStoredSnapshots).toBe(1);
    expect(merged.reusedStoredFixtures).toBe(1);
  });
});
