import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionProviderEvidenceFeed, DecisionProviderEvidenceLedger } from "@/lib/sports/prediction/decisionProviderEvidenceLedger";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { Sport } from "@/lib/sports/types";

export type DecisionLiveDataReadinessStatus = "ready-shadow" | "schema-ready-empty" | "needs-provider-rows" | "blocked-storage";
export type DecisionLiveDataReadinessFamilyStatus = "pass" | "watch" | "block";

export type DecisionLiveDataReadinessFamily = {
  id: "fixture-spine" | "market-odds" | "context-signals" | "live-state" | "training-corpus" | "decision-memory";
  label: string;
  purpose: string;
  tables: string[];
  liveTables: number;
  rowCount: number;
  populatedTables: number;
  feeds: string[];
  providerBackedFeeds: number;
  dryRunReadyFeeds: number;
  missingFeeds: number;
  status: DecisionLiveDataReadinessFamilyStatus;
  nextAction: string;
};

export type DecisionLiveDataReadiness = {
  mode: "decision-live-data-readiness";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionLiveDataReadinessStatus;
  readinessHash: string;
  summary: string;
  totals: {
    families: number;
    liveTables: number;
    expectedTables: number;
    populatedTables: number;
    rows: number;
    providerBackedFeeds: number;
    dryRunReadyFeeds: number;
    missingFeeds: number;
    blockedFamilies: number;
    watchFamilies: number;
  };
  families: DecisionLiveDataReadinessFamily[];
  nextFamily: DecisionLiveDataReadinessFamily | null;
  trainingGate: {
    canTrain: false;
    canUseLearnedWeights: false;
    reason: string;
    minimumEvidence: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

type FamilyDefinition = Pick<DecisionLiveDataReadinessFamily, "id" | "label" | "purpose" | "tables" | "feeds">;

const FAMILIES: FamilyDefinition[] = [
  {
    id: "fixture-spine",
    label: "Fixture spine",
    purpose: "Fixtures, teams, leagues, standings, scores, home/away features, and recent-form features.",
    tables: ["op_leagues", "op_teams", "op_fixtures", "op_fixture_team_features", "op_standings_snapshots"],
    feeds: ["fixtures", "historical-results", "standings", "home-away", "recent-form"]
  },
  {
    id: "market-odds",
    label: "Market odds",
    purpose: "Bookmaker odds snapshots for implied probability, no-vig probability, expected value, and closing-line checks.",
    tables: ["op_odds_snapshots"],
    feeds: ["odds"]
  },
  {
    id: "context-signals",
    label: "Context signals",
    purpose: "Injuries, suspensions, lineups, news, and football weather signals used for model and AI-review adjustments.",
    tables: ["op_player_availability_snapshots", "op_lineup_snapshots", "op_news_signals", "op_weather_snapshots"],
    feeds: ["injuries", "suspensions", "lineups", "news", "weather"]
  },
  {
    id: "live-state",
    label: "Live state",
    purpose: "Live scores and match events for in-play state, invalidation, settlement, and replay.",
    tables: ["op_live_match_events"],
    feeds: ["live-scores", "match-events"]
  },
  {
    id: "training-corpus",
    label: "Training corpus",
    purpose: "Feature snapshots, historical corpus rows, odds history, and backtests required before learned model behavior can influence trust.",
    tables: ["op_training_feature_snapshots", "op_backtest_runs", "op_provider_ingestion_runs", "op_raw_provider_payloads"],
    feeds: ["ten-year-history", "backtests"]
  },
  {
    id: "decision-memory",
    label: "Decision memory",
    purpose: "Decision runs, model versions, outcomes, calibration runs, AI audit episodes, briefings, and shadow replay.",
    tables: ["op_model_versions", "op_decision_runs", "op_prediction_outcomes", "op_calibration_runs", "op_ai_thought_episodes", "op_decision_briefings", "op_shadow_memory_replay"],
    feeds: []
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusForFamily({
  liveTables,
  expectedTables,
  rowCount,
  missingFeeds
}: {
  liveTables: number;
  expectedTables: number;
  rowCount: number;
  missingFeeds: number;
}): DecisionLiveDataReadinessFamilyStatus {
  if (liveTables < expectedTables || missingFeeds > 0) return "block";
  if (rowCount === 0) return "watch";
  return "pass";
}

function nextActionForFamily(family: FamilyDefinition, status: DecisionLiveDataReadinessFamilyStatus, rowCount: number): string {
  if (status === "pass") return "Keep this family fresh and source-stamped before each prediction window.";
  if (status === "watch" && rowCount === 0) return `Run provider dry-runs, review normalized counts, then store controlled rows for ${family.label.toLowerCase()}.`;
  return `Resolve missing tables or provider evidence for ${family.label.toLowerCase()} before it can support training or trust upgrades.`;
}

function statusFor(families: DecisionLiveDataReadinessFamily[], schemaManifest: DecisionSupabaseSchemaManifest): DecisionLiveDataReadinessStatus {
  if (schemaManifest.status === "blocked-credentials" || schemaManifest.status === "blocked-cross-project" || schemaManifest.inventory.liveVerifiedTables === 0) {
    return "blocked-storage";
  }
  if (families.every((family) => family.rowCount > 0 && family.status !== "block")) return "ready-shadow";
  if (families.every((family) => family.liveTables === family.tables.length) && families.some((family) => family.rowCount === 0)) return "schema-ready-empty";
  return "needs-provider-rows";
}

function summaryFor(status: DecisionLiveDataReadinessStatus, totals: DecisionLiveDataReadiness["totals"]): string {
  if (status === "ready-shadow") return `Live data readiness has populated rows across ${totals.populatedTables} table(s); training and publishing still require backtest gates.`;
  if (status === "schema-ready-empty") return `Live data schema is present across ${totals.liveTables}/${totals.expectedTables} table checks, but provider rows are still mostly empty.`;
  if (status === "blocked-storage") return "Live data readiness is blocked until OddsPadi Supabase storage proof is valid.";
  return `${totals.blockedFamilies} data family/families still need provider rows, storage proof, or feed evidence before training can begin.`;
}

function familyFromDefinition({
  family,
  schemaManifest,
  feeds
}: {
  family: FamilyDefinition;
  schemaManifest: DecisionSupabaseSchemaManifest;
  feeds: Map<string, DecisionProviderEvidenceFeed>;
}): DecisionLiveDataReadinessFamily {
  const tables = new Map(schemaManifest.tables.map((table) => [table.table, table]));
  const tableEvidence = family.tables.map((table) => tables.get(table));
  const liveTables = tableEvidence.filter((table) => table?.liveStatus === "verified").length;
  const rowCount = tableEvidence.reduce((sum, table) => sum + Math.max(0, table?.rowCount ?? 0), 0);
  const populatedTables = tableEvidence.filter((table) => (table?.rowCount ?? 0) > 0).length;
  const feedEvidence = family.feeds.map((feed) => feeds.get(feed)).filter((feed): feed is DecisionProviderEvidenceFeed => Boolean(feed));
  const providerBackedFeeds = feedEvidence.filter((feed) => feed.status === "provider-backed").length;
  const dryRunReadyFeeds = feedEvidence.filter((feed) => feed.status === "dry-run-ready").length;
  const missingFeeds = feedEvidence.filter((feed) => ["blocked", "needs-storage-proof", "needs-env", "missing"].includes(feed.status)).length;
  const status = statusForFamily({
    liveTables,
    expectedTables: family.tables.length,
    rowCount,
    missingFeeds
  });

  return {
    ...family,
    liveTables,
    rowCount,
    populatedTables,
    providerBackedFeeds,
    dryRunReadyFeeds,
    missingFeeds,
    status,
    nextAction: nextActionForFamily(family, status, rowCount)
  };
}

export function buildDecisionLiveDataReadiness({
  date,
  sport,
  schemaManifest,
  providerEvidenceLedger,
  dataBackbone,
  storageActivationChecklist,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  schemaManifest: DecisionSupabaseSchemaManifest;
  providerEvidenceLedger: DecisionProviderEvidenceLedger;
  dataBackbone: DecisionDataBackbone;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  now?: Date;
}): DecisionLiveDataReadiness {
  const feeds = new Map(providerEvidenceLedger.feeds.map((feed) => [feed.id, feed]));
  const families = FAMILIES.map((family) => familyFromDefinition({ family, schemaManifest, feeds }));
  const totals = {
    families: families.length,
    liveTables: families.reduce((sum, family) => sum + family.liveTables, 0),
    expectedTables: families.reduce((sum, family) => sum + family.tables.length, 0),
    populatedTables: families.reduce((sum, family) => sum + family.populatedTables, 0),
    rows: families.reduce((sum, family) => sum + family.rowCount, 0),
    providerBackedFeeds: families.reduce((sum, family) => sum + family.providerBackedFeeds, 0),
    dryRunReadyFeeds: families.reduce((sum, family) => sum + family.dryRunReadyFeeds, 0),
    missingFeeds: families.reduce((sum, family) => sum + family.missingFeeds, 0),
    blockedFamilies: families.filter((family) => family.status === "block").length,
    watchFamilies: families.filter((family) => family.status === "watch").length
  };
  const status = statusFor(families, schemaManifest);
  const nextFamily = families.find((family) => family.status === "block") ?? families.find((family) => family.status === "watch") ?? null;
  const minimumEvidence = unique([
    "stored fixtures and final scores for the target sport",
    "bookmaker odds snapshots with no-vig probabilities",
    "feature snapshots with labels and split assignment",
    "settled outcomes and backtest runs",
    "fresh injuries/news/lineup/weather evidence where relevant",
    nextFamily?.nextAction
  ]);
  const readinessHash = stableHash({
    date,
    sport,
    status,
    schema: schemaManifest.manifestHash,
    provider: providerEvidenceLedger.ledgerHash,
    families: families.map((family) => [family.id, family.status, family.rowCount, family.missingFeeds])
  });

  return {
    mode: "decision-live-data-readiness",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    readinessHash,
    summary: summaryFor(status, totals),
    totals,
    families,
    nextFamily,
    trainingGate: {
      canTrain: false,
      canUseLearnedWeights: false,
      reason:
        status === "ready-shadow"
          ? "Live rows exist, but training remains locked until calibration, backtest, and promotion receipts clear."
          : nextFamily?.nextAction ?? "Populate live data families before training can be considered.",
      minimumEvidence
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: dataBackbone.controls.canRunProviderDryRun || storageActivationChecklist.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/live-data-readiness",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/provider-evidence-ledger",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/storage-activation-checklist",
      ...schemaManifest.gates.map(() => "/api/sports/decision/supabase-schema-manifest"),
      ...providerEvidenceLedger.proofUrls
    ]),
    locks: unique([
      "Live data readiness is read-only and cannot write provider rows, persist decisions, train models, apply learned weights, publish picks, stake, or upgrade public action.",
      "Schema-present is not enough: stored provider rows, feature labels, outcome settlement, and backtests must exist before trust can rise.",
      "Dry-run readiness can schedule ingestion probes, but it cannot be treated as training data.",
      ...dataBackbone.locks,
      ...providerEvidenceLedger.locks
    ])
  };
}
