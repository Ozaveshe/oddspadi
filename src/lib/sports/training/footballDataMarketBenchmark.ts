import { calculateBookmakerMargin, decimalOddsToImpliedProbability, removeBookmakerMargin } from "@/lib/sports/prediction/odds";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { footballDataCandidatesToBacktestFixtures } from "@/lib/sports/training/footballDataCsvBacktestProbe";
import {
  footballDataSeasonCode,
  normalizeFootballDataSeasonRange,
  parseFootballDataCsv,
  parseFootballDataCsvFixtureCandidates,
  type FootballDataCsvFixtureCandidate
} from "@/lib/sports/training/footballDataCsvCorpusProbe";
import { FOOTBALL_BACKTEST_MODEL_KEY, runFootballBacktest, type FootballBacktestResult } from "@/lib/sports/training/footballBacktest";

type FetchCsv = (url: string) => Promise<string>;
type Outcome = "home" | "draw" | "away";

export type FootballDataMarketBenchmarkStatus = "completed" | "partial" | "no-data" | "failed";
export type FootballDataMarketBenchmarkVerdict = "model-beats-market" | "market-beats-model" | "mixed" | "insufficient";
export type FootballDataMarketBenchmarkAction = "eligible-for-provider-enriched-retest" | "defer-to-market-prior" | "keep-shadow-locked";

export type FootballDataMarketBenchmark = {
  mode: "football-data-market-benchmark";
  generatedAt: string;
  status: FootballDataMarketBenchmarkStatus;
  summary: string;
  provider: {
    name: "Football-Data.co.uk";
    leagueCode: "E0";
    competition: "English Premier League";
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    dryRun: true;
    trainRatio: number;
    minEdge: number;
    minModelProbability: number;
  };
  corpus: {
    seasonsRequested: number;
    seasonsLoaded: number;
    fixtureCandidates: number;
    consensusRows: number;
    holdoutRows: number;
    matchedRows: number;
    failedSeasons: Array<{
      season: string;
      sourceUrl: string;
      error: string;
    }>;
  };
  model: Pick<
    FootballBacktestResult,
    "modelKey" | "sampleSize" | "trainSize" | "testSize" | "pickCount" | "brierScore" | "logLoss" | "yield" | "calibrationError"
  >;
  market: {
    rows: number;
    brierScore: number | null;
    logLoss: number | null;
    averageMargin: number | null;
    averageDisagreement: number | null;
  };
  comparison: {
    modelBrierDelta: number | null;
    modelLogLossDelta: number | null;
    modelBeatsMarketBrier: boolean | null;
    modelBeatsMarketLogLoss: boolean | null;
    marketBeatsModel: boolean | null;
    verdict: FootballDataMarketBenchmarkVerdict;
  };
  recommendation: {
    action: FootballDataMarketBenchmarkAction;
    summary: string;
    risks: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsBenchmark: boolean;
    canApplyMarketPrior: false;
    canPersistBenchmark: false;
    canPersistTrainingRows: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
};

const DEFAULT_TRAIN_RATIO = 0.7;
const DEFAULT_MIN_EDGE = 0.02;
const DEFAULT_MIN_MODEL_PROBABILITY = 0.36;
const BOOKMAKER_PREFIXES = ["PS", "B365", "BW", "IW", "WH", "VC", "Max", "Avg"] as const;

type MarketConsensusRow = {
  fixtureExternalId: string;
  probabilities: Record<Outcome, number>;
  margin: number | null;
  disagreement: number | null;
};

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

function seasonLabel(seasonStart: number): string {
  return `${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values) ?? 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function parseNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function rowObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function marketTriples(row: Record<string, string>) {
  return BOOKMAKER_PREFIXES.flatMap((prefix) => {
    const home = parseNumber(row[`${prefix}H`]);
    const draw = parseNumber(row[`${prefix}D`]);
    const away = parseNumber(row[`${prefix}A`]);
    if (!home || !draw || !away) return [];
    const raw = [home, draw, away].map(decimalOddsToImpliedProbability);
    const noVig = removeBookmakerMargin(raw);
    return [
      {
        margin: calculateBookmakerMargin(raw),
        noVig: {
          home: noVig[0] ?? 0,
          draw: noVig[1] ?? 0,
          away: noVig[2] ?? 0
        }
      }
    ];
  });
}

function disagreement(markets: ReturnType<typeof marketTriples>): number | null {
  if (markets.length < 2) return null;
  const spreads = (["home", "draw", "away"] as const).flatMap((outcome) => {
    const spread = stddev(markets.map((market) => market.noVig[outcome]));
    return spread === null ? [] : [spread];
  });
  return round(average(spreads), 6);
}

function consensus(markets: ReturnType<typeof marketTriples>): Record<Outcome, number> {
  const raw = [
    average(markets.map((market) => market.noVig.home)) ?? 0,
    average(markets.map((market) => market.noVig.draw)) ?? 0,
    average(markets.map((market) => market.noVig.away)) ?? 0
  ];
  const normalized = removeBookmakerMargin(raw);
  return {
    home: round(normalized[0] ?? 0, 6) ?? 0,
    draw: round(normalized[1] ?? 0, 6) ?? 0,
    away: round(normalized[2] ?? 0, 6) ?? 0
  };
}

function seasonConsensusRows(seasonStart: number, text: string): MarketConsensusRow[] {
  const parsed = parseFootballDataCsv(text);
  const headers = parsed[0]?.map((item) => item.trim()).filter(Boolean) ?? [];
  const rows = parsed.slice(1).map((row) => rowObject(headers, row));
  return rows.flatMap((row, index) => {
    const markets = marketTriples(row);
    if (!markets.length) return [];
    return [
      {
        fixtureExternalId: `football-data:E0:${footballDataSeasonCode(seasonStart)}:${index + 1}`,
        probabilities: consensus(markets),
        margin: round(average(markets.map((market) => market.margin)), 6),
        disagreement: disagreement(markets)
      }
    ];
  });
}

function metricBrier(probabilities: Record<Outcome, number>, actual: Outcome): number {
  const score =
    ((probabilities.home - (actual === "home" ? 1 : 0)) ** 2 +
      (probabilities.draw - (actual === "draw" ? 1 : 0)) ** 2 +
      (probabilities.away - (actual === "away" ? 1 : 0)) ** 2) /
    3;
  return round(score, 6) ?? score;
}

function metricLogLoss(probabilities: Record<Outcome, number>, actual: Outcome): number {
  const probability = clamp(probabilities[actual], 0.000001, 0.999999);
  return round(-Math.log(probability), 6) ?? -Math.log(probability);
}

function comparison({
  modelBrier,
  modelLogLoss,
  marketBrier,
  marketLogLoss,
  matchedRows
}: {
  modelBrier: number | null;
  modelLogLoss: number | null;
  marketBrier: number | null;
  marketLogLoss: number | null;
  matchedRows: number;
}): FootballDataMarketBenchmark["comparison"] {
  const modelBrierDelta = marketBrier !== null && modelBrier !== null ? round(marketBrier - modelBrier, 6) : null;
  const modelLogLossDelta = marketLogLoss !== null && modelLogLoss !== null ? round(marketLogLoss - modelLogLoss, 6) : null;
  const modelBeatsMarketBrier = modelBrierDelta === null ? null : modelBrierDelta > 0;
  const modelBeatsMarketLogLoss = modelLogLossDelta === null ? null : modelLogLossDelta > 0;
  const marketBeatsModel =
    modelBeatsMarketBrier === null || modelBeatsMarketLogLoss === null ? null : !modelBeatsMarketBrier && !modelBeatsMarketLogLoss;
  const verdict: FootballDataMarketBenchmarkVerdict =
    matchedRows < 100 || modelBeatsMarketBrier === null || modelBeatsMarketLogLoss === null
      ? "insufficient"
      : modelBeatsMarketBrier && modelBeatsMarketLogLoss
        ? "model-beats-market"
        : !modelBeatsMarketBrier && !modelBeatsMarketLogLoss
          ? "market-beats-model"
          : "mixed";

  return {
    modelBrierDelta,
    modelLogLossDelta,
    modelBeatsMarketBrier,
    modelBeatsMarketLogLoss,
    marketBeatsModel,
    verdict
  };
}

function recommendation(verdict: FootballDataMarketBenchmarkVerdict): FootballDataMarketBenchmark["recommendation"] {
  if (verdict === "model-beats-market") {
    return {
      action: "eligible-for-provider-enriched-retest",
      summary: "The model beat the no-vig market benchmark on both core probability metrics; retest with provider-enriched injury, lineup, news, and weather features before promotion.",
      risks: [
        "Public CSV odds are not independent live closing snapshots.",
        "Provider-enriched features and persisted backtests are still required before any learned weights can affect decisions."
      ]
    };
  }
  if (verdict === "market-beats-model") {
    return {
      action: "defer-to-market-prior",
      summary: "The no-vig market consensus is the stronger baseline on this holdout; use it as the shadow prior until richer provider data improves the model.",
      risks: [
        "A weaker model should not publish value picks just because it finds nominal edge.",
        "Market priors cannot be applied live until odds snapshots, line movement, and CLV evidence are stored."
      ]
    };
  }
  return {
    action: "keep-shadow-locked",
    summary: "Benchmark evidence is mixed or thin; keep the model in shadow mode and collect richer data before trusting public decisions.",
    risks: [
      "Mixed Brier/log-loss evidence can hide calibration problems.",
      "Public CSV evidence lacks injuries, suspensions, lineups, live events, news, weather, and official fixture IDs."
    ]
  };
}

function nextAction(seasonFrom: number, seasonTo: number, maxSeasons: number, trainRatio: number, minEdge: number, minModelProbability: number) {
  const verifyUrl = `/api/sports/decision/training/football-data-market-benchmark?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&trainRatio=${trainRatio}&minEdge=${minEdge}&minModelProbability=${minModelProbability}&dryRun=1`;
  return {
    label: "Run public EPL model-vs-market benchmark",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Read-only comparison of Poisson/Elo holdout probabilities against no-vig bookmaker consensus on the same EPL fixtures."
  };
}

export async function buildFootballDataMarketBenchmark({
  seasonFrom,
  seasonTo,
  maxSeasons,
  trainRatio = DEFAULT_TRAIN_RATIO,
  minEdge = DEFAULT_MIN_EDGE,
  minModelProbability = DEFAULT_MIN_MODEL_PROBABILITY,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataMarketBenchmark> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const safeTrainRatio = clamp(trainRatio, 0.1, 0.9);
  const safeMinEdge = clamp(minEdge, 0, 0.2);
  const safeMinModelProbability = clamp(minModelProbability, 0, 0.9);
  const failedSeasons: FootballDataMarketBenchmark["corpus"]["failedSeasons"] = [];
  const candidates: FootballDataCsvFixtureCandidate[] = [];
  const consensusRows = new Map<string, MarketConsensusRow>();

  for (const seasonStart of range.starts) {
    const url = sourceUrl(seasonStart);
    try {
      const text = await fetchCsv(url);
      candidates.push(...parseFootballDataCsvFixtureCandidates(seasonStart, text));
      for (const row of seasonConsensusRows(seasonStart, text)) consensusRows.set(row.fixtureExternalId, row);
    } catch (error) {
      failedSeasons.push({
        season: seasonLabel(seasonStart),
        sourceUrl: url,
        error: error instanceof Error ? error.message : "Failed to load CSV."
      });
    }
  }

  const fixtures = footballDataCandidatesToBacktestFixtures(candidates);
  const backtest = runFootballBacktest(fixtures, {
    trainRatio: safeTrainRatio,
    minEdge: safeMinEdge,
    minModelProbability: safeMinModelProbability
  });
  const matched = backtest.results.flatMap((result) => {
    const market = consensusRows.get(result.fixtureExternalId);
    return market ? [{ result, market }] : [];
  });
  const marketBriers = matched.map(({ result, market }) => metricBrier(market.probabilities, result.actualOutcome));
  const marketLosses = matched.map(({ result, market }) => metricLogLoss(market.probabilities, result.actualOutcome));
  const marketBrier = round(average(marketBriers), 6);
  const marketLogLoss = round(average(marketLosses), 6);
  const marketMargins = matched.map(({ market }) => market.margin).filter((value): value is number => value !== null);
  const marketDisagreements = matched.map(({ market }) => market.disagreement).filter((value): value is number => value !== null);
  const compare = comparison({
    modelBrier: backtest.brierScore,
    modelLogLoss: backtest.logLoss,
    marketBrier,
    marketLogLoss,
    matchedRows: matched.length
  });
  const status: FootballDataMarketBenchmarkStatus =
    backtest.status === "completed" && matched.length
      ? failedSeasons.length
        ? "partial"
        : "completed"
      : failedSeasons.length
        ? "failed"
        : "no-data";
  const action = nextAction(range.seasonFrom, range.seasonTo, range.maxSeasons, safeTrainRatio, safeMinEdge, safeMinModelProbability);
  const rec = recommendation(compare.verdict);

  return {
    mode: "football-data-market-benchmark",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "completed" || status === "partial"
        ? `Compared ${FOOTBALL_BACKTEST_MODEL_KEY} against no-vig bookmaker consensus on ${matched.length} EPL holdout fixture(s); verdict is ${compare.verdict}.`
        : "No matched EPL holdout fixtures were available for a model-vs-market benchmark.",
    provider: {
      name: "Football-Data.co.uk",
      leagueCode: "E0",
      competition: "English Premier League"
    },
    request: {
      seasonFrom: range.seasonFrom,
      seasonTo: range.seasonTo,
      maxSeasons: range.maxSeasons,
      dryRun: true,
      trainRatio: safeTrainRatio,
      minEdge: safeMinEdge,
      minModelProbability: safeMinModelProbability
    },
    corpus: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: range.starts.length - failedSeasons.length,
      fixtureCandidates: candidates.length,
      consensusRows: consensusRows.size,
      holdoutRows: backtest.results.length,
      matchedRows: matched.length,
      failedSeasons
    },
    model: {
      modelKey: backtest.modelKey,
      sampleSize: backtest.sampleSize,
      trainSize: backtest.trainSize,
      testSize: backtest.testSize,
      pickCount: backtest.pickCount,
      brierScore: backtest.brierScore,
      logLoss: backtest.logLoss,
      yield: backtest.yield,
      calibrationError: backtest.calibrationError
    },
    market: {
      rows: matched.length,
      brierScore: marketBrier,
      logLoss: marketLogLoss,
      averageMargin: round(average(marketMargins), 6),
      averageDisagreement: round(average(marketDisagreements), 6)
    },
    comparison: compare,
    recommendation: rec,
    controls: {
      canInspectReadOnly: true,
      canUseAsBenchmark: matched.length >= 100,
      canApplyMarketPrior: false,
      canPersistBenchmark: false,
      canPersistTrainingRows: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: action,
    locks: [
      "This benchmark is read-only and cannot persist model or market metrics.",
      "Market consensus can be used as diagnostic evidence only; it cannot alter live probabilities until odds snapshots and promotion gates pass.",
      "Provider-enriched retests remain required for injuries, lineups, suspensions, news, weather, live events, and official fixture IDs."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/training/football-data-market-consensus",
      "/api/sports/decision/training/football-data-walk-forward",
      "/api/sports/decision/training/football-data-threshold-sweep",
      "/api/sports/decision/training/historical-corpus-acquisition"
    ]
  };
}

export const FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-market-benchmark?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.02&minModelProbability=0.36&dryRun=1";

export const FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL);
