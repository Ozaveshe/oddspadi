import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { EPL_2026_SEASON } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";
import { strictTrainingFeatureJsonColumns } from "@/lib/sports/training/featureQuality";

type EnvLike = Record<string, string | undefined>;
type TrainingSport = Extract<Sport, "football" | "basketball" | "tennis">;
type CountOperator = "eq" | "neq" | "not-null" | "in";
type CountFilterValue = string | string[];

export type SupabaseTrainingCorpusCensusStatus =
  | "waiting-supabase"
  | "empty-corpus"
  | "partial-corpus"
  | "ready-live-monitor"
  | "ready-shadow-backtest"
  | "failed";

export type SupabaseTrainingCorpusSportCounts = {
  sport: TrainingSport;
  fixtures: number;
  finishedFixtures: number;
  epl2026Fixtures: number;
  oddsSnapshots: number;
  matchWinnerOddsSnapshots: number;
  rawProviderPayloads: number;
  playerPerformanceRows: number;
  featureSnapshots: number;
  completeFeatureSnapshots: number;
  completeLiveFeatureSnapshots: number;
  partialFeatureSnapshots: number;
  proxyFeatureSnapshots: number;
  liveFeatureSnapshots: number;
  labeledFeatureSnapshots: number;
  completedBacktests: number;
};

export type SupabaseTrainingCorpusSportCountsInput = Omit<
  SupabaseTrainingCorpusSportCounts,
  "playerPerformanceRows" | "completeFeatureSnapshots" | "completeLiveFeatureSnapshots" | "partialFeatureSnapshots" | "proxyFeatureSnapshots"
> &
  Partial<
    Pick<
      SupabaseTrainingCorpusSportCounts,
      "playerPerformanceRows" | "completeFeatureSnapshots" | "completeLiveFeatureSnapshots" | "partialFeatureSnapshots" | "proxyFeatureSnapshots"
    >
  >;

export type SupabaseTrainingCorpusCensus = {
  mode: "supabase-training-corpus-census";
  generatedAt: string;
  status: SupabaseTrainingCorpusCensusStatus;
  censusHash: string;
  summary: string;
  target: {
    expectedProjectRef: string;
    projectRef: string;
    serverReadReady: boolean;
    targetMatchesExpected: boolean;
  };
  totals: {
    sports: number;
    fixtures: number;
    finishedFixtures: number;
    oddsSnapshots: number;
    rawProviderPayloads: number;
    playerPerformanceRows: number;
    featureSnapshots: number;
    completeFeatureSnapshots: number;
    completeLiveFeatureSnapshots: number;
    partialFeatureSnapshots: number;
    proxyFeatureSnapshots: number;
    liveFeatureSnapshots: number;
    completedBacktests: number;
    errors: number;
  };
  sports: SupabaseTrainingCorpusSportCounts[];
  readiness: {
    liveMonitorReadySports: TrainingSport[];
    shadowBacktestReadySports: TrainingSport[];
    emptySports: TrainingSport[];
    minimumRecommendedFinishedFixtures: number;
    errors: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canUseForLiveMonitor: boolean;
    canUseForShadowBacktest: boolean;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
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

const TRAINING_SPORTS: TrainingSport[] = ["football", "basketball", "tennis"];
const TRAINING_CENSUS_READ_TIMEOUT_MS = 3_000;
const MINIMUM_RECOMMENDED_FINISHED_FIXTURES = 1000;
const ZERO_COUNTS: SupabaseTrainingCorpusSportCounts[] = TRAINING_SPORTS.map((sport) => ({
  sport,
  fixtures: 0,
  finishedFixtures: 0,
  epl2026Fixtures: 0,
  oddsSnapshots: 0,
  matchWinnerOddsSnapshots: 0,
  rawProviderPayloads: 0,
  playerPerformanceRows: 0,
  featureSnapshots: 0,
  completeFeatureSnapshots: 0,
  completeLiveFeatureSnapshots: 0,
  partialFeatureSnapshots: 0,
  proxyFeatureSnapshots: 0,
  liveFeatureSnapshots: 0,
  labeledFeatureSnapshots: 0,
  completedBacktests: 0
}));

type CorpusCountsRead = {
  counts: SupabaseTrainingCorpusSportCounts[];
  errors: string[];
};

type CensusCacheEntry = {
  cacheKey: string;
  expiresAt: number;
  read: Promise<CorpusCountsRead>;
};

let censusCache: CensusCacheEntry | null = null;

function censusReadSignal(): AbortSignal {
  return AbortSignal.timeout(TRAINING_CENSUS_READ_TIMEOUT_MS);
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function sumBy(rows: SupabaseTrainingCorpusSportCounts[], key: keyof Omit<SupabaseTrainingCorpusSportCounts, "sport">): number {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function normalizedCounts(row: SupabaseTrainingCorpusSportCountsInput): SupabaseTrainingCorpusSportCounts {
  const proxyFeatureSnapshots = row.proxyFeatureSnapshots ?? 0;
  const playerPerformanceRows = row.playerPerformanceRows ?? 0;
  const completeFeatureSnapshots = row.completeFeatureSnapshots ?? row.featureSnapshots;
  const completeLiveFeatureSnapshots = row.completeLiveFeatureSnapshots ?? row.liveFeatureSnapshots;
  return {
    ...row,
    playerPerformanceRows,
    completeFeatureSnapshots,
    completeLiveFeatureSnapshots,
    partialFeatureSnapshots:
      row.partialFeatureSnapshots ?? Math.max(0, row.featureSnapshots - completeFeatureSnapshots - proxyFeatureSnapshots),
    proxyFeatureSnapshots
  };
}

function liveMonitorReady(row: SupabaseTrainingCorpusSportCounts): boolean {
  if (row.sport === "football") {
    return row.epl2026Fixtures > 0 && row.matchWinnerOddsSnapshots > 0 && row.rawProviderPayloads > 0 && row.completeLiveFeatureSnapshots > 0;
  }
  return row.fixtures > 0 && row.oddsSnapshots > 0 && row.rawProviderPayloads > 0 && row.completeLiveFeatureSnapshots > 0;
}

function shadowBacktestReady(row: SupabaseTrainingCorpusSportCounts): boolean {
  return (
    row.finishedFixtures >= MINIMUM_RECOMMENDED_FINISHED_FIXTURES &&
    row.matchWinnerOddsSnapshots > 0 &&
    row.completeFeatureSnapshots >= MINIMUM_RECOMMENDED_FINISHED_FIXTURES &&
    row.labeledFeatureSnapshots > 0 &&
    row.completedBacktests > 0
  );
}

function statusFor({
  serverReadReady,
  rows,
  errors
}: {
  serverReadReady: boolean;
  rows: SupabaseTrainingCorpusSportCounts[];
  errors: string[];
}): SupabaseTrainingCorpusCensusStatus {
  if (errors.length) return "failed";
  if (!serverReadReady) return "waiting-supabase";
  if (rows.every((row) => row.fixtures === 0 && row.oddsSnapshots === 0 && row.featureSnapshots === 0 && row.completedBacktests === 0)) return "empty-corpus";
  if (rows.some(shadowBacktestReady)) return "ready-shadow-backtest";
  if (rows.some(liveMonitorReady)) return "ready-live-monitor";
  return "partial-corpus";
}

function summaryFor(status: SupabaseTrainingCorpusCensusStatus, totals: SupabaseTrainingCorpusCensus["totals"]): string {
  if (status === "ready-shadow-backtest") return `Supabase has ${totals.finishedFixtures} finished fixture row(s), ${totals.completeFeatureSnapshots} complete feature row(s), and ${totals.completedBacktests} completed backtest row(s) for shadow training review.`;
  if (status === "ready-live-monitor") return `Supabase has live monitor evidence across ${totals.fixtures} fixture row(s), ${totals.oddsSnapshots} odds row(s), and ${totals.completeLiveFeatureSnapshots} complete live feature row(s).`;
  if (status === "partial-corpus") return `Supabase corpus is partially populated: ${totals.fixtures} fixture row(s), ${totals.oddsSnapshots} odds row(s), ${totals.playerPerformanceRows} real player-performance row(s), ${totals.completeFeatureSnapshots}/${totals.featureSnapshots} complete feature row(s), and ${totals.completedBacktests} backtest row(s).`;
  if (status === "empty-corpus") return "Supabase op_ tables are reachable, but the training corpus is still empty.";
  if (status === "waiting-supabase") return "Training corpus census is waiting on OddsPadi Supabase service-role read readiness.";
  return "Training corpus census failed while reading Supabase row counts.";
}

function nextActionFor(status: SupabaseTrainingCorpusCensusStatus, origin: string): SupabaseTrainingCorpusCensus["nextAction"] {
  if (status === "waiting-supabase") {
    return {
      label: "Configure OddsPadi Supabase service-role reads",
      command: decisionCurlCommand(`${origin}/api/sports/decision/supabase-credential-activation`),
      verifyUrl: "/api/sports/decision/supabase-credential-activation",
      expectedEvidence: "The runtime Supabase ref matches OddsPadi and service-role reads can count every op_ corpus table."
    };
  }
  if (status === "empty-corpus") {
    return {
      label: "Run provider dry-runs before any write import",
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/provider-corpus-dry-run-queue?date=2026-08-21&sport=football`),
      verifyUrl: "/api/sports/decision/training/provider-corpus-dry-run-queue?date=2026-08-21&sport=football",
      expectedEvidence: "Provider dry-runs return normalized fixture, odds, raw payload, context, and event counts without writing rows."
    };
  }
  if (status === "partial-corpus") {
    return {
      label: "Fill missing corpus lanes",
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-provider-feature-intake-gap?date=2026-08-21`),
      verifyUrl: "/api/sports/decision/training/football-provider-feature-intake-gap?date=2026-08-21",
      expectedEvidence: "Fixture, odds, raw payload, feature, settlement, and backtest counts show which lane blocks training promotion."
    };
  }
  return {
    label: "Review promotion gates without unlocking public picks",
    command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-data-model-promotion-decision`),
    verifyUrl: "/api/sports/decision/training/football-data-model-promotion-decision",
    expectedEvidence: "Stored corpus evidence is compared against market benchmarks before any learned weights or public predictions are allowed."
  };
}

export function buildSupabaseTrainingCorpusCensus({
  counts = ZERO_COUNTS,
  errors = [],
  env = process.env,
  origin = "http://127.0.0.1:3025",
  serverReadReady = true,
  targetMatchesExpected = true,
  projectRef = ODDSPADI_SUPABASE_PROJECT_REF,
  now = new Date()
}: {
  counts?: SupabaseTrainingCorpusSportCountsInput[];
  errors?: string[];
  env?: EnvLike;
  origin?: string;
  serverReadReady?: boolean;
  targetMatchesExpected?: boolean;
  projectRef?: string;
  now?: Date;
}): SupabaseTrainingCorpusCensus {
  const rows = TRAINING_SPORTS.map((sport) =>
    normalizedCounts(counts.find((row) => row.sport === sport) ?? ZERO_COUNTS.find((row) => row.sport === sport)!)
  );
  const effectiveReadReady = serverReadReady && targetMatchesExpected;
  const totals = {
    sports: rows.length,
    fixtures: sumBy(rows, "fixtures"),
    finishedFixtures: sumBy(rows, "finishedFixtures"),
    oddsSnapshots: sumBy(rows, "oddsSnapshots"),
    rawProviderPayloads: sumBy(rows, "rawProviderPayloads"),
    playerPerformanceRows: sumBy(rows, "playerPerformanceRows"),
    featureSnapshots: sumBy(rows, "featureSnapshots"),
    completeFeatureSnapshots: sumBy(rows, "completeFeatureSnapshots"),
    completeLiveFeatureSnapshots: sumBy(rows, "completeLiveFeatureSnapshots"),
    partialFeatureSnapshots: sumBy(rows, "partialFeatureSnapshots"),
    proxyFeatureSnapshots: sumBy(rows, "proxyFeatureSnapshots"),
    liveFeatureSnapshots: sumBy(rows, "liveFeatureSnapshots"),
    completedBacktests: sumBy(rows, "completedBacktests"),
    errors: errors.length
  };
  const status = statusFor({ serverReadReady: effectiveReadReady, rows, errors });
  const liveMonitorReadySports = unique(rows.filter(liveMonitorReady).map((row) => row.sport));
  const shadowBacktestReadySports = unique(rows.filter(shadowBacktestReady).map((row) => row.sport));
  const emptySports = unique(rows.filter((row) => row.fixtures === 0 && row.oddsSnapshots === 0 && row.featureSnapshots === 0).map((row) => row.sport));

  return {
    mode: "supabase-training-corpus-census",
    generatedAt: now.toISOString(),
    status,
    censusHash: stableHash({ status, projectRef, rows, errors, effectiveReadReady }),
    summary: summaryFor(status, totals),
    target: {
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      projectRef,
      serverReadReady,
      targetMatchesExpected
    },
    totals,
    sports: rows,
    readiness: {
      liveMonitorReadySports,
      shadowBacktestReadySports,
      emptySports,
      minimumRecommendedFinishedFixtures: MINIMUM_RECOMMENDED_FINISHED_FIXTURES,
      errors
    },
    controls: {
      canInspectReadOnly: true,
      canUseForLiveMonitor: status === "ready-live-monitor" || status === "ready-shadow-backtest",
      canUseForShadowBacktest: status === "ready-shadow-backtest",
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: nextActionFor(status, origin),
    locks: [
      "Corpus census is read-only and cannot write fixtures, odds, feature snapshots, backtests, picks, or stakes.",
      "Table existence is not treated as training evidence; row counts must prove fixture, odds, player-performance, raw payload, feature, settlement, and backtest coverage.",
      "Live monitor readiness cannot train models until settled labels and completed backtests exist.",
      "Shadow backtest readiness still requires model-vs-market promotion gates before learned weights can influence live decisions."
    ],
    proofUrls: [
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/supabase-storage-proof-ledger",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/training/football-provider-fixture-feature-readiness",
      "/api/sports/decision/training/football-data-model-promotion-decision"
    ]
  };
}

type CountFilter = {
  column: string;
  value?: CountFilterValue;
  operator?: CountOperator;
};

async function countRows(
  table: string,
  filters: CountFilter[],
  env: EnvLike,
  abortSignal: AbortSignal
): Promise<{ count: number; error: string | null }> {
  const client = getSupabaseServerClient(env);
  if (!client) return { count: 0, error: "Supabase server client is not available." };
  let query = client.from(table).select("id", { count: "exact", head: true });
  for (const filter of filters) {
    if (filter.operator === "not-null") {
      query = query.not(filter.column, "is", null);
    } else if (filter.operator === "in") {
      const values = Array.isArray(filter.value) ? filter.value : typeof filter.value === "string" ? [filter.value] : [];
      query = query.in(filter.column, values);
    } else if (filter.operator === "neq") {
      query = query.neq(filter.column, typeof filter.value === "string" ? filter.value : "");
    } else {
      query = query.eq(filter.column, typeof filter.value === "string" ? filter.value : "");
    }
  }
  const { count, error } = await query.abortSignal(abortSignal);
  return { count: count ?? 0, error: error?.message ?? null };
}

async function readFeatureQualityCounts(
  sport: TrainingSport,
  env: EnvLike,
  abortSignal: AbortSignal
): Promise<{ complete: number; completeLive: number; proxy: number; errors: string[] }> {
  const required = strictTrainingFeatureJsonColumns(sport).map((column) => ({ column, operator: "not-null" as const }));
  const [complete, completeLive, proxy] = await Promise.all([
    countRows("op_training_feature_snapshots", [
      { column: "sport", value: sport },
      { column: "source", value: "demo_seed", operator: "neq" },
      ...required
    ], env, abortSignal),
    countRows("op_training_feature_snapshots", [
      { column: "sport", value: sport },
      { column: "split", value: "live" },
      { column: "source", value: "demo_seed", operator: "neq" },
      ...required
    ], env, abortSignal),
    countRows("op_training_feature_snapshots", [
      { column: "sport", value: sport },
      { column: "source", value: "demo_seed" }
    ], env, abortSignal)
  ]);
  return {
    complete: complete.count,
    completeLive: completeLive.count,
    proxy: proxy.count,
    errors: [complete.error, completeLive.error, proxy.error].flatMap((error) => (error ? [`${sport}: ${error}`] : []))
  };
}

async function readSportCounts(
  sport: TrainingSport,
  env: EnvLike,
  abortSignal: AbortSignal
): Promise<{ counts: SupabaseTrainingCorpusSportCounts; errors: string[] }> {
  const reads = await Promise.all([
    countRows("op_fixtures", [{ column: "sport", value: sport }], env, abortSignal),
    countRows("op_fixtures", [{ column: "sport", value: sport }, { column: "status", value: "finished" }], env, abortSignal),
    sport === "football"
      ? countRows("op_fixtures", [
          { column: "sport", value: "football" },
          { column: "league_external_id", value: [EPL_2026_SEASON.leagueId, `api-football:${EPL_2026_SEASON.leagueId}`], operator: "in" },
          { column: "season", value: EPL_2026_SEASON.providerSeason }
        ], env, abortSignal)
      : Promise.resolve({ count: 0, error: null }),
    countRows("op_odds_snapshots", [{ column: "sport", value: sport }], env, abortSignal),
    countRows("op_odds_snapshots", [{ column: "sport", value: sport }, { column: "market", value: "match_winner" }], env, abortSignal),
    countRows("op_raw_provider_payloads", [{ column: "sport", value: sport }], env, abortSignal),
    countRows("op_player_match_performances", [{ column: "sport", value: sport }, { column: "source_kind", value: "real" }], env, abortSignal),
    countRows("op_training_feature_snapshots", [{ column: "sport", value: sport }], env, abortSignal),
    countRows("op_training_feature_snapshots", [{ column: "sport", value: sport }, { column: "split", value: "live" }], env, abortSignal),
    countRows("op_training_feature_snapshots", [{ column: "sport", value: sport }, { column: "label", operator: "not-null" }], env, abortSignal),
    readFeatureQualityCounts(sport, env, abortSignal),
    countRows("op_backtest_runs", [{ column: "sport", value: sport }, { column: "status", value: "completed" }], env, abortSignal)
  ]);
  const quality = reads[10] as Awaited<ReturnType<typeof readFeatureQualityCounts>>;
  const rowReads = reads.filter((_, index) => index !== 10) as Array<{ count: number; error: string | null }>;
  const errors = [...rowReads.flatMap((read) => (read.error ? [`${sport}: ${read.error}`] : [])), ...quality.errors];
  const partialFeatureSnapshots = Math.max(0, rowReads[7].count - quality.complete - quality.proxy);

  return {
    errors,
    counts: {
      sport,
      fixtures: rowReads[0].count,
      finishedFixtures: rowReads[1].count,
      epl2026Fixtures: rowReads[2].count,
      oddsSnapshots: rowReads[3].count,
      matchWinnerOddsSnapshots: rowReads[4].count,
      rawProviderPayloads: rowReads[5].count,
      playerPerformanceRows: rowReads[6].count,
      featureSnapshots: rowReads[7].count,
      completeFeatureSnapshots: quality.complete,
      completeLiveFeatureSnapshots: quality.completeLive,
      partialFeatureSnapshots,
      proxyFeatureSnapshots: quality.proxy,
      liveFeatureSnapshots: rowReads[8].count,
      labeledFeatureSnapshots: rowReads[9].count,
      completedBacktests: rowReads[10].count
    }
  };
}

function countValue(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

async function readPlayerPerformanceCounts(
  env: EnvLike,
  abortSignal: AbortSignal
): Promise<{ counts: Map<TrainingSport, number>; errors: string[] }> {
  const client = getSupabaseServerClient(env);
  if (client) {
    const { data, error } = await client.rpc("op_player_performance_corpus_counts").abortSignal(abortSignal);
    if (!error && Array.isArray(data)) {
      const rows = data as Array<Record<string, unknown>>;
      const counts = new Map<TrainingSport, number>();
      for (const row of rows) {
        const sport = String(row.sport ?? "");
        if (sport === "football" || sport === "basketball" || sport === "tennis") {
          counts.set(sport, countValue(row.player_performance_rows));
        }
      }
      if (TRAINING_SPORTS.every((sport) => counts.has(sport))) return { counts, errors: [] };
    }
  }

  // The RPC may have exhausted or aborted its own deadline. A fallback table
  // count must receive a fresh bounded budget instead of inheriting a dead signal.
  const fallbackSignal = censusReadSignal();
  const reads = await Promise.all(TRAINING_SPORTS.map(async (sport) => ({
    sport,
    read: await countRows("op_player_match_performances", [
      { column: "sport", value: sport },
      { column: "source_kind", value: "real" }
    ], env, fallbackSignal)
  })));
  return {
    counts: new Map(reads.map(({ sport, read }) => [sport, read.count])),
    errors: reads.flatMap(({ sport, read }) => read.error ? [`${sport}: ${read.error}`] : [])
  };
}

function attachPlayerPerformanceCounts(
  counts: SupabaseTrainingCorpusSportCounts[],
  playerCounts: Map<TrainingSport, number>
): SupabaseTrainingCorpusSportCounts[] {
  return counts.map((row) => ({ ...row, playerPerformanceRows: playerCounts.get(row.sport) ?? 0 }));
}

async function readSnapshotRpcCounts(env: EnvLike, abortSignal: AbortSignal): Promise<SupabaseTrainingCorpusSportCounts[] | null> {
  const client = getSupabaseServerClient(env);
  if (!client) return null;
  const { data, error } = await client.rpc("op_training_snapshot_counts").abortSignal(abortSignal);
  if (error || !Array.isArray(data)) return null;

  const rows = data as Array<Record<string, unknown>>;
  const bySport = new Map(rows.map((row) => [String(row.sport ?? ""), row]));
  if (TRAINING_SPORTS.some((sport) => !bySport.has(sport))) return null;

  return TRAINING_SPORTS.map((sport) => {
    const row = bySport.get(sport) ?? {};
    const featureSnapshots = countValue(row.feature_snapshots);
    const completeFeatureSnapshots = countValue(row.complete_feature_snapshots);
    const proxyFeatureSnapshots = countValue(row.proxy_feature_snapshots);
    return {
      sport,
      fixtures: countValue(row.fixtures),
      finishedFixtures: countValue(row.finished_fixtures),
      epl2026Fixtures: countValue(row.epl_2026_fixtures),
      oddsSnapshots: countValue(row.odds_snapshots),
      matchWinnerOddsSnapshots: countValue(row.match_winner_odds_snapshots),
      rawProviderPayloads: countValue(row.raw_provider_payloads),
      playerPerformanceRows: 0,
      featureSnapshots,
      completeFeatureSnapshots,
      completeLiveFeatureSnapshots: countValue(row.complete_live_feature_snapshots),
      partialFeatureSnapshots: Math.max(0, featureSnapshots - completeFeatureSnapshots - proxyFeatureSnapshots),
      proxyFeatureSnapshots,
      liveFeatureSnapshots: countValue(row.live_feature_snapshots),
      labeledFeatureSnapshots: countValue(row.labeled_feature_snapshots),
      completedBacktests: countValue(row.completed_backtests)
    };
  });
}

async function readRpcCounts(env: EnvLike, abortSignal: AbortSignal): Promise<SupabaseTrainingCorpusSportCounts[] | null> {
  const client = getSupabaseServerClient(env);
  if (!client) return null;
  const { data, error } = await client.rpc("op_training_corpus_census").abortSignal(abortSignal);
  if (error || !Array.isArray(data)) return null;

  const rows = data as Array<Record<string, unknown>>;
  const bySport = new Map(rows.map((row) => [String(row.sport ?? ""), row]));
  if (TRAINING_SPORTS.some((sport) => !bySport.has(sport))) return null;

  return TRAINING_SPORTS.map((sport) => {
    const row = bySport.get(sport) ?? {};
    return {
      sport,
      fixtures: countValue(row.fixtures),
      finishedFixtures: countValue(row.finished_fixtures),
      epl2026Fixtures: countValue(row.epl_2026_fixtures),
      oddsSnapshots: countValue(row.odds_snapshots),
      matchWinnerOddsSnapshots: countValue(row.match_winner_odds_snapshots),
      rawProviderPayloads: countValue(row.raw_provider_payloads),
      playerPerformanceRows: 0,
      featureSnapshots: countValue(row.feature_snapshots),
      completeFeatureSnapshots: countValue(row.complete_feature_snapshots),
      completeLiveFeatureSnapshots: countValue(row.complete_live_feature_snapshots),
      partialFeatureSnapshots: countValue(row.partial_feature_snapshots),
      proxyFeatureSnapshots: countValue(row.proxy_feature_snapshots),
      liveFeatureSnapshots: countValue(row.live_feature_snapshots),
      labeledFeatureSnapshots: countValue(row.labeled_feature_snapshots),
      completedBacktests: countValue(row.completed_backtests)
    };
  });
}

function censusCacheTtlMs(env: EnvLike): number {
  const configured = Number(env.ODDSPADI_CENSUS_CACHE_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 60_000;
  return Math.max(5_000, Math.min(5 * 60_000, Math.round(configured)));
}

async function loadCorpusCounts(env: EnvLike): Promise<CorpusCountsRead> {
  const snapshotRpcCounts = await readSnapshotRpcCounts(env, censusReadSignal());
  if (snapshotRpcCounts) {
    const playerCounts = await readPlayerPerformanceCounts(env, censusReadSignal());
    return { counts: attachPlayerPerformanceCounts(snapshotRpcCounts, playerCounts.counts), errors: playerCounts.errors };
  }

  const rpcCounts = await readRpcCounts(env, censusReadSignal());
  if (rpcCounts) {
    const [quality, playerCounts] = await Promise.all([
      Promise.all(TRAINING_SPORTS.map((sport) => readFeatureQualityCounts(sport, env, censusReadSignal()))),
      readPlayerPerformanceCounts(env, censusReadSignal())
    ]);
    return {
      counts: attachPlayerPerformanceCounts(rpcCounts.map((row, index) => ({
        ...row,
        completeFeatureSnapshots: quality[index].complete,
        completeLiveFeatureSnapshots: quality[index].completeLive,
        partialFeatureSnapshots: Math.max(0, row.featureSnapshots - quality[index].complete - quality[index].proxy),
        proxyFeatureSnapshots: quality[index].proxy
      })), playerCounts.counts),
      errors: [...quality.flatMap((read) => read.errors), ...playerCounts.errors]
    };
  }

  const reads = await Promise.all(TRAINING_SPORTS.map((sport) => readSportCounts(sport, env, censusReadSignal())));
  return {
    counts: reads.map((read) => read.counts),
    errors: reads.flatMap((read) => read.errors)
  };
}

async function readCorpusCounts(env: EnvLike, projectRef: string, fresh: boolean): Promise<CorpusCountsRead> {
  const serverKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_API_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const cacheKey = stableHash([projectRef, env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "", serverKey]);
  if (!fresh && censusCache?.cacheKey === cacheKey && censusCache.expiresAt > Date.now()) return censusCache.read;

  const read = loadCorpusCounts(env);
  censusCache = { cacheKey, expiresAt: Date.now() + censusCacheTtlMs(env), read };
  try {
    return await read;
  } catch (error) {
    if (censusCache?.read === read) censusCache = null;
    throw error;
  }
}

export async function readSupabaseTrainingCorpusCensus({
  env = process.env,
  origin,
  now = new Date(),
  fresh = false
}: {
  env?: EnvLike;
  origin: string;
  now?: Date;
  fresh?: boolean;
}): Promise<SupabaseTrainingCorpusCensus> {
  const runtime = getSupabaseRuntimeStatus(env);
  const projectRef = runtime.projectRef ?? runtime.urlProjectRef ?? "missing";
  if (!runtime.serverWriteReady) {
    return buildSupabaseTrainingCorpusCensus({
      counts: ZERO_COUNTS,
      errors: [],
      env,
      origin,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected,
      projectRef,
      now
    });
  }

  const read = await readCorpusCounts(env, projectRef, fresh);
  return buildSupabaseTrainingCorpusCensus({
    counts: read.counts,
    errors: read.errors,
    env,
    origin,
    serverReadReady: runtime.serverWriteReady,
    targetMatchesExpected: runtime.targetMatchesExpected,
    projectRef,
    now
  });
}
