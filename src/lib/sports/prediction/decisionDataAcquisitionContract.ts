import type { DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FirstCorpusImportQueue } from "@/lib/sports/training/firstCorpusImportQueue";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { TrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";

export type DecisionDataAcquisitionContractStatus =
  | "waiting-provider-keys"
  | "ready-provider-dry-run"
  | "waiting-storage-fill"
  | "ready-shadow-training-review"
  | "blocked";

export type DecisionDataAcquisitionContractStage =
  | "provider-key"
  | "provider-dry-run"
  | "storage-fill"
  | "feature-materialization"
  | "shadow-training-review";

export type DecisionDataAcquisitionContractFeed = {
  id: DecisionProviderKeyPlan["feedMatrix"]["rows"][number]["id"];
  label: string;
  status: DecisionProviderKeyPlan["feedMatrix"]["rows"][number]["status"];
  stage: DecisionDataAcquisitionContractStage;
  priority: number;
  sports: string[];
  providerLanes: string[];
  requiredKeys: string[];
  missingKeys: string[];
  targetTables: string[];
  observedRows: number;
  modelFeatures: string[];
  modelUnlocks: string[];
  trainingEvidence: string[];
  nextProofUrl: string;
  blocker: string | null;
};

export type DecisionDataAcquisitionContract = {
  mode: "decision-data-acquisition-contract";
  generatedAt: string;
  status: DecisionDataAcquisitionContractStatus;
  contractHash: string;
  summary: string;
  scope: {
    feeds: number;
    criticalFeeds: number;
    configuredFeeds: number;
    missingCriticalFeeds: number;
    storageTables: number;
    tablesWithObservedEvidence: number;
    modelFeatures: number;
  };
  modelFamilies: Array<{
    id: "football" | "basketball" | "tennis" | "odds";
    label: string;
    requiredFeeds: string[];
    requiredTables: string[];
    readyFeeds: number;
    totalFeeds: number;
    status: "ready" | "waiting";
    blocker: string | null;
  }>;
  feeds: DecisionDataAcquisitionContractFeed[];
  nextFeed: DecisionDataAcquisitionContractFeed | null;
  storageTables: Array<{
    table: string;
    purpose: string;
    requiredFor: string;
    observedEvidence: boolean;
  }>;
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canWriteRawPayloads: false;
    canWriteFeatureSnapshots: false;
    canRunBacktests: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  blockers: string[];
  proofUrls: string[];
  locks: string[];
};

type FeedStorageSpec = {
  tables: string[];
  evidence: Array<keyof SupabaseTrainingCorpusCensus["totals"]>;
  trainingEvidence: string[];
};

const FEED_STORAGE: Record<DecisionDataAcquisitionContractFeed["id"], FeedStorageSpec> = {
  fixtures: {
    tables: ["op_fixtures", "op_teams", "op_leagues", "op_raw_provider_payloads", "op_provider_ingestion_runs"],
    evidence: ["fixtures", "rawProviderPayloads"],
    trainingEvidence: ["provider event IDs", "kickoff/start time", "normalized competitors"]
  },
  "historical-results": {
    tables: ["op_fixtures", "op_training_feature_snapshots", "op_backtest_runs"],
    evidence: ["finishedFixtures", "featureSnapshots", "completedBacktests"],
    trainingEvidence: ["settled outcome labels", "walk-forward splits", "real-data backtest rows"]
  },
  "standings-home-away-form": {
    tables: ["op_standings_snapshots", "op_fixture_team_features", "op_training_feature_snapshots"],
    evidence: ["featureSnapshots"],
    trainingEvidence: ["standing position", "home/away priors", "recent form weights"]
  },
  "injuries-suspensions": {
    tables: ["op_player_availability_snapshots", "op_news_signals", "op_fixture_team_features", "op_training_feature_snapshots"],
    evidence: ["featureSnapshots"],
    trainingEvidence: ["availability impact", "fitness downgrade", "late-news risk flag"]
  },
  lineups: {
    tables: ["op_lineup_snapshots", "op_fixture_team_features", "op_training_feature_snapshots"],
    evidence: ["featureSnapshots"],
    trainingEvidence: ["starter confirmation", "formation/rotation adjustment", "late lineup correction"]
  },
  odds: {
    tables: ["op_odds_snapshots", "op_raw_provider_payloads", "op_training_feature_snapshots", "op_backtest_runs"],
    evidence: ["oddsSnapshots", "rawProviderPayloads", "featureSnapshots", "completedBacktests"],
    trainingEvidence: ["implied probability", "no-vig probability", "value edge", "closing-line value"]
  },
  "live-scores-events": {
    tables: ["op_live_match_events", "op_fixtures", "op_raw_provider_payloads"],
    evidence: ["fixtures", "rawProviderPayloads", "liveFeatureSnapshots"],
    trainingEvidence: ["live state refresh", "settlement support", "event provenance"]
  },
  news: {
    tables: ["op_news_signals", "op_raw_provider_payloads"],
    evidence: ["rawProviderPayloads"],
    trainingEvidence: ["source-stamped context", "news adjustment", "avoid/abstain flags"]
  },
  weather: {
    tables: ["op_weather_snapshots", "op_fixture_team_features", "op_training_feature_snapshots"],
    evidence: ["featureSnapshots"],
    trainingEvidence: ["outdoor football weather adjustment", "tempo/total-goals risk"]
  },
  "basketball-efficiency": {
    tables: ["op_fixtures", "op_fixture_team_features", "op_odds_snapshots", "op_training_feature_snapshots", "op_backtest_runs"],
    evidence: ["fixtures", "oddsSnapshots", "featureSnapshots", "completedBacktests"],
    trainingEvidence: ["pace", "offensive efficiency", "defensive efficiency", "spread and moneyline labels"]
  },
  "tennis-player-history": {
    tables: ["op_fixtures", "op_teams", "op_odds_snapshots", "op_training_feature_snapshots", "op_backtest_runs"],
    evidence: ["fixtures", "oddsSnapshots", "featureSnapshots", "completedBacktests"],
    trainingEvidence: ["player Elo", "surface rating", "head-to-head", "fatigue and round context"]
  }
};

const MODEL_FAMILIES: Array<{
  id: DecisionDataAcquisitionContract["modelFamilies"][number]["id"];
  label: string;
  requiredFeeds: DecisionDataAcquisitionContractFeed["id"][];
}> = [
  {
    id: "football",
    label: "Football Poisson + Elo model",
    requiredFeeds: ["fixtures", "historical-results", "standings-home-away-form", "injuries-suspensions", "lineups", "odds"]
  },
  {
    id: "basketball",
    label: "Basketball rating + pace/efficiency model",
    requiredFeeds: ["fixtures", "historical-results", "standings-home-away-form", "injuries-suspensions", "basketball-efficiency", "odds"]
  },
  {
    id: "tennis",
    label: "Tennis player/surface Elo model",
    requiredFeeds: ["fixtures", "historical-results", "injuries-suspensions", "tennis-player-history", "odds"]
  },
  {
    id: "odds",
    label: "Odds intelligence and EV layer",
    requiredFeeds: ["odds", "historical-results"]
  }
];

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function sumEvidence(totals: SupabaseTrainingCorpusCensus["totals"], keys: FeedStorageSpec["evidence"]): number {
  return keys.reduce((sum, key) => sum + (typeof totals[key] === "number" ? totals[key] : 0), 0);
}

function statusFor({
  providerKeyPlan,
  firstCorpusImportQueue,
  supabaseTrainingCorpusCensus
}: {
  providerKeyPlan: DecisionProviderKeyPlan;
  firstCorpusImportQueue: FirstCorpusImportQueue;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus;
}): DecisionDataAcquisitionContractStatus {
  if (firstCorpusImportQueue.status === "failed" || supabaseTrainingCorpusCensus.status === "failed") return "blocked";
  if (providerKeyPlan.feedMatrix.totals.missingCritical > 0 || firstCorpusImportQueue.status === "waiting-provider-keys") return "waiting-provider-keys";
  if (firstCorpusImportQueue.controls.canRunProviderDryRun) return "ready-provider-dry-run";
  if (supabaseTrainingCorpusCensus.controls.canUseForShadowBacktest) return "ready-shadow-training-review";
  return "waiting-storage-fill";
}

function stageFor(
  feed: DecisionProviderKeyPlan["feedMatrix"]["rows"][number],
  observedRows: number,
  firstCorpusImportQueue: FirstCorpusImportQueue,
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus
): DecisionDataAcquisitionContractStage {
  if (feed.status !== "configured") return "provider-key";
  if (observedRows <= 0) return firstCorpusImportQueue.controls.canRunProviderDryRun ? "provider-dry-run" : "storage-fill";
  if (supabaseTrainingCorpusCensus.totals.featureSnapshots <= 0) return "feature-materialization";
  return "shadow-training-review";
}

function summaryFor(status: DecisionDataAcquisitionContractStatus): string {
  if (status === "blocked") return "Data acquisition contract has a failing provider, Supabase, or corpus dependency.";
  if (status === "waiting-provider-keys") return "Data acquisition is waiting for sports and odds provider keys before real fixtures, odds, and context can be collected.";
  if (status === "ready-provider-dry-run") return "Provider keys are ready enough for supervised dry-runs; storage writes and training remain locked.";
  if (status === "ready-shadow-training-review") return "Stored corpus evidence is ready for shadow training review; public picks and staking remain locked.";
  return "Provider data still needs storage receipts, feature materialization, labels, and backtests before training can be trusted.";
}

function observedTableEvidence(table: string, census: SupabaseTrainingCorpusCensus): boolean {
  if (table === "op_fixtures" || table === "op_teams" || table === "op_leagues") return census.totals.fixtures > 0;
  if (table === "op_odds_snapshots") return census.totals.oddsSnapshots > 0;
  if (table === "op_raw_provider_payloads" || table === "op_provider_ingestion_runs") return census.totals.rawProviderPayloads > 0;
  if (table === "op_training_feature_snapshots" || table === "op_fixture_team_features") return census.totals.featureSnapshots > 0;
  if (table === "op_backtest_runs") return census.totals.completedBacktests > 0;
  return false;
}

export function buildDecisionDataAcquisitionContract({
  providerKeyPlan,
  trainingDataBlueprint,
  supabaseTrainingCorpusCensus,
  firstCorpusImportQueue,
  now = new Date()
}: {
  providerKeyPlan: DecisionProviderKeyPlan;
  trainingDataBlueprint: TrainingDataBlueprint;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus;
  firstCorpusImportQueue: FirstCorpusImportQueue;
  now?: Date;
}): DecisionDataAcquisitionContract {
  const feeds = providerKeyPlan.feedMatrix.rows.map((feed): DecisionDataAcquisitionContractFeed => {
    const spec = FEED_STORAGE[feed.id];
    const observedRows = sumEvidence(supabaseTrainingCorpusCensus.totals, spec.evidence);
    const targetTables = unique(spec.tables);
    return {
      id: feed.id,
      label: feed.label,
      status: feed.status,
      stage: stageFor(feed, observedRows, firstCorpusImportQueue, supabaseTrainingCorpusCensus),
      priority: feed.priority,
      sports: feed.sports,
      providerLanes: feed.requiredLaneIds,
      requiredKeys: feed.requiredKeys,
      missingKeys: feed.missingKeys,
      targetTables,
      observedRows,
      modelFeatures: feed.modelFeatures,
      modelUnlocks: feed.unlocks,
      trainingEvidence: spec.trainingEvidence,
      nextProofUrl: feed.proofUrl,
      blocker: feed.blockedReason
    };
  });
  const status = statusFor({ providerKeyPlan, firstCorpusImportQueue, supabaseTrainingCorpusCensus });
  const storageTableNames = unique(feeds.flatMap((feed) => feed.targetTables), 200);
  const storageTables = storageTableNames.map((table) => {
    const blueprintTable = trainingDataBlueprint.storageTables.find((item) => item.table === table);
    return {
      table,
      purpose: blueprintTable?.purpose ?? "Required by a provider feed before model features can be trusted.",
      requiredFor: blueprintTable?.requiredFor ?? "provider-ingestion",
      observedEvidence: observedTableEvidence(table, supabaseTrainingCorpusCensus)
    };
  });
  const modelFamilies = MODEL_FAMILIES.map((family) => {
    const requiredFeeds = feeds.filter((feed) => family.requiredFeeds.includes(feed.id));
    const readyFeeds = requiredFeeds.filter((feed) => feed.status === "configured" && feed.observedRows > 0).length;
    const requiredTables = unique(requiredFeeds.flatMap((feed) => feed.targetTables), 80);
    const firstBlocker = requiredFeeds.find((feed) => feed.status !== "configured" || feed.observedRows <= 0);
    return {
      id: family.id,
      label: family.label,
      requiredFeeds: family.requiredFeeds,
      requiredTables,
      readyFeeds,
      totalFeeds: requiredFeeds.length,
      status: readyFeeds === requiredFeeds.length ? ("ready" as const) : ("waiting" as const),
      blocker: firstBlocker
        ? firstBlocker.blocker ?? `${firstBlocker.label} needs provider keys, stored rows, and feature evidence.`
        : null
    };
  });
  const criticalFeeds = feeds.filter((feed) => feed.status !== "optional-missing");
  const nextFeed =
    feeds.find((feed) => feed.status === "missing-critical") ??
    feeds.find((feed) => feed.stage === "provider-dry-run") ??
    feeds.find((feed) => feed.stage === "storage-fill" || feed.stage === "feature-materialization") ??
    feeds.find((feed) => feed.status === "optional-missing") ??
    null;
  const blockers = unique([
    ...feeds.filter((feed) => feed.status === "missing-critical").map((feed) => feed.blocker),
    supabaseTrainingCorpusCensus.status === "empty-corpus" ? "Supabase has no observed fixture, odds, feature, or backtest corpus rows yet." : null,
    firstCorpusImportQueue.nextStep?.blocker ?? null,
    ...trainingDataBlueprint.blockers
  ]);

  return {
    mode: "decision-data-acquisition-contract",
    generatedAt: now.toISOString(),
    status,
    contractHash: stableHash({
      status,
      provider: [providerKeyPlan.status, providerKeyPlan.feedMatrix.totals],
      blueprint: [trainingDataBlueprint.blueprintHash, trainingDataBlueprint.status],
      census: [supabaseTrainingCorpusCensus.censusHash, supabaseTrainingCorpusCensus.totals],
      queue: [firstCorpusImportQueue.queueHash, firstCorpusImportQueue.status],
      feeds: feeds.map((feed) => [feed.id, feed.status, feed.stage, feed.observedRows])
    }),
    summary: summaryFor(status),
    scope: {
      feeds: feeds.length,
      criticalFeeds: criticalFeeds.length,
      configuredFeeds: feeds.filter((feed) => feed.status === "configured").length,
      missingCriticalFeeds: feeds.filter((feed) => feed.status === "missing-critical").length,
      storageTables: storageTables.length,
      tablesWithObservedEvidence: storageTables.filter((table) => table.observedEvidence).length,
      modelFeatures: unique(feeds.flatMap((feed) => feed.modelFeatures), 200).length
    },
    modelFamilies,
    feeds,
    nextFeed,
    storageTables,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: firstCorpusImportQueue.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canWriteRawPayloads: false,
      canWriteFeatureSnapshots: false,
      canRunBacktests: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/data-acquisition-contract",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/training/supabase-training-corpus-census",
      ...feeds.map((feed) => feed.nextProofUrl)
    ]),
    locks: [
      "Data acquisition contract is read-only and cannot fetch providers, write Supabase rows, train models, publish picks, or stake.",
      `Provider dry-run proof command: ${decisionCurlCommand("/api/sports/decision/training/provider-corpus-dry-run-queue?sport=all&seasonFrom=2016&seasonTo=2025&dryRun=1")}`,
      "Write mode requires separate service-role storage receipts after provider dry-runs are reviewed.",
      "Training requires stored feature snapshots with labels plus completed backtests and promotion review."
    ]
  };
}
