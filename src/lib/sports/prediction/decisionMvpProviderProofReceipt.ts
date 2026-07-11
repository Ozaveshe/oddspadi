import type { DecisionLiveProviderProbeLane, DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";
import type { DecisionMvpProviderActivationChecklist } from "@/lib/sports/prediction/decisionMvpProviderActivationChecklist";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import type { DecisionMvpStorageCorpusGate } from "@/lib/sports/prediction/decisionMvpStorageCorpusGate";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProviderProofReceiptStatus =
  | "not-run"
  | "waiting-provider-key"
  | "waiting-admin-token"
  | "ready-dry-run"
  | "proof-observed"
  | "provider-warning"
  | "provider-error"
  | "blocked";

export type DecisionMvpProviderProofReceipt = {
  mode: "decision-mvp-provider-proof-receipt";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProviderProofReceiptStatus;
  receiptHash: string;
  summary: string;
  selected: {
    providerId: string | null;
    liveLaneId: DecisionLiveProviderProbeLane["id"] | null;
    label: string | null;
    provider: string | null;
    configured: boolean;
    adminTokenConfigured: boolean;
    adminAuthorized: boolean;
    runRequested: boolean;
    runAttempted: boolean;
  };
  observation: {
    syncStatus: DecisionLiveProviderProbeLane["result"]["syncStatus"] | null;
    fetched: number;
    normalized: number;
    endpoint: string | null;
    reason: string | null;
    proofHash: string;
  };
  interpretation: {
    canAdvanceToStorageReview: boolean;
    canAdvanceAnswerAuthority: false;
    nextProofUrl: string;
    nextAction: string;
    evidenceUse: "provider-env-repair" | "admin-run" | "storage-review" | "provider-repair" | "operator-review" | "blocked";
  };
  controls: {
    canInspectReadOnly: true;
    canRequestSelectedDryRun: boolean;
    canReviewStorageProof: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor({
  providerProofGate,
  lane,
  liveProviderProbeLedger
}: {
  providerProofGate: DecisionMvpProviderProofGate;
  lane: DecisionLiveProviderProbeLane | null;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
}): DecisionMvpProviderProofReceiptStatus {
  if (!providerProofGate.selected) return "blocked";
  if (lane?.status === "passed") return "proof-observed";
  if (lane?.status === "warning") return "provider-warning";
  if (lane?.status === "error") return "provider-error";
  if (providerProofGate.status === "ready-dry-run") return "ready-dry-run";
  if (providerProofGate.status === "waiting-admin-token" || lane?.status === "admin-required") return "waiting-admin-token";
  if (providerProofGate.status === "waiting-provider-env" || lane?.status === "missing-env") return "waiting-provider-key";
  if (!liveProviderProbeLedger.runRequested) return "not-run";
  return "blocked";
}

function summaryFor(status: DecisionMvpProviderProofReceiptStatus, lane: DecisionLiveProviderProbeLane | null): string {
  if (status === "proof-observed") return `${lane?.label ?? "Selected provider"} observed ${lane?.result.normalized ?? 0} normalized dry-run row(s); storage review is next.`;
  if (status === "ready-dry-run") return `${lane?.label ?? "Selected provider"} is ready for a run=1 admin dry-run receipt.`;
  if (status === "waiting-admin-token") return `${lane?.label ?? "Selected provider"} needs ODDSPADI_ADMIN_TOKEN before a dry-run can be observed.`;
  if (status === "waiting-provider-key") return `${lane?.label ?? "Selected provider"} is waiting on provider env before proof can run.`;
  if (status === "provider-warning") return `${lane?.label ?? "Selected provider"} returned dry-run evidence that needs operator review.`;
  if (status === "provider-error") return `${lane?.label ?? "Selected provider"} reached the provider path but failed.`;
  if (status === "not-run") return "Selected provider proof has not run; inspect the dry-run route before execution.";
  return "Selected provider proof receipt is blocked by provider proof readiness.";
}

function interpretationFor({
  status,
  lane,
  providerProofGate,
  storageCorpusGate
}: {
  status: DecisionMvpProviderProofReceiptStatus;
  lane: DecisionLiveProviderProbeLane | null;
  providerProofGate: DecisionMvpProviderProofGate;
  storageCorpusGate: DecisionMvpStorageCorpusGate;
}): DecisionMvpProviderProofReceipt["interpretation"] {
  if (status === "proof-observed") {
    return {
      canAdvanceToStorageReview: true,
      canAdvanceAnswerAuthority: false,
      nextProofUrl: storageCorpusGate.nextStep.proofUrl,
      nextAction: "Review storage/schema and corpus readiness with the observed dry-run hash; do not write provider rows yet.",
      evidenceUse: "storage-review"
    };
  }
  if (status === "waiting-provider-key") {
    return {
      canAdvanceToStorageReview: false,
      canAdvanceAnswerAuthority: false,
      nextProofUrl: "/api/sports/decision/mvp-provider-activation-checklist",
      nextAction: "Configure the selected provider env, mirror it in Netlify, restart localhost, then re-open this receipt.",
      evidenceUse: "provider-env-repair"
    };
  }
  if (status === "waiting-admin-token" || status === "ready-dry-run" || status === "not-run") {
    return {
      canAdvanceToStorageReview: false,
      canAdvanceAnswerAuthority: false,
      nextProofUrl: providerProofGate.selected?.runUrl ?? lane?.command ?? "/api/sports/decision/live-provider-probe-ledger?run=1",
      nextAction: "Run only the selected dry-run proof with run=1 and x-oddspadi-admin-token; inspect counts only.",
      evidenceUse: "admin-run"
    };
  }
  if (status === "provider-warning" || status === "provider-error") {
    return {
      canAdvanceToStorageReview: false,
      canAdvanceAnswerAuthority: false,
      nextProofUrl: lane?.command ? "/api/sports/decision/live-provider-probe-ledger" : "/api/sports/decision/mvp-provider-proof-gate",
      nextAction: lane?.nextAction ?? "Repair provider credentials, quota, request parameters, or normalization before trust can rise.",
      evidenceUse: "provider-repair"
    };
  }
  return {
    canAdvanceToStorageReview: false,
    canAdvanceAnswerAuthority: false,
    nextProofUrl: "/api/sports/decision/mvp-provider-proof-gate",
    nextAction: "Inspect provider proof readiness before execution.",
    evidenceUse: "blocked"
  };
}

export function buildDecisionMvpProviderProofReceipt({
  date,
  sport,
  providerProofGate,
  liveProviderProbeLedger,
  providerActivationChecklist,
  storageCorpusGate,
  answerAuthorityGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerProofGate: DecisionMvpProviderProofGate;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  providerActivationChecklist: DecisionMvpProviderActivationChecklist;
  storageCorpusGate: DecisionMvpStorageCorpusGate;
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  now?: Date;
}): DecisionMvpProviderProofReceipt {
  const selected = providerProofGate.selected;
  const lane = liveProviderProbeLedger.lanes.find((item) => item.id === selected?.liveLaneId) ?? null;
  const status = statusFor({ providerProofGate, lane, liveProviderProbeLedger });
  const interpretation = interpretationFor({ status, lane, providerProofGate, storageCorpusGate });
  const receiptHash = stableHash({
    date,
    sport,
    status,
    selected: selected ? [selected.providerId, selected.liveLaneId, selected.providerConfigured, selected.adminTokenConfigured] : null,
    ledger: [liveProviderProbeLedger.ledgerHash, liveProviderProbeLedger.runRequested, liveProviderProbeLedger.adminAuthorized],
    lane: lane ? [lane.id, lane.status, lane.result.syncStatus, lane.result.fetched, lane.result.normalized, lane.result.endpoint, lane.result.reason] : null,
    activation: [providerActivationChecklist.checklistHash, providerActivationChecklist.status],
    storage: [storageCorpusGate.gateHash, storageCorpusGate.status],
    authority: [answerAuthorityGate.authorityHash, answerAuthorityGate.status]
  });

  return {
    mode: "decision-mvp-provider-proof-receipt",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    receiptHash,
    summary: summaryFor(status, lane),
    selected: {
      providerId: selected?.providerId ?? null,
      liveLaneId: selected?.liveLaneId ?? null,
      label: selected?.label ?? null,
      provider: selected?.provider ?? null,
      configured: Boolean(selected?.providerConfigured),
      adminTokenConfigured: Boolean(selected?.adminTokenConfigured),
      adminAuthorized: liveProviderProbeLedger.adminAuthorized,
      runRequested: liveProviderProbeLedger.runRequested,
      runAttempted: Boolean(lane?.runAttempted)
    },
    observation: {
      syncStatus: lane?.result.syncStatus ?? null,
      fetched: lane?.result.fetched ?? 0,
      normalized: lane?.result.normalized ?? 0,
      endpoint: lane?.result.endpoint ?? null,
      reason: lane?.result.reason ?? null,
      proofHash: liveProviderProbeLedger.ledgerHash
    },
    interpretation,
    controls: {
      canInspectReadOnly: true,
      canRequestSelectedDryRun: providerProofGate.controls.canRunSelectedDryRun,
      canReviewStorageProof: interpretation.canAdvanceToStorageReview,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-provider-proof-receipt",
      "/api/sports/decision/live-provider-probe-ledger",
      "/api/sports/decision/mvp-provider-proof-gate",
      "/api/sports/decision/mvp-provider-activation-checklist",
      interpretation.nextProofUrl,
      selected?.runUrl,
      selected?.proofUrl,
      ...liveProviderProbeLedger.proofUrls,
      ...providerProofGate.proofUrls,
      ...providerActivationChecklist.proofUrls,
      ...storageCorpusGate.proofUrls,
      ...answerAuthorityGate.proofUrls
    ]),
    locks: unique([
      "MVP provider proof receipt observes read-only dry-run evidence only; it never executes shell commands itself.",
      "A proof-observed receipt can advance only to storage/schema review.",
      "Provider writes, decision persistence, training rows, model training, learned weights, probability edits, confidence upgrades, public picks, staking, and hidden chain-of-thought stay locked.",
      ...liveProviderProbeLedger.locks,
      ...providerProofGate.locks,
      ...providerActivationChecklist.locks,
      ...storageCorpusGate.locks,
      ...answerAuthorityGate.locks
    ])
  };
}
