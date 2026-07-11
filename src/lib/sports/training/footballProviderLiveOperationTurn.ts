import { fetchDecisionApiData, type DecisionInternalFetchOptions } from "@/lib/sports/prediction/decisionInternalFetch";
import type { FootballProviderLiveOperation, FootballProviderLiveOperationQueue } from "@/lib/sports/training/footballProviderLiveOperationQueue";

export type FootballProviderLiveOperationTurnStatus = "preview-ready" | "observed" | "blocked" | "proof-failed";

export type FootballProviderLiveOperationTurn = {
  mode: "football-provider-live-operation-turn";
  generatedAt: string;
  status: FootballProviderLiveOperationTurnStatus;
  turnHash: string;
  summary: string;
  target: FootballProviderLiveOperationQueue["target"];
  queue: {
    status: FootballProviderLiveOperationQueue["status"];
    queueHash: string;
    nextOperationId: string | null;
  };
  selectedOperation: FootballProviderLiveOperation | null;
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
    canRequestAIReview: boolean;
    canUseForMonitor: boolean;
    canWriteLiveFeatureSnapshots: boolean;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
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
  if (!value.startsWith("/api/sports/decision/training/football-provider-live-")) return false;
  const lower = value.toLowerCase();
  return !/[?&]run=1\b/.test(lower) && !/[?&]run=true\b/.test(lower) && !lower.includes("dryrun=0") && !lower.includes("dryrun=false") && !lower.includes("persist=1");
}

function selectOperation(queue: FootballProviderLiveOperationQueue): { operation: FootballProviderLiveOperation | null; reason: string } {
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
    reason: "No read-only live provider operation is currently safe to run."
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

export async function buildFootballProviderLiveOperationTurn({
  queue,
  runRequested = false,
  origin = "http://127.0.0.1:3025",
  fetchImpl,
  now = new Date()
}: {
  queue: FootballProviderLiveOperationQueue;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<FootballProviderLiveOperationTurn> {
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

  const status: FootballProviderLiveOperationTurnStatus = !operation || !canRunSelectedProof ? "blocked" : runRequested ? (proof ? "observed" : "proof-failed") : "preview-ready";
  const proofHash = proof ? stableHash(proof) : null;
  const nextAction =
    status === "observed"
      ? {
          label: "Inspect observed proof and refresh queue",
          verifyUrl: "/api/sports/decision/training/football-provider-live-operation-queue?date=2026-08-21",
          expectedEvidence: "Operation queue reflects the latest read-only proof while write, train, publish, and stake controls remain locked."
        }
      : operation
        ? {
            label: runRequested ? "Retry selected read-only proof" : `Run ${operation.label}`,
            verifyUrl: operation.verifyUrl,
            expectedEvidence: operation.expectedEvidence
          }
        : {
            label: "Repair live provider queue",
            verifyUrl: "/api/sports/decision/training/football-provider-live-operation-queue?date=2026-08-21",
            expectedEvidence: "Queue exposes at least one safe read-only operation."
          };

  return {
    mode: "football-provider-live-operation-turn",
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
            : "No safe read-only live provider operation can run right now.",
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
      canRequestAIReview: queue.controls.canRequestAIReview,
      canUseForMonitor: queue.controls.canUseForMonitor,
      canWriteLiveFeatureSnapshots: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    nextAction,
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-operation-turn",
      "/api/sports/decision/training/football-provider-live-operation-queue",
      operation?.verifyUrl,
      ...queue.proofUrls
    ]),
    locks: unique([
      "Live operation turn can only observe read-only live-provider proof routes.",
      "run=1 is required before any proof observation is attempted.",
      "No write, persistence, training, publishing, staking, or hidden chain-of-thought access is allowed.",
      ...queue.locks
    ])
  };
}
