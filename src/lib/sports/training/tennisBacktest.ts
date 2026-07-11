import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { buildProbabilityCalibration, type ProbabilityCalibrationBucket } from "@/lib/sports/training/probabilityCalibration";

export const TENNIS_BACKTEST_MODEL_KEY = "tennis-surface-elo-match-winner-v1";

type TennisOutcome = "home" | "away";
type TennisSurface = "hard" | "clay" | "grass" | "indoor" | "unknown";
type BacktestConfidence = "low" | "medium" | "high";

export type HistoricalTennisOddsQuote = {
  market: "match_winner";
  selection: TennisOutcome;
  decimalOdds: number;
  isClosing?: boolean;
  observedAt?: string;
  bookmaker?: string;
};

export type HistoricalTennisMatch = {
  fixtureExternalId: string;
  kickoffAt: string;
  tournamentExternalId?: string | null;
  season?: string | null;
  surface?: TennisSurface | null;
  round?: string | null;
  homePlayerExternalId: string;
  awayPlayerExternalId: string;
  homeSets: number;
  awaySets: number;
  dataQuality?: number | null;
  homeElo?: number | null;
  awayElo?: number | null;
  homeSurfaceRating?: number | null;
  awaySurfaceRating?: number | null;
  homeRecentFormPoints?: number | null;
  awayRecentFormPoints?: number | null;
  homeHeadToHeadWins?: number | null;
  awayHeadToHeadWins?: number | null;
  homeFatigueScore?: number | null;
  awayFatigueScore?: number | null;
  homeInjuryRisk?: number | null;
  awayInjuryRisk?: number | null;
  odds: HistoricalTennisOddsQuote[];
};

export type TennisBacktestConfig = {
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  eloKFactor?: number;
  surfaceWeight?: number;
};

export type TennisBacktestPick = {
  selection: TennisOutcome;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  odds: number;
  closingOdds: number | null;
  confidence: BacktestConfidence;
  won: boolean;
  unitReturn: number;
  closingLineValue: number | null;
};

export type TennisBacktestMatchResult = {
  fixtureExternalId: string;
  kickoffAt: string;
  surface: TennisSurface;
  actualOutcome: TennisOutcome;
  probabilities: Record<TennisOutcome, number>;
  ratingEdge: number;
  adjustmentEdge: number;
  brierScore: number;
  logLoss: number;
  pick: TennisBacktestPick | null;
};

export type TennisBacktestBreakdown = {
  sampleSize: number;
  pickCount: number;
  winRate: number | null;
  roiUnits: number;
  yield: number | null;
  brierScore: number | null;
  averageEdge: number | null;
};

export type TennisBacktestResult = {
  sport: "tennis";
  modelKey: string;
  engineVersion: string;
  generatedAt: string;
  status: "completed" | "no-data";
  sampleSize: number;
  trainSize: number;
  testSize: number;
  windowStart: string | null;
  windowEnd: string | null;
  brierScore: number | null;
  logLoss: number | null;
  pickCount: number;
  roiUnits: number;
  yield: number | null;
  averageEdge: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: ProbabilityCalibrationBucket[];
  marketBreakdown: Record<string, TennisBacktestBreakdown>;
  surfaceBreakdown: Record<string, TennisBacktestBreakdown>;
  confidenceBreakdown: Record<string, TennisBacktestBreakdown>;
  learnedWeights: {
    valueEdgeWeight: number;
    surfaceWeight: number;
    dataQualityWeight: number;
    minimumEdge: number;
    eloKFactor: number;
  };
  config: Required<TennisBacktestConfig>;
  notes: string[];
  results: TennisBacktestMatchResult[];
};

type Ratings = Map<string, number>;
type SelectionOdds = {
  odds: number;
  closingOdds: number | null;
  impliedProbability: number;
};

const DEFAULT_CONFIG: Required<TennisBacktestConfig> = {
  trainRatio: 0.7,
  minEdge: 0.032,
  minModelProbability: 0.43,
  eloKFactor: 24,
  surfaceWeight: 0.18
};

function roundMetric(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function safeNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedSurface(surface: TennisSurface | null | undefined): TennisSurface {
  return surface ?? "unknown";
}

function actualOutcome(match: HistoricalTennisMatch): TennisOutcome {
  return match.homeSets > match.awaySets ? "home" : "away";
}

function getRating(ratings: Ratings, playerId: string, fallback?: number | null): number {
  return safeNumber(fallback, ratings.get(playerId) ?? 1700);
}

function isLateRound(round: string | null | undefined): boolean {
  const value = round?.toLowerCase() ?? "";
  return value.includes("final") || value.includes("semi") || value.includes("quarter");
}

function projectMatch(
  match: HistoricalTennisMatch,
  homeElo: number,
  awayElo: number,
  config: Required<TennisBacktestConfig>
): { probabilities: Record<TennisOutcome, number>; ratingEdge: number; adjustmentEdge: number } {
  const ratingEdge = (homeElo - awayElo) / 165;
  const surfaceEdge = (safeNumber(match.homeSurfaceRating, 0.5) - safeNumber(match.awaySurfaceRating, 0.5)) * config.surfaceWeight * 4.2;
  const formEdge = (safeNumber(match.homeRecentFormPoints, 7) - safeNumber(match.awayRecentFormPoints, 7)) * 0.045;
  const headToHeadEdge = (safeNumber(match.homeHeadToHeadWins, 0) - safeNumber(match.awayHeadToHeadWins, 0)) * 0.055;
  const fatigueEdge = (safeNumber(match.awayFatigueScore, 1.6) - safeNumber(match.homeFatigueScore, 1.6)) * 0.11;
  const injuryEdge = (safeNumber(match.awayInjuryRisk, 0) - safeNumber(match.homeInjuryRisk, 0)) * 0.5;
  const roundPressureEdge = isLateRound(match.round) ? ratingEdge * 0.08 : 0;
  const adjustmentEdge = clamp(surfaceEdge + formEdge + headToHeadEdge + fatigueEdge + injuryEdge + roundPressureEdge, -1.15, 1.15);
  const home = clamp(logistic(ratingEdge + adjustmentEdge), 0.01, 0.99);
  const away = 1 - home;

  return {
    probabilities: { home: roundMetric(home, 6) ?? home, away: roundMetric(away, 6) ?? away },
    ratingEdge: roundMetric(ratingEdge, 4) ?? ratingEdge,
    adjustmentEdge: roundMetric(adjustmentEdge, 4) ?? adjustmentEdge
  };
}

function updateRatings(ratings: Ratings, match: HistoricalTennisMatch, config: Required<TennisBacktestConfig>): void {
  const homeElo = getRating(ratings, match.homePlayerExternalId, match.homeElo);
  const awayElo = getRating(ratings, match.awayPlayerExternalId, match.awayElo);
  const projection = projectMatch(match, homeElo, awayElo, config);
  const actualHome = actualOutcome(match) === "home" ? 1 : 0;
  const setMarginFactor = clamp(Math.abs(match.homeSets - match.awaySets) / 2, 0.75, 1.35);
  const dataQuality = clamp(safeNumber(match.dataQuality, 0.72), 0.35, 1);
  const k = config.eloKFactor * setMarginFactor * dataQuality;

  ratings.set(match.homePlayerExternalId, homeElo + k * (actualHome - projection.probabilities.home));
  ratings.set(match.awayPlayerExternalId, awayElo + k * ((1 - actualHome) - projection.probabilities.away));
}

function quoteTime(quote: HistoricalTennisOddsQuote): number {
  return quote.observedAt ? new Date(quote.observedAt).getTime() : 0;
}

function matchWinnerOdds(odds: HistoricalTennisOddsQuote[]): Record<TennisOutcome, SelectionOdds> | null {
  const selections: Partial<Record<TennisOutcome, { taken: HistoricalTennisOddsQuote; closing: HistoricalTennisOddsQuote | null }>> = {};

  for (const selection of ["home", "away"] as const) {
    const quotes = odds
      .filter((quote) => quote.market === "match_winner" && quote.selection === selection && quote.decimalOdds > 1)
      .sort((a, b) => quoteTime(a) - quoteTime(b));
    if (!quotes.length) return null;
    const taken = quotes.find((quote) => !quote.isClosing) ?? quotes[0];
    const closing = [...quotes].reverse().find((quote) => quote.isClosing) ?? quotes[quotes.length - 1] ?? null;
    selections[selection] = { taken, closing };
  }

  const rawHome = 1 / selections.home!.taken.decimalOdds;
  const rawAway = 1 / selections.away!.taken.decimalOdds;
  const margin = rawHome + rawAway || 1;

  return {
    home: {
      odds: selections.home!.taken.decimalOdds,
      closingOdds: selections.home!.closing?.decimalOdds ?? null,
      impliedProbability: rawHome / margin
    },
    away: {
      odds: selections.away!.taken.decimalOdds,
      closingOdds: selections.away!.closing?.decimalOdds ?? null,
      impliedProbability: rawAway / margin
    }
  };
}

function confidenceForPick(edge: number, probability: number, dataQuality: number): BacktestConfidence {
  if (edge >= 0.075 && probability >= 0.57 && dataQuality >= 0.78) return "high";
  if (edge >= 0.048 && probability >= 0.49 && dataQuality >= 0.66) return "medium";
  return "low";
}

function selectPick(
  match: HistoricalTennisMatch,
  probabilities: Record<TennisOutcome, number>,
  odds: Record<TennisOutcome, SelectionOdds>,
  actual: TennisOutcome,
  config: Required<TennisBacktestConfig>
): TennisBacktestPick | null {
  const dataQuality = clamp(safeNumber(match.dataQuality, 0.72), 0, 1);
  const candidates = (["home", "away"] as const)
    .map((selection) => {
      const quote = odds[selection];
      const modelProbability = probabilities[selection];
      const edge = modelProbability - quote.impliedProbability;
      const confidence = confidenceForPick(edge, modelProbability, dataQuality);
      return { selection, modelProbability, impliedProbability: quote.impliedProbability, edge, odds: quote.odds, closingOdds: quote.closingOdds, confidence };
    })
    .filter((pick) => pick.edge >= config.minEdge && pick.modelProbability >= config.minModelProbability)
    .sort((a, b) => b.edge - a.edge);
  const pick = candidates[0];
  if (!pick) return null;
  const won = pick.selection === actual;
  const unitReturn = won ? pick.odds - 1 : -1;
  const closingLineValue = pick.closingOdds && pick.closingOdds > 1 ? pick.odds / pick.closingOdds - 1 : null;

  return {
    ...pick,
    modelProbability: roundMetric(pick.modelProbability, 6) ?? pick.modelProbability,
    impliedProbability: roundMetric(pick.impliedProbability, 6) ?? pick.impliedProbability,
    edge: roundMetric(pick.edge, 6) ?? pick.edge,
    won,
    unitReturn: roundMetric(unitReturn, 6) ?? unitReturn,
    closingLineValue: roundMetric(closingLineValue, 6)
  };
}

function brierScore(probabilities: Record<TennisOutcome, number>, actual: TennisOutcome): number {
  const score = ((probabilities.home - (actual === "home" ? 1 : 0)) ** 2 + (probabilities.away - (actual === "away" ? 1 : 0)) ** 2) / 2;
  return roundMetric(score, 6) ?? score;
}

function logLoss(probabilities: Record<TennisOutcome, number>, actual: TennisOutcome): number {
  const probability = clamp(probabilities[actual], 0.000001, 0.999999);
  return roundMetric(-Math.log(probability), 6) ?? -Math.log(probability);
}

function buildBreakdown(results: TennisBacktestMatchResult[]): TennisBacktestBreakdown {
  const picks = results.map((result) => result.pick).filter((pick): pick is TennisBacktestPick => Boolean(pick));
  const wins = picks.filter((pick) => pick.won).length;
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  return {
    sampleSize: results.length,
    pickCount: picks.length,
    winRate: roundMetric(picks.length ? wins / picks.length : null, 6),
    roiUnits: roundMetric(roiUnits, 6) ?? 0,
    yield: roundMetric(picks.length ? roiUnits / picks.length : null, 6),
    brierScore: roundMetric(average(results.map((result) => result.brierScore)), 6),
    averageEdge: roundMetric(average(picks.map((pick) => pick.edge)), 6)
  };
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyForItem(item);
    groups[key] = [...(groups[key] ?? []), item];
  }
  return groups;
}

function buildCalibration(results: TennisBacktestMatchResult[]) {
  return buildProbabilityCalibration(
    results.flatMap((result) =>
      (["home", "away"] as const).map((selection) => ({
        probability: result.probabilities[selection],
        occurred: result.actualOutcome === selection
      }))
    )
  );
}

function learnedWeights(
  result: Pick<TennisBacktestResult, "yield" | "brierScore" | "closingLineValue" | "config">
): TennisBacktestResult["learnedWeights"] {
  const yieldValue = result.yield ?? 0;
  const brierPenalty = result.brierScore !== null && result.brierScore > 0.23 ? 0.022 : 0;
  const clvSignal = result.closingLineValue ?? 0;
  return {
    valueEdgeWeight: roundMetric(clamp(0.28 + yieldValue * 0.2 + clvSignal * 0.1, 0.18, 0.42), 4) ?? 0.28,
    surfaceWeight: roundMetric(clamp(result.config.surfaceWeight + (result.brierScore !== null && result.brierScore < 0.19 ? 0.015 : 0), 0.12, 0.24), 4) ?? result.config.surfaceWeight,
    dataQualityWeight: roundMetric(clamp(0.16 + brierPenalty, 0.14, 0.24), 4) ?? 0.16,
    minimumEdge: roundMetric(clamp(result.config.minEdge + (yieldValue < 0 ? 0.016 : -0.004) + brierPenalty, 0.02, 0.085), 4) ?? result.config.minEdge,
    eloKFactor: result.config.eloKFactor
  };
}

function resultNotes(result: Pick<TennisBacktestResult, "sampleSize" | "testSize" | "pickCount" | "closingLineValue" | "yield">): string[] {
  return [
    result.sampleSize < 500 ? "Tennis historical sample is thin; import multiple seasons, surfaces, and tours before trusting calibration." : "",
    result.testSize < 120 ? "Holdout set is small for tennis upset variance; metrics are directional only." : "",
    result.pickCount === 0 ? "No tennis picks cleared the value-edge threshold." : "",
    result.closingLineValue === null ? "Closing-line value is unavailable until taken and closing match-winner odds are stored." : "",
    result.yield !== null && result.yield < 0 ? "Backtest yield is negative; raise the minimum edge or discount this market." : ""
  ].filter(Boolean);
}

export function runTennisBacktest(matches: HistoricalTennisMatch[], configInput: TennisBacktestConfig = {}): TennisBacktestResult {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const sortedMatches = matches
    .filter((match) => Number.isFinite(match.homeSets) && Number.isFinite(match.awaySets) && match.homeSets !== match.awaySets)
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const sampleSize = sortedMatches.length;

  if (!sampleSize) {
    return {
      sport: "tennis",
      modelKey: TENNIS_BACKTEST_MODEL_KEY,
      engineVersion: DECISION_ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      status: "no-data",
      sampleSize: 0,
      trainSize: 0,
      testSize: 0,
      windowStart: null,
      windowEnd: null,
      brierScore: null,
      logLoss: null,
      pickCount: 0,
      roiUnits: 0,
      yield: null,
      averageEdge: null,
      closingLineValue: null,
      calibrationError: null,
      calibrationBuckets: [],
      marketBreakdown: {},
      surfaceBreakdown: {},
      confidenceBreakdown: {},
      learnedWeights: learnedWeights({ yield: null, brierScore: null, closingLineValue: null, config }),
      config,
      notes: ["No finished historical tennis matches are available for backtesting."],
      results: []
    };
  }

  const testStartIndex = Math.min(sampleSize - 1, Math.max(0, Math.floor(sampleSize * clamp(config.trainRatio, 0.1, 0.9))));
  const ratings: Ratings = new Map();
  const results: TennisBacktestMatchResult[] = [];

  sortedMatches.forEach((match, index) => {
    const homeElo = getRating(ratings, match.homePlayerExternalId, match.homeElo);
    const awayElo = getRating(ratings, match.awayPlayerExternalId, match.awayElo);
    const actual = actualOutcome(match);
    const projection = projectMatch(match, homeElo, awayElo, config);
    const odds = matchWinnerOdds(match.odds);
    if (index >= testStartIndex) {
      const pick = odds ? selectPick(match, projection.probabilities, odds, actual, config) : null;
      results.push({
        fixtureExternalId: match.fixtureExternalId,
        kickoffAt: match.kickoffAt,
        surface: normalizedSurface(match.surface),
        actualOutcome: actual,
        probabilities: projection.probabilities,
        ratingEdge: projection.ratingEdge,
        adjustmentEdge: projection.adjustmentEdge,
        brierScore: brierScore(projection.probabilities, actual),
        logLoss: logLoss(projection.probabilities, actual),
        pick
      });
    }
    updateRatings(ratings, match, config);
  });

  const picks = results.map((result) => result.pick).filter((pick): pick is TennisBacktestPick => Boolean(pick));
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  const brier = roundMetric(average(results.map((result) => result.brierScore)), 6);
  const loss = roundMetric(average(results.map((result) => result.logLoss)), 6);
  const averageEdge = roundMetric(average(picks.map((pick) => pick.edge)), 6);
  const clv = roundMetric(average(picks.map((pick) => pick.closingLineValue).filter((value): value is number => value !== null)), 6);
  const yieldValue = roundMetric(picks.length ? roiUnits / picks.length : null, 6);
  const surfaceGroups = groupBy(results, (result) => result.surface);
  const confidenceGroups = groupBy(results, (result) => result.pick?.confidence ?? "no-pick");
  const calibration = buildCalibration(results);

  const result: TennisBacktestResult = {
    sport: "tennis",
    modelKey: TENNIS_BACKTEST_MODEL_KEY,
    engineVersion: DECISION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: "completed",
    sampleSize,
    trainSize: testStartIndex,
    testSize: results.length,
    windowStart: sortedMatches[0]?.kickoffAt ?? null,
    windowEnd: sortedMatches[sortedMatches.length - 1]?.kickoffAt ?? null,
    brierScore: brier,
    logLoss: loss,
    pickCount: picks.length,
    roiUnits: roundMetric(roiUnits, 6) ?? 0,
    yield: yieldValue,
    averageEdge,
    closingLineValue: clv,
    calibrationError: calibration.expectedCalibrationError,
    calibrationBuckets: calibration.buckets,
    marketBreakdown: { match_winner: buildBreakdown(results) },
    surfaceBreakdown: Object.fromEntries(Object.entries(surfaceGroups).map(([key, group]) => [key, buildBreakdown(group)])),
    confidenceBreakdown: Object.fromEntries(Object.entries(confidenceGroups).map(([key, group]) => [key, buildBreakdown(group)])),
    learnedWeights: learnedWeights({ yield: yieldValue, brierScore: brier, closingLineValue: clv, config }),
    config,
    notes: [],
    results
  };
  result.notes = resultNotes(result);
  return result;
}
