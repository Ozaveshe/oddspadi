import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { buildProbabilityCalibration, type ProbabilityCalibrationBucket } from "@/lib/sports/training/probabilityCalibration";
import { benchmarkBacktestModelKey } from "@/lib/sports/prediction/modelIdentity";

export const BASKETBALL_BACKTEST_MODEL_KEY = benchmarkBacktestModelKey("basketball");

type BasketballOutcome = "home" | "away";
type BacktestConfidence = "low" | "medium" | "high";

export type HistoricalBasketballOddsQuote = {
  market: "moneyline";
  selection: BasketballOutcome;
  decimalOdds: number;
  isClosing?: boolean;
  observedAt?: string;
  bookmaker?: string;
};

export type HistoricalBasketballFixture = {
  fixtureExternalId: string;
  kickoffAt: string;
  leagueExternalId?: string | null;
  season?: string | null;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  homeScore: number;
  awayScore: number;
  neutralVenue?: boolean;
  dataQuality?: number | null;
  homeRating?: number | null;
  awayRating?: number | null;
  homePace?: number | null;
  awayPace?: number | null;
  homeOffensiveEfficiency?: number | null;
  awayOffensiveEfficiency?: number | null;
  homeDefensiveEfficiency?: number | null;
  awayDefensiveEfficiency?: number | null;
  homeRecentFormPoints?: number | null;
  awayRecentFormPoints?: number | null;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  homeInjuriesCount?: number | null;
  awayInjuriesCount?: number | null;
  homeRotationPenalty?: number | null;
  awayRotationPenalty?: number | null;
  odds: HistoricalBasketballOddsQuote[];
};

export type BasketballBacktestConfig = {
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  ratingKFactor?: number;
  homeCourtPoints?: number;
};

export type BasketballBacktestPick = {
  selection: BasketballOutcome;
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

export type BasketballBacktestFixtureResult = {
  fixtureExternalId: string;
  kickoffAt: string;
  actualOutcome: BasketballOutcome;
  probabilities: Record<BasketballOutcome, number>;
  projectedMargin: number;
  projectedTotal: number;
  brierScore: number;
  logLoss: number;
  pick: BasketballBacktestPick | null;
};

export type BasketballBacktestBreakdown = {
  sampleSize: number;
  pickCount: number;
  winRate: number | null;
  roiUnits: number;
  yield: number | null;
  brierScore: number | null;
  averageEdge: number | null;
};

export type BasketballBacktestResult = {
  sport: "basketball";
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
  marketBreakdown: Record<string, BasketballBacktestBreakdown>;
  confidenceBreakdown: Record<string, BasketballBacktestBreakdown>;
  learnedWeights: {
    valueEdgeWeight: number;
    paceWeight: number;
    dataQualityWeight: number;
    minimumEdge: number;
    homeCourtPoints: number;
  };
  config: Required<BasketballBacktestConfig>;
  notes: string[];
  results: BasketballBacktestFixtureResult[];
};

type Ratings = Map<string, number>;
type SelectionOdds = {
  odds: number;
  closingOdds: number | null;
  impliedProbability: number;
};

const DEFAULT_CONFIG: Required<BasketballBacktestConfig> = {
  trainRatio: 0.7,
  minEdge: 0.035,
  minModelProbability: 0.42,
  ratingKFactor: 18,
  homeCourtPoints: 2.6
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

function actualOutcome(fixture: HistoricalBasketballFixture): BasketballOutcome {
  return fixture.homeScore > fixture.awayScore ? "home" : "away";
}

function getRating(ratings: Ratings, teamId: string, fallback?: number | null): number {
  return safeNumber(fallback, ratings.get(teamId) ?? 1500);
}

function expectedHomeResult(homeRating: number, awayRating: number, homeCourtPoints: number): number {
  return logistic((homeRating - awayRating + homeCourtPoints * 18) / 150);
}

function updateRatings(ratings: Ratings, fixture: HistoricalBasketballFixture, config: Required<BasketballBacktestConfig>): void {
  const homeRating = getRating(ratings, fixture.homeTeamExternalId, fixture.homeRating);
  const awayRating = getRating(ratings, fixture.awayTeamExternalId, fixture.awayRating);
  const expectedHome = expectedHomeResult(homeRating, awayRating, fixture.neutralVenue ? 0 : config.homeCourtPoints);
  const actualHome = actualOutcome(fixture) === "home" ? 1 : 0;
  const marginFactor = clamp(Math.abs(fixture.homeScore - fixture.awayScore) / 12, 0.7, 1.8);
  const dataQuality = clamp(safeNumber(fixture.dataQuality, 0.72), 0.35, 1);
  const k = config.ratingKFactor * marginFactor * dataQuality;

  ratings.set(fixture.homeTeamExternalId, homeRating + k * (actualHome - expectedHome));
  ratings.set(fixture.awayTeamExternalId, awayRating + k * ((1 - actualHome) - (1 - expectedHome)));
}

function projectGame(
  fixture: HistoricalBasketballFixture,
  homeRating: number,
  awayRating: number,
  config: Required<BasketballBacktestConfig>
): { probabilities: Record<BasketballOutcome, number>; projectedMargin: number; projectedTotal: number } {
  const ratingMargin = (homeRating - awayRating) / 18;
  const homeCourt = fixture.neutralVenue ? 0 : config.homeCourtPoints;
  const formMargin = (safeNumber(fixture.homeRecentFormPoints, 5) - safeNumber(fixture.awayRecentFormPoints, 5)) * 0.65;
  const efficiencyMargin =
    (safeNumber(fixture.homeOffensiveEfficiency, 112) - safeNumber(fixture.awayDefensiveEfficiency, 112)) * 0.09 -
    (safeNumber(fixture.awayOffensiveEfficiency, 112) - safeNumber(fixture.homeDefensiveEfficiency, 112)) * 0.09;
  const restMargin = (safeNumber(fixture.homeRestDays, 2) - safeNumber(fixture.awayRestDays, 2)) * 0.8;
  const availabilityMargin =
    (safeNumber(fixture.awayInjuriesCount, 0) +
      safeNumber(fixture.awayRotationPenalty, 0) -
      safeNumber(fixture.homeInjuriesCount, 0) -
      safeNumber(fixture.homeRotationPenalty, 0)) *
    0.7;
  const projectedMargin = clamp(ratingMargin + homeCourt + formMargin + efficiencyMargin + restMargin + availabilityMargin, -26, 26);
  const averagePace = (safeNumber(fixture.homePace, 98) + safeNumber(fixture.awayPace, 98)) / 2;
  const projectedTotal = clamp(
    214 +
      (averagePace - 98) * 1.25 +
      (safeNumber(fixture.homeOffensiveEfficiency, 112) + safeNumber(fixture.awayOffensiveEfficiency, 112) - 224) * 0.42 -
      (safeNumber(fixture.homeRotationPenalty, 0) + safeNumber(fixture.awayRotationPenalty, 0)) * 1.1,
    178,
    252
  );
  const home = clamp(logistic(projectedMargin / 7.2), 0.01, 0.99);
  const away = 1 - home;

  return {
    probabilities: { home: roundMetric(home, 6) ?? home, away: roundMetric(away, 6) ?? away },
    projectedMargin: roundMetric(projectedMargin, 4) ?? projectedMargin,
    projectedTotal: roundMetric(projectedTotal, 4) ?? projectedTotal
  };
}

function quoteTime(quote: HistoricalBasketballOddsQuote): number {
  return quote.observedAt ? new Date(quote.observedAt).getTime() : 0;
}

function moneylineOdds(odds: HistoricalBasketballOddsQuote[]): Record<BasketballOutcome, SelectionOdds> | null {
  const selections: Partial<Record<BasketballOutcome, { taken: HistoricalBasketballOddsQuote; closing: HistoricalBasketballOddsQuote | null }>> = {};

  for (const selection of ["home", "away"] as const) {
    const quotes = odds
      .filter((quote) => quote.market === "moneyline" && quote.selection === selection && quote.decimalOdds > 1)
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
  if (edge >= 0.08 && probability >= 0.56 && dataQuality >= 0.78) return "high";
  if (edge >= 0.05 && probability >= 0.48 && dataQuality >= 0.66) return "medium";
  return "low";
}

function selectPick(
  fixture: HistoricalBasketballFixture,
  probabilities: Record<BasketballOutcome, number>,
  odds: Record<BasketballOutcome, SelectionOdds>,
  actual: BasketballOutcome,
  config: Required<BasketballBacktestConfig>
): BasketballBacktestPick | null {
  const dataQuality = clamp(safeNumber(fixture.dataQuality, 0.72), 0, 1);
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

function brierScore(probabilities: Record<BasketballOutcome, number>, actual: BasketballOutcome): number {
  const score = ((probabilities.home - (actual === "home" ? 1 : 0)) ** 2 + (probabilities.away - (actual === "away" ? 1 : 0)) ** 2) / 2;
  return roundMetric(score, 6) ?? score;
}

function logLoss(probabilities: Record<BasketballOutcome, number>, actual: BasketballOutcome): number {
  const probability = clamp(probabilities[actual], 0.000001, 0.999999);
  return roundMetric(-Math.log(probability), 6) ?? -Math.log(probability);
}

function buildBreakdown(results: BasketballBacktestFixtureResult[]): BasketballBacktestBreakdown {
  const picks = results.map((result) => result.pick).filter((pick): pick is BasketballBacktestPick => Boolean(pick));
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
  for (const item of items) groups[keyForItem(item)] = [...(groups[keyForItem(item)] ?? []), item];
  return groups;
}

function buildCalibration(results: BasketballBacktestFixtureResult[]) {
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
  result: Pick<BasketballBacktestResult, "yield" | "brierScore" | "closingLineValue" | "config">
): BasketballBacktestResult["learnedWeights"] {
  const yieldValue = result.yield ?? 0;
  const brierPenalty = result.brierScore !== null && result.brierScore > 0.24 ? 0.025 : 0;
  const clvSignal = result.closingLineValue ?? 0;
  return {
    valueEdgeWeight: roundMetric(clamp(0.3 + yieldValue * 0.22 + clvSignal * 0.1, 0.2, 0.44), 4) ?? 0.3,
    paceWeight: roundMetric(clamp(0.14 + (result.brierScore !== null && result.brierScore < 0.2 ? 0.02 : 0), 0.1, 0.2), 4) ?? 0.14,
    dataQualityWeight: roundMetric(clamp(0.17 + brierPenalty, 0.15, 0.25), 4) ?? 0.17,
    minimumEdge: roundMetric(clamp(result.config.minEdge + (yieldValue < 0 ? 0.018 : -0.004) + brierPenalty, 0.02, 0.09), 4) ?? result.config.minEdge,
    homeCourtPoints: result.config.homeCourtPoints
  };
}

function resultNotes(result: Pick<BasketballBacktestResult, "sampleSize" | "testSize" | "pickCount" | "closingLineValue" | "yield">): string[] {
  return [
    result.sampleSize < 300 ? "Basketball historical sample is thin; import multiple seasons before trusting calibration." : "",
    result.testSize < 80 ? "Holdout set is small for basketball variance; metrics are directional only." : "",
    result.pickCount === 0 ? "No basketball picks cleared the value-edge threshold." : "",
    result.closingLineValue === null ? "Closing-line value is unavailable until taken and closing moneyline odds are stored." : "",
    result.yield !== null && result.yield < 0 ? "Backtest yield is negative; raise the minimum edge or discount this market." : ""
  ].filter(Boolean);
}

export function runBasketballBacktest(
  fixtures: HistoricalBasketballFixture[],
  configInput: BasketballBacktestConfig = {}
): BasketballBacktestResult {
  const config = { ...DEFAULT_CONFIG, ...configInput };
  const sortedFixtures = fixtures
    .filter((fixture) => Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore) && fixture.homeScore !== fixture.awayScore)
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const sampleSize = sortedFixtures.length;

  if (!sampleSize) {
    return {
      sport: "basketball",
      modelKey: BASKETBALL_BACKTEST_MODEL_KEY,
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
      confidenceBreakdown: {},
      learnedWeights: learnedWeights({ yield: null, brierScore: null, closingLineValue: null, config }),
      config,
      notes: ["No finished historical basketball fixtures are available for backtesting."],
      results: []
    };
  }

  const testStartIndex = Math.min(sampleSize - 1, Math.max(0, Math.floor(sampleSize * clamp(config.trainRatio, 0.1, 0.9))));
  const ratings: Ratings = new Map();
  const results: BasketballBacktestFixtureResult[] = [];

  sortedFixtures.forEach((fixture, index) => {
    const homeRating = getRating(ratings, fixture.homeTeamExternalId, fixture.homeRating);
    const awayRating = getRating(ratings, fixture.awayTeamExternalId, fixture.awayRating);
    const actual = actualOutcome(fixture);
    const projection = projectGame(fixture, homeRating, awayRating, config);
    const odds = moneylineOdds(fixture.odds);
    if (index >= testStartIndex) {
      const pick = odds ? selectPick(fixture, projection.probabilities, odds, actual, config) : null;
      results.push({
        fixtureExternalId: fixture.fixtureExternalId,
        kickoffAt: fixture.kickoffAt,
        actualOutcome: actual,
        probabilities: projection.probabilities,
        projectedMargin: projection.projectedMargin,
        projectedTotal: projection.projectedTotal,
        brierScore: brierScore(projection.probabilities, actual),
        logLoss: logLoss(projection.probabilities, actual),
        pick
      });
    }
    updateRatings(ratings, fixture, config);
  });

  const picks = results.map((result) => result.pick).filter((pick): pick is BasketballBacktestPick => Boolean(pick));
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  const brier = roundMetric(average(results.map((result) => result.brierScore)), 6);
  const loss = roundMetric(average(results.map((result) => result.logLoss)), 6);
  const averageEdge = roundMetric(average(picks.map((pick) => pick.edge)), 6);
  const clv = roundMetric(average(picks.map((pick) => pick.closingLineValue).filter((value): value is number => value !== null)), 6);
  const yieldValue = roundMetric(picks.length ? roiUnits / picks.length : null, 6);
  const confidenceGroups = groupBy(results, (result) => result.pick?.confidence ?? "no-pick");
  const calibration = buildCalibration(results);

  const result: BasketballBacktestResult = {
    sport: "basketball",
    modelKey: BASKETBALL_BACKTEST_MODEL_KEY,
    engineVersion: DECISION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: "completed",
    sampleSize,
    trainSize: testStartIndex,
    testSize: results.length,
    windowStart: sortedFixtures[0]?.kickoffAt ?? null,
    windowEnd: sortedFixtures[sortedFixtures.length - 1]?.kickoffAt ?? null,
    brierScore: brier,
    logLoss: loss,
    pickCount: picks.length,
    roiUnits: roundMetric(roiUnits, 6) ?? 0,
    yield: yieldValue,
    averageEdge,
    closingLineValue: clv,
    calibrationError: calibration.expectedCalibrationError,
    calibrationBuckets: calibration.buckets,
    marketBreakdown: { moneyline: buildBreakdown(results) },
    confidenceBreakdown: Object.fromEntries(Object.entries(confidenceGroups).map(([key, group]) => [key, buildBreakdown(group)])),
    learnedWeights: learnedWeights({ yield: yieldValue, brierScore: brier, closingLineValue: clv, config }),
    config,
    notes: [],
    results
  };
  result.notes = resultNotes(result);
  return result;
}
