import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import type { DecisionProviderBatchManifest } from "@/lib/sports/prediction/decisionProviderBatchManifest";
import { buildDecisionProviderKeyPlan, type DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import type { DecisionSupabaseCredentialActivationReceipt } from "@/lib/sports/prediction/decisionSupabaseCredentialActivationReceipt";
import type { HistoricalCorpusAcquisition } from "@/lib/sports/training/historicalCorpusAcquisition";
import type { TenYearCorpusExecutionManifest } from "@/lib/sports/training/tenYearCorpusExecutionManifest";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionProviderActivationQueueStatus = "needs-supabase-secret" | "needs-provider-env" | "ready-dry-run" | "blocked";
export type DecisionProviderActivationQueueItemKind =
  | "supabase-credential"
  | "epl-fixtures"
  | "provider-signal"
  | "ten-year-corpus"
  | "historical-phase";
export type DecisionProviderActivationQueueItemStatus = "next" | "ready" | "waiting-env" | "storage-blocked" | "locked";

export type DecisionProviderActivationQueueItem = {
  id: string;
  kind: DecisionProviderActivationQueueItemKind;
  label: string;
  status: DecisionProviderActivationQueueItemStatus;
  priority: number;
  sport: Sport | "all";
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  targetTables: string[];
  missing: string[];
  expectedEvidence: string;
  unlocks: string;
  userGoalFit: string;
};

export type DecisionProviderActivationQueue = {
  mode: "provider-activation-queue";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProviderActivationQueueStatus;
  queueHash: string;
  summary: string;
  totals: {
    items: number;
    ready: number;
    waitingEnv: number;
    storageBlocked: number;
    locked: number;
    safeCommands: number;
    targetTables: number;
  };
  currentBlocker: {
    label: string;
    missing: string[];
    proofUrl: string;
    nextAction: string;
  };
  eplBridge: {
    season: string;
    providerSeason: string;
    startDate: string;
    daysUntilStart: number;
    fixtureCount: number;
    sourceUrl: string;
    status: DecisionEplFixtureIntake["status"];
  };
  providerKeyPlan: DecisionProviderKeyPlan;
  trainingBridge: {
    window: string;
    estimatedMatches: number;
    estimatedOddsSnapshots: number;
    nextJob: string | null;
    status: TenYearCorpusExecutionManifest["status"];
  };
  queue: DecisionProviderActivationQueueItem[];
  nextItem: DecisionProviderActivationQueueItem | null;
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function statusRank(status: DecisionProviderActivationQueueItemStatus): number {
  if (status === "next") return 0;
  if (status === "ready") return 1;
  if (status === "waiting-env") return 2;
  if (status === "storage-blocked") return 3;
  return 4;
}

function queueItem(input: DecisionProviderActivationQueueItem): DecisionProviderActivationQueueItem {
  return {
    ...input,
    targetTables: unique(input.targetTables),
    missing: unique(input.missing)
  };
}

function credentialAllowsReadOnlyDryRun(receipt: DecisionSupabaseCredentialActivationReceipt): boolean {
  return (
    receipt.status === "ready-storage-credential" ||
    (receipt.evidence.projectMatchesExpected &&
      receipt.evidence.credentialStatus === "valid" &&
      receipt.evidence.liveTables === receipt.evidence.expectedTables &&
      receipt.evidence.expectedTables > 0)
  );
}

function credentialItem(receipt: DecisionSupabaseCredentialActivationReceipt): DecisionProviderActivationQueueItem {
  const credentialReady = credentialAllowsReadOnlyDryRun(receipt);
  const cleanReady = receipt.status === "ready-storage-credential";
  return queueItem({
    id: "supabase-server-secret",
    kind: "supabase-credential",
    label: cleanReady ? "Verify storage credential after restart" : credentialReady ? "Review contained storage proof" : "Replace rejected Supabase server secret",
    status: credentialReady ? "ready" : "next",
    priority: 1,
    sport: "all",
    command: receipt.commands[0]?.command ?? null,
    verifyUrl: receipt.nextStep.proofUrl,
    safeToRun: true,
    targetTables: ["op_provider_ingestion_runs", "op_raw_provider_payloads"],
    missing: credentialReady ? [] : ["valid SUPABASE_SERVICE_ROLE_KEY"],
    expectedEvidence: receipt.nextStep.evidence,
    unlocks: cleanReady
      ? "Confirms the app can read OddsPadi storage before provider dry-run review."
      : credentialReady
        ? "Allows guarded read-only provider dry-runs while mixed-schema containment keeps writes, persistence, training, and publishing locked."
      : "Unlocks guarded provider dry-runs, storage reads, training-corpus proof, and post-restart schema checks.",
    userGoalFit: "This is the first hard blocker between the current planner and a real data-backed prediction engine."
  });
}

function eplItem(epl: DecisionEplFixtureIntake): DecisionProviderActivationQueueItem {
  const task = epl.nextTask;
  const status: DecisionProviderActivationQueueItemStatus =
    task?.status === "ready" ? "ready" : epl.status === "needs-storage-proof" ? "storage-blocked" : task?.missingEnv.length ? "waiting-env" : "locked";
  return queueItem({
    id: "epl-2026-fixture-bridge",
    kind: "epl-fixtures",
    label: task?.label ?? "Bridge EPL 2026/27 fixtures",
    status,
    priority: 2,
    sport: "football",
    command: task?.command ?? null,
    verifyUrl: task?.verifyUrl ?? "/api/sports/decision/epl-fixture-intake",
    safeToRun: epl.controls.canRunFixtureDryRun,
    targetTables: ["op_leagues", "op_teams", "op_fixtures", "op_raw_provider_payloads"],
    missing: task?.missingEnv ?? [],
    expectedEvidence: task?.expectedEvidence ?? epl.summary,
    unlocks: "Seeds the Premier League 2026/27 slate so fixtures, odds event IDs, kickoff changes, and pre-match context can attach before August kickoff.",
    userGoalFit: "Keeps the model aware of the 2026/27 EPL season instead of waiting until matchweek one."
  });
}

function providerItems(manifest: DecisionProviderBatchManifest): DecisionProviderActivationQueueItem[] {
  return manifest.batches.slice(0, 6).map((batch, index) => {
    const status: DecisionProviderActivationQueueItemStatus =
      batch.status === "dry-run-ready" ? "ready" : batch.status === "needs-env" ? "waiting-env" : batch.status === "storage-blocked" ? "storage-blocked" : "locked";
    return queueItem({
      id: `provider-${batch.category}`,
      kind: "provider-signal",
      label: batch.label,
      status,
      priority: 10 + index,
      sport: "all",
      command: batch.safeToRun ? batch.dryRunCommand : null,
      verifyUrl: batch.verifyUrl,
      safeToRun: batch.safeToRun,
      targetTables: batch.targetTables,
      missing: [...batch.missingEnv, ...batch.storageMissing],
      expectedEvidence: batch.expectedEvidence,
      unlocks: batch.modelImpact,
      userGoalFit: "Turns a requested signal category into provider-backed evidence the model can score and explain."
    });
  });
}

function tenYearItem(manifest: TenYearCorpusExecutionManifest): DecisionProviderActivationQueueItem {
  const job = manifest.nextJob;
  const status: DecisionProviderActivationQueueItemStatus =
    job?.status === "dry-run-ready"
      ? "ready"
      : job?.status === "needs-env"
        ? "waiting-env"
        : job?.status === "storage-locked"
          ? "storage-blocked"
          : "locked";
  return queueItem({
    id: "ten-year-corpus-next-job",
    kind: "ten-year-corpus",
    label: job?.label ?? "Select 10-year corpus job",
    status,
    priority: 30,
    sport: job?.sport ?? "all",
    command: job?.safeToRun ? job.dryRunCommand : null,
    verifyUrl: job?.verifyUrl ?? "/api/sports/decision/training/ten-year-corpus-execution",
    safeToRun: Boolean(job?.safeToRun),
    targetTables: job?.targetTables ?? ["op_training_feature_snapshots", "op_backtest_runs"],
    missing: job?.missing ?? [],
    expectedEvidence: job?.expectedEvidence ?? manifest.summary,
    unlocks: "Builds the historical fixture, odds, feature, and backtest corpus needed for calibration instead of relying on mock rows.",
    userGoalFit: "This is the training-data path for the 10-year model corpus the product needs."
  });
}

function historicalPhaseItem(acquisition: HistoricalCorpusAcquisition): DecisionProviderActivationQueueItem {
  const phase = acquisition.phases.find((entry) => entry.status !== "ready") ?? acquisition.phases[0];
  const command = acquisition.nextSafeCommands[0] ?? null;
  return queueItem({
    id: `historical-phase-${phase?.id ?? "review"}`,
    kind: "historical-phase",
    label: phase?.label ?? "Review historical acquisition",
    status: phase?.status === "blocked" ? "storage-blocked" : phase?.status === "waiting" ? "waiting-env" : "ready",
    priority: 40,
    sport: "all",
    command: command?.safeToRun ? command.command : null,
    verifyUrl: command?.verifyUrl ?? "/api/sports/decision/training/historical-corpus-acquisition",
    safeToRun: Boolean(command?.safeToRun),
    targetTables: ["op_fixtures", "op_odds_snapshots", "op_training_feature_snapshots", "op_backtest_runs"],
    missing: phase?.blockers ?? command?.missingEnv ?? [],
    expectedEvidence: phase?.evidenceRequired.join(" ") ?? acquisition.summary,
    unlocks: "Coordinates storage proof, provider keys, dry-run counts, corpus writes, feature snapshots, backtests, and shadow learning gates.",
    userGoalFit: "Keeps the agent focused on real historical evidence before it can learn or raise confidence."
  });
}

function topStatus({
  credential,
  queue
}: {
  credential: DecisionSupabaseCredentialActivationReceipt;
  queue: DecisionProviderActivationQueueItem[];
}): DecisionProviderActivationQueueStatus {
  if (!credentialAllowsReadOnlyDryRun(credential)) return "needs-supabase-secret";
  if (queue.some((item) => item.safeToRun)) return "ready-dry-run";
  if (queue.some((item) => item.status === "waiting-env")) return "needs-provider-env";
  return "blocked";
}

function summaryFor(status: DecisionProviderActivationQueueStatus, totals: DecisionProviderActivationQueue["totals"]): string {
  if (status === "needs-supabase-secret") return "Activation queue is waiting on the OddsPadi Supabase server secret before provider dry-runs can become meaningful.";
  if (status === "ready-dry-run") return `${totals.safeCommands} read-only provider dry-run command(s) are safe to inspect; writes, training, publishing, and staking remain locked.`;
  if (status === "needs-provider-env") return "Activation queue is mapped, but provider keys are still missing before real-data dry-runs can run.";
  return "Activation queue is blocked by storage, provider, or safety constraints.";
}

export function buildDecisionProviderActivationQueue({
  date,
  sport,
  supabaseCredentialActivationReceipt,
  eplFixtureIntake,
  providerBatchManifest,
  tenYearCorpusExecutionManifest,
  historicalCorpusAcquisition,
  env = process.env,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  supabaseCredentialActivationReceipt: DecisionSupabaseCredentialActivationReceipt;
  eplFixtureIntake: DecisionEplFixtureIntake;
  providerBatchManifest: DecisionProviderBatchManifest;
  tenYearCorpusExecutionManifest: TenYearCorpusExecutionManifest;
  historicalCorpusAcquisition: HistoricalCorpusAcquisition;
  env?: EnvMap;
  now?: Date;
}): DecisionProviderActivationQueue {
  const providerKeyPlan = buildDecisionProviderKeyPlan({
    date,
    asOfDate: eplFixtureIntake.season.asOfDate,
    env,
    providerBatchManifest,
    tenYearCorpusExecutionManifest
  });
  const queue = [
    credentialItem(supabaseCredentialActivationReceipt),
    eplItem(eplFixtureIntake),
    ...providerItems(providerBatchManifest),
    tenYearItem(tenYearCorpusExecutionManifest),
    historicalPhaseItem(historicalCorpusAcquisition)
  ].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.priority - b.priority);
  const targetTables = unique(queue.flatMap((item) => item.targetTables));
  const totals = {
    items: queue.length,
    ready: queue.filter((item) => item.status === "ready").length,
    waitingEnv: queue.filter((item) => item.status === "waiting-env").length,
    storageBlocked: queue.filter((item) => item.status === "storage-blocked").length,
    locked: queue.filter((item) => item.status === "locked").length,
    safeCommands: queue.filter((item) => item.safeToRun).length,
    targetTables: targetTables.length
  };
  const status = topStatus({ credential: supabaseCredentialActivationReceipt, queue });
  const nextItem = queue.find((item) => item.status === "next") ?? queue.find((item) => item.safeToRun) ?? queue.find((item) => item.missing.length) ?? queue[0] ?? null;
  const queueHash = stableHash({
    date,
    sport,
    status,
    credential: supabaseCredentialActivationReceipt.receiptHash,
    provider: providerBatchManifest.manifestHash,
    providerKeys: providerKeyPlan.lanes.map((lane) => [lane.id, lane.status, lane.missing]),
    corpus: tenYearCorpusExecutionManifest.manifestHash,
    items: queue.map((item) => [item.id, item.status, item.missing])
  });

  return {
    mode: "provider-activation-queue",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    queueHash,
    summary: summaryFor(status, totals),
    totals,
    currentBlocker: {
      label: nextItem?.label ?? "No activation item selected",
      missing: nextItem?.missing ?? [],
      proofUrl: nextItem?.verifyUrl ?? "/api/sports/decision/provider-activation-queue",
      nextAction:
        status === "needs-supabase-secret"
          ? "Replace the server-only Supabase service key, restart the app, then re-run this queue."
          : nextItem?.safeToRun
            ? "Run the read-only dry-run command and inspect normalized counts before any write discussion."
            : "Satisfy the listed missing env/proof items, then re-run the queue."
    },
    eplBridge: {
      season: eplFixtureIntake.season.season,
      providerSeason: eplFixtureIntake.season.providerSeason,
      startDate: eplFixtureIntake.season.seasonStartDate,
      daysUntilStart: eplFixtureIntake.season.daysUntilStart,
      fixtureCount: eplFixtureIntake.season.totalFixtures,
      sourceUrl: eplFixtureIntake.season.sourceUrl,
      status: eplFixtureIntake.status
    },
    providerKeyPlan,
    trainingBridge: {
      window: `${tenYearCorpusExecutionManifest.window.from}-${tenYearCorpusExecutionManifest.window.to}`,
      estimatedMatches: tenYearCorpusExecutionManifest.window.estimatedMatches,
      estimatedOddsSnapshots: tenYearCorpusExecutionManifest.window.estimatedOddsSnapshots,
      nextJob: tenYearCorpusExecutionManifest.nextJob?.label ?? null,
      status: tenYearCorpusExecutionManifest.status
    },
    queue,
    nextItem,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: status === "ready-dry-run" && queue.some((item) => item.safeToRun),
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique([
      "Activation queue never writes provider rows; it only selects the next evidence-producing read-only command.",
      "Provider writes require valid OddsPadi storage credentials, dry-run counts, admin approval, and explicit write receipts.",
      "Training remains locked until real fixtures, odds snapshots, feature snapshots, and backtest rows exist.",
      "EPL 2026/27 fixtures are mutable and must stay source-stamped until kickoff and TV changes settle.",
      ...supabaseCredentialActivationReceipt.locks,
      ...providerBatchManifest.locks,
      ...tenYearCorpusExecutionManifest.locks,
      ...historicalCorpusAcquisition.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/provider-activation-queue",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/supabase-credential-activation",
      "/api/sports/decision/provider-batch-manifest",
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/training/ten-year-corpus-execution",
      "/api/sports/decision/training/historical-corpus-acquisition"
    ])
  };
}
