import type { LiveTrainingSport, MultiSportLiveFeatureMaterializerReceipt } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";
import type { MultiSportLiveFeatureStorageReceipt } from "@/lib/sports/training/multiSportLiveFeatureStorageReceipt";

export type MultiSportLiveOperationQueueStatus = "blocked-provider-proof" | "waiting-supabase" | "waiting-admin" | "ready-readonly" | "safe-hold";
export type MultiSportLiveOperationStatus = "ready" | "waiting" | "blocked" | "done";
export type MultiSportLiveOperationKind = "provider" | "feature" | "storage" | "settlement" | "backtest" | "safety";

export type MultiSportLiveOperation = {
  id: string;
  kind: MultiSportLiveOperationKind;
  status: MultiSportLiveOperationStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  rationale: string;
  expectedEvidence: string;
  verifyUrl: string;
  command: string | null;
  safeToRun: boolean;
  blockedBy: string[];
};

export type MultiSportLiveOperationQueue = {
  mode: "multi-sport-live-operation-queue";
  generatedAt: string;
  status: MultiSportLiveOperationQueueStatus;
  queueHash: string;
  summary: string;
  target: {
    sport: LiveTrainingSport;
    targetDate: string;
    sourceFixtures: number;
    modelKey: string;
    storageTable: "op_training_feature_snapshots";
    upsertConflictTarget: string;
  };
  nextOperation: MultiSportLiveOperation | null;
  totals: Record<MultiSportLiveOperationStatus, number>;
  operations: MultiSportLiveOperation[];
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: boolean;
    canPreviewLiveFeatureRows: boolean;
    canWriteLiveFeatureSnapshots: boolean;
    canFeedBacktestRunner: false;
    canTrainModels: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsReadOnly(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  const hasRunParam = /[?&]run=1\b/.test(lower) || /[?&]run=true\b/.test(lower);
  return !hasRunParam && !lower.includes("dryrun=0") && !lower.includes("dryrun=false") && !lower.includes("persist=1");
}

function operation(input: Omit<MultiSportLiveOperation, "safeToRun" | "blockedBy"> & { blockedBy?: string[] }): MultiSportLiveOperation {
  const blockedBy = unique(input.blockedBy ?? [], 8);
  return {
    ...input,
    blockedBy,
    safeToRun: input.status === "ready" && blockedBy.length === 0 && commandIsReadOnly(input.command)
  };
}

function sportUrl(path: string, sport: LiveTrainingSport, targetDate: string): string {
  return `${path}?sport=${sport}&date=${targetDate}&dryRun=1`;
}

function statusFor(storage: MultiSportLiveFeatureStorageReceipt, operations: MultiSportLiveOperation[]): MultiSportLiveOperationQueueStatus {
  if (storage.status === "waiting-provider-proof") return "blocked-provider-proof";
  if (storage.status === "waiting-supabase") return "waiting-supabase";
  if (storage.status === "waiting-admin") return "waiting-admin";
  if (operations.some((item) => item.safeToRun)) return "ready-readonly";
  return "safe-hold";
}

function summaryFor(status: MultiSportLiveOperationQueueStatus, nextOperation: MultiSportLiveOperation | null): string {
  if (status === "blocked-provider-proof") return `Multi-sport live queue is blocked by provider proof: ${nextOperation?.label ?? "collect provider-backed rows"}.`;
  if (status === "waiting-supabase") return "Multi-sport live queue is waiting for OddsPadi Supabase service-role readiness.";
  if (status === "waiting-admin") return "Multi-sport live queue is waiting for admin authorization before any storage run.";
  if (status === "ready-readonly") return `Multi-sport live queue has a safe read-only proof ready: ${nextOperation?.label ?? "inspect proof"}.`;
  return "Multi-sport live queue is in safe hold; training and public action remain locked.";
}

function operationsFor({
  materializer,
  storage,
  origin
}: {
  materializer: MultiSportLiveFeatureMaterializerReceipt;
  storage: MultiSportLiveFeatureStorageReceipt;
  origin: string;
}): MultiSportLiveOperation[] {
  const sport = materializer.request.sport;
  const targetDate = materializer.request.targetDate;
  const materializerUrl = sportUrl("/api/sports/decision/training/multi-sport-live-feature-materializer", sport, targetDate);
  const storageUrl = sportUrl("/api/sports/decision/training/multi-sport-live-feature-storage-receipt", sport, targetDate);
  const corpusPlanUrl = `/api/sports/decision/training/multi-sport-corpus-plan?sport=${sport}`;
  const providerProofReady = storage.materializer.providerBackedRows > 0;
  const hasPreviewRows = materializer.previewRows.length > 0;

  return [
    operation({
      id: "provider-live-proof",
      kind: "provider",
      status: providerProofReady ? "done" : "blocked",
      priority: "critical",
      label: `Collect provider-backed ${sport} fixture and odds proof`,
      rationale: providerProofReady
        ? `${storage.materializer.providerBackedRows} provider-backed ${sport} live row(s) have raw payload proof; ${storage.materializer.ineligiblePendingRows} incomplete row(s) remain excluded.`
        : "Mock or synthetic rows cannot be stored as provider-backed training evidence.",
      expectedEvidence: "Every storage-eligible row has provider identity, raw payload proof, complete strength inputs, and two-way moneyline odds.",
      verifyUrl: storageUrl,
      command: providerProofReady ? `curl.exe -s "${origin}${storageUrl}"` : null,
      blockedBy: providerProofReady ? [] : ["provider fixture API", "provider odds API", "raw payload proof"]
    }),
    operation({
      id: "live-feature-preview",
      kind: "feature",
      status: hasPreviewRows ? "ready" : "waiting",
      priority: "high",
      label: `Inspect ${sport} live feature materializer`,
      rationale: hasPreviewRows
        ? `${materializer.previewRows.length} ${sport} live feature row(s) are available for read-only review.`
        : materializer.summary,
      expectedEvidence: "Feature rows include model probabilities, market probabilities, odds, secondary markets, evidence flags, and pending settlement targets.",
      verifyUrl: materializerUrl,
      command: `curl.exe -s "${origin}${materializerUrl}"`,
      blockedBy: hasPreviewRows ? [] : ["complete moneyline odds"]
    }),
    operation({
      id: "live-storage-preview",
      kind: "storage",
      status: storage.payload.rows.length ? "ready" : "waiting",
      priority: "high",
      label: `Inspect ${sport} live storage receipt`,
      rationale: storage.summary,
      expectedEvidence: "Storage receipt exposes target table, upsert conflict key, pending rows, provider proof count, and locked write controls.",
      verifyUrl: storageUrl,
      command: `curl.exe -s "${origin}${storageUrl}"`,
      blockedBy: storage.payload.rows.length ? [] : ["pending live feature rows"]
    }),
    operation({
      id: "store-provider-live-feature-snapshot",
      kind: "storage",
      status: storage.controls.canWriteLiveFeatureSnapshots ? "ready" : "blocked",
      priority: "medium",
      label: `Store provider-backed ${sport} live feature snapshots`,
      rationale: "Storage writes require provider proof, correct Supabase ref, service-role readiness, run=1, and admin authorization.",
      expectedEvidence: "op_training_feature_snapshots receives split=live rows with pending targets and no training/public-action unlock.",
      verifyUrl: `${storageUrl}&run=1`,
      command: null,
      blockedBy: storage.controls.canWriteLiveFeatureSnapshots ? [] : ["provider proof", "admin token", "Supabase service-role readiness"]
    }),
    operation({
      id: "settle-live-outcomes",
      kind: "settlement",
      status: "waiting",
      priority: "medium",
      label: `Settle ${sport} live rows after final results`,
      rationale: "Pending live rows are not training data until outcomes and labels are settled.",
      expectedEvidence: "Stored live rows receive actualOutcome labels only after final scores/results are verified.",
      verifyUrl: "/api/sports/decision/outcome-settlement",
      command: null,
      blockedBy: ["finished score/result", "settlement label", "stored live feature row"]
    }),
    operation({
      id: "run-sport-backtest",
      kind: "backtest",
      status: "blocked",
      priority: "low",
      label: `Keep ${sport} backtest promotion locked`,
      rationale: "A live preview cannot feed learned weights until stored rows are settled and backtested.",
      expectedEvidence: "Historical fixtures, real odds snapshots, feature rows, settlement labels, and completed backtests exist before learning promotion.",
      verifyUrl: corpusPlanUrl,
      command: `curl.exe -s "${origin}${corpusPlanUrl}"`,
      blockedBy: ["settled labels", "historical corpus", "completed backtest"]
    }),
    operation({
      id: "train-publish-stake-lock",
      kind: "safety",
      status: "blocked",
      priority: "critical",
      label: "Keep training, public picks, and staking locked",
      rationale: "Basketball/tennis live rows are monitor evidence only until provider proof, storage, settlement, and backtests pass.",
      expectedEvidence: "Queue controls keep canTrainModels, canPublishPicks, and canStake false.",
      verifyUrl: storageUrl,
      command: null,
      blockedBy: ["pending settlement label", "model governance", "public safety policy"]
    })
  ];
}

export function buildMultiSportLiveOperationQueue({
  materializer,
  storage,
  origin = "http://127.0.0.1:3025",
  now = new Date()
}: {
  materializer: MultiSportLiveFeatureMaterializerReceipt;
  storage: MultiSportLiveFeatureStorageReceipt;
  origin?: string;
  now?: Date;
}): MultiSportLiveOperationQueue {
  const operations = operationsFor({ materializer, storage, origin }).sort((a, b) => {
    const statusRank = { blocked: 4, ready: 3, waiting: 2, done: 1 }[b.status] - { blocked: 4, ready: 3, waiting: 2, done: 1 }[a.status];
    if (statusRank !== 0) return statusRank;
    const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[b.priority] - { critical: 4, high: 3, medium: 2, low: 1 }[a.priority];
    if (priorityRank !== 0) return priorityRank;
    return a.id.localeCompare(b.id);
  });
  const actionable =
    operations.find((item) => item.status === "blocked" && item.priority === "critical" && item.id !== "train-publish-stake-lock") ??
    operations.find((item) => item.status === "ready") ??
    null;
  const totals = {
    ready: operations.filter((item) => item.status === "ready").length,
    waiting: operations.filter((item) => item.status === "waiting").length,
    blocked: operations.filter((item) => item.status === "blocked").length,
    done: operations.filter((item) => item.status === "done").length
  };
  const status = statusFor(storage, operations);

  return {
    mode: "multi-sport-live-operation-queue",
    generatedAt: now.toISOString(),
    status,
    queueHash: stableHash({
      status,
      materializer: materializer.materializerHash,
      storage: storage.receiptHash,
      operations: operations.map((item) => [item.id, item.status, item.blockedBy])
    }),
    summary: summaryFor(status, actionable),
    target: {
      sport: materializer.request.sport,
      targetDate: materializer.request.targetDate,
      sourceFixtures: materializer.request.sourceFixtures,
      modelKey: materializer.request.modelKey,
      storageTable: storage.target.table,
      upsertConflictTarget: storage.target.upsertConflictTarget
    },
    nextOperation: actionable,
    totals,
    operations,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: operations.some((item) => item.safeToRun),
      canPreviewLiveFeatureRows: materializer.controls.canPreviewLiveFeatureRows,
      canWriteLiveFeatureSnapshots: storage.controls.canWriteLiveFeatureSnapshots,
      canFeedBacktestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/multi-sport-live-operation-queue",
      ...materializer.proofUrls,
      ...storage.proofUrls,
      ...operations.map((item) => item.verifyUrl)
    ]),
    locks: unique([
      "Multi-sport live operation queue is read-only and cannot train models, publish picks, stake, or expose hidden chain-of-thought.",
      "Storage writes require the separate storage receipt, provider raw payload proof, admin authorization, and Supabase service-role readiness.",
      "Basketball and tennis live rows remain monitor-only until settlement labels and backtests exist.",
      ...materializer.locks,
      ...storage.locks
    ])
  };
}
