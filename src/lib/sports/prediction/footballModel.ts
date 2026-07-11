import type { ExpectedGoals, FootballModelDiagnostics, Match, MatchContextSignal, PredictionMarket, RiskLevel, ScorelineProbability } from "@/lib/sports/types";
import { clampProbability } from "./odds";
import { applyDixonColesAdjustment, buildScoreMatrix, probabilityFromScoreMatrix, topScorelines } from "./poisson";
import { isFreshProviderContextSignal } from "./contextSignalPolicy";

function formScore(results: Array<"W" | "D" | "L">): number {
  const total = results.reduce((score, result) => {
    if (result === "W") return score + 1;
    if (result === "D") return score + 0.45;
    return score;
  }, 0);
  return total / Math.max(results.length, 1);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function signalQualityMultiplier(signal: MatchContextSignal): number {
  if (signal.quality === "strong") return 1.16;
  if (signal.quality === "acceptable") return 1;
  if (signal.quality === "thin") return 0.58;
  return 0;
}

function signalMagnitude(signal: MatchContextSignal): number {
  return clampRange(signal.weight * signal.confidence * signalQualityMultiplier(signal), 0, 0.05);
}

function footballProviderContext(match: Match): {
  source: "provider-context" | "deterministic-proxy";
  signalCount: number;
  homeAdjustment: number;
  awayAdjustment: number;
  totalAdjustment: number;
} {
  const providerMatch = match.dataSource?.kind === "provider";
  const signals = (match.providerContextSignals ?? []).filter(
    (signal) =>
      ["injury", "suspension", "lineup", "weather", "news"].includes(signal.category) &&
      (!providerMatch || isFreshProviderContextSignal(signal, { requireTimestamp: true }))
  );

  if (!signals.length) {
    return {
      source: "deterministic-proxy",
      signalCount: 0,
      homeAdjustment: 0,
      awayAdjustment: 0,
      totalAdjustment: 0
    };
  }

  let homeAdjustment = 0;
  let awayAdjustment = 0;
  let tempoAdjustment = 0;

  for (const signal of signals) {
    const magnitude = signalMagnitude(signal);
    if (signal.impact === "home-positive") {
      homeAdjustment += magnitude * 3.8;
      awayAdjustment -= magnitude * 1.15;
    }
    if (signal.impact === "home-negative") {
      homeAdjustment -= magnitude * 3.8;
      awayAdjustment += magnitude * 1.15;
    }
    if (signal.impact === "away-positive") {
      awayAdjustment += magnitude * 3.8;
      homeAdjustment -= magnitude * 1.15;
    }
    if (signal.impact === "away-negative") {
      awayAdjustment -= magnitude * 3.8;
      homeAdjustment += magnitude * 1.15;
    }
    if (signal.impact === "tempo-up") tempoAdjustment += magnitude * 2.25;
    if (signal.impact === "tempo-down") tempoAdjustment -= magnitude * 2.25;
  }

  return {
    source: "provider-context",
    signalCount: signals.length,
    homeAdjustment: Number(clampRange(homeAdjustment + tempoAdjustment, -0.28, 0.28).toFixed(3)),
    awayAdjustment: Number(clampRange(awayAdjustment + tempoAdjustment, -0.28, 0.28).toFixed(3)),
    totalAdjustment: Number(clampRange(homeAdjustment + awayAdjustment + tempoAdjustment * 2, -0.42, 0.42).toFixed(3))
  };
}

function xgBlendAdjustment({
  observed,
  proxy,
  dataQualityScore
}: {
  observed: number | null;
  proxy: number;
  dataQualityScore: number;
}): number {
  if (observed === null) return 0;
  const boundedObserved = clampRange(observed, 0.15, 4.5);
  const weight = clampRange(0.22 + (dataQualityScore - 0.68) * 0.28, 0.16, 0.34);
  return clampRange((boundedObserved - proxy) * weight, -0.42, 0.42);
}

function expectedGoalsForMatch(match: Match) {
  const ratingDiff = (match.homeTeam.rating - match.awayTeam.rating) / 100;
  const formDiff = formScore(match.homeForm.recentResults) - formScore(match.awayForm.recentResults);
  const leagueGoalRate = 2.48 + (match.league.strength - 0.72) * 0.38;
  const homeAdvantage = 1.11;

  const homeAttack = 0.78 + match.homeForm.attackStrength * 0.34 + match.homeForm.goalsFor * 0.08;
  const awayAttack = 0.78 + match.awayForm.attackStrength * 0.34 + match.awayForm.goalsFor * 0.08;
  const homeDefensiveResistance = 1.2 - match.homeForm.defenseStrength * 0.22 - match.homeForm.goalsAgainst * 0.05;
  const awayDefensiveResistance = 1.2 - match.awayForm.defenseStrength * 0.22 - match.awayForm.goalsAgainst * 0.05;
  const homeRatingFactor = 1 + ratingDiff * 0.55;
  const awayRatingFactor = 1 - ratingDiff * 0.45;
  const homeFormFactor = 0.94 + formScore(match.homeForm.recentResults) * 0.13 + Math.max(formDiff, 0) * 0.05;
  const awayFormFactor = 0.94 + formScore(match.awayForm.recentResults) * 0.12 + Math.max(-formDiff, 0) * 0.04;

  const homeProxyGoals = (leagueGoalRate / 2) * homeAttack * awayDefensiveResistance * homeRatingFactor * homeFormFactor * homeAdvantage;
  const awayProxyGoals = (leagueGoalRate / 2) * awayAttack * homeDefensiveResistance * awayRatingFactor * awayFormFactor * 0.94;
  const homeXgFor = finiteOptionalNumber(match.homeForm.xgFor);
  const awayXgFor = finiteOptionalNumber(match.awayForm.xgFor);
  const homeXgAgainst = finiteOptionalNumber(match.homeForm.xgAgainst);
  const awayXgAgainst = finiteOptionalNumber(match.awayForm.xgAgainst);
  const homeXgObserved = homeXgFor === null && awayXgAgainst === null ? null : ((homeXgFor ?? homeProxyGoals) + (awayXgAgainst ?? homeProxyGoals)) / 2;
  const awayXgObserved = awayXgFor === null && homeXgAgainst === null ? null : ((awayXgFor ?? awayProxyGoals) + (homeXgAgainst ?? awayProxyGoals)) / 2;
  const homeXgAdjustment = xgBlendAdjustment({
    observed: homeXgObserved,
    proxy: homeProxyGoals,
    dataQualityScore: match.dataQualityScore
  });
  const awayXgAdjustment = xgBlendAdjustment({
    observed: awayXgObserved,
    proxy: awayProxyGoals,
    dataQualityScore: match.dataQualityScore
  });
  const providerContext = footballProviderContext(match);
  const homeExpectedGoals = clampRange(homeProxyGoals + homeXgAdjustment + providerContext.homeAdjustment, 0.25, 3.65);
  const awayExpectedGoals = clampRange(awayProxyGoals + awayXgAdjustment + providerContext.awayAdjustment, 0.2, 3.45);

  return {
    home: Number(homeExpectedGoals.toFixed(3)),
    away: Number(awayExpectedGoals.toFixed(3)),
    total: Number((homeExpectedGoals + awayExpectedGoals).toFixed(3)),
    xg: {
      homeObserved: homeXgObserved === null ? null : Number(homeXgObserved.toFixed(3)),
      awayObserved: awayXgObserved === null ? null : Number(awayXgObserved.toFixed(3)),
      homeAdjustment: Number(homeXgAdjustment.toFixed(3)),
      awayAdjustment: Number(awayXgAdjustment.toFixed(3)),
      applied: Math.abs(homeXgAdjustment) > 0.0001 || Math.abs(awayXgAdjustment) > 0.0001
    },
    context: {
      ...providerContext,
      applied: Math.abs(providerContext.homeAdjustment) > 0.0001 || Math.abs(providerContext.awayAdjustment) > 0.0001
    }
  };
}

function uncertaintyFromDataQuality(dataQualityScore: number): RiskLevel {
  if (dataQualityScore >= 0.82) return "low";
  if (dataQualityScore >= 0.7) return "medium";
  return "high";
}

function ratingEvidenceSummary(team: Match["homeTeam"]): string {
  const evidence = team.ratingEvidence;
  if (!evidence) return `${team.name}: unspecified rating input`;
  const raw = typeof evidence.rawRating === "number" ? `, raw ${evidence.rawRating.toFixed(1)}` : "";
  const sample = typeof evidence.sampleSize === "number" ? `, ${evidence.sampleSize} match sample` : "";
  const asOf = evidence.asOf ? `, as of ${evidence.asOf.slice(0, 10)}` : "";
  return `${team.name}: ${evidence.source}${raw}${sample}${asOf}`;
}

function dixonColesRhoForMatch(match: Match, expectedGoals: ExpectedGoals, isLive: boolean): number {
  const lowTotalPressure = clampRange((2.7 - expectedGoals.total) * 0.028, -0.018, 0.028);
  const leagueTempoPressure = clampRange((0.82 - match.league.strength) * 0.04, -0.014, 0.018);
  const liveDampener = isLive ? 0.68 : 1;
  return Number((-clampRange(0.056 + lowTotalPressure + leagueTempoPressure, 0.035, 0.098) * liveDampener).toFixed(4));
}

function buildLiveScoreProjection(match: Match, preMatchExpectedGoals: ExpectedGoals, rho: number) {
  if (match.status !== "live" || !match.score) return null;

  const currentHome = Math.max(0, Math.round(match.score.home));
  const currentAway = Math.max(0, Math.round(match.score.away));
  const minute = clampRange(match.score.minute ?? 45, 1, 96);
  const remainingShare = clampRange((96 - minute) / 96, 0, 0.98);
  const scoreDiff = currentHome - currentAway;
  const chaseBoost = clampRange(Math.abs(scoreDiff) * 0.16, 0, 0.34);
  const tempoBoost = Math.abs(scoreDiff) === 0 ? 1.03 : 1 + clampRange(Math.abs(scoreDiff) * 0.05, 0.04, 0.16);
  const homeGameState = scoreDiff < 0 ? 1 + chaseBoost : scoreDiff > 0 ? 0.88 : 1;
  const awayGameState = scoreDiff > 0 ? 1 + chaseBoost : scoreDiff < 0 ? 0.88 : 1;
  const remainingHome = clampRange(preMatchExpectedGoals.home * remainingShare * homeGameState * tempoBoost, 0, 2.8);
  const remainingAway = clampRange(preMatchExpectedGoals.away * remainingShare * awayGameState * tempoBoost, 0, 2.8);
  const remainingMatrix = applyDixonColesAdjustment(buildScoreMatrix(remainingHome, remainingAway, 6), remainingHome, remainingAway, rho);
  const scoreMatrix: ScorelineProbability[] = remainingMatrix.map((cell) => ({
    homeGoals: currentHome + cell.homeGoals,
    awayGoals: currentAway + cell.awayGoals,
    probability: cell.probability
  }));

  return {
    minute,
    currentHome,
    currentAway,
    remainingShare,
    remainingExpectedGoals: {
      home: Number(remainingHome.toFixed(3)),
      away: Number(remainingAway.toFixed(3)),
      total: Number((remainingHome + remainingAway).toFixed(3))
    },
    expectedGoals: {
      home: Number((currentHome + remainingHome).toFixed(3)),
      away: Number((currentAway + remainingAway).toFixed(3)),
      total: Number((currentHome + currentAway + remainingHome + remainingAway).toFixed(3))
    },
    scoreMatrix
  };
}

export function modelFootballMatch(match: Match): { markets: PredictionMarket[]; diagnostics: FootballModelDiagnostics } {
  const preMatchExpectedGoals = expectedGoalsForMatch(match);
  const isLiveWithScore = match.status === "live" && Boolean(match.score);
  const dixonColesRho = dixonColesRhoForMatch(match, preMatchExpectedGoals, isLiveWithScore);
  const liveProjection = buildLiveScoreProjection(match, preMatchExpectedGoals, dixonColesRho);
  const expectedGoals = liveProjection?.expectedGoals ?? preMatchExpectedGoals;
  const scoreMatrix =
    liveProjection?.scoreMatrix ?? applyDixonColesAdjustment(buildScoreMatrix(expectedGoals.home, expectedGoals.away), expectedGoals.home, expectedGoals.away, dixonColesRho);

  const home = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals > cell.awayGoals);
  const draw = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals === cell.awayGoals);
  const away = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals < cell.awayGoals);
  const hdaTotal = home + draw + away;
  const normalizedHome = clampProbability(home / hdaTotal);
  const normalizedDraw = clampProbability(draw / hdaTotal);
  const normalizedAway = clampProbability(away / hdaTotal);
  const over15 = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals + cell.awayGoals > 1.5);
  const over25 = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals + cell.awayGoals > 2.5);
  const btts = probabilityFromScoreMatrix(scoreMatrix, (cell) => cell.homeGoals > 0 && cell.awayGoals > 0);

  const diagnostics: FootballModelDiagnostics = {
    modelVersion: "football-poisson-v2",
    expectedScoreLabel: liveProjection
      ? `Live projection ${match.homeTeam.name} ${expectedGoals.home.toFixed(2)} - ${match.awayTeam.name} ${expectedGoals.away.toFixed(
          2
        )} from ${liveProjection.currentHome}-${liveProjection.currentAway} at ${liveProjection.minute}'.`
      : undefined,
    topOutcomeLabel: liveProjection
      ? `In-play remaining xG ${liveProjection.remainingExpectedGoals.home.toFixed(2)}-${liveProjection.remainingExpectedGoals.away.toFixed(
          2
        )}; remaining time share ${Math.round(liveProjection.remainingShare * 100)}%.`
      : undefined,
    expectedGoals,
    topCorrectScores: topScorelines(scoreMatrix),
    homeDrawAwayTotal: Number((normalizedHome + normalizedDraw + normalizedAway).toFixed(6)),
    dataQualityScore: match.dataQualityScore,
    uncertainty: uncertaintyFromDataQuality(match.dataQualityScore),
    signalScores: [
      {
        label: "Home rating edge",
        value: Number(((match.homeTeam.rating - match.awayTeam.rating) / 100).toFixed(3)),
        note: `Positive values favor the home side before market comparison. ${ratingEvidenceSummary(match.homeTeam)}; ${ratingEvidenceSummary(
          match.awayTeam
        )}.`
      },
      {
        label: "Recent form edge",
        value: Number((formScore(match.homeForm.recentResults) - formScore(match.awayForm.recentResults)).toFixed(3)),
        note: "Computed from W/D/L form with draws treated as partial positive outcomes."
      },
      {
        label: "Expected goals total",
        value: expectedGoals.total,
        note: liveProjection
          ? "Projected final total from current score plus remaining-time Poisson expected goals."
          : "Derived from attack, defense, rating, home advantage, and league goal-rate assumptions."
      },
      {
        label: "xG blend adjustment",
        value: Number((preMatchExpectedGoals.xg.homeAdjustment - preMatchExpectedGoals.xg.awayAdjustment).toFixed(3)),
        note: preMatchExpectedGoals.xg.applied
          ? `Provider xG blend applied: observed home ${preMatchExpectedGoals.xg.homeObserved?.toFixed(2) ?? "n/a"}, observed away ${
              preMatchExpectedGoals.xg.awayObserved?.toFixed(2) ?? "n/a"
            }; goal adjustments ${preMatchExpectedGoals.xg.homeAdjustment.toFixed(2)}-${preMatchExpectedGoals.xg.awayAdjustment.toFixed(2)}.`
          : "No provider xG inputs were available, so expected goals used rating, form, attack, defense, league rate, and home advantage only."
      },
      {
        label: "Provider football context xG",
        value: Number((preMatchExpectedGoals.context.homeAdjustment - preMatchExpectedGoals.context.awayAdjustment).toFixed(3)),
        note:
          preMatchExpectedGoals.context.source === "provider-context"
            ? `Poisson expected goals consumed ${preMatchExpectedGoals.context.signalCount} provider/context injury, suspension, lineup, weather, or news signal(s). Goal adjustments ${preMatchExpectedGoals.context.homeAdjustment.toFixed(
                2
              )}-${preMatchExpectedGoals.context.awayAdjustment.toFixed(2)}.`
            : "Poisson expected goals used deterministic team strength, form, and xG proxies because provider-backed football context was not attached."
      },
      {
        label: "Data quality",
        value: match.dataQualityScore,
        note: "Lower data quality reduces confidence even when the edge is positive."
      },
      {
        label: "Dixon-Coles rho",
        value: dixonColesRho,
        note: "Low-score dependence correction applied to 0-0, 1-0, 0-1, and 1-1 score cells before market probabilities are derived."
      },
      ...(liveProjection
        ? [
            {
              label: "Live in-play Poisson",
              value: Number(liveProjection.remainingShare.toFixed(4)),
              note: `Current score ${liveProjection.currentHome}-${liveProjection.currentAway} at ${liveProjection.minute}' with remaining xG ${liveProjection.remainingExpectedGoals.home.toFixed(
                2
              )}-${liveProjection.remainingExpectedGoals.away.toFixed(2)}.`
            },
            {
              label: "Live score differential",
              value: liveProjection.currentHome - liveProjection.currentAway,
              note: "Positive values mean the home side is currently leading; the remaining-goal model accounts for game-state chase effects."
            }
          ]
        : [])
    ],
    calibrationNotes: [
      "Scoreline probabilities start from independent Poisson distributions and are normalized across the score matrix.",
      `A Dixon-Coles low-score correction is applied with rho ${dixonColesRho.toFixed(4)} before deriving match winner, totals, BTTS, and scoreline probabilities.`,
      liveProjection
        ? "Live football probabilities combine the current score with a remaining-time Poisson model, including a bounded game-state chase adjustment."
        : "Expected goals are deterministic MVP estimates, not live xG feeds.",
      preMatchExpectedGoals.xg.applied
        ? "When provider xG is available, the football model blends xG-for and opponent xG-against into the pre-match expected-goals estimate with bounded influence."
        : "xG blend is inactive for this fixture because provider xG inputs are not available yet.",
      preMatchExpectedGoals.context.source === "provider-context"
        ? "Provider/context injury, suspension, lineup, weather, or news signals were consumed inside the bounded Poisson expected-goals estimate before market comparison."
        : "Future upgrades can add closing-line calibration, shot-pressure xG, and richer injury/news adjustments."
    ]
  };

  return {
    diagnostics,
    markets: [
    {
      marketId: "match_winner",
      probabilities: {
        home: normalizedHome,
        draw: normalizedDraw,
        away: normalizedAway
      }
    },
    {
      marketId: "over_under_25",
      probabilities: {
        over_25: over25,
        under_25: clampProbability(1 - over25),
        over_15: over15
      }
    },
    {
      marketId: "both_teams_to_score",
      probabilities: {
        yes: btts,
        no: clampProbability(1 - btts)
      }
    }
  ]
  };
}

export function predictFootballMatch(match: Match): PredictionMarket[] {
  return modelFootballMatch(match).markets;
}
