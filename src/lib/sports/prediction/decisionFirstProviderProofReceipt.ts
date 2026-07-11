import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import type { DecisionFirstProviderProofRun } from "@/lib/sports/prediction/decisionFirstProviderProofRun";

type DecisionFirstProviderProofCandidateId = NonNullable<DecisionFirstProviderProofRun["selectedCandidate"]>["id"];

export type DecisionFirstProviderProofReceiptStatus =
  | "not-run"
  | "waiting-provider-env"
  | "waiting-admin-token"
  | "admin-blocked"
  | "proof-observed"
  | "provider-error"
  | "blocked";

export type DecisionFirstProviderProofReceiptObservation = {
  selectedCandidateId: DecisionFirstProviderProofCandidateId | null;
  mode: DecisionEplProviderDryRunReceipt["mode"] | DecisionEplOddsDryRunReceipt["mode"] | null;
  statusLabel: DecisionEplProviderDryRunReceipt["status"] | DecisionEplOddsDryRunReceipt["status"] | null;
  receiptHash: string | null;
  provider: "api-football" | "the-odds-api" | null;
  attempted: boolean;
  dryRun: boolean | null;
  normalizedRows: number;
  responseHash: string | null;
  signals: string[];
  error: string | null;
};

export type DecisionFirstProviderProofReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-first-provider-proof-receipt";
  status: DecisionFirstProviderProofReceiptStatus;
  receiptHash: string;
  summary: string;
  input: {
    runHash: string;
    runStatus: DecisionFirstProviderProofRun["status"];
    runRequested: boolean;
    selectedCandidateId: DecisionFirstProviderProofCandidateId | null;
  };
  observation: DecisionFirstProviderProofReceiptObservation;
  interpretation: {
    canAdvanceToStorageProof: boolean;
    nextProofUrl: string;
    evidenceUse: "storage-proof-review" | "provider-env-repair" | "admin-retry" | "operator-review" | "blocked";
    nextAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestSelectedDryRun: boolean;
    canReviewStorageProof: boolean;
    canExecuteShell: false;
    canWriteFixtures: false;
    canWriteOddsSnapshots: false;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
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

function unique(values: Array<string | null | undefined>, limit = 50): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function providerObservation(receipt: DecisionEplProviderDryRunReceipt): DecisionFirstProviderProofReceiptObservation {
  return {
    selectedCandidateId: "football-fixtures",
    mode: receipt.mode,
    statusLabel: receipt.status,
    receiptHash: receipt.receiptHash,
    provider: "api-football",
    attempted: receipt.observation.attempted,
    dryRun: receipt.observation.dryRun,
    normalizedRows: receipt.observation.normalized,
    responseHash: receipt.observation.responseHash,
    signals: receipt.observation.signals,
    error: receipt.observation.error
  };
}

function oddsObservation(receipt: DecisionEplOddsDryRunReceipt): DecisionFirstProviderProofReceiptObservation {
  return {
    selectedCandidateId: "odds-markets",
    mode: receipt.mode,
    statusLabel: receipt.status,
    receiptHash: receipt.receiptHash,
    provider: "the-odds-api",
    attempted: receipt.observation.attempted,
    dryRun: receipt.observation.dryRun,
    normalizedRows: receipt.observation.normalizedOddsRows,
    responseHash: receipt.observation.responseHash,
    signals: receipt.observation.signals,
    error: receipt.observation.error
  };
}

function emptyObservation(run: DecisionFirstProviderProofRun): DecisionFirstProviderProofReceiptObservation {
  return {
    selectedCandidateId: run.selectedCandidate?.id ?? null,
    mode: null,
    statusLabel: null,
    receiptHash: null,
    provider: run.selectedCandidate?.provider ?? null,
    attempted: false,
    dryRun: null,
    normalizedRows: 0,
    responseHash: null,
    signals: [],
    error: null
  };
}

function statusFor({
  run,
  observation,
  runRequested
}: {
  run: DecisionFirstProviderProofRun;
  observation: DecisionFirstProviderProofReceiptObservation;
  runRequested: boolean;
}): DecisionFirstProviderProofReceiptStatus {
  if (observation.statusLabel === "verified" && observation.normalizedRows > 0 && observation.dryRun === true) return "proof-observed";
  if (observation.statusLabel === "provider-error" || observation.statusLabel === "failed") return "provider-error";
  if (observation.statusLabel === "admin-blocked") return "admin-blocked";
  if (observation.statusLabel === "needs-admin-token" || run.status === "waiting-admin-token") return "waiting-admin-token";
  if (observation.statusLabel === "needs-provider" || observation.statusLabel === "needs-odds-key" || run.status === "waiting-provider-env") {
    return "waiting-provider-env";
  }
  if (!runRequested) return "not-run";
  return "blocked";
}

function summaryFor(status: DecisionFirstProviderProofReceiptStatus, observation: DecisionFirstProviderProofReceiptObservation): string {
  if (status === "proof-observed") return `First provider proof observed ${observation.normalizedRows} dry-run row(s) from ${observation.provider ?? "provider"}.`;
  if (status === "waiting-provider-env") return "First provider proof receipt is waiting on provider environment before a dry-run can be observed.";
  if (status === "waiting-admin-token") return "First provider proof receipt is waiting for ODDSPADI_ADMIN_TOKEN before an operator dry-run.";
  if (status === "admin-blocked") return "First provider proof was requested but blocked by missing or invalid x-oddspadi-admin-token.";
  if (status === "provider-error") return `First provider proof reached the provider path but returned an error: ${observation.error ?? "provider error"}.`;
  if (status === "blocked") return "First provider proof receipt is blocked by the selected proof readiness.";
  return "First provider proof receipt has not run the selected dry-run.";
}

function proofUrlFor(candidateId: DecisionFirstProviderProofCandidateId | null, run: DecisionFirstProviderProofRun): string {
  if (candidateId === "football-fixtures") return "/api/sports/decision/epl-provider-dry-run-receipt";
  if (candidateId === "odds-markets") return "/api/sports/decision/epl-odds-dry-run-receipt";
  return run.selectedCandidate?.proofUrl ?? "/api/sports/decision/first-provider-proof-run";
}

function nextProofFor(
  status: DecisionFirstProviderProofReceiptStatus,
  run: DecisionFirstProviderProofRun,
  candidateId: DecisionFirstProviderProofCandidateId | null
): DecisionFirstProviderProofReceipt["interpretation"] {
  if (status === "proof-observed") {
    return {
      canAdvanceToStorageProof: true,
      nextProofUrl: candidateId === "odds-markets" ? "/api/sports/decision/odds-snapshot-storage-readiness" : "/api/sports/decision/epl-provider-dry-run-interpreter",
      evidenceUse: "storage-proof-review",
      nextAction: "Review storage/schema readiness with the observed dry-run hash; do not write provider rows yet."
    };
  }
  if (status === "waiting-provider-env") {
    return {
      canAdvanceToStorageProof: false,
      nextProofUrl: "/api/sports/decision/provider-key-activation-receipt",
      evidenceUse: "provider-env-repair",
      nextAction: "Configure the missing provider env names, restart localhost, then re-run the first provider proof selector."
    };
  }
  if (status === "waiting-admin-token" || status === "admin-blocked") {
    return {
      canAdvanceToStorageProof: false,
      nextProofUrl: proofUrlFor(candidateId, run),
      evidenceUse: "admin-retry",
      nextAction: "Retry only with a valid x-oddspadi-admin-token header and keep dryRun=true."
    };
  }
  return {
    canAdvanceToStorageProof: false,
    nextProofUrl: run.nextTurn.url,
    evidenceUse: status === "not-run" ? "operator-review" : "blocked",
    nextAction: status === "not-run" ? "Inspect the selected dry-run route; execution requires run=1 and admin authorization." : "Repair the selected provider proof blocker."
  };
}

export function buildDecisionFirstProviderProofReceipt({
  run,
  eplProviderDryRunReceipt,
  eplOddsDryRunReceipt,
  selectedCandidateId = run.selectedCandidate?.id ?? null,
  runRequested = false,
  now = new Date()
}: {
  run: DecisionFirstProviderProofRun;
  eplProviderDryRunReceipt?: DecisionEplProviderDryRunReceipt | null;
  eplOddsDryRunReceipt?: DecisionEplOddsDryRunReceipt | null;
  selectedCandidateId?: DecisionFirstProviderProofCandidateId | null;
  runRequested?: boolean;
  now?: Date;
}): DecisionFirstProviderProofReceipt {
  const observation =
    selectedCandidateId === "football-fixtures" && eplProviderDryRunReceipt
      ? providerObservation(eplProviderDryRunReceipt)
      : selectedCandidateId === "odds-markets" && eplOddsDryRunReceipt
        ? oddsObservation(eplOddsDryRunReceipt)
        : emptyObservation(run);
  const status = statusFor({ run, observation, runRequested });
  const interpretation = nextProofFor(status, run, selectedCandidateId);
  const receiptHash = stableHash({
    run: run.runHash,
    status,
    runRequested,
    observation: [observation.selectedCandidateId, observation.statusLabel, observation.receiptHash, observation.normalizedRows, observation.responseHash]
  });

  return {
    generatedAt: now.toISOString(),
    date: run.date,
    sport: "football",
    mode: "decision-first-provider-proof-receipt",
    status,
    receiptHash,
    summary: summaryFor(status, observation),
    input: {
      runHash: run.runHash,
      runStatus: run.status,
      runRequested,
      selectedCandidateId
    },
    observation,
    interpretation,
    controls: {
      canInspectReadOnly: true,
      canRequestSelectedDryRun: run.controls.canRunAdminDryRun,
      canReviewStorageProof: interpretation.canAdvanceToStorageProof,
      canExecuteShell: false,
      canWriteFixtures: false,
      canWriteOddsSnapshots: false,
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/first-provider-proof-receipt",
      "/api/sports/decision/first-provider-proof-run",
      run.selectedCandidate?.proofUrl,
      interpretation.nextProofUrl,
      eplProviderDryRunReceipt?.target.path,
      eplOddsDryRunReceipt?.target.path,
      ...run.proofUrls,
      ...(eplProviderDryRunReceipt?.proofUrls ?? []),
      ...(eplOddsDryRunReceipt?.proofUrls ?? [])
    ]),
    locks: unique([
      "First provider proof receipt observes one selected dry-run result; it cannot execute shell commands.",
      "A proof-observed receipt can advance only to storage/schema review.",
      "Provider row writes, odds snapshot writes, feature writes, training, probability changes, public picks, and staking remain locked.",
      ...run.locks,
      ...(eplProviderDryRunReceipt?.locks ?? []),
      ...(eplOddsDryRunReceipt?.locks ?? [])
    ])
  };
}
