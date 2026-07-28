import { describe, expect, it } from "vitest";
import { analyzeSlip, BET_SLIP_STORAGE_KEY, readSlip, slipLegFromPrediction, type SlipLeg } from "@/lib/sports/betSlip";
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
  it("multiplies odds and independent model probabilities", () => {
    const analysis = analyzeSlip([leg("a", 2, .5), leg("b", 3, .4), leg("c", 1.5, .6)]);
    expect(analysis.combinedOdds).toBeCloseTo(9);
    expect(analysis.modelProbability).toBeCloseTo(.12);
    expect(analysis.bookmakerProbability).toBeCloseTo(1 / 9);
    expect(analysis.weakestLegId).toBe("b");
  });

  it("measures the gap against the fair price, not the vigged one", () => {
    // Three legs each carrying a 5% bookmaker margin: the fair chance of the
    // parlay is meaningfully higher than the price implies, and charging the
    // model with the vigged figure inflated its edge by the compounded margin.
    const vigged = [leg("a", 2, .5), leg("b", 3, .4), leg("c", 1.5, .6)].map((row) => ({
      ...row,
      noVigProbability: (1 / row.decimalOdds) * 1.05
    }));
    const analysis = analyzeSlip(vigged);
    const fair = vigged.reduce((value, row) => value * row.noVigProbability, 1);

    expect(analysis.fairProbability).toBeCloseTo(fair);
    expect(analysis.probabilityGap).toBeCloseTo(.12 - fair);
    // The vigged benchmark would have reported a larger gap than the truth.
    expect(analysis.probabilityGap).toBeLessThan(.12 - analysis.bookmakerProbability);
  });

  it("returns a neutral empty analysis", () => { expect(analyzeSlip([])).toEqual({ combinedOdds: 1, modelProbability: 0, bookmakerProbability: 0, fairProbability: 0, probabilityGap: 0, weakestLegId: null }); });

  it("drops a stored leg whose no-vig probability is not a real probability", () => {
    // `noVigProbability` was typed `number` but never validated on read, so a
    // corrupt or hand-edited localStorage entry put a non-number into a typed
    // numeric field and propagated it straight into the analysis as NaN.
    const store = new Map<string, string>();
    const stub = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value)
      },
      dispatchEvent: () => true
    };
    const globals = globalThis as { window?: unknown };
    const previous = globals.window;
    globals.window = stub;

    try {
      const good = leg("a", 2, .5);
      store.set(
        BET_SLIP_STORAGE_KEY,
        JSON.stringify([
          good,
          { ...leg("b", 3, .4), noVigProbability: "banana" },
          { ...leg("c", 1.5, .6), noVigProbability: Number.NaN },
          { ...leg("d", 4, .25), noVigProbability: 0 }
        ])
      );

      expect(readSlip()).toEqual([good]);
    } finally {
      globals.window = previous;
    }
  });
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
