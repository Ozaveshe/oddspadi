import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";

type EnvLike = Record<string, string | undefined>;

export type FootballDataMarketBenchmarkPersistenceStatus =
  | "preview-ready"
  | "stored"
  | "waiting-admin"
  | "waiting-supabase"
  | "waiting-benchmark"
  | "failed";

export type FootballDataMarketBenchmarkBacktestRow = {
  sport: "football";
  model_key: string;
  engine_version: string;
  status: "completed" | "failed";
  data_source: "football-data-market-benchmark";
  train_window_start: null;
  train_window_end: null;
  test_window_start: null;
  test_window_end: null;
  sample_size: number;
  train_size: number;
  test_size: number;
  pick_count: number;
  brier_score: number | null;
  log_loss: number | null;
  roi_units: number;
  yield: number | null;
  average_edge: null;
  closing_line_value: null;
  calibration_error?: number | null;
  calibration_buckets?: [];
  market_breakdown: {
    benchmarkMode: FootballDataMarketBenchmark["mode"];
    benchmarkStatus: FootballDataMarketBenchmark["status"];
    marketRows: number;
    marketBrierScore: number | null;
    marketLogLoss: number | null;
    averageMarketMargin: number | null;
    averageMarketDisagreement: number | null;
    modelBrierDelta: number | null;
    modelLogLossDelta: number | null;
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"];
    recommendation: FootballDataMarketBenchmark["recommendation"]["action"];
  };
  confidence_breakdown: {
    governor: "market-prior";
    controls: FootballDataMarketBenchmark["controls"];
  };
  learned_weights: {};
  config: {
    request: FootballDataMarketBenchmark["request"];
    corpus: FootballDataMarketBenchmark["corpus"];
    comparison: FootballDataMarketBenchmark["comparison"];
    persistence: {
      table: "op_backtest_runs";
      expectedProjectRef: string;
      rls: "enabled";
      dataApiExposure: "service-role-only";
    };
    calibration?: {
      expectedCalibrationError: number | null;
      buckets: [];
    };
  };
  notes: string[];
  error_message: null;
};

export type FootballDataMarketBenchmarkPersistenceReceipt = {
  mode: "football-data-market-benchmark-persistence-receipt";
  generatedAt: string;
  status: FootballDataMarketBenchmarkPersistenceStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
  };
  target: {
    projectRef: string;
    table: "op_backtest_runs";
    expectedProjectRef: string;
    serverWriteReady: boolean;
    targetMatchesExpected: boolean;
  };
  benchmark: {
    status: FootballDataMarketBenchmark["status"];
    matchedRows: number;
    verdict: FootballDataMarketBenchmark["comparison"]["verdict"];
    recommendation: FootballDataMarketBenchmark["recommendation"]["action"];
  };
  payload: FootballDataMarketBenchmarkBacktestRow | null;
  storage: {
    inserted: boolean;
    backtestRunId: string | null;
    error: string | null;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPrepareBacktestRunRow: boolean;
    canWriteBacktestRun: boolean;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
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

function adminTokenConfigured(env: EnvLike): boolean {
  return Boolean(env.ODDSPADI_ADMIN_TOKEN?.trim());
}

function benchmarkPersistable(benchmark: FootballDataMarketBenchmark): boolean {
  return benchmark.status === "completed" || benchmark.status === "partial";
}

function isMissingBacktestCalibrationColumn(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("op_backtest_runs.calibration_error") ||
    text.includes("op_backtest_runs.calibration_buckets") ||
    text.includes("calibration_error") ||
    text.includes("calibration_buckets")
  );
}

export function footballDataMarketBenchmarkBacktestRow(benchmark: FootballDataMarketBenchmark): FootballDataMarketBenchmarkBacktestRow {
  return {
    sport: "football",
    model_key: benchmark.model.modelKey,
    engine_version: DECISION_ENGINE_VERSION,
    status: benchmark.status === "completed" || benchmark.status === "partial" ? "completed" : "failed",
    data_source: "football-data-market-benchmark",
    train_window_start: null,
    train_window_end: null,
    test_window_start: null,
    test_window_end: null,
    sample_size: benchmark.model.sampleSize,
    train_size: benchmark.model.trainSize,
    test_size: benchmark.model.testSize,
    pick_count: benchmark.model.pickCount,
    brier_score: benchmark.model.brierScore,
    log_loss: benchmark.model.logLoss,
    roi_units: 0,
    yield: benchmark.model.yield,
    average_edge: null,
    closing_line_value: null,
    calibration_error: benchmark.model.calibrationError,
    calibration_buckets: [],
    market_breakdown: {
      benchmarkMode: benchmark.mode,
      benchmarkStatus: benchmark.status,
      marketRows: benchmark.market.rows,
      marketBrierScore: benchmark.market.brierScore,
      marketLogLoss: benchmark.market.logLoss,
      averageMarketMargin: benchmark.market.averageMargin,
      averageMarketDisagreement: benchmark.market.averageDisagreement,
      modelBrierDelta: benchmark.comparison.modelBrierDelta,
      modelLogLossDelta: benchmark.comparison.modelLogLossDelta,
      verdict: benchmark.comparison.verdict,
      recommendation: benchmark.recommendation.action
    },
    confidence_breakdown: {
      governor: "market-prior",
      controls: benchmark.controls
    },
    learned_weights: {},
    config: {
      request: benchmark.request,
      corpus: benchmark.corpus,
      comparison: benchmark.comparison,
      persistence: {
        table: "op_backtest_runs",
        expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
        rls: "enabled",
        dataApiExposure: "service-role-only"
      }
    },
    notes: [
      benchmark.summary,
      benchmark.recommendation.summary,
      "Public Football-Data benchmark evidence is stored for audit only; learned weights and public picks remain locked."
    ],
    error_message: null
  };
}

function legacyFootballDataMarketBenchmarkBacktestRow(benchmark: FootballDataMarketBenchmark): FootballDataMarketBenchmarkBacktestRow {
  const payload = footballDataMarketBenchmarkBacktestRow(benchmark);
  delete payload.calibration_error;
  delete payload.calibration_buckets;
  payload.config = {
    ...payload.config,
    calibration: {
      expectedCalibrationError: benchmark.model.calibrationError,
      buckets: []
    }
  };
  payload.notes = [
    ...payload.notes,
    "Legacy op_backtest_runs schema lacks calibration_error/calibration_buckets; calibration metrics were stored under config.calibration."
  ];
  return payload;
}

function statusFor({
  runRequested,
  adminAuthorized,
  serverWriteReady,
  benchmarkReady,
  error,
  inserted
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  serverWriteReady: boolean;
  benchmarkReady: boolean;
  error: string | null;
  inserted: boolean;
}): FootballDataMarketBenchmarkPersistenceStatus {
  if (error) return "failed";
  if (inserted) return "stored";
  if (!benchmarkReady) return "waiting-benchmark";
  if (!serverWriteReady) return "waiting-supabase";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  return "preview-ready";
}

function summaryFor(status: FootballDataMarketBenchmarkPersistenceStatus): string {
  if (status === "stored") return "Stored the market benchmark as an op_backtest_runs audit row; promotion and publishing remain locked.";
  if (status === "waiting-admin") return "Market benchmark row is prepared, but storing it requires x-oddspadi-admin-token.";
  if (status === "waiting-supabase") return "Market benchmark row is prepared, but OddsPadi Supabase service-role write readiness is missing.";
  if (status === "waiting-benchmark") return "A completed or partial market benchmark is required before a backtest-run row can be prepared.";
  if (status === "failed") return "Market benchmark persistence attempt failed.";
  return "Market benchmark row is prepared for op_backtest_runs; run=1 with admin authorization is required to store it.";
}

export async function observeFootballDataMarketBenchmarkPersistenceReceipt({
  benchmark,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date()
}: {
  benchmark: FootballDataMarketBenchmark;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvLike;
  origin: string;
  now?: Date;
}): Promise<FootballDataMarketBenchmarkPersistenceReceipt> {
  const runtime = getSupabaseRuntimeStatus(env);
  const readyBenchmark = benchmarkPersistable(benchmark);
  const payload = readyBenchmark ? footballDataMarketBenchmarkBacktestRow(benchmark) : null;
  let inserted = false;
  let backtestRunId: string | null = null;
  let error: string | null = null;

  if (runRequested && adminAuthorized && runtime.serverWriteReady && payload) {
    const client = getSupabaseServerClient(env);
    if (!client) {
      error = "Supabase server client is not available for the configured OddsPadi project.";
    } else {
      const insert = await client.from("op_backtest_runs").insert(payload).select("id").single();
      const shouldRetryLegacy = insert.error && isMissingBacktestCalibrationColumn(insert.error.message);
      const result = shouldRetryLegacy
        ? await client.from("op_backtest_runs").insert(legacyFootballDataMarketBenchmarkBacktestRow(benchmark)).select("id").single()
        : insert;
      if (result.error) {
        error = result.error.message;
      } else {
        inserted = true;
        backtestRunId = typeof result.data?.id === "string" ? result.data.id : null;
      }
    }
  }

  const status = statusFor({
    runRequested,
    adminAuthorized,
    serverWriteReady: runtime.serverWriteReady,
    benchmarkReady: readyBenchmark,
    error,
    inserted
  });
  const verifyUrl = "/api/sports/decision/training/football-data-market-benchmark-persistence?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.02&minModelProbability=0.36";
  const command = `${decisionCurlCommand(`${origin}${verifyUrl}&run=1`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const receiptHash = stableHash({
    status,
    payload,
    inserted,
    backtestRunId,
    target: [runtime.projectRef, runtime.urlProjectRef, runtime.serverWriteReady],
    benchmark: [benchmark.status, benchmark.corpus.matchedRows, benchmark.comparison.verdict]
  });

  return {
    mode: "football-data-market-benchmark-persistence-receipt",
    generatedAt: now.toISOString(),
    status,
    receiptHash,
    summary: summaryFor(status),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested
    },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef ?? "missing",
      table: "op_backtest_runs",
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      serverWriteReady: runtime.serverWriteReady,
      targetMatchesExpected: runtime.targetMatchesExpected
    },
    benchmark: {
      status: benchmark.status,
      matchedRows: benchmark.corpus.matchedRows,
      verdict: benchmark.comparison.verdict,
      recommendation: benchmark.recommendation.action
    },
    payload,
    storage: {
      inserted,
      backtestRunId,
      error
    },
    nextAction: {
      label: "Store market benchmark audit row",
      command,
      verifyUrl,
      expectedEvidence: "A completed op_backtest_runs row containing model-vs-market benchmark metrics, while learned weights and public picks remain locked."
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareBacktestRunRow: Boolean(payload),
      canWriteBacktestRun: Boolean(!error && payload && runtime.serverWriteReady && adminTokenConfigured(env) && adminAuthorized),
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Stored benchmark rows are audit evidence only and cannot apply learned weights.",
      "Writes require run=1, x-oddspadi-admin-token, correct OddsPadi Supabase ref, and service-role readiness.",
      "Public picks and staking remain locked after persistence."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-market-benchmark-persistence",
      "/api/sports/decision/training/football-data-market-benchmark-memory",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/market-prior-governor",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
