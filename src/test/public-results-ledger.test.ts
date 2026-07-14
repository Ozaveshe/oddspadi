import { describe, expect, it } from "vitest";
import { getPublicPredictionHistory, publicHistoryItemFromPublicPickRow } from "@/lib/sports/prediction/history";

const row = {
  id: "pick-1", fixture_id: "api-football:1", sport: "football", league: "NPFL", country: "Nigeria",
  home_team: "Kano Pillars", away_team: "Enyimba", kickoff_at: "2026-07-12T18:00:00Z", market: "match_winner",
  selection: "home", selection_label: "Kano Pillars", odds: "1.90", model_version: "football-v1", model_probability: "0.61",
  implied_probability: "0.526", no_vig_probability: "0.51", value_edge: "0.10", expected_value: "0.159",
  confidence: "medium", risk: "medium", published_at: "2026-07-12T10:00:00Z", status: "settled" as const,
  settlement_status: "settled" as const, result: "won" as const, settlement_reason: "Final score 2-1.",
  settled_at: "2026-07-12T20:00:00Z", closing_odds: "1.82", closing_line_value: "0.043956", created_at: "2026-07-12T10:00:00Z"
};

describe("public results ledger", () => {
  it("returns unavailable with no demo rows when storage is not configured", async () => {
    const ledger = await getPublicPredictionHistory({});
    expect(ledger.source).toBe("unavailable");
    expect(ledger.items).toEqual([]);
    expect(ledger.reason).toContain("not configured");
  });

  it("maps an explicitly published public pick into the public record", () => {
    const item = publicHistoryItemFromPublicPickRow(row);
    expect(item).toMatchObject({ sport: "football", market: "match_winner", match: "Kano Pillars vs Enyimba", result: "won", recordSource: "public-pick-ledger" });
    expect(item.closingLineValue).toBeCloseTo(0.043956);
  });

  it("preserves void outcomes and their settlement reason", () => {
    const item = publicHistoryItemFromPublicPickRow({ ...row, id: "pick-void", status: "void", settlement_status: "void", result: "void", settlement_reason: "Provider marked the match cancelled." });
    expect(item.result).toBe("void");
    expect(item.settlementReason).toContain("cancelled");
  });
});
