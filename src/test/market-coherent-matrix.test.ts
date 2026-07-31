import { describe, expect, it } from "vitest";
import { shinNoVigProbabilities, normalizeImpliedProbabilities } from "@/lib/sports/prediction/odds";
import { applyMarketCoherencePass, fitLambdasToAnchoredTargets } from "@/lib/sports/prediction/marketCoherentMatrix";
import { applyDixonColesAdjustment, buildScoreMatrix, probabilityFromScoreMatrix } from "@/lib/sports/prediction/poisson";
import type { PredictionMarket } from "@/lib/sports/types";

describe("shinNoVigProbabilities", () => {
  it("sums to one and reallocates margin away from the longshot", () => {
    // 1X2 with a heavy favorite and ~6% overround.
    const implied = [1 / 1.3, 1 / 5.4, 1 / 9.0];
    const shin = shinNoVigProbabilities(implied);
    const proportional = normalizeImpliedProbabilities(implied);

    expect(shin.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 9);
    // Shin charges the margin mostly to the longshots: the favorite keeps more
    // probability than proportional de-vig gives it, the longshot keeps less.
    expect(shin[0]!).toBeGreaterThan(proportional[0]!);
    expect(shin[2]!).toBeLessThan(proportional[2]!);
    // Ordering is preserved.
    expect(shin[0]!).toBeGreaterThan(shin[1]!);
    expect(shin[1]!).toBeGreaterThan(shin[2]!);
  });

  it("leaves a symmetric two-way market symmetric", () => {
    const shin = shinNoVigProbabilities([1 / 1.9, 1 / 1.9]);
    expect(shin[0]!).toBeCloseTo(0.5, 9);
    expect(shin[1]!).toBeCloseTo(0.5, 9);
  });

  it("falls back to proportional on degenerate input", () => {
    // Sub-1 book sum (arb) has no margin to reallocate.
    const arb = [0.45, 0.45];
    expect(shinNoVigProbabilities(arb)).toEqual(normalizeImpliedProbabilities(arb));
    // A zero entry is not a real quote.
    const broken = [0.9, 0];
    expect(shinNoVigProbabilities(broken)).toEqual(normalizeImpliedProbabilities(broken));
  });
});

describe("fitLambdasToAnchoredTargets", () => {
  const RHO = -0.06;

  function matrixTargets(lambdaHome: number, lambdaAway: number) {
    const matrix = applyDixonColesAdjustment(buildScoreMatrix(lambdaHome, lambdaAway, 8), lambdaHome, lambdaAway, RHO);
    return {
      home: probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals),
      draw: probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals),
      away: probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals),
      over25: probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals + cell.awayGoals > 2.5)
    };
  }

  it("round-trips: recovers the lambdas that generated the targets", () => {
    const { home, draw, away } = matrixTargets(1.62, 1.08);
    const fit = fitLambdasToAnchoredTargets({ targets: { home, draw, away }, rho: RHO });
    expect(fit.converged).toBe(true);
    expect(fit.lambdaHome).toBeCloseTo(1.62, 1);
    expect(fit.lambdaAway).toBeCloseTo(1.08, 1);
    expect(fit.maxResidual).toBeLessThan(0.005);
  });

  it("recovers the generating total, so the matrix carries a market-consistent goal rate", () => {
    const { home, draw, away } = matrixTargets(1.45, 1.3);
    const fit = fitLambdasToAnchoredTargets({ targets: { home, draw, away }, rho: RHO });
    expect(fit.converged).toBe(true);
    expect(fit.lambdaHome + fit.lambdaAway).toBeCloseTo(2.75, 1);
  });

  it("converges from a poor starting point", () => {
    const { home, draw, away } = matrixTargets(2.3, 0.7);
    const fit = fitLambdasToAnchoredTargets({ targets: { home, draw, away }, rho: RHO, initialLambdaHome: 0.8, initialLambdaAway: 1.9 });
    expect(fit.converged).toBe(true);
    expect(fit.lambdaHome).toBeGreaterThan(fit.lambdaAway);
  });
});

describe("applyMarketCoherencePass", () => {
  const RHO = -0.06;

  /** A raw-model board built from λ 1.30/1.20, i.e. NOT the anchored match. */
  function rawBoard(): PredictionMarket[] {
    const matrix = applyDixonColesAdjustment(buildScoreMatrix(1.3, 1.2, 8), 1.3, 1.2, RHO);
    const p = (predicate: (cell: { homeGoals: number; awayGoals: number }) => boolean) =>
      probabilityFromScoreMatrix(matrix, predicate);
    const over25 = p((cell) => cell.homeGoals + cell.awayGoals > 2.5);
    const csHome = p((cell) => cell.awayGoals === 0);
    return [
      // The anchored winner: markedly home-heavier than the raw matrix.
      { marketId: "match_winner", probabilities: { home: 0.56, draw: 0.24, away: 0.2 } },
      { marketId: "over_under_25", probabilities: { over_25: over25, under_25: 1 - over25 } },
      { marketId: "clean_sheet_home", probabilities: { yes: csHome, no: 1 - csHome } },
      { marketId: "double_chance", probabilities: { home_or_draw: 0.5, home_or_away: 0.5, draw_or_away: 0.5 } },
      { marketId: "draw_no_bet", probabilities: { home: 0.5, away: 0.5 } }
    ];
  }

  it("rebuilds unpriced markets from the anchored match and leaves priced markets alone", () => {
    const markets = rawBoard();
    const anchoredOver25 = markets[1]!.probabilities.over_25!;
    const result = applyMarketCoherencePass({
      markets,
      pricedMarketIds: new Set(["match_winner", "over_under_25"]),
      rho: RHO,
      initialLambdaHome: 1.3,
      initialLambdaAway: 1.2
    });

    expect(result.applied).toBe(true);
    const byId = new Map(result.markets.map((market) => [market.marketId, market.probabilities]));
    // Priced markets untouched.
    expect(byId.get("match_winner")).toEqual({ home: 0.56, draw: 0.24, away: 0.2 });
    expect(byId.get("over_under_25")!.over_25).toBe(anchoredOver25);
    // Home clean sheet must RISE: the anchored match is more home-dominant
    // than the raw λ1.3/1.2 matrix the old value came from.
    expect(byId.get("clean_sheet_home")!.yes!).toBeGreaterThan(markets[2]!.probabilities.yes!);
    // Deterministic transforms of the anchored winner.
    expect(byId.get("double_chance")!.home_or_draw!).toBeCloseTo(0.8, 6);
    expect(byId.get("draw_no_bet")!.home!).toBeCloseTo(0.56 / 0.76, 6);
    expect(result.receipt?.rebuiltMarkets).toContain("clean_sheet_home");
    // The refitted matrix reproduces the anchored winner.
    expect(result.receipt!.lambdaHome).toBeGreaterThan(result.receipt!.lambdaAway);
  });

  it("does nothing without an anchored winner market", () => {
    const result = applyMarketCoherencePass({
      markets: [{ marketId: "over_under_25", probabilities: { over_25: 0.5, under_25: 0.5 } }],
      pricedMarketIds: new Set(["over_under_25"]),
      rho: RHO
    });
    expect(result.applied).toBe(false);
  });
});
