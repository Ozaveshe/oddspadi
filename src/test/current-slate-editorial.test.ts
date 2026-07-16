import { describe, expect, it } from "vitest";
import {
  buildStoredSlateEditorialOutcomes,
  mergeEditorialOutcomes,
  type StoredEditorialDecisionSummary,
  type StoredEditorialFixture
} from "@/lib/editorial/currentSlateStories";
import type { EditorialOutcome } from "@/lib/editorial/generatedStories";

const now = new Date("2026-07-17T05:35:00.000Z");
const fixture: StoredEditorialFixture = {
  external_id: "api-football:9001",
  sport: "football",
  league_name: "NPFL",
  home_team_name: "Enyimba",
  away_team_name: "Kano Pillars",
  kickoff_at: "2026-07-17T18:00:00.000Z",
  last_synced_at: "2026-07-17T05:20:00.000Z"
};
const summary: StoredEditorialDecisionSummary = {
  fixture_external_id: fixture.external_id,
  generated_at: "2026-07-17T05:25:00.000Z",
  expires_at: "2026-07-17T06:25:00.000Z",
  best_published_pick: null,
  best_lean: null,
  best_watchlist_candidate: {
    marketId: "match_winner",
    selectionId: "home",
    label: "Enyimba",
    modelProbability: 0.61,
    edge: 0.04,
    odds: 1.95,
    expiresAt: "2026-07-17T06:25:00.000Z"
  },
  all_market_analyses: []
};

describe("current slate editorial inputs", () => {
  it("turns a fresh canonical watchlist into a factual pending editorial row", () => {
    expect(buildStoredSlateEditorialOutcomes([fixture], [summary], now)).toEqual([
      expect.objectContaining({
        fixture_external_id: fixture.external_id,
        recommended_selection: "Enyimba",
        model_probability: 0.61,
        value_edge: 0.04,
        odds: 1.95,
        result: "pending"
      })
    ]);
  });

  it("refuses expired analysis instead of writing stale daily copy", () => {
    expect(buildStoredSlateEditorialOutcomes([fixture], [{ ...summary, expires_at: "2026-07-17T05:30:00.000Z", best_watchlist_candidate: { ...summary.best_watchlist_candidate as object, expiresAt: "2026-07-17T05:30:00.000Z" } }], now)).toEqual([]);
  });

  it("does not duplicate a fixture already represented by a public pending outcome", () => {
    const stored = buildStoredSlateEditorialOutcomes([fixture], [summary], now);
    const publicRow = { ...stored[0], id: "public-row" } as EditorialOutcome;
    expect(mergeEditorialOutcomes([publicRow], stored)).toEqual([publicRow]);
  });
});
