import { hasAnyConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { EPL_2026_SEASON } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY } from "@/lib/sports/training/footballDataProviderRetestBridge";

type EnvLike = Record<string, string | undefined>;

export type FootballProviderFeatureIntakeGapStatus =
  | "ready-live-watchlist"
  | "waiting-provider-keys"
  | "waiting-supabase"
  | "waiting-epl-fixtures"
  | "waiting-provider-evidence"
  | "waiting-feature-materialization"
  | "waiting-settlement-history"
  | "failed";

export type FootballProviderFeatureIntakeStorageCounts = {
  epl2026Fixtures: number;
  finishedFootballFixtures: number;
  matchWinnerOddsSnapshots: number;
  trainingFeatureSnapshots: number;
  providerRetestFeatureSnapshots: number;
  rawProviderPayloads: number;
  completedBacktests: number;
};

export type FootballProviderFeatureIntakeGapReceipt = {
  mode: "football-provider-feature-intake-gap";
  generatedAt: string;
  status: FootballProviderFeatureIntakeGapStatus;
  gapHash: string;
  summary: string;
  request: {
    leagueId: "39";
    providerSeason: "2026";
    targetDate: string;
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
  };
  target: {
    projectRef: string;
    expectedProjectRef: string;
    serverReadReady: boolean;
    targetMatchesExpected: boolean;
  };
  providerKeys: {
    apiFootballConfigured: boolean;
    oddsConfigured: boolean;
    newsConfigured: boolean;
    weatherConfigured: boolean;
  };
  storage: FootballProviderFeatureIntakeStorageCounts & {
    errors: string[];
  };
  lanes: {
    eplLiveWatchlist: {
      status: "ready" | "waiting";
      canGenerateLiveFeatureRows: boolean;
      missing: string[];
    };
    settledTraining: {
      status: "ready" | "waiting";
      canGenerateTrainingRows: boolean;
      missing: string[];
    };
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canRunOddsDryRun: boolean;
    canMaterializeFeaturePreview: boolean;
    canWriteFeatureSnapshots: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

const ZERO_COUNTS: FootballProviderFeatureIntakeStorageCounts = {
  epl2026Fixtures: 0,
  finishedFootballFixtures: 0,
  matchWinnerOddsSnapshots: 0,
  trainingFeatureSnapshots: 0,
  providerRetestFeatureSnapshots: 0,
  rawProviderPayloads: 0,
  completedBacktests: 0
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

function hasAnyEnv(env: EnvLike, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function liveWatchlistMissing(counts: FootballProviderFeatureIntakeStorageCounts, keys: FootballProviderFeatureIntakeGapReceipt["providerKeys"]): string[] {
  return [
    keys.apiFootballConfigured ? "" : "API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY",
    keys.oddsConfigured ? "" : "THE_ODDS_API_KEY or ODDS_API_KEY",
    counts.epl2026Fixtures > 0 ? "" : "stored EPL 2026/27 fixture rows",
    counts.matchWinnerOddsSnapshots > 0 ? "" : "match_winner odds snapshots",
    counts.rawProviderPayloads > 0 ? "" : "raw provider payload links"
  ].filter(Boolean);
}

function trainingMissing(counts: FootballProviderFeatureIntakeStorageCounts, keys: FootballProviderFeatureIntakeGapReceipt["providerKeys"]): string[] {
  return [
    keys.apiFootballConfigured ? "" : "API-Football provider key",
    keys.oddsConfigured ? "" : "odds provider key",
    counts.finishedFootballFixtures > 0 ? "" : "settled football fixtures with scores",
    counts.matchWinnerOddsSnapshots > 0 ? "" : "complete match_winner odds snapshots",
    counts.trainingFeatureSnapshots > 0 ? "" : "stored training feature snapshots",
    counts.providerRetestFeatureSnapshots > 0 ? "" : `${FOOTBALL_PROVIDER_RETEST_MODEL_KEY} feature snapshots`,
    counts.rawProviderPayloads > 0 ? "" : "raw provider payload links"
  ].filter(Boolean);
}

function statusFor({
  runtimeReady,
  keys,
  counts,
  errors
}: {
  runtimeReady: boolean;
  keys: FootballProviderFeatureIntakeGapReceipt["providerKeys"];
  counts: FootballProviderFeatureIntakeStorageCounts;
  errors: string[];
}): FootballProviderFeatureIntakeGapStatus {
  if (errors.length) return "failed";
  if (!runtimeReady) return "waiting-supabase";
  if (!keys.apiFootballConfigured || !keys.oddsConfigured) return "waiting-provider-keys";
  if (counts.epl2026Fixtures <= 0) return "waiting-epl-fixtures";
  if (counts.matchWinnerOddsSnapshots <= 0 || counts.rawProviderPayloads <= 0) return "waiting-provider-evidence";
  if (counts.providerRetestFeatureSnapshots <= 0) return "waiting-feature-materialization";
  if (counts.finishedFootballFixtures <= 0 || counts.completedBacktests <= 0) return "waiting-settlement-history";
  return "ready-live-watchlist";
}

function summaryFor(status: FootballProviderFeatureIntakeGapStatus): string {
  if (status === "ready-live-watchlist") return "Provider feature intake has enough stored evidence for a live EPL watchlist; training and public picks remain locked.";
  if (status === "waiting-provider-keys") return "Provider feature intake is waiting on fixture and odds provider keys.";
  if (status === "waiting-supabase") return "Provider feature intake is waiting on OddsPadi Supabase server-read readiness.";
  if (status === "waiting-epl-fixtures") return "Provider feature intake is waiting for stored EPL 2026/27 fixture rows.";
  if (status === "waiting-provider-evidence") return "Provider feature intake is waiting for odds snapshots and raw provider payload links.";
  if (status === "waiting-feature-materialization") return "Provider feature intake is waiting for provider-enriched feature snapshots.";
  if (status === "failed") return "Provider feature intake gap check failed while reading storage counts.";
  return "Provider feature intake is waiting for settled results and backtest memory before training activation.";
}

function nextActionFor(status: FootballProviderFeatureIntakeGapStatus, origin: string): FootballProviderFeatureIntakeGapReceipt["nextAction"] {
  if (status === "waiting-provider-keys") {
    return {
      label: "Configure provider keys",
      command: decisionCurlCommand(`${origin}/api/sports/decision/provider-key-plan?date=2026-07-03&sport=football`),
      verifyUrl: "/api/sports/decision/provider-key-plan?date=2026-07-03&sport=football",
      expectedEvidence: "Server-only fixture and odds provider keys are present without exposing secrets to the browser."
    };
  }
  if (status === "waiting-epl-fixtures") {
    return {
      label: "Run EPL fixture dry-run",
      command: `${decisionCurlCommand(`${origin}/api/sports/decision/training/provider-readiness?provider=api-football&league=39&season=2026&date=2026-08-21&includeContext=1&limit=1`)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
      verifyUrl: "/api/sports/decision/training/provider-readiness?provider=api-football&league=39&season=2026&date=2026-08-21&includeContext=1&limit=1",
      expectedEvidence: "API-Football dry-run returns league 39 season 2026 fixture rows before any write-mode import."
    };
  }
  if (status === "waiting-provider-evidence") {
    return {
      label: "Run odds and raw payload dry-runs",
      command: `${decisionCurlCommand(`${origin}/api/sports/decision/training/provider-readiness?provider=the-odds-api&sportKey=soccer_epl&date=2026-08-21T12:00:00Z&regions=uk,eu&limit=5`)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
      verifyUrl: "/api/sports/decision/training/provider-readiness?provider=the-odds-api&sportKey=soccer_epl&date=2026-08-21T12:00:00Z&regions=uk,eu&limit=5",
      expectedEvidence: "Bookmaker h2h odds rows normalize into match_winner snapshots with raw provider payload hashes."
    };
  }
  if (status === "waiting-feature-materialization") {
    return {
      label: "Preview provider feature materializer",
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-provider-feature-materializer?demo=1&dryRun=1`),
      verifyUrl: "/api/sports/decision/training/football-provider-feature-materializer?demo=1&dryRun=1",
      expectedEvidence: "Provider fixtures produce op_training_feature_snapshots preview rows with model probabilities, market probabilities, targets, and feature hashes."
    };
  }
  return {
    label: "Keep training locked and collect settled evidence",
    command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-provider-feature-intake-gap?date=2026-08-21`),
    verifyUrl: "/api/sports/decision/training/football-provider-feature-intake-gap?date=2026-08-21",
    expectedEvidence: "Stored EPL fixtures, odds snapshots, raw payloads, feature snapshots, settled outcomes, and backtests are all visible before training activation."
  };
}

export function buildFootballProviderFeatureIntakeGapReceipt({
  counts = ZERO_COUNTS,
  errors = [],
  env = process.env,
  origin = "http://127.0.0.1:3025",
  targetDate = EPL_2026_SEASON.seasonStartDate,
  serverReadReady = true,
  targetMatchesExpected = true,
  projectRef = ODDSPADI_SUPABASE_PROJECT_REF,
  now = new Date()
}: {
  counts?: FootballProviderFeatureIntakeStorageCounts;
  errors?: string[];
  env?: EnvLike;
  origin?: string;
  targetDate?: string;
  serverReadReady?: boolean;
  targetMatchesExpected?: boolean;
  projectRef?: string;
  now?: Date;
}): FootballProviderFeatureIntakeGapReceipt {
  const providerKeys = {
    apiFootballConfigured: hasAnyEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]),
    oddsConfigured: hasAnyEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]),
    newsConfigured: hasAnyEnv(env, ["NEWS_API_KEY"]),
    weatherConfigured: hasAnyEnv(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"])
  };
  const liveMissing = liveWatchlistMissing(counts, providerKeys);
  const settledMissing = trainingMissing(counts, providerKeys);
  const status = statusFor({ runtimeReady: serverReadReady && targetMatchesExpected, keys: providerKeys, counts, errors });

  return {
    mode: "football-provider-feature-intake-gap",
    generatedAt: now.toISOString(),
    status,
    gapHash: stableHash({
      status,
      targetDate,
      projectRef,
      providerKeys,
      counts,
      errors
    }),
    summary: summaryFor(status),
    request: {
      leagueId: "39",
      providerSeason: EPL_2026_SEASON.providerSeason,
      targetDate,
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY
    },
    target: {
      projectRef,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      serverReadReady,
      targetMatchesExpected
    },
    providerKeys,
    storage: {
      ...counts,
      errors
    },
    lanes: {
      eplLiveWatchlist: {
        status: liveMissing.length ? "waiting" : "ready",
        canGenerateLiveFeatureRows: liveMissing.length === 0,
        missing: liveMissing
      },
      settledTraining: {
        status: settledMissing.length ? "waiting" : "ready",
        canGenerateTrainingRows: settledMissing.length === 0,
        missing: settledMissing
      }
    },
    nextAction: nextActionFor(status, origin),
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: providerKeys.apiFootballConfigured && serverReadReady,
      canRunOddsDryRun: providerKeys.oddsConfigured && serverReadReady,
      canMaterializeFeaturePreview: counts.epl2026Fixtures > 0 || counts.finishedFootballFixtures > 0 || counts.matchWinnerOddsSnapshots > 0,
      canWriteFeatureSnapshots: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Feature intake gap receipt is read-only and cannot write fixtures, odds, feature snapshots, backtests, picks, or stakes.",
      "Upcoming EPL fixtures can feed a live watchlist, but settled training rows require final outcomes and complete odds.",
      "Provider feature rows must carry raw payload links, model probabilities, no-vig market probabilities, target labels, split, and feature hash.",
      "Training activation remains locked until stored feature rows, provider retests, backtests, and promotion gates pass."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/football-provider-fixture-feature-readiness",
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/training/provider-readiness",
      "/api/sports/decision/training/football-provider-feature-materializer",
      "/api/sports/decision/training/football-provider-feature-storage-receipt",
      "/api/sports/decision/training/football-data-provider-learning-activation"
    ]
  };
}

async function countRows(table: string, filters: Record<string, string>): Promise<{ count: number; error: string | null }> {
  const client = getSupabaseServerClient();
  if (!client) return { count: 0, error: "Supabase server client is not available." };
  let query = client.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { count, error } = await query;
  return { count: count ?? 0, error: error?.message ?? null };
}

export async function readFootballProviderFeatureIntakeGapReceipt({
  env = process.env,
  origin,
  targetDate = EPL_2026_SEASON.seasonStartDate,
  now = new Date()
}: {
  env?: EnvLike;
  origin: string;
  targetDate?: string;
  now?: Date;
}): Promise<FootballProviderFeatureIntakeGapReceipt> {
  const runtime = getSupabaseRuntimeStatus(env);
  const projectRef = runtime.projectRef ?? runtime.urlProjectRef ?? "missing";
  if (!runtime.serverWriteReady) {
    return buildFootballProviderFeatureIntakeGapReceipt({
      counts: ZERO_COUNTS,
      errors: [],
      env,
      origin,
      targetDate,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected,
      projectRef,
      now
    });
  }

  const reads = await Promise.all([
    countRows("op_fixtures", { sport: "football", league_external_id: EPL_2026_SEASON.leagueId, season: EPL_2026_SEASON.providerSeason }),
    countRows("op_fixtures", { sport: "football", status: "finished" }),
    countRows("op_odds_snapshots", { sport: "football", market: "match_winner" }),
    countRows("op_training_feature_snapshots", { sport: "football" }),
    countRows("op_training_feature_snapshots", { sport: "football", model_key: FOOTBALL_PROVIDER_RETEST_MODEL_KEY }),
    countRows("op_raw_provider_payloads", { sport: "football" }),
    countRows("op_backtest_runs", { sport: "football", status: "completed" })
  ]);
  const errors = reads.flatMap((read) => (read.error ? [read.error] : []));
  const counts: FootballProviderFeatureIntakeStorageCounts = {
    epl2026Fixtures: reads[0].count,
    finishedFootballFixtures: reads[1].count,
    matchWinnerOddsSnapshots: reads[2].count,
    trainingFeatureSnapshots: reads[3].count,
    providerRetestFeatureSnapshots: reads[4].count,
    rawProviderPayloads: reads[5].count,
    completedBacktests: reads[6].count
  };

  return buildFootballProviderFeatureIntakeGapReceipt({
    counts,
    errors,
    env,
    origin,
    targetDate,
    serverReadReady: runtime.serverWriteReady,
    targetMatchesExpected: runtime.targetMatchesExpected,
    projectRef,
    now
  });
}
