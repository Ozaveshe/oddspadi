import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { Match, ValueEdge } from "@/lib/sports/types";
import { buildCanonicalDecision } from "@/lib/sports/prediction/canonicalDecision";
import { normalizeCanonicalFixture, normalizeOddsSnapshots } from "@/lib/sports/intelligence/canonical";
import { persistFixturesAndOdds } from "@/lib/sports/intelligence/repository";
import type { CanonicalOddsSnapshot } from "@/lib/sports/intelligence/types";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const HOME_OBSERVED_AT = "2026-07-19T11:56:00.000Z";

async function mixedBookMatch(): Promise<Match> {
  const [base] = await mockSportsDataProvider.getFixtures("2026-07-19", "football");
  if (!base) throw new Error("Test fixture is unavailable.");
  return {
    ...base,
    id: "api-football:provenance-1",
    kickoffTime: "2026-07-19T18:00:00.000Z",
    status: "scheduled",
    dataQualityScore: 0.9,
    oddsMarkets: [{
      id: "match_winner",
      name: "Match winner",
      priceMethod: "best-price-per-selection-v1",
      selections: [
        { id: "home", label: "Home", decimalOdds: 2.2, bookmaker: { id: "book-a", name: "Book A" }, observedAt: HOME_OBSERVED_AT },
        { id: "draw", label: "Draw", decimalOdds: 3.5, bookmaker: { id: "book-c", name: "Book C" }, observedAt: "2026-07-19T11:58:00.000Z" },
        { id: "away", label: "Away", decimalOdds: 3.4, bookmaker: { id: "book-b", name: "Book B" }, observedAt: "2026-07-19T11:57:00.000Z" }
      ],
      consensus: {
        method: "median-no-vig-v1",
        bookmakerCount: 3,
        probabilities: { home: 0.45, draw: 0.27, away: 0.28 },
        averageMargin: 0.06,
        maxProbabilitySpread: 0.04
      }
    }],
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "provenance-1",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-provenance-1",
      oddsCapturedAt: "2026-07-19T11:50:00.000Z",
      fetchedAt: "2026-07-19T11:59:00.000Z",
      season: "2026"
    }
  };
}

function bestPriceEdge(overrides: Partial<ValueEdge> = {}): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home",
    modelProbability: 0.6,
    rawImpliedProbability: 1 / 2.2,
    noVigImpliedProbability: 0.45,
    impliedProbability: 0.45,
    bookmakerMargin: 0.06,
    edge: 0.15,
    expectedValue: 0.32,
    expectedRoi: 0.32,
    odds: 2.2,
    bookmaker: { id: "book-a", name: "Book A" },
    priceObservedAt: HOME_OBSERVED_AT,
    priceMethod: "best-price-per-selection-v1",
    consensusBookmakerCount: 3,
    consensusMaxProbabilitySpread: 0.04,
    confidence: "high",
    risk: "medium",
    ...overrides
  };
}

function canonicalSummary(match: Match, snapshots: CanonicalOddsSnapshot[], edge = bestPriceEdge()) {
  return buildCanonicalDecision(
    match,
    snapshots,
    {
      valueEdges: [edge],
      diagnostics: { dataQualityScore: match.dataQualityScore },
      generatedAt: NOW.toISOString()
    },
    [],
    { now: NOW }
  );
}

function persistenceClient(insertedOdds: Array<Record<string, unknown>>): SupabaseClient {
  return {
    from(table: string) {
      if (table === "op_leagues" || table === "op_teams") {
        return { upsert: async () => ({ data: null, error: null }) };
      }
      if (table === "op_fixtures") {
        return {
          upsert: (rows: Array<Record<string, unknown>>) => ({
            select: async () => ({
              data: rows.map((row) => ({ id: "db-fixture-1", external_id: row.external_id })),
              error: null
            })
          })
        };
      }
      if (table === "op_odds_snapshots") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            insertedOdds.push(...rows);
            return {
              select: async () => ({
                data: rows.map((row) => ({
                  id: `odds-${String(row.selection)}`,
                  market: row.market,
                  selection: row.selection,
                  captured_at: row.captured_at
                })),
                error: null
              })
            };
          }
        };
      }
      throw new Error(`Unexpected test table: ${table}`);
    }
  } as unknown as SupabaseClient;
}

describe("canonical odds provenance", () => {
  it("retains a mixed-book best price's exact bookmaker ID and quote time through normalization and persistence", async () => {
    const match = await mixedBookMatch();
    const fixture = normalizeCanonicalFixture(match, NOW);
    const normalized = normalizeOddsSnapshots(match, NOW);
    const home = normalized.find((snapshot) => snapshot.selection === "home");
    const away = normalized.find((snapshot) => snapshot.selection === "away");

    expect(home).toMatchObject({
      bookmaker: "Book A",
      bookmakerId: "book-a",
      priceMethod: "best-price-per-selection-v1",
      capturedAt: HOME_OBSERVED_AT
    });
    expect(away).toMatchObject({ bookmaker: "Book B", bookmakerId: "book-b", capturedAt: "2026-07-19T11:57:00.000Z" });

    const insertedOdds: Array<Record<string, unknown>> = [];
    const persisted = await persistFixturesAndOdds({
      matches: [match],
      fixtures: [fixture],
      oddsByFixture: new Map([[match.id, normalized]]),
      client: persistenceClient(insertedOdds)
    });
    const storedHome = insertedOdds.find((row) => row.selection === "home");
    expect(storedHome).toMatchObject({
      bookmaker: "Book A",
      observed_at: HOME_OBSERVED_AT,
      captured_at: HOME_OBSERVED_AT,
      metadata: {
        label: "Home",
        bookmakerId: "book-a",
        priceMethod: "best-price-per-selection-v1"
      }
    });

    const persistedSnapshots = persisted.oddsByFixture.get(match.id) ?? [];
    expect(persistedSnapshots.find((snapshot) => snapshot.selection === "home")?.oddsSnapshotId).toBe("odds-home");
    const summary = canonicalSummary(match, persistedSnapshots);
    expect(summary.publicStatus).toBe("value_pick");
    expect(summary.bestPublishedPick).toMatchObject({
      publicationEligible: true,
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: HOME_OBSERVED_AT,
      oddsCapturedAt: HOME_OBSERVED_AT
    });
  });

  it("keeps best-price candidates blocked when canonical method, source, or timestamp evidence is missing or mismatched", async () => {
    const match = await mixedBookMatch();
    const normalized = normalizeOddsSnapshots(match, NOW);
    const missingEvidence = normalized.map((snapshot) => snapshot.selection === "home"
      ? { ...snapshot, bookmakerId: null, priceMethod: undefined }
      : snapshot);
    const missingSummary = canonicalSummary(match, missingEvidence);
    expect(missingSummary.publicStatus).toBe("watchlist");
    expect(missingSummary.bestPublishedPick).toBeNull();
    expect(missingSummary.bestWatchlistCandidate?.blockers).toEqual(expect.arrayContaining([
      "best-price method is missing or mismatched on the canonical odds snapshot",
      "best-price source does not match the canonical bookmaker snapshot"
    ]));

    const mismatchedEvidence = normalized.map((snapshot) => snapshot.selection === "home"
      ? { ...snapshot, bookmakerId: "book-z", capturedAt: "2026-07-19T11:55:00.000Z" }
      : snapshot);
    const mismatchedSummary = canonicalSummary(match, mismatchedEvidence);
    expect(mismatchedSummary.publicStatus).toBe("watchlist");
    expect(mismatchedSummary.bestWatchlistCandidate?.blockers).toEqual(expect.arrayContaining([
      "best-price source does not match the canonical bookmaker snapshot",
      "best-price timestamp is missing, mismatched, or ahead of the decision clock"
    ]));
  });
});
