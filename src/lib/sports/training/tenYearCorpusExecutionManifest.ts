import type { DecisionProviderBatchManifest } from "@/lib/sports/prediction/decisionProviderBatchManifest";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { MultiSportCorpusPlan, TrainingCorpusSport, TrainingCorpusSportPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import type { Sport } from "@/lib/sports/types";

export type TenYearCorpusExecutionManifestStatus =
  | "ready-dry-run"
  | "needs-provider-env"
  | "needs-storage-proof"
  | "needs-backtest"
  | "blocked";

export type TenYearCorpusJobStatus = "dry-run-ready" | "needs-env" | "storage-locked" | "training-locked";

export type TenYearCorpusExecutionSport = {
  sport: TrainingCorpusSport;
  status: TenYearCorpusExecutionManifestStatus;
  competitions: number;
  seasonJobs: number;
  estimatedMatches: number;
  estimatedOddsSnapshots: number;
  adapterStatus: string;
  backtestRunnerStatus: string;
  missingEnv: string[];
  targetTables: string[];
  firstDryRunCommand: string | null;
};

export type TenYearCorpusExecutionJob = {
  id: string;
  label: string;
  sport: TrainingCorpusSport;
  competition: string;
  seasonWindow: string;
  provider: string;
  status: TenYearCorpusJobStatus;
  dryRunCommand: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  targetTables: string[];
  expectedEvidence: string;
  missing: string[];
  estimatedMatches: number;
  estimatedOddsSnapshots: number;
};

export type TenYearCorpusExecutionManifest = {
  mode: "ten-year-corpus-execution-manifest";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: TenYearCorpusExecutionManifestStatus;
  manifestHash: string;
  summary: string;
  window: {
    from: number;
    to: number;
    seasons: string[];
    sportCount: number;
    estimatedMatches: number;
    estimatedOddsSnapshots: number;
  };
  totals: {
    sports: number;
    competitions: number;
    seasonJobs: number;
    dryRunReadyJobs: number;
    needsEnvJobs: number;
    storageLockedJobs: number;
    trainingLockedJobs: number;
    targetTables: number;
    estimatedRows: number;
  };
  sports: TenYearCorpusExecutionSport[];
  jobs: TenYearCorpusExecutionJob[];
  nextJob: TenYearCorpusExecutionJob | null;
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteCorpusRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

const FOOTBALL_TARGET_TABLES = [
  "op_leagues",
  "op_teams",
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
  "op_backtest_runs",
  "op_provider_ingestion_runs",
  "op_raw_provider_payloads"
];

const BASKETBALL_TARGET_TABLES = [
  "op_leagues",
  "op_teams",
  "op_fixtures",
  "op_fixture_team_features",
  "op_odds_snapshots",
  "op_training_feature_snapshots",
  "op_backtest_runs",
  "op_provider_ingestion_runs",
  "op_raw_provider_payloads"
];

const TENNIS_TARGET_TABLES = [
  "op_teams",
  "op_fixtures",
  "op_fixture_team_features",
  "op_odds_snapshots",
  "op_training_feature_snapshots",
  "op_backtest_runs",
  "op_provider_ingestion_runs",
  "op_raw_provider_payloads"
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

function targetTablesFor(sport: TrainingCorpusSport): string[] {
  if (sport === "basketball") return BASKETBALL_TARGET_TABLES;
  if (sport === "tennis") return TENNIS_TARGET_TABLES;
  return FOOTBALL_TARGET_TABLES;
}

function providerFor(sport: TrainingCorpusSport): string {
  if (sport === "basketball") return "api-basketball + the-odds-api";
  if (sport === "tennis") return "api-tennis + the-odds-api";
  return "api-football + the-odds-api";
}

function sportStatus({
  sportPlan,
  storage,
  providerBatchManifest,
  trainingBlueprint
}: {
  sportPlan: TrainingCorpusSportPlan;
  storage: DecisionStorageActivationChecklist;
  providerBatchManifest: DecisionProviderBatchManifest;
  trainingBlueprint: TrainingDataBlueprint;
}): TenYearCorpusExecutionManifestStatus {
  if (storage.status === "blocked-cross-project" || sportPlan.status === "blocked") return "blocked";
  if (sportPlan.missingEnvKeys.length || providerBatchManifest.status === "needs-provider-env") return "needs-provider-env";
  if (storage.progress.liveTables < storage.progress.expectedTables || providerBatchManifest.status === "needs-storage-proof") return "needs-storage-proof";
  const blueprintSport = trainingBlueprint.sports.find((entry) => entry.sport === sportPlan.sport);
  if (blueprintSport && blueprintSport.deficits.backtestRuns > 0) return "needs-backtest";
  return "ready-dry-run";
}

function jobStatus(status: TenYearCorpusExecutionManifestStatus): TenYearCorpusJobStatus {
  if (status === "ready-dry-run") return "dry-run-ready";
  if (status === "needs-provider-env") return "needs-env";
  if (status === "needs-storage-proof" || status === "blocked") return "storage-locked";
  return "training-locked";
}

function summaryFor(status: TenYearCorpusExecutionManifestStatus, totals: TenYearCorpusExecutionManifest["totals"]): string {
  if (status === "ready-dry-run") return `${totals.dryRunReadyJobs} 10-year corpus job(s) can run as dry-runs while writes and training remain locked.`;
  if (status === "needs-provider-env") return "10-year corpus execution is mapped, but provider/admin environment variables are still missing.";
  if (status === "needs-storage-proof") return "10-year corpus execution is mapped, but live OddsPadi storage proof is required before provider writes or training.";
  if (status === "needs-backtest") return "10-year corpus execution is storage-ready, but model training remains locked until backtest proof exists.";
  return "10-year corpus execution is blocked by project, storage, or safety constraints.";
}

function missingFor({
  status,
  sportPlan,
  storage,
  trainingBlueprint
}: {
  status: TenYearCorpusExecutionManifestStatus;
  sportPlan: TrainingCorpusSportPlan;
  storage: DecisionStorageActivationChecklist;
  trainingBlueprint: TrainingDataBlueprint;
}): string[] {
  const blueprintSport = trainingBlueprint.sports.find((entry) => entry.sport === sportPlan.sport);
  return unique([
    ...sportPlan.missingEnvKeys,
    status === "needs-storage-proof" ? `Live table proof ${storage.progress.liveTables}/${storage.progress.expectedTables}` : "",
    status === "needs-backtest" && blueprintSport ? `${blueprintSport.deficits.backtestRuns} backtest run(s)` : "",
    status === "blocked" ? storage.locks[0] ?? "Blocked by storage/project safety lock." : ""
  ]);
}

export function buildTenYearCorpusExecutionManifest({
  date,
  sport,
  multiSportCorpusPlan,
  trainingBlueprint,
  storageActivationChecklist,
  providerBatchManifest,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  multiSportCorpusPlan: MultiSportCorpusPlan;
  trainingBlueprint: TrainingDataBlueprint;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  providerBatchManifest: DecisionProviderBatchManifest;
  now?: Date;
}): TenYearCorpusExecutionManifest {
  const sportRows = multiSportCorpusPlan.sports.map((sportPlan) => {
    const status = sportStatus({ sportPlan, storage: storageActivationChecklist, providerBatchManifest, trainingBlueprint });
    return {
      sport: sportPlan.sport,
      status,
      competitions: sportPlan.targetCompetitions.length,
      seasonJobs: sportPlan.targetCompetitions.length * sportPlan.seasonCount,
      estimatedMatches: sportPlan.estimatedHistoricalMatches,
      estimatedOddsSnapshots: sportPlan.estimatedOddsSnapshots,
      adapterStatus: sportPlan.adapterStatus,
      backtestRunnerStatus: sportPlan.backtestRunnerStatus,
      missingEnv: sportPlan.missingEnvKeys,
      targetTables: targetTablesFor(sportPlan.sport),
      firstDryRunCommand: sportPlan.firstDryRunCommand?.command ?? null
    };
  });

  const jobs = multiSportCorpusPlan.sports.flatMap((sportPlan) => {
    const status = sportStatus({ sportPlan, storage: storageActivationChecklist, providerBatchManifest, trainingBlueprint });
    const safeStatus = jobStatus(status);
    const missing = missingFor({ status, sportPlan, storage: storageActivationChecklist, trainingBlueprint });
    return sportPlan.targetCompetitions.map((target) => {
      const estimatedMatches = target.typicalMatchesPerSeason * sportPlan.seasonCount;
      const estimatedOddsSnapshots = estimatedMatches * 3;
      const dryRunCommand = sportPlan.firstDryRunCommand?.command ?? decisionCurlCommand(`/api/sports/decision/training/multi-sport-corpus-plan?sport=${sportPlan.sport}`);
      return {
        id: `${sportPlan.sport}-${target.id}-${sportPlan.seasonFrom}-${sportPlan.seasonTo}`,
        label: `${target.name} ${sportPlan.seasonFrom}-${sportPlan.seasonTo}`,
        sport: sportPlan.sport,
        competition: target.name,
        seasonWindow: `${sportPlan.seasonFrom}-${sportPlan.seasonTo}`,
        provider: providerFor(sportPlan.sport),
        status: safeStatus,
        dryRunCommand,
        verifyUrl: sportPlan.firstDryRunCommand?.verifyUrl ?? `/api/sports/decision/training/multi-sport-corpus-plan?sport=${sportPlan.sport}`,
        safeToRun: safeStatus === "dry-run-ready",
        targetTables: targetTablesFor(sportPlan.sport),
        expectedEvidence: `Dry-run ${target.name} historical ${sportPlan.sport} rows for fixtures, odds, features, context signals, and backtest-ready feature snapshots without writing data.`,
        missing,
        estimatedMatches,
        estimatedOddsSnapshots
      };
    });
  });

  const targetTables = unique(jobs.flatMap((job) => job.targetTables));
  const totals = {
    sports: multiSportCorpusPlan.sportCount,
    competitions: multiSportCorpusPlan.sports.reduce((sum, plan) => sum + plan.targetCompetitions.length, 0),
    seasonJobs: sportRows.reduce((sum, row) => sum + row.seasonJobs, 0),
    dryRunReadyJobs: jobs.filter((job) => job.status === "dry-run-ready").length,
    needsEnvJobs: jobs.filter((job) => job.status === "needs-env").length,
    storageLockedJobs: jobs.filter((job) => job.status === "storage-locked").length,
    trainingLockedJobs: jobs.filter((job) => job.status === "training-locked").length,
    targetTables: targetTables.length,
    estimatedRows: jobs.reduce((sum, job) => sum + job.estimatedMatches + job.estimatedOddsSnapshots + job.targetTables.length, 0)
  };
  const status = sportRows.some((row) => row.status === "blocked")
    ? "blocked"
    : sportRows.some((row) => row.status === "needs-provider-env")
      ? "needs-provider-env"
      : sportRows.some((row) => row.status === "needs-storage-proof")
        ? "needs-storage-proof"
        : sportRows.some((row) => row.status === "needs-backtest")
          ? "needs-backtest"
          : "ready-dry-run";
  const nextJob =
    jobs.find((job) => job.status === "dry-run-ready") ??
    jobs.find((job) => job.status === "needs-env") ??
    jobs.find((job) => job.status === "storage-locked") ??
    jobs[0] ??
    null;
  const manifestHash = stableHash({
    date,
    sport,
    status,
    window: multiSportCorpusPlan.seasons,
    storage: storageActivationChecklist.checklistHash,
    providerBatch: providerBatchManifest.manifestHash,
    jobs: jobs.map((job) => [job.id, job.status, job.estimatedMatches])
  });

  return {
    mode: "ten-year-corpus-execution-manifest",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    manifestHash,
    summary: summaryFor(status, totals),
    window: {
      from: multiSportCorpusPlan.seasonFrom,
      to: multiSportCorpusPlan.seasonTo,
      seasons: multiSportCorpusPlan.seasons,
      sportCount: multiSportCorpusPlan.sportCount,
      estimatedMatches: multiSportCorpusPlan.totalEstimatedHistoricalMatches,
      estimatedOddsSnapshots: multiSportCorpusPlan.totalEstimatedOddsSnapshots
    },
    totals,
    sports: sportRows,
    jobs,
    nextJob,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: jobs.some((job) => job.safeToRun),
      canWriteCorpusRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/ten-year-corpus-execution",
      "/api/sports/decision/training/football-data-market-consensus",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/training/football-data-market-benchmark-persistence",
      "/api/sports/decision/training/football-data-market-benchmark-memory",
      "/api/sports/decision/training/football-data-walk-forward",
      "/api/sports/decision/training/football-data-threshold-sweep",
      "/api/sports/decision/training/football-data-backtest-probe",
      "/api/sports/decision/training/football-data-csv-probe",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/historical-corpus-acquisition",
      "/api/sports/decision/training/historical-provider-storage-receipt",
      "/api/sports/decision/provider-batch-manifest",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/training/backfill"
    ]),
    locks: unique([
      "10-year corpus execution is read-only until live OddsPadi storage proof, provider dry-run counts, and admin approval exist.",
      "Public EPL CSV probes can supply read-only row counts, but paid provider enrichment is still required for injuries, lineups, live events, news, weather, and official fixture IDs.",
      "Public EPL backtest probes can produce shadow metrics and learned-weight candidates, but they cannot persist op_backtest_runs or alter live decisions.",
      "Public EPL threshold sweeps can recommend safer shadow thresholds, but learned thresholds cannot affect live decisions without stored backtests and governance approval.",
      "Public EPL walk-forward validation can test threshold stability across seasons, but promotion still requires provider-enriched retests and persisted backtest runs.",
      "Public EPL market consensus can audit no-vig probability and bookmaker disagreement, but live odds snapshots are still required for CLV and activation.",
      "Public EPL market benchmarks can compare model probabilities against no-vig consensus, but cannot apply market priors or publish picks.",
      "Public EPL market benchmark persistence can store audit rows in op_backtest_runs only with admin authorization and service-role readiness.",
      "Public EPL market benchmark memory can read stored op_backtest_runs evidence, but cannot apply priors or learned weights.",
      "Training remains locked until real finished fixtures, odds snapshots, feature snapshots, and backtest runs are stored and verified.",
      "Public picks remain locked until backtests, market-edge proof, AI review, and final-answer validation all pass.",
      ...storageActivationChecklist.locks,
      ...providerBatchManifest.locks
    ])
  };
}
