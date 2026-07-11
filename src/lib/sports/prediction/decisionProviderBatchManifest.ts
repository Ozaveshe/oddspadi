import type { DecisionProviderIngestionEvidence, DecisionProviderIngestionSignal } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { DecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { MultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import type { Sport } from "@/lib/sports/types";

export type DecisionProviderBatchManifestStatus = "ready-dry-run" | "needs-provider-env" | "needs-storage-proof" | "blocked";
export type DecisionProviderBatchStatus = "dry-run-ready" | "needs-env" | "storage-blocked" | "locked";

export type DecisionProviderBatch = {
  id: string;
  label: string;
  category: DecisionProviderIngestionSignal["category"];
  provider: string;
  status: DecisionProviderBatchStatus;
  priority: DecisionProviderIngestionSignal["priority"];
  dryRunCommand: string;
  verifyUrl: string;
  safeToRun: boolean;
  expectedEvidence: string;
  targetTables: string[];
  affectedMatches: number;
  estimatedRows: number;
  missingEnv: string[];
  storageMissing: string[];
  modelImpact: string;
  writeMode: {
    canWrite: false;
    table: "op_provider_ingestion_runs" | "op_raw_provider_payloads" | "mixed";
    reason: string;
  };
};

export type DecisionProviderBatchManifest = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "provider-batch-manifest";
  status: DecisionProviderBatchManifestStatus;
  manifestHash: string;
  summary: string;
  totals: {
    batches: number;
    dryRunReady: number;
    needsEnv: number;
    storageBlocked: number;
    locked: number;
    targetTables: number;
    estimatedRows: number;
    tenYearEstimatedMatches: number;
    tenYearEstimatedOddsSnapshots: number;
  };
  storage: {
    status: DecisionStorageActivationChecklist["status"];
    liveTables: number;
    expectedTables: number;
    canApplySchema: boolean;
    canRunProviderDryRun: boolean;
    containmentStatus: DecisionSupabaseContainmentPolicy["status"] | "not-evaluated";
    canRunContainedDryRun: boolean;
  };
  batches: DecisionProviderBatch[];
  nextBatch: DecisionProviderBatch | null;
  nextCommand: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
    missing: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsDryRunSafe(command: string): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("dryrun=0") || lower.includes("persist=1")) return false;
  if (lower.includes("apply_migration") || lower.includes("supabase db push")) return false;
  if (lower.includes("-x post") && !lower.includes("dryrun=1")) return false;
  return true;
}

function estimatedRowsFor(signal: DecisionProviderIngestionSignal): number {
  const matches = Math.max(1, signal.affectedMatches);
  const tableMultiplier = Math.max(1, signal.storageTables.length);
  if (signal.category === "odds") return matches * 9;
  if (signal.category === "lineups") return matches * 2;
  if (signal.category === "injuries" || signal.category === "suspensions") return matches * 4;
  if (signal.category === "match-events") return matches * 12;
  if (signal.category === "training" || signal.category === "historical-results") return matches * tableMultiplier * 2;
  return matches * tableMultiplier;
}

function writeTableFor(signal: DecisionProviderIngestionSignal): DecisionProviderBatch["writeMode"]["table"] {
  if (signal.storageTables.length === 1) return signal.storageTables[0] === "op_raw_provider_payloads" ? "op_raw_provider_payloads" : "mixed";
  if (signal.storageTables.includes("op_provider_ingestion_runs") && signal.storageTables.includes("op_raw_provider_payloads")) return "mixed";
  return "mixed";
}

function batchStatus(
  signal: DecisionProviderIngestionSignal,
  storage: DecisionStorageActivationChecklist,
  containmentPolicy: DecisionSupabaseContainmentPolicy | null
): DecisionProviderBatchStatus {
  if (signal.missingEnv.length) return "needs-env";
  const containedDryRun = Boolean(containmentPolicy?.controls.canRunProviderDryRun);
  if (storage.status === "blocked-cross-project" && !containedDryRun) return "locked";
  if ((signal.storageMissing.length || storage.progress.liveTables < storage.progress.expectedTables) && !containedDryRun) return "storage-blocked";
  return commandIsDryRunSafe(signal.command) ? "dry-run-ready" : "locked";
}

function batchFromSignal(
  signal: DecisionProviderIngestionSignal,
  storage: DecisionStorageActivationChecklist,
  containmentPolicy: DecisionSupabaseContainmentPolicy | null
): DecisionProviderBatch {
  const status = batchStatus(signal, storage, containmentPolicy);
  const safeToRun = status === "dry-run-ready" && commandIsDryRunSafe(signal.command);
  return {
    id: `batch-${signal.category}`,
    label: signal.label,
    category: signal.category,
    provider: signal.provider,
    status,
    priority: signal.priority,
    dryRunCommand: signal.command,
    verifyUrl: signal.verifyUrl,
    safeToRun,
    expectedEvidence: signal.expectedEvidence,
    targetTables: signal.storageTables,
    affectedMatches: signal.affectedMatches,
    estimatedRows: estimatedRowsFor(signal),
    missingEnv: signal.missingEnv,
    storageMissing: signal.storageMissing,
    modelImpact: signal.modelImpact,
    writeMode: {
      canWrite: false,
      table: writeTableFor(signal),
      reason: containmentPolicy?.status === "contained-dry-run"
        ? "Contained mode allows dry-run provider rehearsal only; mixed-schema proof keeps writes, migrations, training, and publishing locked."
        : "Provider batch manifest is dry-run/read-only; write mode requires live schema, storage receipt, admin approval, and dry-run counts."
    }
  };
}

function statusFor(
  batches: DecisionProviderBatch[],
  storage: DecisionStorageActivationChecklist,
  containmentPolicy: DecisionSupabaseContainmentPolicy | null
): DecisionProviderBatchManifestStatus {
  if (batches.some((batch) => batch.status === "dry-run-ready")) return "ready-dry-run";
  if (batches.some((batch) => batch.status === "needs-env")) return "needs-provider-env";
  if (storage.status === "blocked-cross-project" && !containmentPolicy?.controls.canRunProviderDryRun) return "blocked";
  if (batches.some((batch) => batch.status === "storage-blocked")) return "needs-storage-proof";
  return "blocked";
}

function summaryFor(status: DecisionProviderBatchManifestStatus, totals: DecisionProviderBatchManifest["totals"]): string {
  if (status === "ready-dry-run") return `${totals.dryRunReady} provider batch(es) can run in dry-run mode while writes remain locked.`;
  if (status === "needs-provider-env") return "Provider batch manifest is waiting for provider/admin environment variables before dry-runs can run.";
  if (status === "needs-storage-proof") return "Provider batches are mapped, but storage proof is missing before any write or training step.";
  return "Provider batch manifest is blocked by project, storage, or safety constraints.";
}

export function buildDecisionProviderBatchManifest({
  date,
  sport,
  providerIngestionEvidence,
  storageActivationChecklist,
  multiSportCorpusPlan,
  containmentPolicy = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  multiSportCorpusPlan: MultiSportCorpusPlan;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  now?: Date;
}): DecisionProviderBatchManifest {
  const batches = providerIngestionEvidence.providerSignals.map((signal) => batchFromSignal(signal, storageActivationChecklist, containmentPolicy));
  const targetTables = unique(batches.flatMap((batch) => batch.targetTables)).length;
  const totals = {
    batches: batches.length,
    dryRunReady: batches.filter((batch) => batch.status === "dry-run-ready").length,
    needsEnv: batches.filter((batch) => batch.status === "needs-env").length,
    storageBlocked: batches.filter((batch) => batch.status === "storage-blocked").length,
    locked: batches.filter((batch) => batch.status === "locked").length,
    targetTables,
    estimatedRows: batches.reduce((sum, batch) => sum + batch.estimatedRows, 0),
    tenYearEstimatedMatches: multiSportCorpusPlan.totalEstimatedHistoricalMatches,
    tenYearEstimatedOddsSnapshots: multiSportCorpusPlan.totalEstimatedOddsSnapshots
  };
  const status = statusFor(batches, storageActivationChecklist, containmentPolicy);
  const nextBatch =
    batches.find((batch) => batch.status === "dry-run-ready") ??
    batches.find((batch) => batch.status === "needs-env") ??
    batches.find((batch) => batch.status === "storage-blocked") ??
    batches[0] ??
    null;
  const manifestHash = stableHash({
    date,
    sport,
    status,
    storage: storageActivationChecklist.checklistHash,
    evidence: providerIngestionEvidence.evidenceHash,
    batches: batches.map((batch) => [batch.id, batch.status, batch.targetTables])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "provider-batch-manifest",
    status,
    manifestHash,
    summary: summaryFor(status, totals),
    totals,
    storage: {
      status: storageActivationChecklist.status,
      liveTables: storageActivationChecklist.progress.liveTables,
      expectedTables: storageActivationChecklist.progress.expectedTables,
      canApplySchema: storageActivationChecklist.controls.canApplySchema,
      canRunProviderDryRun: storageActivationChecklist.controls.canRunProviderDryRun,
      containmentStatus: containmentPolicy?.status ?? "not-evaluated",
      canRunContainedDryRun: Boolean(containmentPolicy?.controls.canRunProviderDryRun)
    },
    batches,
    nextBatch,
    nextCommand: {
      label: nextBatch?.label ?? "Inspect provider batch manifest",
      command: nextBatch?.safeToRun ? nextBatch.dryRunCommand : decisionCurlCommand("/api/sports/decision/provider-batch-manifest"),
      verifyUrl: nextBatch?.verifyUrl ?? "/api/sports/decision/provider-batch-manifest",
      safeToRun: Boolean(nextBatch?.safeToRun),
      expectedEvidence: nextBatch?.expectedEvidence ?? "Provider batch manifest returns dry-run batch mapping, target tables, storage blockers, and write locks.",
      missing: unique([...(nextBatch?.missingEnv ?? []), ...(containmentPolicy?.controls.canRunProviderDryRun ? [] : (nextBatch?.storageMissing ?? []))])
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: batches.some((batch) => batch.safeToRun),
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-batch-manifest",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/data-intake",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/training/backfill"
    ]),
    locks: unique([
      "Provider batch manifest is read-only and cannot write provider rows, persist decisions, train models, publish picks, or stake.",
      "Every provider batch stays dry-run until storage proof, provider counts, admin approval, and write receipts pass.",
      "Raw provider payloads and ingestion-run rows must be source-stamped before any training feature rows are trusted.",
      ...storageActivationChecklist.locks
    ])
  };
}
