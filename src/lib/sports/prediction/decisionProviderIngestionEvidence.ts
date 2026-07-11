import {
  buildDecisionDataCapabilityItems,
  type DecisionDataIntakeItem,
  type DecisionDataIntakeQueue
} from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import type { TenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionProviderIngestionEvidenceStatus = "ready-dry-run" | "needs-env" | "needs-supabase-proof" | "blocked";
export type DecisionProviderIngestionSignalStatus = "ready" | "needs-env" | "needs-supabase-proof" | "watch" | "blocked";
export type DecisionProviderIngestionCommandKind = "verify" | "provider-dry-run" | "corpus-plan" | "supabase-proof";

export type DecisionProviderIngestionSignal = {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionProviderIngestionSignalStatus;
  priority: DecisionDataIntakeItem["priority"];
  provider: string;
  affectedMatches: number;
  missingEnv: string[];
  storageMissing: string[];
  dryRunOnly: true;
  command: string;
  verifyUrl: string;
  expectedEvidence: string;
  decisionImpact: string;
  modelImpact: string;
  storageTables: string[];
  exampleMatches: string[];
};

export type DecisionProviderIngestionCommand = {
  id: string;
  kind: DecisionProviderIngestionCommandKind;
  label: string;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  expectedEvidence: string;
};

export type DecisionProviderIngestionEvidence = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "provider-ingestion-evidence";
  status: DecisionProviderIngestionEvidenceStatus;
  summary: string;
  evidenceHash: string;
  dataCoverage: {
    score: number;
    totalSignals: number;
    providerBackedSignals: number;
    computedSignals: number;
    mockSignals: number;
    missingSignals: number;
    staleSignals: number;
  };
  providerSignals: DecisionProviderIngestionSignal[];
  nextProviderSignal: DecisionProviderIngestionSignal | null;
  commands: DecisionProviderIngestionCommand[];
  nextCommand: DecisionProviderIngestionCommand | null;
  supabase: {
    expectedProjectRef: string;
    configuredProjectRef: string | null;
    urlProjectRef: string | null;
    targetMatchesExpected: boolean;
    serverClientConfigured: boolean;
    credentialStatus: DecisionEngineReadiness["supabase"]["schema"]["credentialStatus"];
    schemaStatus: DecisionEngineReadiness["supabase"]["schema"]["status"];
    verifiedTableCount: number;
    expectedTableCount: number;
    mcpScopedProof: boolean;
    storageReady: boolean;
    missingForStorage: string[];
  };
  corpus: {
    status: TenYearFootballCorpusBackfillPlan["status"];
    dryRun: true;
    seasonFrom: number;
    seasonTo: number;
    seasonCount: number;
    targetLeagues: number;
    plannedJobs: number;
    totalCandidateJobs: number;
    estimatedFixtureDerivedOddsJobs: number;
    signalCoverage: TenYearFootballCorpusBackfillPlan["signalCoverage"];
  };
  training: {
    status: TrainingDataSnapshot["status"];
    configured: boolean;
    readyForTraining: boolean;
    realFinishedFixtures: number;
    minimumRecommendedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    latestBacktestStatus: string;
    detail: string;
  };
  controls: {
    canRunReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    forbiddenActions: string[];
  };
  proofUrls: string[];
};

const STORAGE_TABLES_BY_CATEGORY: Record<DecisionDataSignalCategory, string[]> = {
  fixtures: ["op_fixtures", "op_teams", "op_leagues"],
  "historical-results": ["op_fixtures", "op_fixture_team_features"],
  standings: ["op_standings_snapshots"],
  "home-away": ["op_fixture_team_features", "op_training_feature_snapshots"],
  "recent-form": ["op_fixture_team_features", "op_training_feature_snapshots"],
  injuries: ["op_player_availability_snapshots"],
  suspensions: ["op_player_availability_snapshots"],
  lineups: ["op_lineup_snapshots"],
  odds: ["op_odds_snapshots"],
  "live-scores": ["op_fixtures", "op_live_match_events"],
  "match-events": ["op_live_match_events"],
  news: ["op_news_signals"],
  weather: ["op_weather_snapshots"],
  training: ["op_training_feature_snapshots", "op_backtest_runs", "op_provider_ingestion_runs", "op_raw_provider_payloads"]
};

const MODEL_IMPACT_BY_CATEGORY: Record<DecisionDataSignalCategory, string> = {
  fixtures: "Anchors the slate so every model, odds comparison, and abstention gate points at real fixtures.",
  "historical-results": "Feeds Poisson goal priors, Elo updates, form validation, and calibration labels.",
  standings: "Adds table-strength context for team-strength and risk adjustments.",
  "home-away": "Turns home advantage from a generic constant into team-specific historical performance.",
  "recent-form": "Weights short-horizon performance without overfitting stale or mock signals.",
  injuries: "Adjusts expected goals, basketball efficiency, tennis hold/break assumptions, and avoid rules for unavailable players.",
  suspensions: "Prevents the model from treating known absences as neutral context.",
  lineups: "Lets the agent downgrade picks when starters, formation, or rotation contradict the base model.",
  odds: "Unlocks no-vig probability, value edge, expected value, market movement, and closing-line validation.",
  "live-scores": "Feeds in-play recalculation, late abstention, and live state verification.",
  "match-events": "Adds red cards, substitutions, tempo, and event replay for live decisions and learning.",
  news: "Gives the AI reviewer source-grounded team news while blocking unsupported claims.",
  weather: "Adjusts football totals and tempo when outdoor conditions are likely to matter.",
  training: "Creates the real corpus for backtests, calibration, learned thresholds, and model trust."
};

const STORAGE_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ODDSPADI_SUPABASE_MCP_PROJECT_REF", "verified op_ schema"];

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: string[], limit = 24): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function localUrl(path: string, baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/$/, "");
  return `${cleaned}${path}`;
}

function isSafeDryRunCommand(command: string): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("dryrun=0") || lower.includes("persist=1")) return false;
  if (lower.includes("apply_migration") || lower.includes("supabase db push")) return false;
  if (lower.includes("-x post") && !lower.includes("dryrun=1")) return false;
  return true;
}

function dryRunMissingEnv(item: DecisionDataIntakeItem): string[] {
  return unique(item.missingEnv.filter((key) => !["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"].includes(key)));
}

function storageMissing({
  item,
  readiness,
  mcpScopedProof
}: {
  item: DecisionDataIntakeItem;
  readiness: DecisionEngineReadiness;
  mcpScopedProof: boolean;
}): string[] {
  return unique([
    ...item.missingEnv.filter((key) => key.includes("SUPABASE")),
    ...(readiness.supabase.preflight.serverClientConfigured ? [] : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
    ...(readiness.supabase.schema.credentialStatus === "invalid" ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : []),
    ...(mcpScopedProof ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]),
    ...(readiness.supabase.schema.status === "ready" ? [] : ["verified op_ schema"])
  ]);
}

function signalStatus({
  item,
  targetMatchesExpected,
  dryRunMissing,
  storageMissingEnv
}: {
  item: DecisionDataIntakeItem;
  targetMatchesExpected: boolean;
  dryRunMissing: string[];
  storageMissingEnv: string[];
}): DecisionProviderIngestionSignalStatus {
  if (!targetMatchesExpected) return "blocked";
  if (dryRunMissing.length) return "needs-env";
  if (item.status === "blocked" && storageMissingEnv.length) return "needs-supabase-proof";
  if (item.status === "needs-provider") return "ready";
  if (item.status === "watch" || item.status === "ready") return "watch";
  return storageMissingEnv.length ? "needs-supabase-proof" : "ready";
}

function statusSummary(status: DecisionProviderIngestionEvidenceStatus): string {
  if (status === "ready-dry-run") return "Provider ingestion evidence is ready for supervised dry-runs; write-mode storage and model training stay locked.";
  if (status === "needs-supabase-proof") {
    return "Provider dry-runs can be planned, but Supabase project scope, credentials, or op_ schema proof must pass before writes or training.";
  }
  if (status === "needs-env") return "Provider ingestion is waiting for admin/provider environment variables before real-data dry-runs can start.";
  return "Provider ingestion is blocked until the Supabase target and credential safety checks are corrected.";
}

function topLevelStatus({
  targetMatchesExpected,
  credentialInvalid,
  missingDryRunEnv,
  storageReady
}: {
  targetMatchesExpected: boolean;
  credentialInvalid: boolean;
  missingDryRunEnv: string[];
  storageReady: boolean;
}): DecisionProviderIngestionEvidenceStatus {
  if (!targetMatchesExpected || credentialInvalid) return "blocked";
  if (missingDryRunEnv.length) return "needs-env";
  if (!storageReady) return "needs-supabase-proof";
  return "ready-dry-run";
}

function buildSignal({
  item,
  readiness,
  mcpScopedProof
}: {
  item: DecisionDataIntakeItem;
  readiness: DecisionEngineReadiness;
  mcpScopedProof: boolean;
}): DecisionProviderIngestionSignal {
  const missingEnv = dryRunMissingEnv(item);
  const missingStorage = storageMissing({ item, readiness, mcpScopedProof });
  return {
    id: `provider-ingestion-${item.category}`,
    category: item.category,
    label: item.label,
    status: signalStatus({
      item,
      targetMatchesExpected: readiness.supabase.preflight.targetMatchesExpected,
      dryRunMissing: missingEnv,
      storageMissingEnv: missingStorage
    }),
    priority: item.priority,
    provider: item.provider,
    affectedMatches: item.affectedMatches,
    missingEnv,
    storageMissing: missingStorage,
    dryRunOnly: true,
    command: item.command,
    verifyUrl: item.verifyUrl,
    expectedEvidence: item.expectedEvidence,
    decisionImpact: item.decisionImpact,
    modelImpact: MODEL_IMPACT_BY_CATEGORY[item.category],
    storageTables: STORAGE_TABLES_BY_CATEGORY[item.category],
    exampleMatches: item.exampleMatches
  };
}

function command(input: DecisionProviderIngestionCommand): DecisionProviderIngestionCommand {
  return {
    ...input,
    safeToRun: input.safeToRun && !input.missingEnv.length && isSafeDryRunCommand(input.command)
  };
}

export function buildDecisionProviderIngestionEvidence({
  date,
  sport,
  dataIntake,
  readiness,
  training,
  corpusPlan,
  env = process.env,
  baseUrl = decisionSiteOrigin(env)
}: {
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
  readiness: DecisionEngineReadiness;
  training: TrainingDataSnapshot;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  env?: EnvMap;
  baseUrl?: string;
}): DecisionProviderIngestionEvidence {
  const mcpScopedProof = env.ODDSPADI_SUPABASE_MCP_PROJECT_REF?.trim() === ODDSPADI_SUPABASE_PROJECT_REF;
  const observedCategories = new Set(dataIntake.items.map((item) => item.category));
  const capabilityItems = buildDecisionDataCapabilityItems({ date, sport, env }).filter((item) => !observedCategories.has(item.category));
  const providerSignals = [...dataIntake.items, ...capabilityItems].map((item) => buildSignal({ item, readiness, mcpScopedProof }));
  const nextProviderSignal =
    providerSignals.find((item) => item.status === "ready") ??
    providerSignals.find((item) => item.status === "needs-env") ??
    providerSignals.find((item) => item.status === "needs-supabase-proof") ??
    providerSignals[0] ??
    null;
  const missingDryRunEnv = unique(providerSignals.flatMap((item) => item.missingEnv));
  const missingForStorage = unique([
    ...(readiness.supabase.preflight.serverClientConfigured ? [] : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
    ...(readiness.supabase.schema.credentialStatus === "invalid" ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : []),
    ...(mcpScopedProof ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]),
    ...(readiness.supabase.schema.status === "ready" ? [] : ["verified op_ schema"])
  ]);
  const storageReady =
    readiness.supabase.preflight.targetMatchesExpected &&
    readiness.supabase.preflight.serverClientConfigured &&
    readiness.supabase.schema.credentialStatus !== "invalid" &&
    readiness.supabase.schema.status === "ready" &&
    mcpScopedProof;
  const credentialInvalid = readiness.supabase.schema.credentialStatus === "invalid";
  const status = topLevelStatus({
    targetMatchesExpected: readiness.supabase.preflight.targetMatchesExpected,
    credentialInvalid,
    missingDryRunEnv,
    storageReady
  });
  const canRunProviderDryRun = Boolean(nextProviderSignal && !nextProviderSignal.missingEnv.length && isSafeDryRunCommand(nextProviderSignal.command));
  const commands = [
    command({
      id: "provider-ingestion-evidence",
      kind: "verify",
      label: "Verify provider ingestion evidence",
      command: `curl.exe -sS "${localUrl(`/api/sports/decision/provider-ingestion-evidence?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`, baseUrl)}"`,
      verifyUrl: `/api/sports/decision/provider-ingestion-evidence?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
      safeToRun: true,
      missingEnv: [],
      expectedEvidence: "Endpoint returns provider dry-run gates, Supabase storage proof, corpus coverage, and forbidden write actions."
    }),
    command({
      id: "data-intake",
      kind: "verify",
      label: "Verify data intake queue",
      command: `curl.exe -sS "${localUrl(`/api/sports/decision/data-intake?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`, baseUrl)}"`,
      verifyUrl: `/api/sports/decision/data-intake?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
      safeToRun: true,
      missingEnv: [],
      expectedEvidence: "Queue returns every missing provider signal and the first safe provider action."
    }),
    nextProviderSignal
      ? command({
          id: `provider-${nextProviderSignal.category}`,
          kind: "provider-dry-run",
          label: `Dry-run ${nextProviderSignal.label}`,
          command: nextProviderSignal.command,
          verifyUrl: nextProviderSignal.verifyUrl,
          safeToRun: canRunProviderDryRun,
          missingEnv: nextProviderSignal.missingEnv,
          expectedEvidence: nextProviderSignal.expectedEvidence
        })
      : null,
    command({
      id: "ten-year-corpus-plan",
      kind: "corpus-plan",
      label: "Review 10-year corpus plan",
      command: `curl.exe -sS "${localUrl("/api/sports/decision/training/corpus-plan", baseUrl)}"`,
      verifyUrl: "/api/sports/decision/training/corpus-plan",
      safeToRun: true,
      missingEnv: [],
      expectedEvidence: "Corpus plan returns target leagues, season range, provider batches, schema tables, and dry-run command."
    }),
    command({
      id: "supabase-proof",
      kind: "supabase-proof",
      label: "Verify Supabase project isolation",
      command: `curl.exe -sS "${localUrl("/api/sports/decision/supabase-project-isolation", baseUrl)}"`,
      verifyUrl: "/api/sports/decision/supabase-project-isolation",
      safeToRun: true,
      missingEnv: [],
      expectedEvidence: `Proof shows the configured target is OddsPadi ${ODDSPADI_SUPABASE_PROJECT_REF} before schema or write operations.`
    })
  ].filter((item): item is DecisionProviderIngestionCommand => Boolean(item));
  const nextCommand = commands.find((item) => item.kind === "provider-dry-run" && item.safeToRun) ?? commands[0] ?? null;
  const evidenceHash = stableHash({
    date,
    sport,
    status,
    coverageScore: dataIntake.coverageScore,
    nextProviderSignal: nextProviderSignal?.category ?? null,
    providerSignals: providerSignals.map((signal) => [signal.category, signal.status, signal.affectedMatches]),
    missingDryRunEnv,
    missingForStorage,
    corpusStatus: corpusPlan.status,
    trainingReady: training.readiness.readyForTraining
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    mode: "provider-ingestion-evidence",
    status,
    summary: statusSummary(status),
    evidenceHash,
    dataCoverage: {
      score: dataIntake.coverageScore,
      totalSignals: dataIntake.totalSignals,
      providerBackedSignals: dataIntake.providerBackedSignals,
      computedSignals: dataIntake.computedSignals,
      mockSignals: dataIntake.mockSignals,
      missingSignals: dataIntake.missingSignals,
      staleSignals: dataIntake.staleSignals
    },
    providerSignals,
    nextProviderSignal,
    commands,
    nextCommand,
    supabase: {
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      configuredProjectRef: readiness.supabase.preflight.configuredProjectRef,
      urlProjectRef: readiness.supabase.preflight.urlProjectRef,
      targetMatchesExpected: readiness.supabase.preflight.targetMatchesExpected,
      serverClientConfigured: readiness.supabase.preflight.serverClientConfigured,
      credentialStatus: readiness.supabase.schema.credentialStatus,
      schemaStatus: readiness.supabase.schema.status,
      verifiedTableCount: readiness.supabase.schema.verifiedTableCount,
      expectedTableCount: readiness.supabase.schema.expectedTableCount,
      mcpScopedProof,
      storageReady,
      missingForStorage: missingForStorage.length ? missingForStorage : STORAGE_ENV_KEYS.filter(() => false)
    },
    corpus: {
      status: corpusPlan.status,
      dryRun: true,
      seasonFrom: corpusPlan.seasonFrom,
      seasonTo: corpusPlan.seasonTo,
      seasonCount: corpusPlan.seasonCount,
      targetLeagues: corpusPlan.targetLeagues.length,
      plannedJobs: corpusPlan.plannedJobs,
      totalCandidateJobs: corpusPlan.totalCandidateJobs,
      estimatedFixtureDerivedOddsJobs: corpusPlan.estimatedFixtureDerivedOddsJobs,
      signalCoverage: corpusPlan.signalCoverage
    },
    training: {
      status: training.status,
      configured: training.configured,
      readyForTraining: training.readiness.readyForTraining,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      minimumRecommendedFixtures: training.readiness.minimumRecommendedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots,
      featureSnapshots: training.counts.featureSnapshots,
      latestBacktestStatus: training.latestBacktest?.status ?? "missing",
      detail: training.readiness.detail
    },
    controls: {
      canRunReadOnly: true,
      canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      forbiddenActions: [
        "Do not run provider imports with dryRun=0 until Supabase target, schema, and provider dry-run counts are reviewed.",
        "Do not train or calibrate from demo rows or unverified raw provider payloads.",
        "Do not persist decisions or publish picks while the ingestion evidence status is not ready-dry-run.",
        "Do not use the generic Supabase MCP target for OddsPadi schema work unless it is project-ref proven first."
      ]
    },
    proofUrls: [
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/data-intake",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/training/corpus-plan",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/supabase-bootstrap",
      "/api/sports/decision/training"
    ]
  };
}
