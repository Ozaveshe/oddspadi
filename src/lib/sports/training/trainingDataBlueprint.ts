import type { MultiSportCorpusPlan, TrainingCorpusCommand, TrainingCorpusSport, TrainingCorpusSportPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export type TrainingDataBlueprintStatus = "ready-dry-run" | "waiting-env" | "needs-supabase-proof" | "blocked";
export type TrainingDataBlueprintPhaseStatus = "ready" | "waiting" | "blocked";
export type TrainingDataBlueprintGateStatus = "pass" | "watch" | "block";

export type TrainingDataBlueprintStorageTable = {
  table: string;
  purpose: string;
  requiredFor: "provider-ingestion" | "feature-generation" | "odds-intelligence" | "context" | "backtesting" | "audit";
  writeMode: "service-role-only";
  rlsRequired: true;
};

export type TrainingDataBlueprintSport = {
  sport: TrainingCorpusSport;
  status: TrainingDataBlueprintStatus;
  adapter: string;
  backtestModelKey: string | null;
  targetCompetitions: number;
  estimatedHistoricalMatches: number;
  estimatedOddsSnapshots: number;
  currentCorpus: {
    configured: boolean;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    totalFeatureSnapshots?: number;
    partialFeatureSnapshots?: number;
    proxyFeatureSnapshots?: number;
    backtestRuns: number;
    latestBacktestId: string | null;
  };
  deficits: {
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
  };
  gates: Array<{
    id: string;
    status: TrainingDataBlueprintGateStatus;
    label: string;
    detail: string;
    unlocks: string;
  }>;
  firstSafeCommand: TrainingCorpusCommand | null;
  nextAction: string;
};

export type TrainingDataBlueprintPhase = {
  id: string;
  status: TrainingDataBlueprintPhaseStatus;
  label: string;
  objective: string;
  evidenceRequired: string[];
  blocks: string[];
};

export type TrainingDataBlueprint = {
  generatedAt: string;
  mode: "training-data-blueprint";
  blueprintHash: string;
  status: TrainingDataBlueprintStatus;
  summary: string;
  seasonWindow: {
    from: number;
    to: number;
    seasons: string[];
  };
  corpusTargets: {
    sports: number;
    totalEstimatedHistoricalMatches: number;
    totalEstimatedOddsSnapshots: number;
    minimumRecommendedFixturesPerSport: number;
  };
  storageTables: TrainingDataBlueprintStorageTable[];
  sports: TrainingDataBlueprintSport[];
  phases: TrainingDataBlueprintPhase[];
  nextSafeCommand: TrainingCorpusCommand;
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  blockers: string[];
  warnings: string[];
  proofUrls: string[];
};

const MINIMUM_RECOMMENDED_FIXTURES = 1000;

const STORAGE_TABLES: TrainingDataBlueprintStorageTable[] = [
  {
    table: "op_provider_ingestion_runs",
    purpose: "Records provider sync attempts, dry-run evidence, quotas, and import status.",
    requiredFor: "audit",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_raw_provider_payloads",
    purpose: "Archives raw provider responses for replay, normalization audits, and debugging.",
    requiredFor: "provider-ingestion",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_leagues",
    purpose: "Stores normalized leagues, tournaments, countries, and sport-specific competition metadata.",
    requiredFor: "provider-ingestion",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_teams",
    purpose: "Stores teams and tennis players as normalized competitors.",
    requiredFor: "provider-ingestion",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_fixtures",
    purpose: "Stores fixtures, games, tennis matches, kickoff time, final score, status, xG where available, and venue context.",
    requiredFor: "provider-ingestion",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_fixture_team_features",
    purpose: "Stores home/away or player-side feature rows such as Elo, attack/defense, form, rest, injuries, and suspensions.",
    requiredFor: "feature-generation",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_odds_snapshots",
    purpose: "Stores bookmaker market odds, implied probability, no-vig probability, opening/pre-kickoff/closing flags, and CLV inputs.",
    requiredFor: "odds-intelligence",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_standings_snapshots",
    purpose: "Stores table position, played, points, W/D/L, goals, and form snapshots.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_player_availability_snapshots",
    purpose: "Stores injuries, suspensions, doubtful status, impact score, and player availability.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_lineup_snapshots",
    purpose: "Stores predicted and confirmed lineups, formations, and player lists.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_live_match_events",
    purpose: "Stores match events, minute, team/player identifiers, cards, substitutions, goals, shots, and replayable live context.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_news_signals",
    purpose: "Stores injury, lineup, weather, tactical, sentiment, and other news-derived context with source URLs.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_weather_snapshots",
    purpose: "Stores football weather context such as precipitation, wind, humidity, condition, and impact score.",
    requiredFor: "context",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_training_feature_snapshots",
    purpose: "Stores model-ready feature vectors, targets, feature hashes, and train/validation/test/live split labels.",
    requiredFor: "backtesting",
    writeMode: "service-role-only",
    rlsRequired: true
  },
  {
    table: "op_backtest_runs",
    purpose: "Stores completed football, basketball, and tennis backtest metrics, learned weights, CLV, ROI, log loss, and notes.",
    requiredFor: "backtesting",
    writeMode: "service-role-only",
    rlsRequired: true
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

function unique(values: Array<string | null | undefined>, limit = 20): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function deficit(target: number, current: number): number {
  return Math.max(0, target - current);
}

function gate({
  id,
  pass,
  watch,
  label,
  detail,
  unlocks
}: {
  id: string;
  pass: boolean;
  watch?: boolean;
  label: string;
  detail: string;
  unlocks: string;
}): TrainingDataBlueprintSport["gates"][number] {
  return {
    id,
    status: pass ? "pass" : watch ? "watch" : "block",
    label,
    detail,
    unlocks
  };
}

function statusForSport(plan: TrainingCorpusSportPlan, snapshot: TrainingDataSnapshot): TrainingDataBlueprintStatus {
  if (plan.status === "blocked") return "needs-supabase-proof";
  if (plan.blockers.length) return "needs-supabase-proof";
  if (plan.missingEnvKeys.length) return "waiting-env";
  if (!snapshot.configured || !snapshot.readiness.hasHistoricalFixtures || !snapshot.readiness.hasOdds) return "ready-dry-run";
  return snapshot.readiness.readyForTraining ? "ready-dry-run" : "waiting-env";
}

function buildSport(plan: TrainingCorpusSportPlan, snapshot: TrainingDataSnapshot): TrainingDataBlueprintSport {
  const completeFeatureSnapshots = snapshot.counts.completeFeatureSnapshots ?? snapshot.counts.featureSnapshots;
  const current = {
    configured: snapshot.configured,
    realFinishedFixtures: snapshot.counts.realFinishedFixtures,
    realOddsSnapshots: snapshot.counts.realOddsSnapshots,
    featureSnapshots: completeFeatureSnapshots,
    totalFeatureSnapshots: snapshot.counts.featureSnapshots,
    partialFeatureSnapshots: snapshot.counts.partialFeatureSnapshots ?? Math.max(0, snapshot.counts.featureSnapshots - completeFeatureSnapshots),
    proxyFeatureSnapshots: snapshot.counts.proxyFeatureSnapshots ?? 0,
    backtestRuns: snapshot.counts.backtestRuns,
    latestBacktestId: snapshot.latestBacktest?.id ?? null
  };
  const deficits = {
    realFinishedFixtures: deficit(MINIMUM_RECOMMENDED_FIXTURES, current.realFinishedFixtures),
    realOddsSnapshots: deficit(MINIMUM_RECOMMENDED_FIXTURES * 2, current.realOddsSnapshots),
    featureSnapshots: deficit(Math.max(MINIMUM_RECOMMENDED_FIXTURES, current.realFinishedFixtures), current.featureSnapshots),
    backtestRuns: deficit(1, current.backtestRuns)
  };
  const gates = [
    gate({
      id: "supabase-storage",
      pass: snapshot.configured && plan.status !== "blocked",
      watch: plan.status !== "blocked",
      label: "Supabase storage readable",
      detail: snapshot.reason ?? snapshot.readiness.detail,
      unlocks: "Server-side corpus counts, backtests, and feature snapshots can be measured."
    }),
    gate({
      id: "real-fixtures",
      pass: current.realFinishedFixtures >= MINIMUM_RECOMMENDED_FIXTURES,
      watch: current.realFinishedFixtures > 0,
      label: "Real finished fixtures",
      detail: `${current.realFinishedFixtures}/${MINIMUM_RECOMMENDED_FIXTURES} real finished fixture rows are available.`,
      unlocks: "First serious train/test split for sport-specific backtests."
    }),
    gate({
      id: "real-odds",
      pass: current.realOddsSnapshots >= MINIMUM_RECOMMENDED_FIXTURES * 2,
      watch: current.realOddsSnapshots > 0,
      label: "Real odds snapshots",
      detail: `${current.realOddsSnapshots}/${MINIMUM_RECOMMENDED_FIXTURES * 2} real bookmaker odds snapshots are available.`,
      unlocks: "No-vig probability calibration, value-edge validation, and closing-line value."
    }),
    gate({
      id: "feature-snapshots",
      pass: current.featureSnapshots >= Math.max(MINIMUM_RECOMMENDED_FIXTURES, current.realFinishedFixtures),
      watch: current.featureSnapshots > 0,
      label: "Complete historical feature snapshots",
      detail: `${current.featureSnapshots} complete feature row(s) out of ${current.totalFeatureSnapshots} total for ${current.realFinishedFixtures} real finished fixtures; ${current.partialFeatureSnapshots} partial and ${current.proxyFeatureSnapshots} proxy row(s) are excluded.`,
      unlocks: "Feature parity between historical training rows and today's live model inputs."
    }),
    gate({
      id: "backtest",
      pass: current.backtestRuns > 0 && snapshot.latestBacktest?.status === "completed",
      watch: current.backtestRuns > 0,
      label: "Completed real-data backtest",
      detail: snapshot.latestBacktest
        ? `Latest backtest ${snapshot.latestBacktest.id} is ${snapshot.latestBacktest.status} with sample size ${snapshot.latestBacktest.sampleSize}.`
        : "No completed real-data backtest is stored yet.",
      unlocks: "Learned guardrails and model-card training readiness can be evaluated."
    })
  ];
  const firstBlock = gates.find((item) => item.status === "block");

  return {
    sport: plan.sport,
    status: statusForSport(plan, snapshot),
    adapter: plan.adapter,
    backtestModelKey: plan.backtestModelKey,
    targetCompetitions: plan.targetCompetitions.length,
    estimatedHistoricalMatches: plan.estimatedHistoricalMatches,
    estimatedOddsSnapshots: plan.estimatedOddsSnapshots,
    currentCorpus: current,
    deficits,
    gates,
    firstSafeCommand: plan.firstDryRunCommand,
    nextAction:
      plan.blockers[0] ??
      (plan.missingEnvKeys[0] ? `Configure ${plan.missingEnvKeys[0]} before provider dry-runs.` : null) ??
      firstBlock?.detail ??
      "Run a capped provider dry-run, review normalized counts, then backfill in small batches."
  };
}

function phaseStatus(blocks: string[]): TrainingDataBlueprintPhaseStatus {
  if (blocks.some((block) => /wrong|invalid|foreign|credential|supabase/i.test(block))) return "blocked";
  if (blocks.length) return "waiting";
  return "ready";
}

function phase(input: Omit<TrainingDataBlueprintPhase, "status">): TrainingDataBlueprintPhase {
  return {
    ...input,
    status: phaseStatus(input.blocks)
  };
}

function buildPhases(plan: MultiSportCorpusPlan, sports: TrainingDataBlueprintSport[]): TrainingDataBlueprintPhase[] {
  const missingEnv = plan.missingEnvKeys;
  const blockers = plan.blockers;
  const corpusBlocks = sports.flatMap((sport) =>
    sport.deficits.realFinishedFixtures || sport.deficits.realOddsSnapshots ? [`${sport.sport} corpus deficits remain.`] : []
  );
  const backtestBlocks = sports.flatMap((sport) => (sport.deficits.backtestRuns ? [`${sport.sport} has no completed real-data backtest.`] : []));

  return [
    phase({
      id: "prove-supabase",
      label: "Prove OddsPadi Supabase target",
      objective: "Confirm project ref, service key, MCP scope, and expected op_ tables before any write-mode import.",
      evidenceRequired: [
        "/api/sports/decision/supabase-project-isolation reports the OddsPadi project.",
        "/api/sports/decision/supabase-bootstrap verifies expected op_ tables.",
        "No foreign-schema sentinel tables are present in the target."
      ],
      blocks: blockers
    }),
    phase({
      id: "provider-dry-runs",
      label: "Run provider dry-runs",
      objective: "Fetch and normalize capped provider payloads with dryRun=1 for football, basketball, tennis, and historical odds.",
      evidenceRequired: [
        "Each provider dry-run returns normalized fixture/result counts.",
        "Odds dry-runs return priced markets and bookmaker metadata.",
        "Raw payload archive and ingestion-run payloads are previewed but not written."
      ],
      blocks: missingEnv
    }),
    phase({
      id: "write-corpus",
      label: "Write historical corpus",
      objective: "After dry-run review, backfill fixtures, teams/players, odds, context, events, news, weather, and feature inputs in small batches.",
      evidenceRequired: [
        "op_fixtures real finished rows grow by sport.",
        "op_odds_snapshots includes opening, pre-kickoff, and closing observations.",
        "Context tables store standings, availability, lineups, events, news, and weather where available."
      ],
      blocks: unique([...blockers, ...missingEnv])
    }),
    phase({
      id: "feature-snapshots",
      label: "Generate feature snapshots",
      objective: "Convert normalized provider data into model-ready football, basketball, and tennis feature vectors.",
      evidenceRequired: [
        "op_training_feature_snapshots contains train/validation/test rows.",
        "Feature hashes and target labels are present.",
        "Feature coverage matches live model-card feature provenance."
      ],
      blocks: corpusBlocks
    }),
    phase({
      id: "backtest",
      label: "Run real-data backtests",
      objective: "Run the implemented sport-specific backtest runners and store metrics before learned guardrails are trusted.",
      evidenceRequired: [
        "op_backtest_runs stores completed runs for each sport.",
        "Metrics include Brier score, log loss, ROI units, yield, average edge, and closing-line value.",
        "Model cards move from blocked to shadow/training-ready only after governance passes."
      ],
      blocks: backtestBlocks
    }),
    phase({
      id: "unlock-shadow-learning",
      label: "Unlock shadow learning only",
      objective: "Allow learned weights to be inspected in shadow mode without public publishing or write automation.",
      evidenceRequired: [
        "Model governance approves corpus volume, feature parity, target labels, calibration, and drift.",
        "Activation audit still keeps publish, persist, train, stake, and public-action upgrades independently locked."
      ],
      blocks: sports.flatMap((sport) => sport.gates.filter((gate) => gate.status !== "pass").map((gate) => `${sport.sport}: ${gate.label}`))
    })
  ];
}

function statusForBlueprint(plan: MultiSportCorpusPlan, sports: TrainingDataBlueprintSport[], phases: TrainingDataBlueprintPhase[]): TrainingDataBlueprintStatus {
  if (plan.status === "blocked" || phases.some((phaseItem) => phaseItem.status === "blocked")) return "needs-supabase-proof";
  if (sports.every((sport) => sport.gates.every((gate) => gate.status === "pass"))) return "ready-dry-run";
  if (plan.missingEnvKeys.length) return "waiting-env";
  return "ready-dry-run";
}

export function buildTrainingDataBlueprint({
  corpusPlan,
  trainingSnapshots,
  now = new Date()
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingSnapshots: TrainingDataSnapshot[];
  now?: Date;
}): TrainingDataBlueprint {
  const snapshotsBySport = new Map(trainingSnapshots.map((snapshot) => [snapshot.sport, snapshot]));
  const sports = corpusPlan.sports.map((sportPlan) => {
    const snapshot =
      snapshotsBySport.get(sportPlan.sport) ??
      ({
        generatedAt: now.toISOString(),
        status: "not-configured",
        configured: false,
        sport: sportPlan.sport,
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
          backtestRuns: 0
        },
        latestBacktest: null,
        readiness: {
          hasHistoricalFixtures: false,
          hasOdds: false,
          hasBacktests: false,
          readyForTraining: false,
          minimumRecommendedFixtures: MINIMUM_RECOMMENDED_FIXTURES,
          detail: "Historical training storage is not ready."
        },
        reason: "Historical training storage is not ready."
      } satisfies TrainingDataSnapshot);

    return buildSport(sportPlan, snapshot);
  });
  const phases = buildPhases(corpusPlan, sports);
  const status = statusForBlueprint(corpusPlan, sports, phases);
  const blockers = unique([...corpusPlan.blockers, ...phases.filter((item) => item.status === "blocked").flatMap((item) => item.blocks)]);
  const warnings = unique([
    ...corpusPlan.warnings,
    ...sports.flatMap((sport) => sport.gates.filter((gate) => gate.status === "watch").map((gate) => `${sport.sport}: ${gate.label}`))
  ]);
  const blueprintHash = stableHash({
    status,
    corpusPlan: corpusPlan.id,
    sports: sports.map((sport) => [sport.sport, sport.status, sport.currentCorpus, sport.deficits]),
    phases: phases.map((phaseItem) => [phaseItem.id, phaseItem.status])
  });

  return {
    generatedAt: now.toISOString(),
    mode: "training-data-blueprint",
    blueprintHash,
    status,
    summary:
      status === "needs-supabase-proof"
        ? "Training data blueprint is blocked by Supabase project/schema proof; only read-only inspection is allowed."
        : status === "waiting-env"
          ? "Training data blueprint is waiting on provider or server env before dry-runs can start."
          : "Training data blueprint is ready for supervised dry-run inspection, but writes and training remain locked.",
    seasonWindow: {
      from: corpusPlan.seasonFrom,
      to: corpusPlan.seasonTo,
      seasons: corpusPlan.seasons
    },
    corpusTargets: {
      sports: corpusPlan.sportCount,
      totalEstimatedHistoricalMatches: corpusPlan.totalEstimatedHistoricalMatches,
      totalEstimatedOddsSnapshots: corpusPlan.totalEstimatedOddsSnapshots,
      minimumRecommendedFixturesPerSport: MINIMUM_RECOMMENDED_FIXTURES
    },
    storageTables: STORAGE_TABLES,
    sports,
    phases,
    nextSafeCommand: corpusPlan.nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: status === "ready-dry-run" && sports.some((sport) => Boolean(sport.firstSafeCommand?.safeToRun)),
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    warnings,
    proofUrls: unique([
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training",
      "/api/sports/decision/model-cards",
      "/api/sports/decision/supabase-bootstrap",
      ...corpusPlan.proofUrls
    ])
  };
}
