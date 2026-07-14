import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { buildScoreMatrix, probabilityFromScoreMatrix } from "@/lib/sports/prediction/poisson";
import { buildProbabilityCalibration, type ProbabilityCalibrationBucket } from "@/lib/sports/training/probabilityCalibration";
import { benchmarkBacktestModelKey } from "@/lib/sports/prediction/modelIdentity";

export const FOOTBALL_BACKTEST_MODEL_KEY = benchmarkBacktestModelKey("football");

export type FootballOutcome = "home" | "draw" | "away";
export type BacktestConfidence = "low" | "medium" | "high";

export type HistoricalFootballOddsQuote = {
  market: "match_winner";
  selection: FootballOutcome;
  decimalOdds: number;
  isClosing?: boolean;
  observedAt?: string;
  bookmaker?: string;
};

export type HistoricalFootballFixture = {
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
  homeElo?: number | null;
  awayElo?: number | null;
  homeAttackStrength?: number | null;
  awayAttackStrength?: number | null;
  homeDefenseStrength?: number | null;
  awayDefenseStrength?: number | null;
  homeRecentFormPoints?: number | null;
  awayRecentFormPoints?: number | null;
  homeRecentGoalsFor?: number | null;
  awayRecentGoalsFor?: number | null;
  homeRecentGoalsAgainst?: number | null;
  awayRecentGoalsAgainst?: number | null;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  homeInjuriesCount?: number | null;
  awayInjuriesCount?: number | null;
  homeSuspensionsCount?: number | null;
  awaySuspensionsCount?: number | null;
  odds: HistoricalFootballOddsQuote[];
};

export type FootballBacktestConfig = {
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  eloKFactor?: number;
  homeAdvantageElo?: number;
};

export type FootballBacktestPick = {
  selection: FootballOutcome;
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

export type FootballBacktestFixtureResult = {
  fixtureExternalId: string;
  kickoffAt: string;
  actualOutcome: FootballOutcome;
  probabilities: Record<FootballOutcome, number>;
  expectedGoals: { home: number; away: number; total: number };
  brierScore: number;
  logLoss: number;
  pick: FootballBacktestPick | null;
};

export type FootballBacktestBreakdown = {
  sampleSize: number;
  pickCount: number;
  winRate: number | null;
  roiUnits: number;
  yield: number | null;
  brierScore: number | null;
  averageEdge: number | null;
};

export type FootballBacktestResult = {
  sport: "football";
  modelKey: string;
  engineVersion: string;
  generatedAt: string;
  status: "completed" | "no-data";
  sampleSize: number;
  trainSize: number;
  testSize: number;
  pickCount: number;
  windowStart: string | null;
  windowEnd: string | null;
  trainWindowStart: string | null;
  trainWindowEnd: string | null;
  testWindowStart: string | null;
  testWindowEnd: string | null;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  averageEdge: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: ProbabilityCalibrationBucket[];
  marketBreakdown: Record<string, FootballBacktestBreakdown>;
  confidenceBreakdown: Record<string, FootballBacktestBreakdown>;
  learnedWeights: {
    valueEdgeWeight: number;
    dataQualityWeight: number;
    minimumEdge: number;
    marketAdjustmentWeight: number;
    homeAdvantageElo: number;
  };
  config: Required<FootballBacktestConfig>;
  notes: string[];
  results: FootballBacktestFixtureResult[];
};

export type FootballEvaluationSummary = {
  pickCount: number;
  roiUnits: number;
  yield: number | null;
  brierScore: number | null;
  logLoss: number | null;
  averageEdge: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: ProbabilityCalibrationBucket[];
  marketBreakdown: Record<string, FootballBacktestBreakdown>;
  confidenceBreakdown: Record<string, FootballBacktestBreakdown>;
};

export type FootballDecisionLearnedWeights = Omit<FootballBacktestResult["learnedWeights"], "homeAdvantageElo">;

type EloRatings = Map<string, number>;
type SelectionOdds = {
  odds: number;
  closingOdds: number | null;
  impliedProbability: number;
};

const DEFAULT_CONFIG: Required<FootballBacktestConfig> = {
  trainRatio: 0.7,
  minEdge: 0.035,
  minModelProbability: 0.32,
  eloKFactor: 24,
  homeAdvantageElo: 62
};

export function resolveFootballBacktestConfig(config: FootballBacktestConfig = {}): Required<FootballBacktestConfig> {
  return { ...DEFAULT_CONFIG, ...config };
}

function roundMetric(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function safeNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function actualOutcome(homeScore: number, awayScore: number): FootballOutcome {
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

function formRate(points: number | null | undefined): number {
  return clamp(safeNumber(points, 7.5) / 15, 0, 1);
}

function getRating(ratings: EloRatings, teamId: string, fallback?: number | null): number {
  return safeNumber(fallback, ratings.get(teamId) ?? 1500);
}

function expectedHomeResult(homeElo: number, awayElo: number, homeAdvantageElo: number): number {
  return 1 / (1 + 10 ** ((awayElo - (homeElo + homeAdvantageElo)) / 400));
}

function updateEloRatings(
  ratings: EloRatings,
  fixture: HistoricalFootballFixture,
  config: Required<FootballBacktestConfig>
): void {
  const homeElo = getRating(ratings, fixture.homeTeamExternalId, fixture.homeElo);
  const awayElo = getRating(ratings, fixture.awayTeamExternalId, fixture.awayElo);
  const expectedHome = expectedHomeResult(homeElo, awayElo, fixture.neutralVenue ? 0 : config.homeAdvantageElo);
  const actualHome = fixture.homeScore > fixture.awayScore ? 1 : fixture.homeScore === fixture.awayScore ? 0.5 : 0;
  const dataQuality = clamp(safeNumber(fixture.dataQuality, 0.72), 0.35, 1);
  const k = config.eloKFactor * dataQuality;

  ratings.set(fixture.homeTeamExternalId, homeElo + k * (actualHome - expectedHome));
  ratings.set(fixture.awayTeamExternalId, awayElo + k * (1 - actualHome - (1 - expectedHome)));
}

function estimateExpectedGoals(
  fixture: HistoricalFootballFixture,
  homeElo: number,
  awayElo: number,
  config: Required<FootballBacktestConfig>
) {
  const ratingEdge = (homeElo - awayElo) / 400;
  const formEdge = formRate(fixture.homeRecentFormPoints) - formRate(fixture.awayRecentFormPoints);
  const homeAttack = safeNumber(fixture.homeAttackStrength, 1);
  const awayAttack = safeNumber(fixture.awayAttackStrength, 1);
  const homeDefense = safeNumber(fixture.homeDefenseStrength, 1);
  const awayDefense = safeNumber(fixture.awayDefenseStrength, 1);
  const homeGoalsFor = safeNumber(fixture.homeRecentGoalsFor, 1.28);
  const awayGoalsFor = safeNumber(fixture.awayRecentGoalsFor, 1.18);
  const homeGoalsAgainst = safeNumber(fixture.homeRecentGoalsAgainst, 1.15);
  const awayGoalsAgainst = safeNumber(fixture.awayRecentGoalsAgainst, 1.22);
  const injuryEdge =
    (safeNumber(fixture.awayInjuriesCount, 0) +
      safeNumber(fixture.awaySuspensionsCount, 0) -
      safeNumber(fixture.homeInjuriesCount, 0) -
      safeNumber(fixture.homeSuspensionsCount, 0)) *
    0.026;
  const restEdge = (safeNumber(fixture.homeRestDays, 5) - safeNumber(fixture.awayRestDays, 5)) * 0.015;
  const homeAdvantage = fixture.neutralVenue ? 0 : config.homeAdvantageElo / 400;

  const home = clamp(
    1.18 +
      homeAdvantage * 0.52 +
      ratingEdge * 0.88 +
      formEdge * 0.38 +
      (homeAttack - awayDefense) * 0.26 +
      (homeGoalsFor - awayGoalsAgainst) * 0.08 +
      injuryEdge +
      restEdge,
    0.2,
    3.9
  );
  const away = clamp(
    1.06 -
      ratingEdge * 0.72 -
      formEdge * 0.28 +
      (awayAttack - homeDefense) * 0.23 +
      (awayGoalsFor - homeGoalsAgainst) * 0.07 -
      injuryEdge * 0.72 -
      restEdge * 0.5,
    0.2,
    3.6
  );

  return {
    home: roundMetric(home, 4) ?? home,
    away: roundMetric(away, 4) ?? away,
    total: roundMetric(home + away, 4) ?? home + away
  };
}

function probabilitiesFromExpectedGoals(expectedGoals: { home: number; away: number }): Record<FootballOutcome, number> {
  const matrix = buildScoreMatrix(expectedGoals.home, expectedGoals.away);
  const home = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
  const draw = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals);
  const away = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);
  const total = home + draw + away || 1;

  return {
    home: roundMetric(home / total, 6) ?? 0,
    draw: roundMetric(draw / total, 6) ?? 0,
    away: roundMetric(away / total, 6) ?? 0
  };
}

function quoteTime(quote: HistoricalFootballOddsQuote): number {
  return quote.observedAt ? new Date(quote.observedAt).getTime() : 0;
}

function winnerOdds(odds: HistoricalFootballOddsQuote[]): Record<FootballOutcome, SelectionOdds> | null {
  const selections: Partial<Record<FootballOutcome, { taken: HistoricalFootballOddsQuote; closing: HistoricalFootballOddsQuote | null }>> = {};

  for (const selection of ["home", "draw", "away"] as const) {
    const quotes = odds
      .filter((quote) => quote.market === "match_winner" && quote.selection === selection && quote.decimalOdds > 1)
      .sort((a, b) => quoteTime(a) - quoteTime(b));
    if (!quotes.length) return null;
    const taken = quotes.find((quote) => !quote.isClosing) ?? quotes[0];
    const closing = [...quotes].reverse().find((quote) => quote.isClosing) ?? quotes[quotes.length - 1] ?? null;
    selections[selection] = { taken, closing };
  }

  const rawImplied = (["home", "draw", "away"] as const).map((selection) => 1 / selections[selection]!.taken.decimalOdds);
  const margin = rawImplied.reduce((sum, value) => sum + value, 0) || 1;

  return Object.fromEntries(
    (["home", "draw", "away"] as const).map((selection, index) => [
      selection,
      {
        odds: selections[selection]!.taken.decimalOdds,
        closingOdds: selections[selection]!.closing?.decimalOdds ?? null,
        impliedProbability: rawImplied[index] / margin
      }
    ])
  ) as Record<FootballOutcome, SelectionOdds>;
}

function confidenceForPick(edge: number, probability: number, dataQuality: number): BacktestConfidence {
  if (edge >= 0.08 && probability >= 0.5 && dataQuality >= 0.78) return "high";
  if (edge >= 0.05 && probability >= 0.38 && dataQuality >= 0.66) return "medium";
  return "low";
}

function selectBacktestPick(
  fixture: HistoricalFootballFixture,
  probabilities: Record<FootballOutcome, number>,
  odds: Record<FootballOutcome, SelectionOdds>,
  actual: FootballOutcome,
  config: Required<FootballBacktestConfig>
): FootballBacktestPick | null {
  const dataQuality = clamp(safeNumber(fixture.dataQuality, 0.72), 0, 1);
  const candidates = (["home", "draw", "away"] as const)
    .map((selection) => {
      const quote = odds[selection];
      const modelProbability = probabilities[selection];
      const edge = modelProbability - quote.impliedProbability;
      const confidence = confidenceForPick(edge, modelProbability, dataQuality);

      return {
        selection,
        modelProbability,
        impliedProbability: quote.impliedProbability,
        edge,
        odds: quote.odds,
        closingOdds: quote.closingOdds,
        confidence
      };
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

function brierScore(probabilities: Record<FootballOutcome, number>, actual: FootballOutcome): number {
  const score =
    ((probabilities.home - (actual === "home" ? 1 : 0)) ** 2 +
      (probabilities.draw - (actual === "draw" ? 1 : 0)) ** 2 +
      (probabilities.away - (actual === "away" ? 1 : 0)) ** 2) /
    3;
  return roundMetric(score, 6) ?? score;
}

function logLoss(probabilities: Record<FootballOutcome, number>, actual: FootballOutcome): number {
  const probability = clamp(probabilities[actual], 0.000001, 0.999999);
  return roundMetric(-Math.log(probability), 6) ?? -Math.log(probability);
}

function buildBreakdown(results: FootballBacktestFixtureResult[]): FootballBacktestBreakdown {
  const picks = results.map((result) => result.pick).filter((pick): pick is FootballBacktestPick => Boolean(pick));
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

function buildBreakdowns(results: FootballBacktestFixtureResult[]) {
  const byMarket = {
    match_winner: buildBreakdown(results)
  };
  const confidenceGroups = groupBy(results, (result) => result.pick?.confidence ?? "no-pick");
  const byConfidence = Object.fromEntries(
    Object.entries(confidenceGroups).map(([confidence, groupResults]) => [confidence, buildBreakdown(groupResults)])
  );

  return { byMarket, byConfidence };
}

function buildCalibration(results: FootballBacktestFixtureResult[]) {
  return buildProbabilityCalibration(
    results.flatMap((result) =>
      (["home", "draw", "away"] as const).map((selection) => ({
        probability: result.probabilities[selection],
        occurred: result.actualOutcome === selection
      }))
    )
  );
}

/** Evaluate one probability vector using the shared odds, pick, and scoring policy. */
export function evaluateFootballPrediction({
  fixture,
  probabilities,
  expectedGoals,
  config
}: {
  fixture: HistoricalFootballFixture;
  probabilities: Record<FootballOutcome, number>;
  expectedGoals: FootballBacktestFixtureResult["expectedGoals"];
  config: Required<FootballBacktestConfig>;
}): FootballBacktestFixtureResult {
  const actual = actualOutcome(fixture.homeScore, fixture.awayScore);
  const odds = winnerOdds(fixture.odds);
  return {
    fixtureExternalId: fixture.fixtureExternalId,
    kickoffAt: fixture.kickoffAt,
    actualOutcome: actual,
    probabilities,
    expectedGoals,
    brierScore: brierScore(probabilities, actual),
    logLoss: logLoss(probabilities, actual),
    pick: odds ? selectBacktestPick(fixture, probabilities, odds, actual, config) : null
  };
}

/** Aggregate model-agnostic scoring so benchmark and exact-runtime replay stay comparable. */
export function summarizeFootballEvaluation(results: FootballBacktestFixtureResult[]): FootballEvaluationSummary {
  const picks = results.map((result) => result.pick).filter((pick): pick is FootballBacktestPick => Boolean(pick));
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  const breakdowns = buildBreakdowns(results);
  const calibration = buildCalibration(results);
  return {
    pickCount: picks.length,
    roiUnits: roundMetric(roiUnits, 6) ?? 0,
    yield: roundMetric(picks.length ? roiUnits / picks.length : null, 6),
    brierScore: roundMetric(average(results.map((result) => result.brierScore)), 6),
    logLoss: roundMetric(average(results.map((result) => result.logLoss)), 6),
    averageEdge: roundMetric(average(picks.map((pick) => pick.edge)), 6),
    closingLineValue: roundMetric(
      average(picks.map((pick) => pick.closingLineValue).filter((value): value is number => value !== null)),
      6
    ),
    calibrationError: calibration.expectedCalibrationError,
    calibrationBuckets: calibration.buckets,
    marketBreakdown: breakdowns.byMarket,
    confidenceBreakdown: breakdowns.byConfidence
  };
}

function learnedWeights(
  result: Pick<FootballBacktestResult, "pickCount" | "yield" | "brierScore" | "closingLineValue" | "config">
): FootballBacktestResult["learnedWeights"] {
  return {
    ...footballDecisionLearnedWeights(result),
    homeAdvantageElo: result.config.homeAdvantageElo
  };
}

export function footballDecisionLearnedWeights(
  result: Pick<FootballBacktestResult, "pickCount" | "yield" | "brierScore" | "closingLineValue"> & {
    config: Pick<Required<FootballBacktestConfig>, "minEdge">;
  }
): FootballDecisionLearnedWeights {
  const yieldValue = result.yield ?? 0;
  const brierPenalty = result.brierScore !== null && result.brierScore > 0.22 ? 0.03 : 0;
  const clvSignal = result.closingLineValue ?? 0;

  return {
    valueEdgeWeight: roundMetric(clamp(0.32 + yieldValue * 0.25 + clvSignal * 0.1, 0.22, 0.44), 4) ?? 0.32,
    dataQualityWeight: roundMetric(clamp(0.18 + brierPenalty, 0.16, 0.26), 4) ?? 0.18,
    minimumEdge: roundMetric(clamp(result.config.minEdge + (yieldValue < 0 ? 0.02 : -0.005) + brierPenalty, 0.02, 0.09), 4) ?? result.config.minEdge,
    marketAdjustmentWeight: roundMetric(clamp(0.16 + clvSignal * 0.2, 0.08, 0.24), 4) ?? 0.16
  };
}

function resultNotes(result: Pick<FootballBacktestResult, "sampleSize" | "testSize" | "pickCount" | "closingLineValue" | "yield">): string[] {
  return [
    result.sampleSize < 200 ? "Historical sample is thin; import multiple seasons before trusting calibration." : "",
    result.testSize < 50 ? "Holdout set is small; backtest metrics are directional only." : "",
    result.pickCount === 0 ? "No historical picks cleared the value-edge threshold." : "",
    result.closingLineValue === null ? "Closing-line value is unavailable until both taken and closing odds are stored." : "",
    result.yield !== null && result.yield < 0 ? "Backtest yield is negative; raise the minimum edge or discount this market." : ""
  ].filter(Boolean);
}

export function runFootballBacktest(
  fixtures: HistoricalFootballFixture[],
  configInput: FootballBacktestConfig = {}
): FootballBacktestResult {
  const config = resolveFootballBacktestConfig(configInput);
  const sortedFixtures = fixtures
    .filter((fixture) => Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore))
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const sampleSize = sortedFixtures.length;

  if (!sampleSize) {
    return {
      sport: "football",
      modelKey: FOOTBALL_BACKTEST_MODEL_KEY,
      engineVersion: DECISION_ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      status: "no-data",
      sampleSize: 0,
      trainSize: 0,
      testSize: 0,
      pickCount: 0,
      windowStart: null,
      windowEnd: null,
      trainWindowStart: null,
      trainWindowEnd: null,
      testWindowStart: null,
      testWindowEnd: null,
      brierScore: null,
      logLoss: null,
      roiUnits: 0,
      yield: null,
      averageEdge: null,
      closingLineValue: null,
      calibrationError: null,
      calibrationBuckets: [],
      marketBreakdown: {},
      confidenceBreakdown: {},
      learnedWeights: learnedWeights({
        pickCount: 0,
        yield: null,
        brierScore: null,
        closingLineValue: null,
        config
      }),
      config,
      notes: ["No finished historical fixtures are available for backtesting."],
      results: []
    };
  }

  const testStartIndex = Math.min(sampleSize - 1, Math.max(0, Math.floor(sampleSize * clamp(config.trainRatio, 0.1, 0.9))));
  const ratings: EloRatings = new Map();
  const results: FootballBacktestFixtureResult[] = [];

  sortedFixtures.forEach((fixture, index) => {
    const homeElo = getRating(ratings, fixture.homeTeamExternalId, fixture.homeElo);
    const awayElo = getRating(ratings, fixture.awayTeamExternalId, fixture.awayElo);
    const expectedGoals = estimateExpectedGoals(fixture, homeElo, awayElo, config);
    const probabilities = probabilitiesFromExpectedGoals(expectedGoals);

    if (index >= testStartIndex) {
      results.push(evaluateFootballPrediction({ fixture, probabilities, expectedGoals, config }));
    }

    updateEloRatings(ratings, fixture, config);
  });

  const summary = summarizeFootballEvaluation(results);
  const partialResult = {
    pickCount: summary.pickCount,
    yield: summary.yield,
    brierScore: summary.brierScore,
    closingLineValue: summary.closingLineValue,
    config
  };

  const result: FootballBacktestResult = {
    sport: "football",
    modelKey: FOOTBALL_BACKTEST_MODEL_KEY,
    engineVersion: DECISION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: "completed",
    sampleSize,
    trainSize: testStartIndex,
    testSize: results.length,
    pickCount: summary.pickCount,
    windowStart: sortedFixtures[0]?.kickoffAt ?? null,
    windowEnd: sortedFixtures[sortedFixtures.length - 1]?.kickoffAt ?? null,
    trainWindowStart: sortedFixtures[0]?.kickoffAt ?? null,
    trainWindowEnd: sortedFixtures[Math.max(0, testStartIndex - 1)]?.kickoffAt ?? null,
    testWindowStart: sortedFixtures[testStartIndex]?.kickoffAt ?? null,
    testWindowEnd: sortedFixtures[sortedFixtures.length - 1]?.kickoffAt ?? null,
    brierScore: summary.brierScore,
    logLoss: summary.logLoss,
    roiUnits: summary.roiUnits,
    yield: summary.yield,
    averageEdge: summary.averageEdge,
    closingLineValue: summary.closingLineValue,
    calibrationError: summary.calibrationError,
    calibrationBuckets: summary.calibrationBuckets,
    marketBreakdown: summary.marketBreakdown,
    confidenceBreakdown: summary.confidenceBreakdown,
    learnedWeights: learnedWeights(partialResult),
    config,
    notes: [],
    results
  };
  result.notes = resultNotes(result);
  return result;
}
