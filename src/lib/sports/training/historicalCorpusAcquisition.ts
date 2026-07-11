import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import {
  FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_COMMAND,
  FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataCsvBacktestProbe";
import {
  FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_COMMAND,
  FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataThresholdSweep";
import {
  FOOTBALL_DATA_WALK_FORWARD_DEFAULT_COMMAND,
  FOOTBALL_DATA_WALK_FORWARD_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataWalkForwardValidation";
import {
  FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_COMMAND,
  FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataMarketConsensus";
import {
  FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_COMMAND,
  FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataMarketBenchmark";
import {
  FOOTBALL_DATA_CSV_PROBE_DEFAULT_COMMAND,
  FOOTBALL_DATA_CSV_PROBE_DEFAULT_VERIFY_URL
} from "@/lib/sports/training/footballDataCsvCorpusProbe";
import type { MultiSportCorpusPlan, TrainingCorpusCommand } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";

export type HistoricalCorpusAcquisitionStatus = "ready-dry-run" | "waiting-env" | "needs-supabase-proof" | "blocked";
export type HistoricalCorpusAcquisitionPhaseStatus = "ready" | "waiting" | "blocked";

export type HistoricalCorpusAcquisitionPhase = {
  id:
    | "prove-storage"
    | "public-epl-history-probe"
    | "public-epl-backtest-probe"
    | "public-epl-threshold-sweep"
    | "public-epl-walk-forward"
    | "public-epl-market-consensus"
    | "public-epl-market-benchmark"
    | "configure-providers"
    | "historical-dry-runs"
    | "odds-market-dry-runs"
    | "epl-2026-fixture-bridge"
    | "write-corpus-batches"
    | "feature-snapshots"
    | "real-backtests"
    | "shadow-learning";
  label: string;
  status: HistoricalCorpusAcquisitionPhaseStatus;
  evidenceRequired: string[];
  blockers: string[];
};

export type HistoricalCorpusAcquisitionCommand = {
  id: string;
  label: string;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  expectedEvidence: string;
  missingEnv: string[];
};

export type HistoricalCorpusAcquisition = {
  generatedAt: string;
  mode: "historical-corpus-acquisition";
  status: HistoricalCorpusAcquisitionStatus;
  acquisitionHash: string;
  summary: string;
  historicalWindow: {
    from: number;
    to: number;
    seasons: string[];
    sports: number;
    estimatedMatches: number;
    estimatedOddsSnapshots: number;
  };
  upcomingEpl: {
    season: string;
    providerSeason: string;
    fixtureReleaseDate: string;
    seasonStartDate: string;
    finalMatchDate: string;
    totalFixtures: number;
    daysUntilStart: number;
    sourceUrl: string;
  };
  totals: {
    phases: number;
    readyPhases: number;
    waitingPhases: number;
    blockedPhases: number;
    providerKeysMissing: number;
    corpusDeficits: number;
  };
  providerMatrix: Array<{
    sport: string;
    status: string;
    adapter: string;
    targetCompetitions: number;
    estimatedMatches: number;
    estimatedOddsSnapshots: number;
    missingEnv: string[];
    firstCommand: string | null;
  }>;
  phases: HistoricalCorpusAcquisitionPhase[];
  nextSafeCommands: HistoricalCorpusAcquisitionCommand[];
  blockers: string[];
  warnings: string[];
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function phase(input: Omit<HistoricalCorpusAcquisitionPhase, "status">): HistoricalCorpusAcquisitionPhase {
  return {
    ...input,
    blockers: unique(input.blockers),
    status: input.blockers.some((blocker) => /supabase|foreign|invalid|wrong|service-role|credential/i.test(blocker))
      ? "blocked"
      : input.blockers.length
        ? "waiting"
        : "ready"
  };
}

function commandFrom(id: string, command: TrainingCorpusCommand | null): HistoricalCorpusAcquisitionCommand | null {
  if (!command) return null;
  return {
    id,
    label: command.label,
    command: command.command,
    verifyUrl: command.verifyUrl,
    safeToRun: command.safeToRun,
    expectedEvidence: command.expectedEvidence,
    missingEnv: command.missingEnv
  };
}

function publicEplHistoryCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-csv-probe",
    label: "Run public EPL historical CSV corpus probe",
    command: FOOTBALL_DATA_CSV_PROBE_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_CSV_PROBE_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence: "Read-only Football-Data.co.uk EPL CSV counts for 2016/17-2025/26 finished fixtures, teams, odds columns, and sample normalized rows.",
    missingEnv: []
  };
}

function publicEplBacktestCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-backtest-probe",
    label: "Run public EPL Poisson/Elo backtest probe",
    command: FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence:
      "Read-only Poisson/Elo/odds-edge backtest over 2016/17-2025/26 EPL CSV candidates with Brier score, log loss, ROI, calibration buckets, and locked learned weights.",
    missingEnv: []
  };
}

function publicEplThresholdSweepCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-threshold-sweep",
    label: "Run public EPL learned-threshold sweep",
    command: FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence:
      "Read-only threshold grid over EPL Poisson/Elo/odds-edge backtests with baseline comparison, ranked profiles, and shadow-only threshold recommendation.",
    missingEnv: []
  };
}

function publicEplWalkForwardCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-walk-forward",
    label: "Run public EPL walk-forward validation",
    command: FOOTBALL_DATA_WALK_FORWARD_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_WALK_FORWARD_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence:
      "Read-only season-by-season validation for EPL Poisson/Elo/odds-edge thresholds, testing each future season after training on prior seasons.",
    missingEnv: []
  };
}

function publicEplMarketConsensusCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-market-consensus",
    label: "Run public EPL bookmaker consensus audit",
    command: FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence:
      "Read-only bookmaker coverage, margin, no-vig consensus, sharp-vs-average gap, and market-quality guardrails from public EPL CSV odds columns.",
    missingEnv: []
  };
}

function publicEplMarketBenchmarkCommand(): HistoricalCorpusAcquisitionCommand {
  return {
    id: "football-data-market-benchmark",
    label: "Run public EPL model-vs-market benchmark",
    command: FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_COMMAND,
    verifyUrl: FOOTBALL_DATA_MARKET_BENCHMARK_DEFAULT_VERIFY_URL,
    safeToRun: true,
    expectedEvidence:
      "Read-only benchmark comparing Poisson/Elo holdout probabilities against no-vig bookmaker consensus on the same EPL fixtures.",
    missingEnv: []
  };
}

function eplCommand(eplFixtureIntake: DecisionEplFixtureIntake): HistoricalCorpusAcquisitionCommand {
  return {
    id: "epl-2026-fixture-dry-run",
    label: eplFixtureIntake.nextTask?.label ?? "EPL 2026/27 fixture intake",
    command: eplFixtureIntake.nextTask?.command ?? null,
    verifyUrl: eplFixtureIntake.nextTask?.verifyUrl ?? "/api/sports/decision/epl-fixture-intake",
    safeToRun: eplFixtureIntake.controls.canRunFixtureDryRun,
    expectedEvidence: eplFixtureIntake.nextTask?.expectedEvidence ?? eplFixtureIntake.summary,
    missingEnv: eplFixtureIntake.nextTask?.missingEnv ?? []
  };
}

function buildPhases({
  corpusPlan,
  trainingBlueprint,
  eplFixtureIntake
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingBlueprint: TrainingDataBlueprint;
  eplFixtureIntake: DecisionEplFixtureIntake;
}): HistoricalCorpusAcquisitionPhase[] {
  const missingProviderEnv = unique(corpusPlan.missingEnvKeys.filter((key) => !key.startsWith("SUPABASE")));
  const storageBlocks = unique([...corpusPlan.blockers, ...trainingBlueprint.blockers]);
  const corpusBlocks = trainingBlueprint.sports.flatMap((sport) =>
    sport.deficits.realFinishedFixtures > 0 || sport.deficits.realOddsSnapshots > 0
      ? [`${sport.sport}: ${sport.deficits.realFinishedFixtures} fixture and ${sport.deficits.realOddsSnapshots} odds deficits remain.`]
      : []
  );
  const featureBlocks = trainingBlueprint.sports.flatMap((sport) =>
    sport.deficits.featureSnapshots > 0 ? [`${sport.sport}: ${sport.deficits.featureSnapshots} feature snapshot deficit remains.`] : []
  );
  const backtestBlocks = trainingBlueprint.sports.flatMap((sport) =>
    sport.deficits.backtestRuns > 0 ? [`${sport.sport}: completed real-data backtest is missing.`] : []
  );
  const eplBlocks = eplFixtureIntake.nextTask?.missingEnv ?? [];

  return [
    phase({
      id: "prove-storage",
      label: "Prove OddsPadi storage target",
      evidenceRequired: [
        "Project ref matches OddsPadi.",
        "Service-role credential can read expected op_ tables.",
        "No foreign schema evidence is present."
      ],
      blockers: storageBlocks
    }),
    phase({
      id: "public-epl-history-probe",
      label: "Probe public EPL history CSVs",
      evidenceRequired: [
        "Football-Data.co.uk EPL CSVs load for 2016/17-2025/26.",
        "Finished fixtures, teams, and bookmaker odds columns are counted without writes.",
        "Rows are treated as training candidates until provider enrichment and storage review pass."
      ],
      blockers: []
    }),
    phase({
      id: "public-epl-backtest-probe",
      label: "Run public EPL backtest probe",
      evidenceRequired: [
        "CSV fixture candidates convert into model-ready HistoricalFootballFixture rows.",
        "Poisson/Elo/odds-edge backtest returns train/test split, Brier score, log loss, ROI, and calibration evidence.",
        "Learned weights remain locked as shadow-only candidates until persisted real-data backtests are approved."
      ],
      blockers: []
    }),
    phase({
      id: "public-epl-threshold-sweep",
      label: "Sweep public EPL learned thresholds",
      evidenceRequired: [
        "Multiple edge/probability threshold profiles are evaluated against the same holdout split.",
        "Baseline and best profile are compared on yield, picks, calibration, Brier score, and risk.",
        "Any recommendation remains shadow-only and cannot alter public decisions."
      ],
      blockers: []
    }),
    phase({
      id: "public-epl-walk-forward",
      label: "Validate public EPL thresholds forward",
      evidenceRequired: [
        "Each held-out EPL season is tested after training on earlier seasons.",
        "Fold-level yield, pick count, calibration, Brier, and log loss are reported.",
        "Any walk-forward recommendation remains shadow-only until provider-enriched retests and stored backtests pass."
      ],
      blockers: []
    }),
    phase({
      id: "public-epl-market-consensus",
      label: "Audit public EPL bookmaker consensus",
      evidenceRequired: [
        "Multiple bookmaker 1X2 triples are converted to implied probability.",
        "Bookmaker margin is removed and consensus no-vig probabilities are compared.",
        "Market quality, sharp-vs-average gap, and disagreement guardrails are reported without writes."
      ],
      blockers: []
    }),
    phase({
      id: "public-epl-market-benchmark",
      label: "Benchmark public EPL model against market",
      evidenceRequired: [
        "The Poisson/Elo holdout set is matched to no-vig bookmaker consensus probabilities.",
        "Model Brier/log-loss is compared against market Brier/log-loss on the same fixtures.",
        "Any market-prior recommendation remains shadow-only until provider-enriched retests and stored backtests pass."
      ],
      blockers: []
    }),
    phase({
      id: "configure-providers",
      label: "Configure provider keys",
      evidenceRequired: [
        "API-Football/APISports key for fixtures and context.",
        "The Odds API key for historical odds and market snapshots.",
        "Basketball, tennis, news, and weather keys for full model inputs."
      ],
      blockers: missingProviderEnv
    }),
    phase({
      id: "historical-dry-runs",
      label: "Run historical fixture dry-runs",
      evidenceRequired: [
        "dryRun=1 requests return normalized fixture/result counts.",
        "Events, standings, availability, lineups, news, and weather enrichments are counted separately.",
        "Provider quotas are visible before write mode."
      ],
      blockers: corpusPlan.sports.flatMap((sport) => (sport.firstDryRunCommand?.safeToRun ? [] : sport.firstDryRunCommand?.missingEnv ?? sport.missingEnvKeys))
    }),
    phase({
      id: "odds-market-dry-runs",
      label: "Run odds market dry-runs",
      evidenceRequired: [
        "Historical h2h prices normalize to implied probabilities.",
        "Bookmaker margin can be removed for no-vig probability.",
        "Opening, pre-kickoff, and closing snapshots are planned per fixture."
      ],
      blockers: corpusPlan.missingEnvKeys.filter((key) => key.includes("ODDS"))
    }),
    phase({
      id: "epl-2026-fixture-bridge",
      label: "Bridge upcoming EPL 2026/27",
      evidenceRequired: [
        "Official released fixtures seed league 39 season 2026.",
        "Provider fixture IDs are verified before kickoff.",
        "Kickoff changes remain mutable and source-stamped."
      ],
      blockers: eplBlocks
    }),
    phase({
      id: "write-corpus-batches",
      label: "Write historical corpus batches",
      evidenceRequired: [
        "op_fixtures, op_teams, op_odds_snapshots, and context tables grow from provider rows.",
        "Raw payload archive and ingestion runs remain auditable.",
        "Writes happen in capped batches after dry-run review."
      ],
      blockers: unique([...storageBlocks, ...missingProviderEnv, ...corpusBlocks])
    }),
    phase({
      id: "feature-snapshots",
      label: "Generate model feature snapshots",
      evidenceRequired: [
        "Feature rows match live model-card inputs.",
        "Train/validation/test splits and target labels are present.",
        "Feature hashes are stable for replay."
      ],
      blockers: featureBlocks.length ? featureBlocks : corpusBlocks
    }),
    phase({
      id: "real-backtests",
      label: "Run real-data backtests",
      evidenceRequired: [
        "Football, basketball, and tennis backtests complete on real provider rows.",
        "Metrics include Brier, log loss, ROI, CLV, calibration error, and sample size.",
        "Model cards stay blocked until metrics and calibration pass."
      ],
      blockers: backtestBlocks
    }),
    phase({
      id: "shadow-learning",
      label: "Unlock shadow learning only",
      evidenceRequired: [
        "Learned weights pass promotion governor checks.",
        "Public prediction, publishing, staking, and write automation remain locked.",
        "Operator approval is required before any future activation."
      ],
      blockers: trainingBlueprint.sports.flatMap((sport) => sport.gates.filter((gate) => gate.status !== "pass").map((gate) => `${sport.sport}: ${gate.label}`))
    })
  ];
}

function statusFrom(phases: HistoricalCorpusAcquisitionPhase[], trainingBlueprint: TrainingDataBlueprint): HistoricalCorpusAcquisitionStatus {
  if (phases.some((item) => item.status === "blocked")) return "needs-supabase-proof";
  if (trainingBlueprint.status === "blocked") return "blocked";
  if (trainingBlueprint.status === "waiting-env" || phases.some((item) => item.status === "waiting")) return "waiting-env";
  return "ready-dry-run";
}

export function buildHistoricalCorpusAcquisition({
  corpusPlan,
  trainingBlueprint,
  eplFixtureIntake,
  now = new Date()
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingBlueprint: TrainingDataBlueprint;
  eplFixtureIntake: DecisionEplFixtureIntake;
  now?: Date;
}): HistoricalCorpusAcquisition {
  const phases = buildPhases({ corpusPlan, trainingBlueprint, eplFixtureIntake });
  const status = statusFrom(phases, trainingBlueprint);
  const commands = unique(
    [
      publicEplMarketConsensusCommand(),
      publicEplMarketBenchmarkCommand(),
      publicEplWalkForwardCommand(),
      publicEplThresholdSweepCommand(),
      publicEplBacktestCommand(),
      publicEplHistoryCommand(),
      eplCommand(eplFixtureIntake),
      commandFrom("multi-sport-corpus-next", corpusPlan.nextSafeCommand),
      commandFrom("training-blueprint-next", trainingBlueprint.nextSafeCommand),
      ...corpusPlan.sports.map((sport) => commandFrom(`${sport.sport}-first-dry-run`, sport.firstDryRunCommand))
    ]
      .filter((item): item is HistoricalCorpusAcquisitionCommand => Boolean(item))
      .map((item) => JSON.stringify(item)),
    8
  ).map((item) => JSON.parse(item) as HistoricalCorpusAcquisitionCommand);
  const blockers = unique([...phases.flatMap((item) => item.blockers), ...trainingBlueprint.blockers, ...corpusPlan.blockers]);
  const warnings = unique([
    ...trainingBlueprint.warnings,
    ...corpusPlan.warnings,
    "This controller is read-only: it plans acquisition but does not authorize writes, training, publishing, or staking."
  ]);
  const providerMatrix = corpusPlan.sports.map((sport) => ({
    sport: sport.sport,
    status: sport.status,
    adapter: sport.adapter,
    targetCompetitions: sport.targetCompetitions.length,
    estimatedMatches: sport.estimatedHistoricalMatches,
    estimatedOddsSnapshots: sport.estimatedOddsSnapshots,
    missingEnv: sport.missingEnvKeys,
    firstCommand: sport.firstDryRunCommand?.command ?? null
  }));
  const acquisitionHash = stableHash({
    status,
    window: [corpusPlan.seasonFrom, corpusPlan.seasonTo],
    epl: eplFixtureIntake.season,
    phases: phases.map((item) => [item.id, item.status, item.blockers]),
    commands: commands.map((item) => [item.id, item.safeToRun, item.missingEnv])
  });

  return {
    generatedAt: now.toISOString(),
    mode: "historical-corpus-acquisition",
    status,
    acquisitionHash,
    summary:
      status === "ready-dry-run"
        ? "Historical corpus acquisition is ready for supervised dry-runs; writes and training remain locked."
        : status === "waiting-env"
          ? "Historical corpus acquisition is waiting on provider keys before dry-runs can cover the full 10-year plan."
          : "Historical corpus acquisition needs OddsPadi Supabase proof before writes, training, or learned weights can unlock.",
    historicalWindow: {
      from: corpusPlan.seasonFrom,
      to: corpusPlan.seasonTo,
      seasons: corpusPlan.seasons,
      sports: corpusPlan.sportCount,
      estimatedMatches: corpusPlan.totalEstimatedHistoricalMatches,
      estimatedOddsSnapshots: corpusPlan.totalEstimatedOddsSnapshots
    },
    upcomingEpl: {
      season: eplFixtureIntake.season.season,
      providerSeason: eplFixtureIntake.season.providerSeason,
      fixtureReleaseDate: eplFixtureIntake.season.fixtureReleaseDate,
      seasonStartDate: eplFixtureIntake.season.seasonStartDate,
      finalMatchDate: eplFixtureIntake.season.finalMatchDate,
      totalFixtures: eplFixtureIntake.season.totalFixtures,
      daysUntilStart: eplFixtureIntake.season.daysUntilStart,
      sourceUrl: eplFixtureIntake.season.sourceUrl
    },
    totals: {
      phases: phases.length,
      readyPhases: phases.filter((item) => item.status === "ready").length,
      waitingPhases: phases.filter((item) => item.status === "waiting").length,
      blockedPhases: phases.filter((item) => item.status === "blocked").length,
      providerKeysMissing: corpusPlan.missingEnvKeys.filter((key) => !key.startsWith("SUPABASE")).length,
      corpusDeficits: trainingBlueprint.sports.reduce(
        (sum, sport) => sum + sport.deficits.realFinishedFixtures + sport.deficits.realOddsSnapshots + sport.deficits.featureSnapshots + sport.deficits.backtestRuns,
        0
      )
    },
    providerMatrix,
    phases,
    nextSafeCommands: commands,
    blockers,
    warnings,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: commands.some((command) => command.safeToRun),
      canWriteProviderRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false
    },
    locks: unique([
      "Do not set dryRun=0 until Supabase project proof, provider dry-run counts, and operator review pass.",
      "Do not train models until real fixture, odds, feature, and backtest gates pass for each sport.",
      "Do not let learned weights affect public predictions until shadow-governance and calibration approve them.",
      "Treat EPL 2026/27 fixtures as mutable until provider IDs, kickoff updates, and odds-event linkage are verified.",
      ...eplFixtureIntake.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/training/historical-corpus-acquisition",
      "/api/sports/decision/training/football-data-market-consensus",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/training/football-data-market-benchmark-persistence",
      "/api/sports/decision/training/football-data-market-benchmark-memory",
      "/api/sports/decision/training/football-data-walk-forward",
      "/api/sports/decision/training/football-data-threshold-sweep",
      "/api/sports/decision/training/football-data-backtest-probe",
      "/api/sports/decision/training/football-data-csv-probe",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/epl-fixture-intake",
      ...trainingBlueprint.proofUrls,
      ...corpusPlan.proofUrls,
      ...eplFixtureIntake.proofUrls
    ])
  };
}
