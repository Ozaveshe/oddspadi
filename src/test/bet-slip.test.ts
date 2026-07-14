import { describe, expect, it } from "vitest";
import { analyzeSlip, slipLegFromPrediction, type SlipLeg } from "@/lib/sports/betSlip";
import type { Match, Prediction } from "@/lib/sports/types";

const leg = (id: string, odds: number, modelProbability: number): SlipLeg => ({ id, matchId: id, matchLabel: id, league: "League", kickoffTime: "2026-07-13T12:00:00Z", selection: "Home", decimalOdds: odds, modelProbability, noVigProbability: 1 / odds, risk: "medium" });
const match = { id: "m1", league: { name: "EPL" }, kickoffTime: "2026-07-13T12:00:00Z", homeTeam: { name: "Arsenal" }, awayTeam: { name: "Chelsea" } } as Match;
const publishedPick = {
  marketId: "match_winner",
  selectionId: "home",
  label: "Arsenal",
  odds: 2.1,
  modelProbability: .55,
  noVigImpliedProbability: .48,
  risk: "low",
  publicationEligible: true
} as NonNullable<Prediction["canonicalDecision"]["bestPublishedPick"]>;

describe("Slip Check", () => {
  it("multiplies odds and independent model probabilities", () => { const analysis = analyzeSlip([leg("a", 2, .5), leg("b", 3, .4), leg("c", 1.5, .6)]); expect(analysis.combinedOdds).toBeCloseTo(9); expect(analysis.modelProbability).toBeCloseTo(.12); expect(analysis.bookmakerProbability).toBeCloseTo(1/9); expect(analysis.probabilityGap).toBeCloseTo(.12 - 1/9); expect(analysis.weakestLegId).toBe("b"); });
  it("returns a neutral empty analysis", () => { expect(analyzeSlip([])).toEqual({ combinedOdds: 1, modelProbability: 0, bookmakerProbability: 0, probabilityGap: 0, weakestLegId: null }); });
  it("uses the canonical published pick after every publication guard passes", () => {
    const prediction = { canonicalDecision: { publicStatus: "value_pick", bestPublishedPick: publishedPick } } as Prediction;
    expect(slipLegFromPrediction(match, prediction)).toMatchObject({ id: "m1:match_winner:home", decimalOdds: 2.1, modelProbability: .55 });
  });
  it("does not convert a watchlist candidate into an executable slip leg", () => {
    const prediction = {
      canonicalDecision: { publicStatus: "watchlist", bestPublishedPick: null },
      bestPick: { ...publishedPick, hasValue: true }
    } as unknown as Prediction;
    expect(slipLegFromPrediction(match, prediction)).toBeNull();
  });
  it("fails closed when a value status has no eligible canonical pick", () => {
    const prediction = { canonicalDecision: { publicStatus: "value_pick", bestPublishedPick: { ...publishedPick, publicationEligible: false } } } as Prediction;
    expect(slipLegFromPrediction(match, prediction)).toBeNull();
  });
});
