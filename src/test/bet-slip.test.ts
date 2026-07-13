import { describe, expect, it } from "vitest";
import { analyzeSlip, slipLegFromPrediction, type SlipLeg } from "@/lib/sports/betSlip";
import type { Match, Prediction } from "@/lib/sports/types";

const leg = (id: string, odds: number, modelProbability: number): SlipLeg => ({ id, matchId: id, matchLabel: id, league: "League", kickoffTime: "2026-07-13T12:00:00Z", selection: "Home", decimalOdds: odds, modelProbability, noVigProbability: 1 / odds, risk: "medium" });
describe("Slip Check", () => {
  it("multiplies odds and independent model probabilities", () => { const analysis = analyzeSlip([leg("a", 2, .5), leg("b", 3, .4), leg("c", 1.5, .6)]); expect(analysis.combinedOdds).toBeCloseTo(9); expect(analysis.modelProbability).toBeCloseTo(.12); expect(analysis.bookmakerProbability).toBeCloseTo(1/9); expect(analysis.probabilityGap).toBeCloseTo(.12 - 1/9); expect(analysis.weakestLegId).toBe("b"); });
  it("returns a neutral empty analysis", () => { expect(analyzeSlip([])).toEqual({ combinedOdds: 1, modelProbability: 0, bookmakerProbability: 0, probabilityGap: 0, weakestLegId: null }); });
  it("prefers the priced best pick when one passed value checks", () => { const match = { id: "m1", league: { name: "EPL" }, kickoffTime: "2026-07-13T12:00:00Z", homeTeam: { name: "Arsenal" }, awayTeam: { name: "Chelsea" } } as Match; const prediction = { bestPick: { hasValue: true, marketId: "match_winner", selectionId: "home", label: "Arsenal", odds: 2.1, modelProbability: .55, noVigImpliedProbability: .48, risk: "low" } } as Prediction; expect(slipLegFromPrediction(match, prediction)).toMatchObject({ id: "m1:match_winner:home", decimalOdds: 2.1, modelProbability: .55 }); });
});
