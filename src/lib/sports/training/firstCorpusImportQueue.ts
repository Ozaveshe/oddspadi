import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { ProviderCorpusDryRunJob, ProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { Sport } from "@/lib/sports/types";

type TrainingSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type FirstCorpusImportQueueStatus =
  | "waiting-supabase"
  | "waiting-provider-keys"
  | "ready-provider-dry-run"
  | "needs-storage-fill"
  | "ready-live-monitor"
  | "ready-shadow-backtest"
  | "failed";

export type FirstCorpusImportQueueStepStatus = "ready" | "waiting" | "blocked" | "complete";
export type FirstCorpusImportQueueStepKind =
  | "supabase-census"
  | "provider-fixture-dry-run"
  | "provider-odds-dry-run"
  | "provider-odds-attachment"
  | "provider-write-receipt"
  | "feature-materialization"
  | "backtest-persistence"
  | "promotion-review";

export type FirstCorpusImportQueueStep = {
  id: string;
  kind: FirstCorpusImportQueueStepKind;
  label: string;
  sport: TrainingSport | "all";
  status: FirstCorpusImportQueueStepStatus;
  targetTables: string[];
  command: string;
  verifyUrl: string;
  expectedEvidence: string;
  blocker: string | null;
  canRunNow: boolean;
};

export type FirstCorpusImportQueue = {
  mode: "first-corpus-import-queue";
  generatedAt: string;
  status: FirstCorpusImportQueueStatus;
  queueHash: string;
  summary: string;
  source: {
    censusStatus: SupabaseTrainingCorpusCensus["status"];
    providerQueueStatus: ProviderCorpusDryRunQueue["status"];
    corpusRows: SupabaseTrainingCorpusCensus["totals"];
    providerDryRunJobs: ProviderCorpusDryRunQueue["totals"];
  };
  nextStep: FirstCorpusImportQueueStep | null;
  steps: FirstCorpusImportQueueStep[];
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canWriteRawPayloads: false;
    canWriteFeatureSnapshots: false;
    canRunBacktests: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
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

function step(input: FirstCorpusImportQueueStep): FirstCorpusImportQueueStep {
  return input;
}

function statusFor(census: SupabaseTrainingCorpusCensus, providerQueue: ProviderCorpusDryRunQueue): FirstCorpusImportQueueStatus {
  if (census.status === "failed" || providerQueue.status === "provider-error") return "failed";
  if (census.status === "waiting-supabase") return "waiting-supabase";
  if (census.status === "ready-shadow-backtest") return "ready-shadow-backtest";
  if (census.status === "ready-live-monitor") return "ready-live-monitor";
  if (providerQueue.status === "missing-env") return "waiting-provider-keys";
  if (census.status === "empty-corpus" || providerQueue.status === "ready-dry-run" || providerQueue.status === "dry-run-passed") return "ready-provider-dry-run";
  return "needs-storage-fill";
}

function summaryFor(status: FirstCorpusImportQueueStatus): string {
  if (status === "waiting-supabase") return "First corpus import is waiting for OddsPadi Supabase service-role read proof.";
  if (status === "waiting-provider-keys") return "First corpus import is waiting for fixture and odds provider keys.";
  if (status === "ready-provider-dry-run") return "First corpus import is ready for supervised provider dry-runs; writes and training remain locked.";
  if (status === "ready-live-monitor") return "Corpus has enough live monitor evidence to review watchlists, but training remains locked.";
  if (status === "ready-shadow-backtest") return "Corpus has enough stored rows for shadow backtest review; public promotion remains separately gated.";
  if (status === "failed") return "First corpus import queue has a failing census or provider dry-run dependency.";
  return "First corpus import needs stored fixtures, odds, raw payloads, feature snapshots, outcomes, or backtest rows before training can advance.";
}

function dryRunStep(job: ProviderCorpusDryRunJob, origin: string): FirstCorpusImportQueueStep {
  const command = `${decisionCurlCommand(`${origin}${job.verifyUrl}&run=1`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  return step({
    id: `dry-run-${job.id}`,
    kind: job.category === "fixtures" ? "provider-fixture-dry-run" : "provider-odds-dry-run",
    label: job.label,
    sport: job.sport,
    status: job.status === "passed" ? "complete" : job.configured ? "ready" : "blocked",
    targetTables: job.targetTables,
    command,
    verifyUrl: job.verifyUrl,
    expectedEvidence: job.expectedEvidence,
    blocker: job.configured ? null : job.missingEnv.join(", "),
    canRunNow: job.configured
  });
}

function firstJobByCategory(providerQueue: ProviderCorpusDryRunQueue, category: ProviderCorpusDryRunJob["category"]): ProviderCorpusDryRunJob | null {
  return (
    providerQueue.jobs.find((job) => job.category === category && job.status === "ready") ??
    providerQueue.jobs.find((job) => job.category === category && job.status === "missing-env") ??
    providerQueue.jobs.find((job) => job.category === category) ??
    null
  );
}

function basketballOddsAttachmentStep(
  census: SupabaseTrainingCorpusCensus,
  oddsJob: ProviderCorpusDryRunJob | null,
  origin: string
): FirstCorpusImportQueueStep | null {
  const basketball = census.sports.find((row) => row.sport === "basketball");
  if (!basketball || basketball.finishedFixtures <= 0 || basketball.matchWinnerOddsSnapshots >= basketball.finishedFixtures) return null;

  const verifyUrl = "/api/sports/decision/training/basketball-odds-backfill?from=2023-10-24&to=2024-04-13&regions=us&maxJobs=7&maxCredits=70&run=0";
  const configured = Boolean(oddsJob?.configured);
  return step({
    id: "basketball-historical-odds-attachment",
    kind: "provider-odds-attachment",
    label: "Checkpoint NBA historical moneyline odds",
    sport: "basketball",
    status: configured ? "ready" : "blocked",
    targetTables: ["op_odds_snapshots", "op_raw_provider_payloads", "op_provider_ingestion_runs"],
    command: `${decisionCurlCommand(`${origin}${verifyUrl}`)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    verifyUrl,
    expectedEvidence:
      "The plan skips completed receipt dates, caps provider credits, and checkpoints NBA historical h2h odds that match existing finished NBA fixtures without rewriting them.",
    blocker: configured ? null : oddsJob?.missingEnv.join(", ") || "THE_ODDS_API_KEY or ODDS_API_KEY",
    canRunNow: configured
  });
}

export function buildFirstCorpusImportQueue({
  census,
  providerQueue,
  origin = "http://127.0.0.1:3025",
  now = new Date()
}: {
  census: SupabaseTrainingCorpusCensus;
  providerQueue: ProviderCorpusDryRunQueue;
  origin?: string;
  now?: Date;
}): FirstCorpusImportQueue {
  const fixtureJob = firstJobByCategory(providerQueue, "fixtures");
  const oddsJob = firstJobByCategory(providerQueue, "odds");
  const basketballOddsStep = basketballOddsAttachmentStep(census, oddsJob, origin);
  const status = statusFor(census, providerQueue);
  const canRunDryRun = providerQueue.controls.canRunProviderDryRun && status !== "waiting-supabase" && status !== "failed";
  const steps = [
    step({
      id: "supabase-corpus-census",
      kind: "supabase-census",
      label: "Read Supabase corpus census",
      sport: "all",
      status: census.status === "waiting-supabase" || census.status === "failed" ? "blocked" : "complete",
      targetTables: ["op_fixtures", "op_odds_snapshots", "op_raw_provider_payloads", "op_training_feature_snapshots", "op_backtest_runs"],
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/supabase-training-corpus-census`),
      verifyUrl: "/api/sports/decision/training/supabase-training-corpus-census",
      expectedEvidence: "Read-only counts for fixtures, odds, raw payloads, feature snapshots, live rows, labeled rows, and completed backtests.",
      blocker: census.status === "waiting-supabase" ? census.target.projectRef : census.readiness.errors[0] ?? null,
      canRunNow: true
    }),
    ...(fixtureJob ? [dryRunStep(fixtureJob, origin)] : []),
    ...(oddsJob ? [dryRunStep(oddsJob, origin)] : []),
    ...(basketballOddsStep ? [basketballOddsStep] : []),
    step({
      id: "provider-storage-receipts",
      kind: "provider-write-receipt",
      label: "Store provider rows through guarded receipts",
      sport: "all",
      status: census.totals.fixtures > 0 && census.totals.oddsSnapshots > 0 && census.totals.rawProviderPayloads > 0 ? "complete" : "waiting",
      targetTables: ["op_provider_ingestion_runs", "op_raw_provider_payloads", "op_fixtures", "op_odds_snapshots"],
      command: `${decisionCurlCommand(`${origin}/api/sports/decision/training/historical-provider-storage-receipt?provider=api-football&league=39&seasonFrom=2025&seasonTo=2025&includeEvents=1&includeContext=1&includeStandings=1&includeAvailability=1&includeLineups=1&includePlayerStats=1&maxEventFixtures=1&maxContextFixtures=2&maxJobs=1&limit=25&dryRun=1&run=1`)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
      verifyUrl: "/api/sports/decision/training/historical-provider-storage-receipt?provider=api-football&league=39&seasonFrom=2025&seasonTo=2025&includeEvents=1&includeContext=1&includeStandings=1&includeAvailability=1&includeLineups=1&includePlayerStats=1&maxEventFixtures=1&maxContextFixtures=2&maxJobs=1&limit=25&dryRun=1",
      expectedEvidence: "Provider write receipts show rows written and read back while public browser writes remain closed.",
      blocker: providerQueue.totals.passed > 0 ? null : "Provider dry-run counts must pass before write receipts are considered.",
      canRunNow: false
    }),
    step({
      id: "feature-materialization",
      kind: "feature-materialization",
      label: "Materialize training feature snapshots",
      sport: "all",
      status: census.totals.featureSnapshots > 0 ? "complete" : "waiting",
      targetTables: ["op_training_feature_snapshots"],
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-provider-feature-materializer?dryRun=1`),
      verifyUrl: "/api/sports/decision/training/football-provider-feature-materializer?dryRun=1",
      expectedEvidence: "Feature rows include model probabilities, no-vig market probabilities, source payload links, split, labels or pending targets, and feature hashes.",
      blocker: census.totals.fixtures > 0 && census.totals.oddsSnapshots > 0 ? null : "Stored fixtures and odds snapshots are required first.",
      canRunNow: census.totals.fixtures > 0 && census.totals.oddsSnapshots > 0
    }),
    step({
      id: "backtest-persistence",
      kind: "backtest-persistence",
      label: "Persist shadow backtest rows",
      sport: "all",
      status: census.totals.completedBacktests > 0 ? "complete" : "waiting",
      targetTables: ["op_backtest_runs", "op_calibration_runs", "op_shadow_memory_replay"],
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/multi-sport-backtest-run?dryRun=1`),
      verifyUrl: "/api/sports/decision/training/multi-sport-backtest-run?dryRun=1",
      expectedEvidence: "Backtest rows compare model probabilities against no-vig market priors with calibration, ROI, Brier, and log-loss metrics.",
      blocker: census.totals.featureSnapshots > 0 ? null : "Stored feature snapshots with labels are required before backtests can be trusted.",
      canRunNow: census.totals.featureSnapshots > 0
    }),
    step({
      id: "promotion-review",
      kind: "promotion-review",
      label: "Review model promotion gates",
      sport: "all",
      status: census.controls.canUseForShadowBacktest ? "ready" : "waiting",
      targetTables: ["op_backtest_runs"],
      command: decisionCurlCommand(`${origin}/api/sports/decision/training/football-data-model-promotion-decision`),
      verifyUrl: "/api/sports/decision/training/football-data-model-promotion-decision",
      expectedEvidence: "Promotion review proves whether learned model probabilities beat market priors before live authority can rise.",
      blocker: census.controls.canUseForShadowBacktest ? null : "Shadow backtest-ready corpus evidence is required first.",
      canRunNow: census.controls.canUseForShadowBacktest
    })
  ];
  const nextStep =
    steps.find((item) => item.status === "blocked") ??
    steps.find((item) => item.status === "ready") ??
    steps.find((item) => item.status === "waiting") ??
    null;

  return {
    mode: "first-corpus-import-queue",
    generatedAt: now.toISOString(),
    status,
    queueHash: stableHash({
      status,
      census: [census.censusHash, census.status, census.totals],
      providerQueue: [providerQueue.queueHash, providerQueue.status, providerQueue.totals],
      steps: steps.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    source: {
      censusStatus: census.status,
      providerQueueStatus: providerQueue.status,
      corpusRows: census.totals,
      providerDryRunJobs: providerQueue.totals
    },
    nextStep,
    steps,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: canRunDryRun,
      canWriteProviderRows: false,
      canWriteRawPayloads: false,
      canWriteFeatureSnapshots: false,
      canRunBacktests: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/provider-corpus-dry-run-queue",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/training/historical-provider-storage-receipt",
      "/api/sports/decision/training/basketball-odds-backfill",
      "/api/sports/decision/provider-batch-manifest",
      "/api/sports/decision/training/football-provider-feature-materializer",
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training/football-data-model-promotion-decision"
    ]),
    locks: unique([
      "First corpus import queue is read-only orchestration and cannot write provider rows, raw payloads, feature snapshots, backtests, picks, or stakes.",
      "Provider network calls require the underlying provider-corpus dry-run queue with run=1 and x-oddspadi-admin-token.",
      "Basketball odds attachment previews provider odds-to-fixture matches first; write mode stays a separate dryRun=0 operator decision.",
      "Storage writes require separate guarded write receipts after dry-run counts are reviewed.",
      "Training and learned weights remain locked until stored feature rows, settled labels, completed backtests, and promotion gates pass."
    ])
  };
}
