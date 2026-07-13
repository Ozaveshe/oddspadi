import { describe, expect, it } from "vitest";
import { getPublicPredictionHistory, publicHistoryItemFromOutcome, publicHistoryItemFromProjection } from "@/lib/sports/prediction/history";

describe("public results ledger", () => {
  it("returns unavailable with no demo rows when storage is not configured", async () => {
    const ledger = await getPublicPredictionHistory({});
    expect(ledger.source).toBe("unavailable");
    expect(ledger.items).toEqual([]);
    expect(ledger.reason).toContain("not configured");
  });

  it("maps stored multi-sport provenance into the public record", () => {
    const item = publicHistoryItemFromOutcome({
      id: "outcome-1", fixture_external_id: "the-odds-api:event-1", sport: "basketball", market: "match_winner",
      selection: "home", model_probability: "0.61", value_edge: "0.08", odds: "1.90", result: "won", source: "settlement-worker",
      settled_at: "2026-07-12T20:00:00Z", created_at: "2026-07-12T10:00:00Z",
      metadata: { homeTeam: "Lagos Legends", awayTeam: "Kigali Kings", league: "BAL", country: "Africa", kickoffTime: "2026-07-12T18:00:00Z", finalAction: "consider", finalConfidence: "high", paperOnly: true, recommendedSelection: "Lagos Legends" }
    });
    expect(item).toMatchObject({ sport: "basketball", market: "match_winner", match: "Lagos Legends vs Kigali Kings", league: "BAL", result: "won", paperOnly: true, recordSource: "settlement-worker" });
  });

  it("preserves void outcomes in the public projection ledger", () => {
    const item = publicHistoryItemFromProjection({
      id: "outcome-void", fixture_external_id: "the-odds-api:event-void", sport: "football", market: "match_winner",
      selection: "home", recommended_selection: null, model_probability: "0.58", value_edge: "0.04", odds: "1.80", result: "void",
      league: "NPFL", country: "Nigeria", home_team: "Kano Pillars", away_team: "Enyimba", kickoff_at: "2026-07-12T18:00:00Z",
      engine_action: "consider", confidence: "medium", paper_only: true, record_source: "settlement-worker",
      settled_at: "2026-07-12T20:00:00Z", created_at: "2026-07-12T10:00:00Z"
    });

    expect(item.result).toBe("void");
    expect(item.market).toBe("match_winner");
  });
});
