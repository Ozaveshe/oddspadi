import type { PredictionMarket } from "@/lib/sports/types";
import { clampProbability } from "./odds";
import { applyDixonColesAdjustment, buildScoreMatrix, probabilityFromScoreMatrix, topScorelines, type ScoreMatrixCell } from "./poisson";

/**
 * Post-anchor score-matrix coherence.
 *
 * The market prior blends each *priced* market toward the book, one market at
 * a time. That leaves the board mathematically incoherent: the anchored 1X2
 * says one match, while every unpriced market — clean sheets, team totals,
 * correct score — still reads off the raw model's score matrix, describing a
 * different match. The two can disagree visibly on the same card.
 *
 * This pass closes the gap: refit the Dixon-Coles lambdas so the matrix's own
 * 1X2 (and total, when a priced total was anchored) reproduces the anchored
 * probabilities, then re-derive every unpriced market from that refitted
 * matrix. Priced markets keep their anchored values — they carry direct
 * market information the matrix only approximates. Double chance and draw no
 * bet are exact transforms of the anchored 1X2, so they are recomputed from
 * it directly rather than through the matrix.
 *
 * One model, many read-outs — now also one *anchored* model.
 */
/**
 * Only the anchored 1X2 is fitted. With rho held fixed the two free lambdas
 * are fully determined by (P(home), P(away)) — adding a totals residual can
 * only pull the fit off the winner probabilities, and priced totals keep
 * their anchored values on the board regardless, so nothing is gained.
 */
export type CoherenceTargets = {
  home: number;
  draw: number;
  away: number;
};

export type LambdaFit = {
  lambdaHome: number;
  lambdaAway: number;
  converged: boolean;
  iterations: number;
  /** Largest absolute probability residual across fitted targets. */
  maxResidual: number;
};

const MAX_GOALS = 8;
const MAX_ITERATIONS = 60;
const TOTAL_BOUNDS: [number, number] = [Math.log(0.4), Math.log(7)];
const SHARE_BOUNDS: [number, number] = [-4, 4];

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function matrixFor(logTotal: number, share: number, rho: number): ScoreMatrixCell[] {
  const total = Math.exp(clampRange(logTotal, TOTAL_BOUNDS[0], TOTAL_BOUNDS[1]));
  const weight = 1 / (1 + Math.exp(-clampRange(share, SHARE_BOUNDS[0], SHARE_BOUNDS[1])));
  const lambdaHome = total * weight;
  const lambdaAway = total * (1 - weight);
  return applyDixonColesAdjustment(buildScoreMatrix(lambdaHome, lambdaAway, MAX_GOALS), lambdaHome, lambdaAway, rho);
}

function residualsFor(logTotal: number, share: number, rho: number, targets: CoherenceTargets): number[] {
  const matrix = matrixFor(logTotal, share, rho);
  const home = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
  const away = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);
  return [home - targets.home, away - targets.away];
}

function sumSquares(values: number[]): number {
  return values.reduce((sum, value) => sum + value * value, 0);
}

/**
 * Gauss-Newton over (log total, logit share) with numeric Jacobian and step
 * halving. Two parameters against two or three smooth residuals: converges in
 * a handful of iterations from any sane starting point, and the caller treats
 * a non-converged fit as "leave the board as it was".
 */
export function fitLambdasToAnchoredTargets({
  targets,
  rho,
  initialLambdaHome = 1.35,
  initialLambdaAway = 1.15
}: {
  targets: CoherenceTargets;
  rho: number;
  initialLambdaHome?: number;
  initialLambdaAway?: number;
}): LambdaFit {
  const first = runFit({ targets, rho, initialLambdaHome, initialLambdaAway });
  if (first.converged) return first;
  // A far-off starting point can stall the damped Newton steps. Retry once
  // from a target-informed seed: the goal share of the anchored winner is an
  // excellent guess for the lambda share.
  const targetShare = clampRange(targets.home / Math.max(1e-6, targets.home + targets.away), 0.08, 0.92);
  const retryTotal = 2.6;
  const retry = runFit({
    targets,
    rho,
    initialLambdaHome: retryTotal * targetShare,
    initialLambdaAway: retryTotal * (1 - targetShare)
  });
  return retry.maxResidual < first.maxResidual ? retry : first;
}

function runFit({
  targets,
  rho,
  initialLambdaHome,
  initialLambdaAway
}: {
  targets: CoherenceTargets;
  rho: number;
  initialLambdaHome: number;
  initialLambdaAway: number;
}): LambdaFit {
  const initialTotal = Math.max(0.5, initialLambdaHome + initialLambdaAway);
  let logTotal = clampRange(Math.log(initialTotal), TOTAL_BOUNDS[0], TOTAL_BOUNDS[1]);
  const initialShare = clampRange(initialLambdaHome / initialTotal, 0.05, 0.95);
  let share = Math.log(initialShare / (1 - initialShare));

  let residuals = residualsFor(logTotal, share, rho, targets);
  let sse = sumSquares(residuals);
  let iterations = 0;

  for (; iterations < MAX_ITERATIONS && sse > 1e-10; iterations += 1) {
    const epsilon = 1e-5;
    const jacobianTotal = residualsFor(logTotal + epsilon, share, rho, targets).map((value, index) => (value - residuals[index]!) / epsilon);
    const jacobianShare = residualsFor(logTotal, share + epsilon, rho, targets).map((value, index) => (value - residuals[index]!) / epsilon);

    // Normal equations for the 2-parameter Gauss-Newton step.
    const a11 = sumSquares(jacobianTotal);
    const a22 = sumSquares(jacobianShare);
    const a12 = jacobianTotal.reduce((sum, value, index) => sum + value * jacobianShare[index]!, 0);
    const g1 = jacobianTotal.reduce((sum, value, index) => sum + value * residuals[index]!, 0);
    const g2 = jacobianShare.reduce((sum, value, index) => sum + value * residuals[index]!, 0);
    const determinant = a11 * a22 - a12 * a12;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) break;
    let stepTotal = -(a22 * g1 - a12 * g2) / determinant;
    let stepShare = -(a11 * g2 - a12 * g1) / determinant;

    // Halve the step until the objective improves; give up after 6 halvings.
    let improved = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const nextLogTotal = clampRange(logTotal + stepTotal, TOTAL_BOUNDS[0], TOTAL_BOUNDS[1]);
      const nextShare = clampRange(share + stepShare, SHARE_BOUNDS[0], SHARE_BOUNDS[1]);
      const nextResiduals = residualsFor(nextLogTotal, nextShare, rho, targets);
      const nextSse = sumSquares(nextResiduals);
      if (nextSse < sse) {
        logTotal = nextLogTotal;
        share = nextShare;
        residuals = nextResiduals;
        sse = nextSse;
        improved = true;
        break;
      }
      stepTotal /= 2;
      stepShare /= 2;
    }
    if (!improved) break;
  }

  const total = Math.exp(logTotal);
  const weight = 1 / (1 + Math.exp(-share));
  const maxResidual = Math.max(...residuals.map((value) => Math.abs(value)));
  return {
    lambdaHome: Number((total * weight).toFixed(4)),
    lambdaAway: Number((total * (1 - weight)).toFixed(4)),
    converged: maxResidual <= 0.005,
    iterations,
    maxResidual: Number(maxResidual.toFixed(6))
  };
}

function marketsFromMatrix(matrix: ScoreMatrixCell[]): Record<string, Record<string, number>> {
  const overLine = (line: number) => probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals + cell.awayGoals > line);
  const two = (over: number, overId: string, underId: string) => ({
    [overId]: clampProbability(over),
    [underId]: clampProbability(1 - over)
  });
  const homeOver15 = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > 1.5);
  const awayOver15 = probabilityFromScoreMatrix(matrix, (cell) => cell.awayGoals > 1.5);
  const homeCleanSheet = probabilityFromScoreMatrix(matrix, (cell) => cell.awayGoals === 0);
  const awayCleanSheet = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === 0);
  const btts = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > 0 && cell.awayGoals > 0);
  const correctScoreLeaders = topScorelines(matrix, 6);
  const correctScore: Record<string, number> = Object.fromEntries(
    correctScoreLeaders.map((cell) => [`${cell.homeGoals}_${cell.awayGoals}`, clampProbability(cell.probability)])
  );
  correctScore.other = clampProbability(1 - correctScoreLeaders.reduce((sum, cell) => sum + cell.probability, 0));

  return {
    over_under_05: two(overLine(0.5), "over_05", "under_05"),
    over_under_15: two(overLine(1.5), "over_15", "under_15"),
    over_under_25: two(overLine(2.5), "over_25", "under_25"),
    over_under_35: two(overLine(3.5), "over_35", "under_35"),
    over_under_45: two(overLine(4.5), "over_45", "under_45"),
    home_team_over_under_15: { over_15: clampProbability(homeOver15), under_15: clampProbability(1 - homeOver15) },
    away_team_over_under_15: { over_15: clampProbability(awayOver15), under_15: clampProbability(1 - awayOver15) },
    clean_sheet_home: { yes: clampProbability(homeCleanSheet), no: clampProbability(1 - homeCleanSheet) },
    clean_sheet_away: { yes: clampProbability(awayCleanSheet), no: clampProbability(1 - awayCleanSheet) },
    both_teams_to_score: { yes: clampProbability(btts), no: clampProbability(1 - btts) },
    correct_score: correctScore
  };
}

export type CoherencePassResult = {
  applied: boolean;
  markets: PredictionMarket[];
  receipt: {
    applied: boolean;
    lambdaHome: number;
    lambdaAway: number;
    iterations: number;
    maxResidual: number;
    rebuiltMarkets: string[];
  } | null;
};

export function applyMarketCoherencePass({
  markets,
  pricedMarketIds,
  rho,
  initialLambdaHome,
  initialLambdaAway
}: {
  markets: PredictionMarket[];
  pricedMarketIds: Set<string>;
  rho: number;
  initialLambdaHome?: number;
  initialLambdaAway?: number;
}): CoherencePassResult {
  const unchanged: CoherencePassResult = { applied: false, markets, receipt: null };
  const winner = markets.find((market) => market.marketId === "match_winner");
  if (!winner) return unchanged;
  const home = winner.probabilities.home;
  const draw = winner.probabilities.draw;
  const away = winner.probabilities.away;
  if (![home, draw, away].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) return unchanged;

  const fit = fitLambdasToAnchoredTargets({
    targets: { home: home!, draw: draw!, away: away! },
    rho,
    initialLambdaHome,
    initialLambdaAway
  });
  if (!fit.converged) return unchanged;

  const matrix = applyDixonColesAdjustment(
    buildScoreMatrix(fit.lambdaHome, fit.lambdaAway, MAX_GOALS),
    fit.lambdaHome,
    fit.lambdaAway,
    rho
  );
  const coherent = marketsFromMatrix(matrix);
  const rebuiltMarkets: string[] = [];

  const nextMarkets = markets.map((market) => {
    // Priced markets keep their anchored probabilities — they carry direct
    // market information the refitted matrix only approximates.
    if (pricedMarketIds.has(market.marketId)) return market;
    if (market.marketId === "double_chance") {
      rebuiltMarkets.push(market.marketId);
      return {
        ...market,
        probabilities: {
          home_or_draw: clampProbability(home! + draw!),
          home_or_away: clampProbability(home! + away!),
          draw_or_away: clampProbability(draw! + away!)
        }
      };
    }
    if (market.marketId === "draw_no_bet") {
      rebuiltMarkets.push(market.marketId);
      const pair = Math.max(1e-6, home! + away!);
      return {
        ...market,
        probabilities: { home: clampProbability(home! / pair), away: clampProbability(away! / pair) }
      };
    }
    const replacement = coherent[market.marketId];
    if (!replacement) return market;
    rebuiltMarkets.push(market.marketId);
    return { ...market, probabilities: replacement };
  });

  if (!rebuiltMarkets.length) return unchanged;
  return {
    applied: true,
    markets: nextMarkets,
    receipt: {
      applied: true,
      lambdaHome: fit.lambdaHome,
      lambdaAway: fit.lambdaAway,
      iterations: fit.iterations,
      maxResidual: fit.maxResidual,
      rebuiltMarkets
    }
  };
}
