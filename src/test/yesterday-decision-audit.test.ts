import { describe, expect, it, vi } from "vitest";

const getDailySlate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/intelligence/pipeline", () => ({
  getDailySlate,
  getWeeklySlate: vi.fn()
}));
vi.mock("@/lib/sports/prediction/history", () => ({
  getHistorySummary: vi.fn(),
  getPublicPredictionHistory: vi.fn()
}));

import { getYesterdayDecisionAuditProduct } from "@/lib/sports/tips/product";

function row(id: string, publicStatus: "value_pick" | "watchlist" | "no_clear_value") {
  return {
    fixture: {
      fixtureId: id,
      providerFixtureId: id,
      provider: "api-football",
      sport: "football",
      kickoffAt: "2026-07-15T18:00:00.000Z"
    },
    odds: [],
    decisions: [],
    bestDecision: null,
    publicStatus,
    decisionSummary: {
      bestPublishedPick: publicStatus === "value_pick" ? { expiresAt: "2026-07-15T19:00:00.000Z" } : null,
      bestLean: null,
      bestWatchlistCandidate: null,
      expiresAt: "2026-07-15T19:00:00.000Z",
      allMarketAnalyses: [{}]
    }
  };
}

describe("yesterday decision audit", () => {
  it("reads the complete stored slate separately from the published accuracy ledger", async () => {
    getDailySlate.mockResolvedValue({
      generatedAt: "2026-07-15T18:30:00.000Z",
      provider: { status: "completed", errors: [] },
      fixtures: [row("published", "value_pick"), row("watch", "watchlist"), row("abstain", "no_clear_value")]
    });

    const result = await getYesterdayDecisionAuditProduct({ now: new Date("2026-07-16T18:00:00.000Z") });

    expect(getDailySlate).toHaveBeenCalledWith({
      now: new Date("2026-07-16T18:00:00.000Z"),
      ensure: false,
      dayOffset: -1,
      maxFixtureAgeMs: 72 * 60 * 60 * 1000,
      includeSuspended: true
    });
    expect(result).toMatchObject({
      date: "2026-07-15",
      source: "stored",
      summary: { fixtures: 3, analysed: 3, valuePicks: 0, watchlist: 2, abstentions: 1 }
    });
    expect(result.rows).toHaveLength(3);
  });
});
