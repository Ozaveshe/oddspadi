import { fetchDecisionApiData, type DecisionInternalFetchOptions } from "@/lib/sports/prediction/decisionInternalFetch";
import type { MultiSportLiveOperation, MultiSportLiveOperationQueue } from "@/lib/sports/training/multiSportLiveOperationQueue";

export type MultiSportLiveOperationTurnStatus = "preview-ready" | "observed" | "blocked" | "proof-failed";

export type MultiSportLiveOperationTurn = {
  mode: "multi-sport-live-operation-turn";
  generatedAt: string;
  status: MultiSportLiveOperationTurnStatus;
  turnHash: string;
  summary: string;
  target: MultiSportLiveOperationQueue["target"];
  queue: {
    status: MultiSportLiveOperationQueue["status"];
    queueHash: string;
    nextOperationId: string | null;
  };
  selectedOperation: MultiSportLiveOperation | null;
  selectionReason: string;
  observation: {
    requested: boolean;
    attempted: boolean;
    success: boolean;
    url: string | null;
    proofHash: string | null;
    proofSummary: string | null;
    error: string | null;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedProof: boolean;
    requiresExplicitRunParam: true;
    canPreviewLiveFeatureRows: boolean;
    canWriteLiveFeatureSnapshots: false;
    canFeedBacktestRunner: false;
    canTrainModels: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

type FetchLike = NonNullable<DecisionInternalFetchOptions["fetchImpl"]>;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string | null | undefined, maxLength = 320): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isSafeVerifyUrl(value: string): boolean {
  if (!value.startsWith("/api/sports/decision/training/multi-sport-live-")) return false;
  const lower = value.toLowerCase();
  return !/[?&]run=1\b/.test(lower) && !/[?&]run=true\b/.test(lower) && !lower.includes("dryrun=0") && !lower.includes("dryrun=false") && !lower.includes("persist=1");
}

function selectOperation(queue: MultiSportLiveOperationQueue): { operation: MultiSportLiveOperation | null; reason: string } {
  if (queue.nextOperation?.safeToRun && isSafeVerifyUrl(queue.nextOperation.verifyUrl)) {
    return {
      operation: queue.nextOperation,
      reason: "Selected the queue's next operation because it is read-only and safe to run."
    };
  }

  const fallback = queue.operations.find((item) => item.safeToRun && isSafeVerifyUrl(item.verifyUrl)) ?? null;
  if (fallback) {
    return {
      operation: fallback,
      reason: queue.nextOperation
        ? `Queue next operation ${queue.nextOperation.id} is blocked or unsafe; selected safe read-only proof ${fallback.id}.`
        : `Selected safe read-only proof ${fallback.id}.`
    };
  }

  return {
    operation: null,
    reason: "No read-only multi-sport live operation is currently safe to run."
  };
}

function proofSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["summary", "status", "mode"]) {
    if (typeof record[key] === "string") return compact(record[key]);
  }
  return null;
}

function absoluteProofUrl(origin: string, verifyUrl: string): string {
  return new URL(verifyUrl, origin).toString();
}

export async function buildMultiSportLiveOperationTurn({
  queue,
  runRequested = false,
  origin = "http://127.0.0.1:3025",
  fetchImpl,
  now = new Date()
}: {
  queue: MultiSportLiveOperationQueue;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<MultiSportLiveOperationTurn> {
  const selected = selectOperation(queue);
  const operation = selected.operation;
  const canRunSelectedProof = Boolean(operation?.safeToRun && isSafeVerifyUrl(operation.verifyUrl));
  let proof: unknown = null;
  let attempted = false;
  let error: string | null = null;
  const proofUrl = operation && canRunSelectedProof ? absoluteProofUrl(origin, operation.verifyUrl) : null;

  if (runRequested && proofUrl && fetchImpl) {
    attempted = true;
    proof = await fetchDecisionApiData<unknown>(proofUrl, { fetchImpl, timeoutMs: 20000, maxAttempts: 1 });
    if (!proof) error = "Read-only proof route did not return a successful OddsPadi API envelope.";
  } else if (runRequested && proofUrl) {
    attempted = true;
    proof = await fetchDecisionApiData<unknown>(proofUrl, { timeoutMs: 20000, maxAttempts: 1 });
    if (!proof) error = "Read-only proof route did not return a successful OddsPadi API envelope.";
  }

  const status: MultiSportLiveOperationTurnStatus = !operation || !canRunSelectedProof ? "blocked" : runRequested ? (proof ? "observed" : "proof-failed") : "preview-ready";
  const proofHash = proof ? stableHash(proof) : null;
  const nextAction =
    status === "observed"
      ? {
          label: "Inspect observed proof and refresh multi-sport queue",
          verifyUrl: `/api/sports/decision/training/multi-sport-live-operation-queue?sport=${queue.target.sport}&date=${queue.target.targetDate}`,
          expectedEvidence: "Operation queue reflects the latest read-only proof while write, train, publish, and stake controls remain locked."
        }
      : operation
        ? {
            label: runRequested ? "Retry selected read-only proof" : `Run ${operation.label}`,
            verifyUrl: operation.verifyUrl,
            expectedEvidence: operation.expectedEvidence
          }
        : {
            label: "Repair multi-sport live queue",
            verifyUrl: `/api/sports/decision/training/multi-sport-live-operation-queue?sport=${queue.target.sport}&date=${queue.target.targetDate}`,
            expectedEvidence: "Queue exposes at least one safe read-only operation."
          };

  return {
    mode: "multi-sport-live-operation-turn",
    generatedAt: now.toISOString(),
    status,
    turnHash: stableHash({
      status,
      queue: queue.queueHash,
      operation: operation ? [operation.id, operation.status, operation.safeToRun] : null,
      proofHash,
      runRequested
    }),
    summary:
      status === "observed"
        ? `Observed read-only proof for ${operation?.label ?? "selected operation"}; no side effects were allowed.`
        : status === "preview-ready"
          ? `Ready to observe read-only proof for ${operation?.label ?? "selected operation"}.`
          : status === "proof-failed"
            ? `Tried to observe ${operation?.label ?? "selected operation"}, but the proof route did not return a valid success envelope.`
            : "No safe read-only multi-sport live operation can run right now.",
    target: queue.target,
    queue: {
      status: queue.status,
      queueHash: queue.queueHash,
      nextOperationId: queue.nextOperation?.id ?? null
    },
    selectedOperation: operation,
    selectionReason: selected.reason,
    observation: {
      requested: runRequested,
      attempted,
      success: Boolean(proof),
      url: proofUrl,
      proofHash,
      proofSummary: proofSummary(proof),
      error
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedProof,
      requiresExplicitRunParam: true,
      canPreviewLiveFeatureRows: queue.controls.canPreviewLiveFeatureRows,
      canWriteLiveFeatureSnapshots: false,
      canFeedBacktestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    nextAction,
    proofUrls: unique([
      "/api/sports/decision/training/multi-sport-live-operation-turn",
      "/api/sports/decision/training/multi-sport-live-operation-queue",
      operation?.verifyUrl,
      ...queue.proofUrls
    ]),
    locks: unique([
      "Multi-sport operation turn can only observe read-only proof routes.",
      "run=1 is required before any proof observation is attempted.",
      "No storage write, training, threshold application, publishing, staking, or hidden chain-of-thought access is allowed.",
      ...queue.locks
    ])
  };
}
