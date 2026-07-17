import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { Sport } from "@/lib/sports/types";
import { benchmarkModelIdentityReceipt, runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";
import { strictTrainingFeatureJsonColumns } from "./featureQuality";
import {
  BASKETBALL_BACKTEST_MODEL_KEY,
  type BasketballBacktestConfig,
  type BasketballBacktestResult,
  type HistoricalBasketballFixture,
  type HistoricalBasketballOddsQuote
} from "./basketballBacktest";
import {
  FOOTBALL_BACKTEST_MODEL_KEY,
  runFootballBacktest,
  type FootballBacktestConfig,
  type FootballBacktestResult,
  type HistoricalFootballFixture,
  type HistoricalFootballOddsQuote
} from "./footballBacktest";
import {
  footballRuntimeReplayIdentityReceipt,
  runFootballRuntimeReplay,
  type FootballRuntimeReplayConfig,
  type FootballRuntimeReplayResult
} from "./footballRuntimeReplay";
import type { HistoricalFootballFixtureInput } from "./historicalIngestion";
import { readStoredPlayerMatchPerformancesForFixtureIds } from "./playerPerformance";
import {
  TENNIS_BACKTEST_MODEL_KEY,
  type HistoricalTennisMatch,
  type HistoricalTennisOddsQuote,
  type TennisBacktestConfig,
  type TennisBacktestResult
} from "./tennisBacktest";
import {
  runBasketballRuntimeReplay,
  runTennisRuntimeReplay,
  twoWayRuntimeReplayIdentityReceipt,
  type TwoWayRuntimeReplayResult
} from "./twoWayRuntimeReplay";

type DbNumeric = number | string | null;
type TrainingSport = Extract<Sport, "football" | "basketball" | "tennis">;
type HistoricalBacktestResult =
  | FootballBacktestResult
  | FootballRuntimeReplayResult
  | BasketballBacktestResult
  | TennisBacktestResult
  | TwoWayRuntimeReplayResult;
type HistoricalBacktestConfig = FootballBacktestConfig | BasketballBacktestConfig | TennisBacktestConfig;

type FixtureRow = {
  id: string;
  provider: string;
  external_id: string;
  league_external_id: string | null;
  season: string | null;
  round: string | null;
  kickoff_at: string;
  home_team_external_id: string;
  away_team_external_id: string;
  home_score: number | null;
  away_score: number | null;
  home_xg: DbNumeric;
  away_xg: DbNumeric;
  neutral_venue: boolean | null;
  data_quality: DbNumeric;
  metadata: Record<string, unknown> | null;
};

type LeagueDimensionRow = {
  provider: string;
  external_id: string;
  name: string;
  country: string | null;
  strength: DbNumeric;
};

type TeamDimensionRow = {
  provider: string;
  external_id: string;
  name: string;
  country: string | null;
};

type AvailabilityRow = {
  provider: string;
  fixture_external_id: string;
  team_external_id: string;
  player_external_id: string | null;
  player_name: string;
  status: "available" | "doubtful" | "injured" | "suspended" | "unknown";
  impact_score: DbNumeric;
  reason: string | null;
  observed_at: string | null;
};

type LineupRow = {
  provider: string;
  fixture_external_id: string;
  team_external_id: string;
  lineup_status: "predicted" | "confirmed" | "unavailable";
  formation: string | null;
  players: unknown[] | null;
  observed_at: string | null;
};

type FeatureRow = {
  fixture_id: string;
  side: "home" | "away";
  elo_rating: DbNumeric;
  attack_strength: DbNumeric;
  defense_strength: DbNumeric;
  recent_form_points: DbNumeric;
  recent_goals_for: DbNumeric;
  recent_goals_against: DbNumeric;
  rest_days: DbNumeric;
  injuries_count: number | null;
  suspensions_count: number | null;
  metadata: Record<string, unknown> | null;
};

type OddsRow = {
  fixture_external_id: string;
  market: string;
  selection: string;
  decimal_odds: DbNumeric;
  is_closing: boolean | null;
  observed_at: string | null;
  bookmaker: string | null;
};

type CountResult = {
  count: number;
  error: string | null;
};

type CountFilter = {
  column: string;
  value?: string | boolean;
  operator?: "eq" | "neq" | "not-null";
};

export type StoredBacktestRun = {
  id: string;
  sport: string;
  modelKey: string;
  engineVersion: string;
  status: "queued" | "running" | "completed" | "failed";
  dataSource: string;
  sampleSize: number;
  trainSize: number;
  testSize: number;
  pickCount: number;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  averageEdge: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: unknown[];
  learnedWeights: Record<string, unknown>;
  config?: Record<string, unknown>;
  notes: string[];
  createdAt: string;
};

export type TrainingDataSnapshot = {
  generatedAt: string;
  status: "ready" | "not-configured" | "failed";
  configured: boolean;
  sport: Sport;
  counts: {
    fixtures: number;
    finishedFixtures: number;
    realFinishedFixtures: number;
    demoFinishedFixtures: number;
    oddsSnapshots: number;
    realOddsSnapshots: number;
    demoOddsSnapshots: number;
    eventSnapshots: number;
    realEventSnapshots: number;
    demoEventSnapshots: number;
    newsSnapshots: number;
    realNewsSnapshots: number;
    demoNewsSnapshots: number;
    standingsSnapshots: number;
    realStandingsSnapshots: number;
    demoStandingsSnapshots: number;
    availabilitySnapshots: number;
    realAvailabilitySnapshots: number;
    demoAvailabilitySnapshots: number;
    lineupSnapshots: number;
    realLineupSnapshots: number;
    demoLineupSnapshots: number;
    weatherSnapshots: number;
    realWeatherSnapshots: number;
    demoWeatherSnapshots: number;
    featureSnapshots: number;
    completeFeatureSnapshots?: number;
    partialFeatureSnapshots?: number;
    proxyFeatureSnapshots?: number;
    backtestRuns: number;
  };
  latestBacktest: StoredBacktestRun | null;
  readiness: {
    hasHistoricalFixtures: boolean;
    hasOdds: boolean;
    hasBacktests: boolean;
    readyForTraining: boolean;
    minimumRecommendedFixtures: number;
    detail: string;
  };
  storage?: {
    status: "ready" | "not-configured" | "credential-error" | "schema-error" | "unknown-error";
    configured: boolean;
    detail: string;
    missingEnv: string[];
    expectedTables: string[];
  };
  controls?: {
    canInspectReadOnly: true;
    canRunBacktest: boolean;
    canStoreBacktest: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
    canPublishPicks: false;
  };
  nextActions?: string[];
  proofUrls?: string[];
  reason?: string;
};

export type BacktestRunStoreResult =
  | {
      status: "stored";
      configured: true;
      id: string;
      result: HistoricalBacktestResult;
    }
  | {
      status: "no-data" | "not-configured" | "failed";
      configured: boolean;
      reason: string;
      result?: HistoricalBacktestResult;
    };

const MINIMUM_RECOMMENDED_FIXTURES = 1000;
const TRAINING_STORAGE_TABLES = [
  "op_fixtures",
  "op_fixture_team_features",
  "op_standings_snapshots",
  "op_odds_snapshots",
  "op_player_availability_snapshots",
  "op_lineup_snapshots",
  "op_live_match_events",
  "op_news_signals",
  "op_weather_snapshots",
  "op_training_feature_snapshots",
  "op_backtest_runs"
];

function toNumber(value: DbNumeric | undefined, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function numericOrUndefined(value: DbNumeric | undefined): number | undefined {
  return toNumber(value, null) ?? undefined;
}

function toFootballOddsSelection(value: string): HistoricalFootballOddsQuote["selection"] | null {
  if (value === "home" || value === "draw" || value === "away") return value;
  return null;
}

function toTwoWaySelection(value: string): "home" | "away" | null {
  if (value === "home" || value === "away") return value;
  return null;
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  const parsed = toNumber(typeof value === "number" || typeof value === "string" ? value : null);
  return parsed ?? undefined;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fatigueFromRestDays(value: DbNumeric | undefined): number | undefined {
  const restDays = numericOrUndefined(value);
  if (restDays === undefined) return undefined;
  return Math.max(0, Math.min(5, 4 - restDays));
}

export function classifyTrainingStorageStatus(
  reason: string | null | undefined,
  configured: boolean
): NonNullable<TrainingDataSnapshot["storage"]>["status"] {
  if (!configured) return "not-configured";
  const text = (reason ?? "").toLowerCase();
  if (text.includes("invalid api key") || text.includes("jwt") || text.includes("unauthorized") || text.includes("permission denied")) return "credential-error";
  if (text.includes("does not exist") || text.includes("could not find") || text.includes("schema cache") || text.includes("relation")) return "schema-error";
  return reason ? "unknown-error" : "ready";
}

function trainingStorageDetail(status: NonNullable<TrainingDataSnapshot["storage"]>["status"], reason: string | undefined): string {
  if (status === "ready") return "Training storage is reachable for server-side read checks.";
  if (status === "not-configured") return reason ?? "Supabase server reads are not configured.";
  if (status === "credential-error") return `Supabase rejected the configured server key: ${reason ?? "credential error"}. Replace the service-role/secret key for the OddsPadi project before corpus reads or writes.`;
  if (status === "schema-error") return `Supabase storage is reachable, but an expected training table is missing or inaccessible: ${reason ?? "schema error"}. Apply the OddsPadi migrations only after project proof passes.`;
  return reason ?? "Training storage failed for an unknown reason.";
}

function trainingControls(canRunBacktest: boolean): NonNullable<TrainingDataSnapshot["controls"]> {
  return {
    canInspectReadOnly: true,
    canRunBacktest,
    canStoreBacktest: false,
    canPersistTrainingRows: false,
    canTrainModels: false,
    canUseLearnedWeights: false,
    canPublishPicks: false
  };
}

function trainingProofUrls(): string[] {
  return [
    "/api/sports/decision/training",
    "/api/sports/decision/training/football-runtime-replay",
    "/api/sports/decision/training/corpus-proof",
    "/api/sports/decision/training/data-blueprint",
    "/api/sports/decision/supabase-bootstrap",
    "/api/sports/decision/supabase-proof-binder"
  ];
}

function trainingNextActions(
  status: NonNullable<TrainingDataSnapshot["storage"]>["status"],
  sport: Sport,
  counts?: { realFinishedFixtures: number; realOddsSnapshots: number }
): string[] {
  if (status === "not-configured") return ["Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server, then restart the app."];
  if (status === "credential-error") return ["Replace SUPABASE_SERVICE_ROLE_KEY with a valid service-role/secret key for the OddsPadi Supabase project."];
  if (status === "schema-error") return ["Apply the local OddsPadi Supabase migrations to the proven OddsPadi project, then rerun this training snapshot."];
  if (status === "ready" && sport === "basketball" && (counts?.realFinishedFixtures ?? 0) > 0 && (counts?.realOddsSnapshots ?? 0) === 0) {
    return [
      "Plan /api/sports/decision/training/basketball-odds-backfill with run=0, then execute a quota-bounded checkpoint after The Odds API historical plan is upgraded.",
      "Review matched fixture IDs and odds-row counts, then attach NBA moneyline odds with dryRun=0 before rerunning basketball backtests."
    ];
  }
  if (status === "ready") {
    return [
      `Run a capped ${sport} provider dry-run before any dryRun=0 write.`,
      "Backfill real finished fixtures, odds snapshots, feature snapshots, and completed backtests before enabling learned guardrails."
    ];
  }
  return ["Inspect Supabase logs and the bootstrap proof before retrying corpus reads."];
}

async function countRows(
  table: string,
  filters: CountFilter[] = []
): Promise<CountResult> {
  const client = getSupabaseServerClient();
  if (!client) return { count: 0, error: "Supabase client could not be created." };

  const execute = async (): Promise<CountResult> => {
    let query = client.from(table).select("id", { count: "exact", head: true });
    for (const filter of filters) {
      if (filter.operator === "not-null") query = query.not(filter.column, "is", null);
      else if (filter.operator === "neq") query = query.neq(filter.column, filter.value ?? "");
      else query = query.eq(filter.column, filter.value ?? "");
    }

    const { count, error } = await query;
    return { count: count ?? 0, error: error?.message ?? null };
  };

  const first = await execute();
  const isDemoSeedCount = filters.some((filter) => filter.column === "provider" && filter.value === "demo_seed" && filter.operator !== "neq");
  return isDemoSeedCount && first.count === 0 && !first.error ? execute() : first;
}

function isTrainingSport(sport: Sport): sport is TrainingSport {
  return sport === "football" || sport === "basketball" || sport === "tennis";
}

function countCompleteFeatureSnapshots(sport: Sport): Promise<CountResult> {
  if (!isTrainingSport(sport)) return Promise.resolve({ count: 0, error: null });
  return countRows("op_training_feature_snapshots", [
    { column: "sport", value: sport },
    { column: "source", value: "demo_seed", operator: "neq" },
    ...strictTrainingFeatureJsonColumns(sport).map((column) => ({ column, operator: "not-null" as const }))
  ]);
}

export function realRowCount(total: number, demo: number): number {
  return Math.max(0, total - demo);
}

export async function runWithConcurrency<T extends ReadonlyArray<() => Promise<unknown>>>(
  tasks: T,
  maxConcurrency = 6
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = new Array(tasks.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, maxConcurrency), tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

function emptySnapshot(sport: Sport, status: TrainingDataSnapshot["status"], configured: boolean, reason?: string): TrainingDataSnapshot {
  const storageStatus = classifyTrainingStorageStatus(reason, configured);
  return {
    generatedAt: new Date().toISOString(),
    status,
    configured,
    sport,
    counts: {
      fixtures: 0,
      finishedFixtures: 0,
      realFinishedFixtures: 0,
      demoFinishedFixtures: 0,
      oddsSnapshots: 0,
      realOddsSnapshots: 0,
      demoOddsSnapshots: 0,
      eventSnapshots: 0,
      realEventSnapshots: 0,
      demoEventSnapshots: 0,
      newsSnapshots: 0,
      realNewsSnapshots: 0,
      demoNewsSnapshots: 0,
      standingsSnapshots: 0,
      realStandingsSnapshots: 0,
      demoStandingsSnapshots: 0,
      availabilitySnapshots: 0,
      realAvailabilitySnapshots: 0,
      demoAvailabilitySnapshots: 0,
      lineupSnapshots: 0,
      realLineupSnapshots: 0,
      demoLineupSnapshots: 0,
      weatherSnapshots: 0,
      realWeatherSnapshots: 0,
      demoWeatherSnapshots: 0,
      featureSnapshots: 0,
      completeFeatureSnapshots: 0,
      partialFeatureSnapshots: 0,
      proxyFeatureSnapshots: 0,
      backtestRuns: 0
    },
    latestBacktest: null,
    readiness: {
      hasHistoricalFixtures: false,
      hasOdds: false,
      hasBacktests: false,
      readyForTraining: false,
      minimumRecommendedFixtures: MINIMUM_RECOMMENDED_FIXTURES,
      detail: reason ?? "Historical training storage is not ready."
    },
    storage: {
      status: storageStatus,
      configured,
      detail: trainingStorageDetail(storageStatus, reason),
      missingEnv: configured ? [] : getSupabaseRuntimeStatus().missingServerEnv,
      expectedTables: TRAINING_STORAGE_TABLES
    },
    controls: trainingControls(false),
    nextActions: trainingNextActions(storageStatus, sport),
    proofUrls: trainingProofUrls(),
    reason
  };
}

function mapLatestBacktest(data: Record<string, unknown> | null): StoredBacktestRun | null {
  if (!data) return null;
  const config = (data.config as Record<string, unknown> | null) ?? {};
  const legacyCalibration = (config.calibration as Record<string, unknown> | null) ?? {};
  return {
    id: String(data.id),
    sport: String(data.sport),
    modelKey: String(data.model_key),
    engineVersion: String(data.engine_version),
    status: data.status as StoredBacktestRun["status"],
    dataSource: typeof data.data_source === "string" ? data.data_source : "",
    sampleSize: Number(data.sample_size ?? 0),
    trainSize: Number(data.train_size ?? 0),
    testSize: Number(data.test_size ?? 0),
    pickCount: Number(data.pick_count ?? 0),
    brierScore: toNumber(data.brier_score as DbNumeric),
    logLoss: toNumber(data.log_loss as DbNumeric),
    roiUnits: toNumber(data.roi_units as DbNumeric, 0) ?? 0,
    yield: toNumber(data.yield as DbNumeric),
    averageEdge: toNumber(data.average_edge as DbNumeric),
    closingLineValue: toNumber(data.closing_line_value as DbNumeric),
    calibrationError: toNumber((data.calibration_error ?? legacyCalibration.expectedCalibrationError) as DbNumeric),
    calibrationBuckets: Array.isArray(data.calibration_buckets)
      ? data.calibration_buckets
      : Array.isArray(legacyCalibration.buckets)
        ? legacyCalibration.buckets
        : [],
    learnedWeights: (data.learned_weights as Record<string, unknown> | null) ?? {},
    config,
    notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
    createdAt: String(data.created_at)
  };
}

function isMissingBacktestCalibrationColumn(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return (
    text.includes("op_backtest_runs.calibration_error") ||
    text.includes("op_backtest_runs.calibration_buckets") ||
    text.includes("'calibration_error' column") ||
    text.includes("'calibration_buckets' column") ||
    text.includes("calibration_error column") ||
    text.includes("calibration_buckets column")
  );
}

async function readLatestBacktest(sport: Sport): Promise<StoredBacktestRun | { error: string } | null> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const { data, error } = await client
    .from("op_backtest_runs")
    .select(
      "id, sport, model_key, engine_version, status, data_source, sample_size, train_size, test_size, pick_count, brier_score, log_loss, roi_units, yield, average_edge, closing_line_value, calibration_error, calibration_buckets, learned_weights, config, notes, created_at"
    )
    .eq("sport", sport)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && isMissingBacktestCalibrationColumn(error.message)) {
    const legacy = await client
      .from("op_backtest_runs")
      .select(
        "id, sport, model_key, engine_version, status, data_source, sample_size, train_size, test_size, pick_count, brier_score, log_loss, roi_units, yield, average_edge, closing_line_value, learned_weights, config, notes, created_at"
      )
      .eq("sport", sport)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (legacy.error) return { error: legacy.error.message };
    return mapLatestBacktest(legacy.data);
  }

  if (error) return { error: error.message };
  return mapLatestBacktest(data);
}

type TrainingSnapshotCoreCounts = {
  fixtures: number;
  finishedFixtures: number;
  realFinishedFixtures: number;
  demoFinishedFixtures: number;
  oddsSnapshots: number;
  realOddsSnapshots: number;
  demoOddsSnapshots: number;
  backtestRuns: number;
};

type TrainingSnapshotAggregateCounts = TrainingSnapshotCoreCounts & {
  eventSnapshots: number;
  demoEventSnapshots: number;
  newsSnapshots: number;
  demoNewsSnapshots: number;
  standingsSnapshots: number;
  demoStandingsSnapshots: number;
  availabilitySnapshots: number;
  demoAvailabilitySnapshots: number;
  lineupSnapshots: number;
  demoLineupSnapshots: number;
  weatherSnapshots: number;
  demoWeatherSnapshots: number;
  featureSnapshots: number;
  completeFeatureSnapshots: number;
  proxyFeatureSnapshots: number;
};

type TrainingSnapshotCacheEntry = {
  expiresAt: number;
  snapshot: Promise<TrainingDataSnapshot>;
};

const trainingSnapshotCache = new Map<Sport, TrainingSnapshotCacheEntry>();

function countValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

async function readTrainingSnapshotCoreCounts(sport: Sport): Promise<TrainingSnapshotCoreCounts | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const rpc = await client.rpc("op_training_corpus_training_counts");
  if (!rpc.error && Array.isArray(rpc.data)) {
    const row = rpc.data.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).sport === sport) as Record<string, unknown> | undefined;
    if (row && "real_finished_fixtures" in row && "real_odds_snapshots" in row) {
      return {
        fixtures: countValue(row.fixtures),
        finishedFixtures: countValue(row.finished_fixtures),
        realFinishedFixtures: countValue(row.real_finished_fixtures),
        demoFinishedFixtures: countValue(row.demo_finished_fixtures),
        oddsSnapshots: countValue(row.odds_snapshots),
        realOddsSnapshots: countValue(row.real_odds_snapshots),
        demoOddsSnapshots: countValue(row.demo_odds_snapshots),
        backtestRuns: countValue(row.completed_backtests)
      };
    }
  }

  const [fixtures, finishedFixtures, demoFinishedFixtures, oddsSnapshots, demoOddsSnapshots, backtestRuns] = await runWithConcurrency([
    () => countRows("op_fixtures", [{ column: "sport", value: sport }]),
    () => countRows("op_fixtures", [
      { column: "sport", value: sport },
      { column: "status", value: "finished" }
    ]),
    () => countRows("op_fixtures", [
      { column: "sport", value: sport },
      { column: "status", value: "finished" },
      { column: "provider", value: "demo_seed" }
    ]),
    () => countRows("op_odds_snapshots", [{ column: "sport", value: sport }]),
    () => countRows("op_odds_snapshots", [
      { column: "sport", value: sport },
      { column: "provider", value: "demo_seed" }
    ]),
    () => countRows("op_backtest_runs", [{ column: "sport", value: sport }])
  ] as const);
  const error = [fixtures, finishedFixtures, demoFinishedFixtures, oddsSnapshots, demoOddsSnapshots, backtestRuns].find((item) => item.error)?.error;
  if (error) return { error };

  return {
    fixtures: fixtures.count,
    finishedFixtures: finishedFixtures.count,
    realFinishedFixtures: realRowCount(finishedFixtures.count, demoFinishedFixtures.count),
    demoFinishedFixtures: demoFinishedFixtures.count,
    oddsSnapshots: oddsSnapshots.count,
    realOddsSnapshots: realRowCount(oddsSnapshots.count, demoOddsSnapshots.count),
    demoOddsSnapshots: demoOddsSnapshots.count,
    backtestRuns: backtestRuns.count
  };
}

async function readTrainingSnapshotAggregateCounts(sport: Sport): Promise<TrainingSnapshotAggregateCounts | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const rpc = await client.rpc("op_training_snapshot_counts");
  if (!rpc.error && Array.isArray(rpc.data)) {
    const row = rpc.data.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).sport === sport) as
      | Record<string, unknown>
      | undefined;
    if (row && "complete_feature_snapshots" in row && "backtest_runs" in row) {
      return {
        fixtures: countValue(row.fixtures),
        finishedFixtures: countValue(row.finished_fixtures),
        realFinishedFixtures: countValue(row.real_finished_fixtures),
        demoFinishedFixtures: countValue(row.demo_finished_fixtures),
        oddsSnapshots: countValue(row.odds_snapshots),
        realOddsSnapshots: countValue(row.real_odds_snapshots),
        demoOddsSnapshots: countValue(row.demo_odds_snapshots),
        backtestRuns: countValue(row.backtest_runs),
        eventSnapshots: countValue(row.event_snapshots),
        demoEventSnapshots: countValue(row.demo_event_snapshots),
        newsSnapshots: countValue(row.news_snapshots),
        demoNewsSnapshots: countValue(row.demo_news_snapshots),
        standingsSnapshots: countValue(row.standings_snapshots),
        demoStandingsSnapshots: countValue(row.demo_standings_snapshots),
        availabilitySnapshots: countValue(row.availability_snapshots),
        demoAvailabilitySnapshots: countValue(row.demo_availability_snapshots),
        lineupSnapshots: countValue(row.lineup_snapshots),
        demoLineupSnapshots: countValue(row.demo_lineup_snapshots),
        weatherSnapshots: countValue(row.weather_snapshots),
        demoWeatherSnapshots: countValue(row.demo_weather_snapshots),
        featureSnapshots: countValue(row.feature_snapshots),
        completeFeatureSnapshots: countValue(row.complete_feature_snapshots),
        proxyFeatureSnapshots: countValue(row.proxy_feature_snapshots)
      };
    }
  }

  const [coreCounts, extraCounts] = await Promise.all([
    readTrainingSnapshotCoreCounts(sport),
    runWithConcurrency([
      () => countRows("op_live_match_events", [{ column: "sport", value: sport }]),
      () => countRows("op_live_match_events", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_news_signals", [{ column: "sport", value: sport }]),
      () => countRows("op_news_signals", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_standings_snapshots", [{ column: "sport", value: sport }]),
      () => countRows("op_standings_snapshots", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_player_availability_snapshots", [{ column: "sport", value: sport }]),
      () => countRows("op_player_availability_snapshots", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_lineup_snapshots", [{ column: "sport", value: sport }]),
      () => countRows("op_lineup_snapshots", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_weather_snapshots", [{ column: "sport", value: sport }]),
      () => countRows("op_weather_snapshots", [
        { column: "sport", value: sport },
        { column: "provider", value: "demo_seed" }
      ]),
      () => countRows("op_training_feature_snapshots", [{ column: "sport", value: sport }]),
      () => countCompleteFeatureSnapshots(sport),
      () => countRows("op_training_feature_snapshots", [
        { column: "sport", value: sport },
        { column: "source", value: "demo_seed" }
      ])
    ] as const)
  ] as const);

  if ("error" in coreCounts) return coreCounts;
  const error = extraCounts.find((item) => item.error)?.error;
  if (error) return { error };

  const [
    eventSnapshots,
    demoEventSnapshots,
    newsSnapshots,
    demoNewsSnapshots,
    standingsSnapshots,
    demoStandingsSnapshots,
    availabilitySnapshots,
    demoAvailabilitySnapshots,
    lineupSnapshots,
    demoLineupSnapshots,
    weatherSnapshots,
    demoWeatherSnapshots,
    featureSnapshots,
    completeFeatureSnapshots,
    proxyFeatureSnapshots
  ] = extraCounts;

  return {
    ...coreCounts,
    eventSnapshots: eventSnapshots.count,
    demoEventSnapshots: demoEventSnapshots.count,
    newsSnapshots: newsSnapshots.count,
    demoNewsSnapshots: demoNewsSnapshots.count,
    standingsSnapshots: standingsSnapshots.count,
    demoStandingsSnapshots: demoStandingsSnapshots.count,
    availabilitySnapshots: availabilitySnapshots.count,
    demoAvailabilitySnapshots: demoAvailabilitySnapshots.count,
    lineupSnapshots: lineupSnapshots.count,
    demoLineupSnapshots: demoLineupSnapshots.count,
    weatherSnapshots: weatherSnapshots.count,
    demoWeatherSnapshots: demoWeatherSnapshots.count,
    featureSnapshots: featureSnapshots.count,
    completeFeatureSnapshots: completeFeatureSnapshots.count,
    proxyFeatureSnapshots: proxyFeatureSnapshots.count
  };
}

async function loadTrainingDataSnapshot(sport: Sport): Promise<TrainingDataSnapshot> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return emptySnapshot(
      sport,
      "not-configured",
      false,
      `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    );
  }

  const [snapshotCounts, latestBacktest] = await Promise.all([readTrainingSnapshotAggregateCounts(sport), readLatestBacktest(sport)]);

  if ("error" in snapshotCounts) return emptySnapshot(sport, "failed", true, snapshotCounts.error);
  if (latestBacktest && "error" in latestBacktest) return emptySnapshot(sport, "failed", true, latestBacktest.error);

  const {
    fixtures,
    finishedFixtures,
    realFinishedFixtures,
    demoFinishedFixtures,
    oddsSnapshots,
    realOddsSnapshots,
    demoOddsSnapshots,
    backtestRuns,
    eventSnapshots,
    demoEventSnapshots,
    newsSnapshots,
    demoNewsSnapshots,
    standingsSnapshots,
    demoStandingsSnapshots,
    availabilitySnapshots,
    demoAvailabilitySnapshots,
    lineupSnapshots,
    demoLineupSnapshots,
    weatherSnapshots,
    demoWeatherSnapshots,
    featureSnapshots,
    completeFeatureSnapshots,
    proxyFeatureSnapshots
  } = snapshotCounts;
  const realEventSnapshots = realRowCount(eventSnapshots, demoEventSnapshots);
  const realNewsSnapshots = realRowCount(newsSnapshots, demoNewsSnapshots);
  const realStandingsSnapshots = realRowCount(standingsSnapshots, demoStandingsSnapshots);
  const realAvailabilitySnapshots = realRowCount(availabilitySnapshots, demoAvailabilitySnapshots);
  const realLineupSnapshots = realRowCount(lineupSnapshots, demoLineupSnapshots);
  const realWeatherSnapshots = realRowCount(weatherSnapshots, demoWeatherSnapshots);
  const partialFeatureSnapshots = Math.max(0, featureSnapshots - completeFeatureSnapshots - proxyFeatureSnapshots);
  const readyForTraining =
    realFinishedFixtures >= MINIMUM_RECOMMENDED_FIXTURES &&
    realOddsSnapshots > 0 &&
    completeFeatureSnapshots >= MINIMUM_RECOMMENDED_FIXTURES;
  const detail = readyForTraining
    ? "Historical fixtures, odds, and complete sport-specific feature rows are sufficient for a first serious backtest."
    : `Collect at least ${MINIMUM_RECOMMENDED_FIXTURES.toLocaleString()} real finished fixtures with odds and complete sport-specific model inputs before trusting calibration.`;

  const storageStatus = "ready";
  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    configured: true,
    sport,
    counts: {
      fixtures,
      finishedFixtures,
      realFinishedFixtures,
      demoFinishedFixtures,
      oddsSnapshots,
      realOddsSnapshots,
      demoOddsSnapshots,
      eventSnapshots,
      realEventSnapshots,
      demoEventSnapshots,
      newsSnapshots,
      realNewsSnapshots,
      demoNewsSnapshots,
      standingsSnapshots,
      realStandingsSnapshots,
      demoStandingsSnapshots,
      availabilitySnapshots,
      realAvailabilitySnapshots,
      demoAvailabilitySnapshots,
      lineupSnapshots,
      realLineupSnapshots,
      demoLineupSnapshots,
      weatherSnapshots,
      realWeatherSnapshots,
      demoWeatherSnapshots,
      featureSnapshots,
      completeFeatureSnapshots,
      partialFeatureSnapshots,
      proxyFeatureSnapshots,
      backtestRuns
    },
    latestBacktest,
    readiness: {
      hasHistoricalFixtures: realFinishedFixtures > 0,
      hasOdds: realOddsSnapshots > 0,
      hasBacktests: Boolean(latestBacktest),
      readyForTraining,
      minimumRecommendedFixtures: MINIMUM_RECOMMENDED_FIXTURES,
      detail
    },
    storage: {
      status: storageStatus,
      configured: true,
      detail: trainingStorageDetail(storageStatus, undefined),
      missingEnv: [],
      expectedTables: TRAINING_STORAGE_TABLES
    },
    controls: trainingControls(readyForTraining),
    nextActions: readyForTraining
      ? ["Run a real-data backtest review before promoting learned weights.", "Keep learned guardrails shadow-only until model governance passes."]
      : trainingNextActions(storageStatus, sport, {
          realFinishedFixtures,
          realOddsSnapshots
        }),
    proofUrls: trainingProofUrls()
  };
}

function trainingSnapshotCacheTtlMs(): number {
  const configured = Number(process.env.ODDSPADI_TRAINING_SNAPSHOT_CACHE_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 30_000;
  return Math.round(Math.min(5 * 60_000, Math.max(5_000, configured)));
}

export async function getTrainingDataSnapshot(sport: Sport = "football"): Promise<TrainingDataSnapshot> {
  const cached = trainingSnapshotCache.get(sport);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const snapshot = loadTrainingDataSnapshot(sport);
  const entry: TrainingSnapshotCacheEntry = {
    expiresAt: Date.now() + trainingSnapshotCacheTtlMs(),
    snapshot
  };
  trainingSnapshotCache.set(sport, entry);

  try {
    const result = await snapshot;
    if (result.status !== "ready" && trainingSnapshotCache.get(sport) === entry) trainingSnapshotCache.delete(sport);
    return result;
  } catch (error) {
    if (trainingSnapshotCache.get(sport) === entry) trainingSnapshotCache.delete(sport);
    throw error;
  }
}

export function invalidateTrainingDataSnapshot(sport?: Sport): void {
  if (sport) {
    trainingSnapshotCache.delete(sport);
    return;
  }
  trainingSnapshotCache.clear();
}

type StoredFinishedFixtures = {
  fixtures: FixtureRow[];
  featuresByFixture: Map<string, { home?: FeatureRow; away?: FeatureRow }>;
  oddsByFixture: Map<string, OddsRow[]>;
};

function chunkItems<T>(items: T[], size = 250): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function readFinishedFixtureRows(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  sport: TrainingSport,
  limit: number,
  includeDemo: boolean
): Promise<FixtureRow[] | { error: string }> {
  const pageSize = 1000;
  const fixtures: FixtureRow[] = [];

  for (let offset = 0; fixtures.length < limit; offset += pageSize) {
    const to = Math.min(offset + pageSize - 1, limit - 1);
    let query = client
      .from("op_fixtures")
      .select(
        "id, provider, external_id, league_external_id, season, round, kickoff_at, home_team_external_id, away_team_external_id, home_score, away_score, home_xg, away_xg, neutral_venue, data_quality, metadata"
      )
      .eq("sport", sport)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .not("away_score", "is", null);

    if (!includeDemo) {
      query = query.neq("provider", "demo_seed");
    }

    const { data, error } = await query
      .order("kickoff_at", { ascending: true })
      .order("external_id", { ascending: true })
      .range(offset, to);
    if (error) return { error: error.message };

    const page = (data ?? []) as FixtureRow[];
    fixtures.push(...page);
    if (page.length < pageSize) break;
  }

  return fixtures.slice(0, limit);
}

async function readStoredFinishedFixtures(
  sport: TrainingSport,
  limit = 5000,
  { includeDemo = false, includeFeatures = true }: { includeDemo?: boolean; includeFeatures?: boolean } = {}
): Promise<StoredFinishedFixtures | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const fixtures = await readFinishedFixtureRows(client, sport, limit, includeDemo);
  if ("error" in fixtures) return fixtures;
  if (!fixtures.length) {
    return {
      fixtures: [],
      featuresByFixture: new Map(),
      oddsByFixture: new Map()
    };
  }

  const fixtureIds = fixtures.map((fixture) => fixture.id);
  const fixtureExternalIds = fixtures.map((fixture) => fixture.external_id);

  const featureRows: FeatureRow[] = [];
  if (includeFeatures) {
    for (const chunk of chunkItems(fixtureIds)) {
      const { data, error } = await client
        .from("op_fixture_team_features")
        .select(
          "fixture_id, side, elo_rating, attack_strength, defense_strength, recent_form_points, recent_goals_for, recent_goals_against, rest_days, injuries_count, suspensions_count, metadata"
        )
        .in("fixture_id", chunk);
      if (error) return { error: error.message };
      featureRows.push(...((data ?? []) as FeatureRow[]));
    }
  }

  const oddsRows: OddsRow[] = [];
  for (const chunk of chunkItems(fixtureExternalIds, 100)) {
    const { data, error } = await client
      .from("op_odds_snapshots")
      .select("fixture_external_id, market, selection, decimal_odds, is_closing, observed_at, bookmaker")
      .eq("sport", sport)
      .eq("market", "match_winner")
      .in("fixture_external_id", chunk)
      .order("observed_at", { ascending: true });
    if (error) return { error: error.message };
    oddsRows.push(...((data ?? []) as OddsRow[]));
  }

  const featuresByFixture = new Map<string, { home?: FeatureRow; away?: FeatureRow }>();
  for (const row of featureRows) {
    const current = featuresByFixture.get(row.fixture_id) ?? {};
    current[row.side] = row;
    featuresByFixture.set(row.fixture_id, current);
  }

  const oddsByFixture = new Map<string, OddsRow[]>();
  for (const row of oddsRows) {
    const decimalOdds = toNumber(row.decimal_odds);
    if (!decimalOdds) continue;
    oddsByFixture.set(row.fixture_external_id, [...(oddsByFixture.get(row.fixture_external_id) ?? []), row]);
  }

  return { fixtures, featuresByFixture, oddsByFixture };
}

function footballOddsFromRows(rows: OddsRow[]): HistoricalFootballOddsQuote[] {
  return rows.flatMap((row) => {
    const selection = toFootballOddsSelection(row.selection);
    const decimalOdds = toNumber(row.decimal_odds);
    if (!selection || !decimalOdds) return [];
    return {
      market: "match_winner" as const,
      selection,
      decimalOdds,
      isClosing: Boolean(row.is_closing),
      observedAt: row.observed_at ?? undefined,
      bookmaker: row.bookmaker ?? undefined
    };
  });
}

function basketballOddsFromRows(rows: OddsRow[]): HistoricalBasketballOddsQuote[] {
  return rows.flatMap((row) => {
    const selection = toTwoWaySelection(row.selection);
    const decimalOdds = toNumber(row.decimal_odds);
    if (!selection || !decimalOdds) return [];
    return {
      market: "moneyline" as const,
      selection,
      decimalOdds,
      isClosing: Boolean(row.is_closing),
      observedAt: row.observed_at ?? undefined,
      bookmaker: row.bookmaker ?? undefined
    };
  });
}

function tennisOddsFromRows(rows: OddsRow[]): HistoricalTennisOddsQuote[] {
  return rows.flatMap((row) => {
    const selection = toTwoWaySelection(row.selection);
    const decimalOdds = toNumber(row.decimal_odds);
    if (!selection || !decimalOdds) return [];
    return {
      market: "match_winner" as const,
      selection,
      decimalOdds,
      isClosing: Boolean(row.is_closing),
      observedAt: row.observed_at ?? undefined,
      bookmaker: row.bookmaker ?? undefined
    };
  });
}

export async function readHistoricalFootballFixtures(
  limit = 5000,
  { includeDemo = false }: { includeDemo?: boolean } = {}
): Promise<HistoricalFootballFixture[] | { error: string }> {
  const stored = await readStoredFinishedFixtures("football", limit, { includeDemo });
  if ("error" in stored) return stored;

  return stored.fixtures.map((fixture) => {
    const features = stored.featuresByFixture.get(fixture.id) ?? {};
    const home = features.home;
    const away = features.away;

    return {
      fixtureExternalId: fixture.external_id,
      kickoffAt: fixture.kickoff_at,
      leagueExternalId: fixture.league_external_id,
      season: fixture.season,
      homeTeamExternalId: fixture.home_team_external_id,
      awayTeamExternalId: fixture.away_team_external_id,
      homeScore: fixture.home_score ?? 0,
      awayScore: fixture.away_score ?? 0,
      neutralVenue: Boolean(fixture.neutral_venue),
      dataQuality: toNumber(fixture.data_quality, 0.72),
      homeElo: numericOrUndefined(home?.elo_rating),
      awayElo: numericOrUndefined(away?.elo_rating),
      homeAttackStrength: numericOrUndefined(home?.attack_strength),
      awayAttackStrength: numericOrUndefined(away?.attack_strength),
      homeDefenseStrength: numericOrUndefined(home?.defense_strength),
      awayDefenseStrength: numericOrUndefined(away?.defense_strength),
      homeRecentFormPoints: numericOrUndefined(home?.recent_form_points),
      awayRecentFormPoints: numericOrUndefined(away?.recent_form_points),
      homeRecentGoalsFor: numericOrUndefined(home?.recent_goals_for),
      awayRecentGoalsFor: numericOrUndefined(away?.recent_goals_for),
      homeRecentGoalsAgainst: numericOrUndefined(home?.recent_goals_against),
      awayRecentGoalsAgainst: numericOrUndefined(away?.recent_goals_against),
      homeRestDays: numericOrUndefined(home?.rest_days),
      awayRestDays: numericOrUndefined(away?.rest_days),
      homeInjuriesCount: home?.injuries_count ?? undefined,
      awayInjuriesCount: away?.injuries_count ?? undefined,
      homeSuspensionsCount: home?.suspensions_count ?? undefined,
      awaySuspensionsCount: away?.suspensions_count ?? undefined,
      odds: footballOddsFromRows(stored.oddsByFixture.get(fixture.external_id) ?? [])
    };
  });
}

function dimensionKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

/**
 * Read the raw historical identities/outcomes needed to rebuild leakage-safe
 * runtime features. Stored strength snapshots are intentionally not trusted
 * here because legacy rows do not carry an as-of or leakage receipt.
 */
export async function readHistoricalFootballRuntimeFixtures(
  limit = 50_000,
  { includeDemo = false }: { includeDemo?: boolean } = {}
): Promise<HistoricalFootballFixtureInput[] | { error: string }> {
  const stored = await readStoredFinishedFixtures("football", limit, { includeDemo, includeFeatures: false });
  if ("error" in stored) return stored;
  if (!stored.fixtures.length) return [];

  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const leagueIds = Array.from(new Set(stored.fixtures.map((fixture) => fixture.league_external_id).filter((value): value is string => Boolean(value))));
  const teamIds = Array.from(new Set(stored.fixtures.flatMap((fixture) => [fixture.home_team_external_id, fixture.away_team_external_id])));
  const leagues: LeagueDimensionRow[] = [];
  const teams: TeamDimensionRow[] = [];
  const availabilityRows: AvailabilityRow[] = [];
  const lineupRows: LineupRow[] = [];

  for (const chunk of chunkItems(leagueIds)) {
    const { data, error } = await client
      .from("op_leagues")
      .select("provider, external_id, name, country, strength")
      .eq("sport", "football")
      .in("external_id", chunk);
    if (error) return { error: error.message };
    leagues.push(...((data ?? []) as LeagueDimensionRow[]));
  }
  for (const chunk of chunkItems(teamIds)) {
    const { data, error } = await client
      .from("op_teams")
      .select("provider, external_id, name, country")
      .eq("sport", "football")
      .in("external_id", chunk);
    if (error) return { error: error.message };
    teams.push(...((data ?? []) as TeamDimensionRow[]));
  }
  const fixtureExternalIds = stored.fixtures.map((fixture) => fixture.external_id);
  for (const chunk of chunkItems(fixtureExternalIds, 100)) {
    const { data, error } = await client
      .from("op_player_availability_snapshots")
      .select("provider, fixture_external_id, team_external_id, player_external_id, player_name, status, impact_score, reason, observed_at")
      .eq("sport", "football")
      .in("fixture_external_id", chunk);
    if (error) return { error: error.message };
    availabilityRows.push(...((data ?? []) as AvailabilityRow[]));
  }
  for (const chunk of chunkItems(fixtureExternalIds, 100)) {
    const { data, error } = await client
      .from("op_lineup_snapshots")
      .select("provider, fixture_external_id, team_external_id, lineup_status, formation, players, observed_at")
      .eq("sport", "football")
      .in("fixture_external_id", chunk);
    if (error) return { error: error.message };
    lineupRows.push(...((data ?? []) as LineupRow[]));
  }

  const leaguesByKey = new Map(leagues.map((row) => [dimensionKey(row.provider, row.external_id), row]));
  const teamsByKey = new Map(teams.map((row) => [dimensionKey(row.provider, row.external_id), row]));
  const availabilityByFixture = new Map<string, AvailabilityRow[]>();
  for (const row of availabilityRows) {
    const key = dimensionKey(row.provider, row.fixture_external_id);
    availabilityByFixture.set(key, [...(availabilityByFixture.get(key) ?? []), row]);
  }
  const lineupsByFixture = new Map<string, LineupRow[]>();
  for (const row of lineupRows) {
    const key = dimensionKey(row.provider, row.fixture_external_id);
    lineupsByFixture.set(key, [...(lineupsByFixture.get(key) ?? []), row]);
  }

  return stored.fixtures.map((fixture) => {
    const leagueExternalId = fixture.league_external_id ?? "";
    const league = leaguesByKey.get(dimensionKey(fixture.provider, leagueExternalId));
    const homeTeam = teamsByKey.get(dimensionKey(fixture.provider, fixture.home_team_external_id));
    const awayTeam = teamsByKey.get(dimensionKey(fixture.provider, fixture.away_team_external_id));
    return {
      externalId: fixture.external_id,
      kickoffAt: fixture.kickoff_at,
      league: {
        externalId: leagueExternalId,
        name: league?.name ?? "",
        country: league?.country ?? null,
        strength: toNumber(league?.strength)
      },
      season: fixture.season,
      round: fixture.round,
      status: "finished" as const,
      homeTeam: {
        externalId: fixture.home_team_external_id,
        name: homeTeam?.name ?? "",
        country: homeTeam?.country ?? null
      },
      awayTeam: {
        externalId: fixture.away_team_external_id,
        name: awayTeam?.name ?? "",
        country: awayTeam?.country ?? null
      },
      homeScore: fixture.home_score,
      awayScore: fixture.away_score,
      homeXg: toNumber(fixture.home_xg),
      awayXg: toNumber(fixture.away_xg),
      neutralVenue: Boolean(fixture.neutral_venue),
      dataQuality: toNumber(fixture.data_quality, 0.72),
      odds: footballOddsFromRows(stored.oddsByFixture.get(fixture.external_id) ?? []),
      availability: (availabilityByFixture.get(dimensionKey(fixture.provider, fixture.external_id)) ?? []).map((row) => ({
        teamExternalId: row.team_external_id,
        playerExternalId: row.player_external_id,
        playerName: row.player_name,
        status: row.status,
        impactScore: toNumber(row.impact_score),
        reason: row.reason,
        observedAt: row.observed_at
      })),
      lineups: (lineupsByFixture.get(dimensionKey(fixture.provider, fixture.external_id)) ?? []).map((row) => ({
        teamExternalId: row.team_external_id,
        lineupStatus: row.lineup_status,
        formation: row.formation,
        players: Array.isArray(row.players) ? row.players : [],
        observedAt: row.observed_at
      })),
      metadata: {
        ...(fixture.metadata ?? {}),
        provider: fixture.provider,
        runtimeReplaySource: "stored-identities-and-outcomes"
      }
    };
  });
}

export async function readHistoricalBasketballFixtures(
  limit = 5000,
  { includeDemo = false }: { includeDemo?: boolean } = {}
): Promise<HistoricalBasketballFixture[] | { error: string }> {
  const stored = await readStoredFinishedFixtures("basketball", limit, { includeDemo });
  if ("error" in stored) return stored;

  return stored.fixtures.map((fixture) => {
    const features = stored.featuresByFixture.get(fixture.id) ?? {};
    const home = features.home;
    const away = features.away;

    return {
      fixtureExternalId: fixture.external_id,
      kickoffAt: fixture.kickoff_at,
      leagueExternalId: fixture.league_external_id,
      season: fixture.season,
      homeTeamExternalId: fixture.home_team_external_id,
      awayTeamExternalId: fixture.away_team_external_id,
      homeScore: fixture.home_score ?? 0,
      awayScore: fixture.away_score ?? 0,
      neutralVenue: Boolean(fixture.neutral_venue),
      dataQuality: toNumber(fixture.data_quality, 0.72),
      homeRating: metadataNumber(home?.metadata, "rating") ?? numericOrUndefined(home?.elo_rating),
      awayRating: metadataNumber(away?.metadata, "rating") ?? numericOrUndefined(away?.elo_rating),
      homePace: metadataNumber(home?.metadata, "pace"),
      awayPace: metadataNumber(away?.metadata, "pace"),
      homeOffensiveEfficiency: metadataNumber(home?.metadata, "offensiveEfficiency") ?? numericOrUndefined(home?.attack_strength),
      awayOffensiveEfficiency: metadataNumber(away?.metadata, "offensiveEfficiency") ?? numericOrUndefined(away?.attack_strength),
      homeDefensiveEfficiency: metadataNumber(home?.metadata, "defensiveEfficiency") ?? numericOrUndefined(home?.defense_strength),
      awayDefensiveEfficiency: metadataNumber(away?.metadata, "defensiveEfficiency") ?? numericOrUndefined(away?.defense_strength),
      homeRecentFormPoints: numericOrUndefined(home?.recent_form_points),
      awayRecentFormPoints: numericOrUndefined(away?.recent_form_points),
      homeRestDays: numericOrUndefined(home?.rest_days),
      awayRestDays: numericOrUndefined(away?.rest_days),
      homeInjuriesCount: home?.injuries_count ?? undefined,
      awayInjuriesCount: away?.injuries_count ?? undefined,
      homeRotationPenalty: home?.suspensions_count ?? undefined,
      awayRotationPenalty: away?.suspensions_count ?? undefined,
      odds: basketballOddsFromRows(stored.oddsByFixture.get(fixture.external_id) ?? [])
    };
  });
}

export async function readHistoricalTennisMatches(
  limit = 5000,
  { includeDemo = false }: { includeDemo?: boolean } = {}
): Promise<HistoricalTennisMatch[] | { error: string }> {
  const stored = await readStoredFinishedFixtures("tennis", limit, { includeDemo });
  if ("error" in stored) return stored;

  return stored.fixtures.map((fixture) => {
    const features = stored.featuresByFixture.get(fixture.id) ?? {};
    const home = features.home;
    const away = features.away;
    const surface = metadataString(fixture.metadata, "surface") ?? metadataString(home?.metadata, "surface") ?? "unknown";

    return {
      fixtureExternalId: fixture.external_id,
      kickoffAt: fixture.kickoff_at,
      tournamentExternalId: fixture.league_external_id,
      season: fixture.season,
      surface: surface === "hard" || surface === "clay" || surface === "grass" || surface === "indoor" ? surface : "unknown",
      round: fixture.round,
      homePlayerExternalId: fixture.home_team_external_id,
      awayPlayerExternalId: fixture.away_team_external_id,
      homeSets: fixture.home_score ?? 0,
      awaySets: fixture.away_score ?? 0,
      dataQuality: toNumber(fixture.data_quality, 0.72),
      homeElo: metadataNumber(home?.metadata, "elo") ?? numericOrUndefined(home?.elo_rating),
      awayElo: metadataNumber(away?.metadata, "elo") ?? numericOrUndefined(away?.elo_rating),
      homeSurfaceRating: metadataNumber(home?.metadata, "surfaceRating") ?? numericOrUndefined(home?.attack_strength),
      awaySurfaceRating: metadataNumber(away?.metadata, "surfaceRating") ?? numericOrUndefined(away?.attack_strength),
      homeRecentFormPoints: numericOrUndefined(home?.recent_form_points),
      awayRecentFormPoints: numericOrUndefined(away?.recent_form_points),
      homeHeadToHeadWins: metadataNumber(home?.metadata, "headToHeadWins"),
      awayHeadToHeadWins: metadataNumber(away?.metadata, "headToHeadWins"),
      homeFatigueScore: metadataNumber(home?.metadata, "fatigueScore") ?? fatigueFromRestDays(home?.rest_days),
      awayFatigueScore: metadataNumber(away?.metadata, "fatigueScore") ?? fatigueFromRestDays(away?.rest_days),
      homeInjuryRisk: metadataNumber(home?.metadata, "injuryRisk") ?? (home?.injuries_count ? Math.min(1, home.injuries_count * 0.2) : undefined),
      awayInjuryRisk: metadataNumber(away?.metadata, "injuryRisk") ?? (away?.injuries_count ? Math.min(1, away.injuries_count * 0.2) : undefined),
      odds: tennisOddsFromRows(stored.oddsByFixture.get(fixture.external_id) ?? [])
    };
  });
}

function resultTrainWindowStart(result: HistoricalBacktestResult): string | null {
  return "trainWindowStart" in result ? result.trainWindowStart : result.windowStart;
}

function resultTrainWindowEnd(result: HistoricalBacktestResult): string | null {
  return "trainWindowEnd" in result ? result.trainWindowEnd : null;
}

function resultTestWindowStart(result: HistoricalBacktestResult): string | null {
  return "testWindowStart" in result ? result.testWindowStart : result.results[0]?.kickoffAt ?? null;
}

function resultTestWindowEnd(result: HistoricalBacktestResult): string | null {
  return "testWindowEnd" in result ? result.testWindowEnd : result.windowEnd;
}

async function readHistoricalFixturesForSport(
  sport: TrainingSport,
  limit: number,
  includeDemo: boolean
): Promise<Array<HistoricalFootballFixture | HistoricalBasketballFixture | HistoricalTennisMatch> | { error: string }> {
  if (sport === "basketball") return readHistoricalBasketballFixtures(limit, { includeDemo });
  if (sport === "tennis") return readHistoricalTennisMatches(limit, { includeDemo });
  return readHistoricalFootballFixtures(limit, { includeDemo });
}

function runBacktestForSport(
  sport: TrainingSport,
  fixtures: Array<HistoricalFootballFixture | HistoricalBasketballFixture | HistoricalTennisMatch>,
  config: HistoricalBacktestConfig
): HistoricalBacktestResult {
  if (sport === "basketball") return runBasketballRuntimeReplay(fixtures as HistoricalBasketballFixture[], config as BasketballBacktestConfig);
  if (sport === "tennis") return runTennisRuntimeReplay(fixtures as HistoricalTennisMatch[], config as TennisBacktestConfig);
  return runFootballBacktest(fixtures as HistoricalFootballFixture[], config as FootballBacktestConfig);
}

function isRuntimeReplayResult(result: HistoricalBacktestResult): result is FootballRuntimeReplayResult | TwoWayRuntimeReplayResult {
  return "featureContract" in result && "executionHash" in result;
}

function modelIdentityForResult(result: HistoricalBacktestResult): Record<string, string | number> {
  if (!isRuntimeReplayResult(result)) return benchmarkModelIdentityReceipt(result.sport);
  return result.sport === "football" ? footballRuntimeReplayIdentityReceipt(result) : twoWayRuntimeReplayIdentityReceipt(result);
}

function backtestInsertPayload(result: HistoricalBacktestResult, includeDemo: boolean): Record<string, unknown> {
  const runtimeReplay = isRuntimeReplayResult(result);
  return {
    sport: result.sport,
    model_key: result.modelKey,
    engine_version: result.engineVersion,
    status: "completed",
    data_source: `${includeDemo ? "supabase:op_fixtures:demo-included" : "supabase:op_fixtures:real-only"}${runtimeReplay ? ":runtime-entrypoint" : ":benchmark"}`,
    train_window_start: resultTrainWindowStart(result),
    train_window_end: resultTrainWindowEnd(result),
    test_window_start: resultTestWindowStart(result),
    test_window_end: resultTestWindowEnd(result),
    sample_size: result.sampleSize,
    train_size: result.trainSize,
    test_size: result.testSize,
    pick_count: result.pickCount,
    brier_score: result.brierScore,
    log_loss: result.logLoss,
    roi_units: result.roiUnits,
    yield: result.yield,
    average_edge: result.averageEdge,
    closing_line_value: result.closingLineValue,
    calibration_error: result.calibrationError,
    calibration_buckets: result.calibrationBuckets,
    market_breakdown: result.marketBreakdown,
    confidence_breakdown: result.confidenceBreakdown,
    learned_weights: result.learnedWeights,
    config: {
      ...result.config,
      ...("learnedWeightsProvenance" in result
        ? { learnedWeightsProvenance: result.learnedWeightsProvenance }
        : {}),
      ...(result.sport === "football" ? { oddsCoverage: result.oddsCoverage } : {}),
      ...(runtimeReplay
        ? {
            featureContract: result.featureContract,
            executionHash: result.executionHash,
            selectionPolicy: result.selectionPolicy,
            economicSelectionComparison: result.economicSelectionComparison,
            probabilityCalibrationPolicy: result.probabilityCalibrationPolicy,
            probabilityCalibrationComparison: result.probabilityCalibrationComparison,
            marketPriorEvidence: result.marketPriorEvidence
          }
        : {}),
      modelIdentity: modelIdentityForResult(result)
    },
    notes: result.notes
  };
}

function legacyBacktestInsertPayload(result: HistoricalBacktestResult, includeDemo: boolean): Record<string, unknown> {
  const payload = backtestInsertPayload(result, includeDemo);
  delete payload.calibration_error;
  delete payload.calibration_buckets;
  payload.config = {
    ...(typeof payload.config === "object" ? payload.config : {}),
    calibration: {
      expectedCalibrationError: result.calibrationError,
      buckets: result.calibrationBuckets
    }
  };
  payload.notes = [
    ...result.notes,
    "Legacy op_backtest_runs schema lacks calibration_error/calibration_buckets; calibration metrics were stored under config.calibration."
  ];
  return payload;
}

async function insertBacktestRun({
  result,
  includeDemo
}: {
  result: HistoricalBacktestResult;
  includeDemo: boolean;
}): Promise<{ id: string } | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const insert = await client.from("op_backtest_runs").insert(backtestInsertPayload(result, includeDemo)).select("id").single();
  if (!insert.error) return { id: String(insert.data.id) };
  if (!isMissingBacktestCalibrationColumn(insert.error.message)) return { error: insert.error.message };

  const legacyInsert = await client.from("op_backtest_runs").insert(legacyBacktestInsertPayload(result, includeDemo)).select("id").single();
  if (legacyInsert.error) return { error: legacyInsert.error.message };
  return { id: String(legacyInsert.data.id) };
}

export async function runAndStoreHistoricalBacktest({
  sport = "football",
  minSample = 30,
  limit = 5000,
  config = {},
  includeDemo = false
}: {
  sport?: TrainingSport;
  minSample?: number;
  limit?: number;
  config?: HistoricalBacktestConfig;
  includeDemo?: boolean;
} = {}): Promise<BacktestRunStoreResult> {
  if (sport === "football") {
    return runAndStoreFootballRuntimeReplay({
      minSample,
      limit,
      config: config as FootballRuntimeReplayConfig,
      includeDemo
    });
  }
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      configured: false,
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, reason: "Supabase client could not be created." };

  const fixtures = await readHistoricalFixturesForSport(sport, limit, includeDemo);
  if ("error" in fixtures) return { status: "failed", configured: true, reason: fixtures.error };
  if (fixtures.length < minSample) {
    return {
      status: "no-data",
      configured: true,
      reason: `Only ${fixtures.length} finished ${sport} fixture(s) are stored; ${minSample} are required for this backtest run.`,
      result: runBacktestForSport(sport, fixtures, config)
    };
  }

  const result = runBacktestForSport(sport, fixtures, config);
  if (result.status !== "completed" || result.sampleSize < minSample) {
    return {
      status: "no-data",
      configured: true,
      reason:
        result.sampleSize < minSample
          ? `Only ${result.sampleSize} ${sport} fixture(s) satisfy the runtime feature contract; ${minSample} are required.`
          : result.notes[0] ?? "No completed historical backtest was produced.",
      result
    };
  }

  const stored = await insertBacktestRun({ result, includeDemo });
  if ("error" in stored) return { status: "failed", configured: true, reason: stored.error, result };

  invalidateTrainingDataSnapshot(sport);

  return {
    status: "stored",
    configured: true,
    id: stored.id,
    result
  };
}

/** Read and replay the stored corpus without inserting an op_backtest_runs row. */
export async function previewStoredHistoricalRuntimeReplay({
  sport,
  limit = 50_000,
  config = {},
  includeDemo = false
}: {
  sport: TrainingSport;
  limit?: number;
  config?: HistoricalBacktestConfig;
  includeDemo?: boolean;
}): Promise<HistoricalBacktestResult | { error: string }> {
  if (sport === "football") {
    return previewStoredFootballRuntimeReplay({
      limit,
      config: config as FootballRuntimeReplayConfig,
      includeDemo
    });
  }

  const fixtures = await readHistoricalFixturesForSport(sport, limit, includeDemo);
  if ("error" in fixtures) return fixtures;
  return runBacktestForSport(sport, fixtures, config);
}

export async function runAndStoreHistoricalFootballBacktest({
  minSample = 30,
  limit = 5000,
  config = {},
  includeDemo = false
}: {
  minSample?: number;
  limit?: number;
  config?: FootballBacktestConfig;
  includeDemo?: boolean;
} = {}): Promise<BacktestRunStoreResult> {
  return runAndStoreHistoricalBacktest({ sport: "football", minSample, limit, config, includeDemo });
}

export async function previewStoredFootballRuntimeReplay({
  limit = 50_000,
  config = {},
  includeDemo = false
}: {
  limit?: number;
  config?: FootballRuntimeReplayConfig;
  includeDemo?: boolean;
} = {}): Promise<FootballRuntimeReplayResult | { error: string }> {
  const fixtures = await readHistoricalFootballRuntimeFixtures(limit, { includeDemo });
  if ("error" in fixtures) return fixtures;
  const playerPerformances = await readStoredPlayerMatchPerformancesForFixtureIds(
    fixtures.map((fixture) => fixture.externalId),
    { includeDemo }
  );
  if (playerPerformances.status === "failed" || playerPerformances.status === "not-configured") {
    return { error: playerPerformances.reason ?? "Player-performance corpus could not be read." };
  }
  return runFootballRuntimeReplay(fixtures, config, { playerPerformances: playerPerformances.rows });
}

export async function runAndStoreFootballRuntimeReplay({
  minSample = 100,
  limit = 50_000,
  config = {},
  includeDemo = false
}: {
  minSample?: number;
  limit?: number;
  config?: FootballRuntimeReplayConfig;
  includeDemo?: boolean;
} = {}): Promise<BacktestRunStoreResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      configured: false,
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const replay = await previewStoredFootballRuntimeReplay({ limit, config, includeDemo });
  if ("error" in replay) return { status: "failed", configured: true, reason: replay.error };
  if (replay.status !== "completed" || replay.featureContract.status !== "passed" || replay.sampleSize < minSample) {
    return {
      status: "no-data",
      configured: true,
      reason: replay.sampleSize < minSample
        ? `Only ${replay.sampleSize} football fixture(s) satisfy the exact runtime feature contract; ${minSample} are required.`
        : replay.notes[0] ?? "No exact-entrypoint football runtime replay was produced.",
      result: replay
    };
  }

  const stored = await insertBacktestRun({ result: replay, includeDemo });
  if ("error" in stored) return { status: "failed", configured: true, reason: stored.error, result: replay };
  invalidateTrainingDataSnapshot("football");
  return { status: "stored", configured: true, id: stored.id, result: replay };
}

export function trainingModelKey(sport: TrainingSport = "football"): string {
  if (sport === "basketball") return BASKETBALL_BACKTEST_MODEL_KEY;
  if (sport === "tennis") return TENNIS_BACKTEST_MODEL_KEY;
  return FOOTBALL_BACKTEST_MODEL_KEY;
}

export function historicalBacktestExecutionModelKey(sport: TrainingSport = "football"): string {
  if (sport === "basketball") return runtimeModelKey("basketball");
  if (sport === "tennis") return runtimeModelKey("tennis");
  return runtimeModelKey("football");
}
