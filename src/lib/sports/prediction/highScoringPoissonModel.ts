import type { FootballModelDiagnostics, Match, PredictionMarket, RiskLevel } from "@/lib/sports/types";
import { applyDixonColesAdjustment, buildScoreMatrix, probabilityFromScoreMatrix, topScorelines } from "@/lib/sports/prediction/poisson";

/**
 * Shared scoreline model for the newly wired sports whose goal counts are
 * Poisson-shaped but sit far from football's 2.6-goal mean: handball (~54 a
 * match) and ice hockey (~6).
 *
 * Same machinery as football — one score matrix, every market a sum over it —
 * with two sport differences handled explicitly rather than by copy-paste:
 *
 *  - Handball keeps the draw as a real outcome (three-way match winner).
 *  - Hockey's final result never ties (overtime decides), so the matrix's
 *    regulation-draw mass is reallocated between the sides in proportion to
 *    their strength, the same renormalisation draw-no-bet uses.
 *
 * The corpus walk-forward harness measured football's independent-Poisson
 * matrix as slightly thin in mid-total mass; the same caveat applies here and
 * these lines stay unpromoted until their own settled evidence exists. These
 * models are deliberately market-anchor-first: an unproven sport is held at
 * the 80% market floor by `buildModelSkillAnchor` exactly as tennis is.
 */
export type HighScoringPoissonConfig = {
  /**
   * Explicit model key rather than `runtimeModelKey(sport)`: these sports are
   * deliberately NOT in the DecisionModelSport registry yet — that registry is
   * the activation gate for learning profiles and calibration candidates, and
   * the v4 evidence gates for both sports are unmet. The key still versions
   * the model so its decisions are attributable when activation happens.
   */
  modelKey: string;
  /** League-typical total score for the sport (both sides combined). */
  meanTotal: number;
  /** Matrix depth per side; must comfortably exceed plausible team scores. */
  maxGoals: number;
  /** Whether a drawn final result exists for this sport's match winner. */
  threeWay: boolean;
  /** Totals lines to price, in market-id token form ("545" = 54.5). */
  totalLines: string[];
  /** Home advantage as a multiplicative edge on expected score share. */
  homeAdvantage: number;
  /** Bounded rating leverage: expected-score swing per 100 rating points. */
  ratingLeverage: number;
};

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampProbability(value: number): number {
  return clampRange(value, 0, 1);
}

function lineFromToken(token: string): number {
  return Number(`${token.slice(0, -1)}.${token.slice(-1)}`);
}

export function modelHighScoringMatch(
  match: Match,
  config: HighScoringPoissonConfig
): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  const ratingDiff = (match.homeTeam.rating - match.awayTeam.rating) / 100;
  // Split the sport's typical total by rating difference, bounded so a rating
  // gap can never claim more than a ~65/35 share of expected scoring.
  const homeShare = clampRange(0.5 + ratingDiff * config.ratingLeverage, 0.35, 0.65) * config.homeAdvantage;
  const lambdaHome = clampRange(config.meanTotal * homeShare, config.meanTotal * 0.3, config.meanTotal * 0.7);
  const lambdaAway = clampRange(config.meanTotal - lambdaHome, config.meanTotal * 0.3, config.meanTotal * 0.7);
  // Low-score dependence is a football phenomenon; at handball and hockey
  // score levels the 0-0/1-0 cells are negligible, so rho stays 0.
  const matrix = applyDixonColesAdjustment(buildScoreMatrix(lambdaHome, lambdaAway, config.maxGoals), lambdaHome, lambdaAway, 0);

  const rawHome = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
  const rawDraw = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals);
  const rawAway = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);
  const total = Math.max(1e-9, rawHome + rawDraw + rawAway);

  const matchWinner: PredictionMarket = config.threeWay
    ? {
        marketId: "match_winner",
        probabilities: {
          home: clampProbability(rawHome / total),
          draw: clampProbability(rawDraw / total),
          away: clampProbability(rawAway / total)
        }
      }
    : {
        // Overtime sports: regulation-draw mass splits between the sides in
        // proportion to their share of decided outcomes.
        marketId: "match_winner",
        probabilities: {
          home: clampProbability(rawHome / Math.max(1e-9, rawHome + rawAway)),
          away: clampProbability(rawAway / Math.max(1e-9, rawHome + rawAway))
        }
      };

  const markets: PredictionMarket[] = [
    matchWinner,
    ...config.totalLines.map((token) => {
      const line = lineFromToken(token);
      const over = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals + cell.awayGoals > line);
      return {
        marketId: `over_under_${token}` as PredictionMarket["marketId"],
        probabilities: {
          [`over_${token}`]: over,
          [`under_${token}`]: clampProbability(1 - over)
        }
      };
    })
  ];

  const uncertainty: RiskLevel = match.dataQualityScore >= 0.82 ? "low" : match.dataQualityScore >= 0.7 ? "medium" : "high";
  const diagnostics: FootballModelDiagnostics = {
    modelVersion: config.modelKey,
    expectedGoals: {
      home: Number(lambdaHome.toFixed(2)),
      away: Number(lambdaAway.toFixed(2)),
      total: Number((lambdaHome + lambdaAway).toFixed(2))
    },
    topCorrectScores: topScorelines(matrix, 3),
    homeDrawAwayTotal: 1,
    dataQualityScore: match.dataQualityScore,
    uncertainty,
    signalScores: [
      {
        label: "Rating edge",
        value: Number(ratingDiff.toFixed(3)),
        note: "Expected-score share is split by rating difference with bounded leverage; no sport-specific form model exists yet."
      },
      {
        label: "Expected total",
        value: Number((lambdaHome + lambdaAway).toFixed(2)),
        note: `League-typical total for the sport, apportioned ${Math.round(homeShare * 100)}/${Math.round((1 - homeShare) * 100)} before bounds.`
      }
    ],
    calibrationNotes: [
      "Scoreline probabilities come from an independent-Poisson matrix at the sport's scoring level; no low-score correction is applied because those cells are negligible here.",
      config.threeWay
        ? "The draw is a real outcome for this sport and is priced from the matrix diagonal."
        : "Final results cannot tie in this sport; regulation-draw mass is reallocated between the sides in proportion to decided outcomes.",
      "This sport has no settled calibration evidence yet, so the market anchor holds it at the unproven floor and nothing publishes from these probabilities."
    ]
  };

  return { markets, diagnostics };
}

export function modelHandballMatch(match: Match): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  return modelHighScoringMatch(match, {
    modelKey: "handball-poisson-v1",
    meanTotal: 54,
    maxGoals: 48,
    threeWay: true,
    totalLines: ["505", "545", "585"],
    homeAdvantage: 1.04,
    ratingLeverage: 0.1
  });
}

export function modelIceHockeyMatch(match: Match): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  return modelHighScoringMatch(match, {
    modelKey: "ice-hockey-poisson-v1",
    meanTotal: 6.1,
    maxGoals: 12,
    threeWay: false,
    totalLines: ["55", "65"],
    homeAdvantage: 1.05,
    ratingLeverage: 0.12
  });
}
