import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import {
  FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_COMMAND,
  FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL,
  type FootballDataMarketBenchmark,
  type FootballDataMarketBenchmarkAction,
  type FootballDataMarketBenchmarkVerdict
} from "@/lib/sports/training/footballDataMarketBenchmark";

type EnvLike = Record<string, string | undefined>;

type DbNumeric = number | string | null;

export type FootballDataMarketBenchmarkMemoryStatus = "ready" | "empty" | "not-configured" | "failed";
export type FootballDataMarketBenchmarkMemoryAction = "defer-to-market-prior" | "allow-provider-enriched-retest" | "keep-shadow-locked" | "store-benchmark-proof";

export type FootballDataMarketBenchmarkMemoryRow = {
  id: string;
  sport: string;
  model_key: string;
  engine_version: string;
  status: string;
  data_source: string;
  sample_size: DbNumeric;
  train_size: DbNumeric;
  test_size: DbNumeric;
  pick_count: DbNumeric;
  brier_score: DbNumeric;
  log_loss: DbNumeric;
  yield: DbNumeric;
  calibration_error?: DbNumeric;
  market_breakdown: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  notes: unknown[] | null;
  created_at: string;
};

export type FootballDataMarketBenchmarkMemoryRun = {
  id: string;
  modelKey: string;
  engineVersion: string;
  status: string;
  sampleSize: number;
  trainSize: number;
  testSize: number;
  pickCount: number;
  modelBrierScore: number | null;
  marketBrierScore: number | null;
  modelLogLoss: number | null;
  marketLogLoss: number | null;
  marketRows: number;
  averageMarketMargin: number | null;
  averageMarketDisagreement: number | null;
  modelYield: number | null;
  calibrationError: number | null;
  modelBrierDelta: number | null;
  modelLogLossDelta: number | null;
  verdict: string | null;
  recommendation: string | null;
  createdAt: string;
  notes: string[];
};

export type FootballDataMarketBenchmarkMemory = {
  mode: "football-data-market-benchmark-memory";
  generatedAt: string;
  status: FootballDataMarketBenchmarkMemoryStatus;
  action: FootballDataMarketBenchmarkMemoryAction;
  memoryHash: string;
  summary: string;
  target: {
    projectRef: string | null;
    expectedProjectRef: string;
    table: "op_backtest_runs";
    dataSource: "football-data-market-benchmark";
    serverReadReady: boolean;
    targetMatchesExpected: boolean;
  };
  totals: {
    runs: number;
    completedRuns: number;
    marketBeatsModel: number;
    modelBeatsMarket: number;
    mixedOrInsufficient: number;
  };
  latestRun: FootballDataMarketBenchmarkMemoryRun | null;
  runs: FootballDataMarketBenchmarkMemoryRun[];
  controls: {
    canInspectReadOnly: true;
    canUseAsHistoricalMemory: boolean;
    canApplyMarketPrior: false;
    canApplyLearnedWeights: false;
    canPersistMemory: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
  error: string | null;
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toNumber(value: DbNumeric | undefined, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function marketNumber(value: unknown): number | null {
  return toNumber(typeof value === "number" || typeof value === "string" ? value : null);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapRow(row: FootballDataMarketBenchmarkMemoryRow): FootballDataMarketBenchmarkMemoryRun {
  const market = row.market_breakdown ?? {};
  return {
    id: row.id,
    modelKey: row.model_key,
    engineVersion: row.engine_version,
    status: row.status,
    sampleSize: toNumber(row.sample_size, 0) ?? 0,
    trainSize: toNumber(row.train_size, 0) ?? 0,
    testSize: toNumber(row.test_size, 0) ?? 0,
    pickCount: toNumber(row.pick_count, 0) ?? 0,
    modelBrierScore: toNumber(row.brier_score),
    marketBrierScore: marketNumber(market.marketBrierScore),
    modelLogLoss: toNumber(row.log_loss),
    marketLogLoss: marketNumber(market.marketLogLoss),
    marketRows: marketNumber(market.marketRows) ?? toNumber(row.test_size, 0) ?? 0,
    averageMarketMargin: marketNumber(market.averageMarketMargin),
    averageMarketDisagreement: marketNumber(market.averageMarketDisagreement),
    modelYield: toNumber(row.yield),
    calibrationError: toNumber(row.calibration_error),
    modelBrierDelta: marketNumber(market.modelBrierDelta),
    modelLogLossDelta: marketNumber(market.modelLogLossDelta),
    verdict: textOrNull(market.verdict),
    recommendation: textOrNull(market.recommendation),
    createdAt: row.created_at,
    notes: Array.isArray(row.notes) ? row.notes.map(String) : []
  };
}

function benchmarkVerdict(value: string | null): FootballDataMarketBenchmarkVerdict {
  if (value === "model-beats-market" || value === "market-beats-model" || value === "mixed" || value === "insufficient") return value;
  return "insufficient";
}

function benchmarkAction(value: string | null, verdict: FootballDataMarketBenchmarkVerdict): FootballDataMarketBenchmarkAction {
  if (value === "eligible-for-provider-enriched-retest" || value === "defer-to-market-prior" || value === "keep-shadow-locked") return value;
  if (value === "allow-provider-enriched-retest" || verdict === "model-beats-market") return "eligible-for-provider-enriched-retest";
  if (verdict === "market-beats-model") return "defer-to-market-prior";
  return "keep-shadow-locked";
}

function benchmarkRecommendation(action: FootballDataMarketBenchmarkAction, verdict: FootballDataMarketBenchmarkVerdict): FootballDataMarketBenchmark["recommendation"] {
  if (action === "eligible-for-provider-enriched-retest") {
    return {
      action,
      summary: "Stored market benchmark memory says the model beat market consensus; provider-enriched retest can proceed while live picks remain locked.",
      risks: [
        "Stored benchmark evidence is historical and cannot mutate live probabilities.",
        "Provider-enriched injuries, lineups, news, weather, and closing-line evidence remain required before promotion."
      ]
    };
  }
  if (action === "defer-to-market-prior") {
    return {
      action,
      summary: "Stored market benchmark memory says no-vig market consensus beat the model; defer to market prior until provider-enriched evidence improves.",
      risks: [
        "A weaker historical model should not publish value picks from nominal live edge.",
        "Market prior evidence can cap confidence only; it cannot stake, publish, or train."
      ]
    };
  }
  return {
    action,
    summary: `Stored market benchmark memory is ${verdict}; keep model-vs-market evidence in shadow review.`,
    risks: [
      "Mixed or insufficient benchmark memory can hide calibration weaknesses.",
      "Live provider feature parity and settlement evidence are still required."
    ]
  };
}

function comparisonFromRun(run: FootballDataMarketBenchmarkMemoryRun, verdict: FootballDataMarketBenchmarkVerdict): FootballDataMarketBenchmark["comparison"] {
  const modelBeatsMarketBrier = run.modelBrierDelta === null ? null : run.modelBrierDelta > 0;
  const modelBeatsMarketLogLoss = run.modelLogLossDelta === null ? null : run.modelLogLossDelta > 0;
  const marketBeatsModel =
    modelBeatsMarketBrier === null || modelBeatsMarketLogLoss === null ? null : !modelBeatsMarketBrier && !modelBeatsMarketLogLoss;

  return {
    modelBrierDelta: run.modelBrierDelta,
    modelLogLossDelta: run.modelLogLossDelta,
    modelBeatsMarketBrier,
    modelBeatsMarketLogLoss,
    marketBeatsModel,
    verdict
  };
}

export function footballDataMarketBenchmarkFromMemory(memory: FootballDataMarketBenchmarkMemory, now = new Date()): FootballDataMarketBenchmark | null {
  const run = memory.latestRun;
  if (memory.status !== "ready" || !run || run.status !== "completed") return null;

  const verdict = benchmarkVerdict(run.verdict);
  const action = benchmarkAction(run.recommendation, verdict);
  const matchedRows = Math.max(0, run.marketRows || run.testSize);

  return {
    mode: "football-data-market-benchmark",
    generatedAt: now.toISOString(),
    status: matchedRows >= 100 ? "completed" : "partial",
    summary: `Reconstructed read-only market benchmark from stored op_backtest_runs memory ${run.id}; verdict is ${verdict}.`,
    provider: {
      name: "Football-Data.co.uk",
      leagueCode: "E0",
      competition: "English Premier League"
    },
    request: {
      seasonFrom: 2016,
      seasonTo: 2025,
      maxSeasons: 10,
      dryRun: true,
      trainRatio: 0.7,
      minEdge: 0.02,
      minModelProbability: 0.36
    },
    corpus: {
      seasonsRequested: 10,
      seasonsLoaded: 10,
      fixtureCandidates: run.sampleSize,
      consensusRows: matchedRows,
      holdoutRows: run.testSize,
      matchedRows,
      failedSeasons: []
    },
    model: {
      modelKey: run.modelKey,
      sampleSize: run.sampleSize,
      trainSize: run.trainSize,
      testSize: run.testSize,
      pickCount: run.pickCount,
      brierScore: run.modelBrierScore,
      logLoss: run.modelLogLoss,
      yield: run.modelYield,
      calibrationError: run.calibrationError
    },
    market: {
      rows: matchedRows,
      brierScore: run.marketBrierScore,
      logLoss: run.marketLogLoss,
      averageMargin: run.averageMarketMargin,
      averageDisagreement: run.averageMarketDisagreement
    },
    comparison: comparisonFromRun(run, verdict),
    recommendation: benchmarkRecommendation(action, verdict),
    controls: {
      canInspectReadOnly: true,
      canUseAsBenchmark: matchedRows >= 100,
      canApplyMarketPrior: false,
      canPersistBenchmark: false,
      canPersistTrainingRows: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: "Refresh public EPL model-vs-market benchmark",
      command: FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_COMMAND,
      verifyUrl: FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL,
      expectedEvidence: "A fresh read-only comparison of model probabilities against no-vig bookmaker consensus."
    },
    locks: [
      "Stored benchmark memory is read-only and cannot mutate live probabilities.",
      "Market consensus can cap confidence only; provider-enriched retests remain required before promotion.",
      "Publishing, staking, persistence, and learned weights remain disabled."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-market-benchmark-memory",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/market-calibrated-fusion"
    ]
  };
}

function actionFor(latest: FootballDataMarketBenchmarkMemoryRun | null): FootballDataMarketBenchmarkMemoryAction {
  if (!latest) return "store-benchmark-proof";
  if (latest.verdict === "market-beats-model") return "defer-to-market-prior";
  if (latest.verdict === "model-beats-market") return "allow-provider-enriched-retest";
  return "keep-shadow-locked";
}

function summaryFor(status: FootballDataMarketBenchmarkMemoryStatus, action: FootballDataMarketBenchmarkMemoryAction, runs: FootballDataMarketBenchmarkMemoryRun[], error: string | null): string {
  if (status === "failed") return `Stored benchmark memory read failed: ${error ?? "unknown error"}.`;
  if (status === "not-configured") return "Stored benchmark memory needs OddsPadi Supabase service-role read readiness.";
  if (!runs.length) return "No stored model-vs-market benchmark memory exists yet; store a benchmark receipt before using historical memory.";
  if (action === "defer-to-market-prior") return "Stored benchmark memory says the market baseline beat the model; defer to market prior until provider-enriched retests improve evidence.";
  if (action === "allow-provider-enriched-retest") return "Stored benchmark memory says the model beat market consensus; provider-enriched retest can proceed while live picks remain locked.";
  return "Stored benchmark memory is mixed or insufficient; keep the market/model prior relationship shadow-only.";
}

export function buildFootballDataMarketBenchmarkMemoryFromRows({
  rows,
  generatedAt = new Date().toISOString(),
  projectRef = ODDSPADI_SUPABASE_PROJECT_REF,
  serverReadReady = true,
  targetMatchesExpected = true,
  error = null
}: {
  rows: FootballDataMarketBenchmarkMemoryRow[];
  generatedAt?: string;
  projectRef?: string | null;
  serverReadReady?: boolean;
  targetMatchesExpected?: boolean;
  error?: string | null;
}): FootballDataMarketBenchmarkMemory {
  const runs = rows.map(mapRow);
  const latestRun = runs[0] ?? null;
  const status: FootballDataMarketBenchmarkMemoryStatus = error ? "failed" : serverReadReady ? (runs.length ? "ready" : "empty") : "not-configured";
  const action = status === "ready" || status === "empty" ? actionFor(latestRun) : "store-benchmark-proof";
  const totals = {
    runs: runs.length,
    completedRuns: runs.filter((run) => run.status === "completed").length,
    marketBeatsModel: runs.filter((run) => run.verdict === "market-beats-model").length,
    modelBeatsMarket: runs.filter((run) => run.verdict === "model-beats-market").length,
    mixedOrInsufficient: runs.filter((run) => run.verdict !== "market-beats-model" && run.verdict !== "model-beats-market").length
  };
  const memoryHash = stableHash({
    status,
    action,
    totals,
    latest: latestRun
      ? [latestRun.id, latestRun.verdict, latestRun.modelBrierScore, latestRun.marketBrierScore, latestRun.modelLogLoss, latestRun.marketLogLoss]
      : null,
    projectRef,
    targetMatchesExpected
  });

  return {
    mode: "football-data-market-benchmark-memory",
    generatedAt,
    status,
    action,
    memoryHash,
    summary: summaryFor(status, action, runs, error),
    target: {
      projectRef,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      table: "op_backtest_runs",
      dataSource: "football-data-market-benchmark",
      serverReadReady,
      targetMatchesExpected
    },
    totals,
    latestRun,
    runs,
    controls: {
      canInspectReadOnly: true,
      canUseAsHistoricalMemory: status === "ready",
      canApplyMarketPrior: false,
      canApplyLearnedWeights: false,
      canPersistMemory: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: runs.length ? "Review stored benchmark memory" : "Store market benchmark proof",
      verifyUrl: runs.length
        ? "/api/sports/decision/training/football-data-market-benchmark-memory"
        : "/api/sports/decision/training/football-data-market-benchmark-persistence",
      expectedEvidence: runs.length
        ? "Stored op_backtest_runs benchmark rows with verdict, Brier/log-loss deltas, and recommendation."
        : "An admin-authorized op_backtest_runs audit row for the 10-year model-vs-market benchmark."
    },
    proofUrls: [
      "/api/sports/decision/training/football-data-market-benchmark-memory",
      "/api/sports/decision/training/football-data-market-benchmark-persistence",
      "/api/sports/decision/market-prior-governor",
      "/api/sports/decision/supabase-proof-binder"
    ],
    locks: [
      "Stored benchmark memory is read-only evidence and cannot mutate live probabilities.",
      "Market priors and learned weights remain locked until provider-enriched backtests and governance pass.",
      "Public picks and staking remain locked regardless of stored benchmark memory."
    ],
    error
  };
}

export async function readFootballDataMarketBenchmarkMemory({
  limit = 8,
  env = process.env,
  now = new Date()
}: {
  limit?: number;
  env?: EnvLike;
  now?: Date;
} = {}): Promise<FootballDataMarketBenchmarkMemory> {
  const runtime = getSupabaseRuntimeStatus(env);
  if (!runtime.serverWriteReady) {
    return buildFootballDataMarketBenchmarkMemoryFromRows({
      rows: [],
      generatedAt: now.toISOString(),
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected
    });
  }

  const client = getSupabaseServerClient(env);
  if (!client) {
    return buildFootballDataMarketBenchmarkMemoryFromRows({
      rows: [],
      generatedAt: now.toISOString(),
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected,
      error: "Supabase server client could not be created."
    });
  }

  const { data, error } = await client
    .from("op_backtest_runs")
    .select(
      "id, sport, model_key, engine_version, status, data_source, sample_size, train_size, test_size, pick_count, brier_score, log_loss, yield, market_breakdown, config, notes, created_at"
    )
    .eq("sport", "football")
    .eq("data_source", "football-data-market-benchmark")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(25, limit)));

  return buildFootballDataMarketBenchmarkMemoryFromRows({
    rows: error ? [] : ((data ?? []) as FootballDataMarketBenchmarkMemoryRow[]),
    generatedAt: now.toISOString(),
    projectRef: runtime.projectRef ?? runtime.urlProjectRef,
    serverReadReady: true,
    targetMatchesExpected: runtime.targetMatchesExpected,
    error: error?.message ?? null
  });
}
