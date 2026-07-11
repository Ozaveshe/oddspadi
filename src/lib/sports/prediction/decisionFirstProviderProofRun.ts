import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import type { DecisionProviderActivationQueueReceipt } from "@/lib/sports/prediction/decisionProviderActivationQueueReceipt";
import type { DecisionProviderKeyActivationReceipt } from "@/lib/sports/prediction/decisionProviderKeyActivationReceipt";

export type DecisionFirstProviderProofRunStatus =
  | "waiting-provider-env"
  | "waiting-admin-token"
  | "ready-admin-dry-run"
  | "proof-observed"
  | "blocked";

export type DecisionFirstProviderProofCandidateStatus =
  | "waiting-provider-env"
  | "waiting-admin-token"
  | "ready-admin-dry-run"
  | "observed"
  | "blocked";

export type DecisionFirstProviderProofCandidate = {
  id: "football-fixtures" | "odds-markets";
  label: string;
  priority: number;
  status: DecisionFirstProviderProofCandidateStatus;
  provider: "api-football" | "the-odds-api";
  proofUrl: string;
  runUrl: string;
  requiredEnvNames: string[];
  configured: boolean;
  adminTokenConfigured: boolean;
  adminAuthorized: boolean;
  observedRows: number;
  writes: false;
  trains: false;
  stakes: false;
  expectedEvidence: string[];
  nextAction: string;
};

export type DecisionFirstProviderProofRun = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-first-provider-proof-run";
  status: DecisionFirstProviderProofRunStatus;
  runHash: string;
  summary: string;
  input: {
    keyReceiptHash: string;
    keyReceiptStatus: DecisionProviderKeyActivationReceipt["status"];
    providerReceiptHash: string;
    providerReceiptStatus: DecisionEplProviderDryRunReceipt["status"];
    oddsReceiptHash: string;
    oddsReceiptStatus: DecisionEplOddsDryRunReceipt["status"];
    queueReceiptStatus: DecisionProviderActivationQueueReceipt["status"];
  };
  selectedCandidate: DecisionFirstProviderProofCandidate | null;
  candidates: DecisionFirstProviderProofCandidate[];
  nextTurn: {
    label: string;
    url: string;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunAdminDryRun: boolean;
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

function candidateStatus({
  providerReady,
  adminReady,
  allowed,
  verified,
  blocked
}: {
  providerReady: boolean;
  adminReady: boolean;
  allowed: boolean;
  verified: boolean;
  blocked: boolean;
}): DecisionFirstProviderProofCandidateStatus {
  if (verified) return "observed";
  if (!providerReady) return "waiting-provider-env";
  if (!adminReady) return "waiting-admin-token";
  if (allowed) return "ready-admin-dry-run";
  return blocked ? "blocked" : "waiting-admin-token";
}

function fixtureCandidate(receipt: DecisionEplProviderDryRunReceipt): DecisionFirstProviderProofCandidate {
  const status = candidateStatus({
    providerReady: receipt.target.providerKeyConfigured,
    adminReady: receipt.target.adminTokenConfigured,
    allowed: receipt.target.allowed,
    verified: receipt.status === "verified",
    blocked: receipt.status === "blocked" || receipt.status === "failed" || receipt.status === "provider-error" || receipt.status === "rate-limited"
  });
  return {
    id: "football-fixtures",
    label: "EPL provider fixture dry-run",
    priority: 1,
    status,
    provider: "api-football",
    proofUrl: "/api/sports/decision/epl-provider-dry-run-receipt",
    runUrl: receipt.target.url,
    requiredEnvNames: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    configured: receipt.target.providerKeyConfigured,
    adminTokenConfigured: receipt.target.adminTokenConfigured,
    adminAuthorized: receipt.target.adminAuthorized,
    observedRows: receipt.observation.normalized,
    writes: false,
    trains: false,
    stakes: false,
    expectedEvidence: [
      "status is verified or dry-run",
      "provider is api-football",
      "league is 39 and season is 2026",
      "dryRun is true",
      "normalized fixture counts are non-zero before any storage write"
    ],
    nextAction:
      status === "ready-admin-dry-run"
        ? "Run the admin-authorized EPL provider dry-run receipt and inspect counts only."
        : status === "waiting-provider-env"
          ? "Configure API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY and restart."
          : status === "waiting-admin-token"
            ? "Set ODDSPADI_ADMIN_TOKEN and pass it only through the x-oddspadi-admin-token header when running the proof."
          : status === "observed"
            ? "Review normalized counts and move only to storage proof review."
            : receipt.status === "rate-limited"
              ? "Wait for API-Football throttle/quota backoff before rerunning a single admin dry-run."
              : "Repair the EPL provider dry-run blocker before execution."
  };
}

function oddsCandidate(receipt: DecisionEplOddsDryRunReceipt): DecisionFirstProviderProofCandidate {
  const status = candidateStatus({
    providerReady: receipt.target.oddsKeyConfigured,
    adminReady: receipt.target.adminTokenConfigured,
    allowed: receipt.target.allowed,
    verified: receipt.status === "verified",
    blocked: receipt.status === "market-map-blocked" || receipt.status === "failed" || receipt.status === "provider-error"
  });
  return {
    id: "odds-markets",
    label: "EPL odds market dry-run",
    priority: 2,
    status,
    provider: "the-odds-api",
    proofUrl: "/api/sports/decision/epl-odds-dry-run-receipt",
    runUrl: receipt.target.url,
    requiredEnvNames: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    configured: receipt.target.oddsKeyConfigured,
    adminTokenConfigured: receipt.target.adminTokenConfigured,
    adminAuthorized: receipt.target.adminAuthorized,
    observedRows: receipt.observation.normalizedOddsRows,
    writes: false,
    trains: false,
    stakes: false,
    expectedEvidence: [
      "status is verified or dry-run",
      "provider is the-odds-api",
      "sport key is soccer_epl",
      "dryRun is true",
      "normalized odds row counts are non-zero before any odds snapshot write"
    ],
    nextAction:
      status === "ready-admin-dry-run"
        ? "Run the admin-authorized EPL odds dry-run receipt and inspect odds-row counts only."
        : status === "waiting-provider-env"
          ? "Configure THE_ODDS_API_KEY or ODDS_API_KEY and restart."
          : status === "waiting-admin-token"
            ? "Set ODDSPADI_ADMIN_TOKEN and pass it only through the x-oddspadi-admin-token header when running the proof."
            : status === "observed"
              ? "Review odds-row counts and move only to odds snapshot storage readiness."
              : "Repair the EPL odds market-map blocker before execution."
  };
}

function statusFor({
  keyReceipt,
  candidates
}: {
  keyReceipt: DecisionProviderKeyActivationReceipt;
  candidates: DecisionFirstProviderProofCandidate[];
}): DecisionFirstProviderProofRunStatus {
  if (keyReceipt.status === "waiting-provider-env" || candidates.every((candidate) => candidate.status === "waiting-provider-env")) {
    return "waiting-provider-env";
  }
  if (candidates.some((candidate) => candidate.status === "observed")) return "proof-observed";
  if (candidates.some((candidate) => candidate.status === "ready-admin-dry-run")) return "ready-admin-dry-run";
  if (candidates.some((candidate) => candidate.status === "waiting-admin-token")) return "waiting-admin-token";
  return "blocked";
}

function summaryFor(status: DecisionFirstProviderProofRunStatus, selected: DecisionFirstProviderProofCandidate | null): string {
  if (status === "ready-admin-dry-run") return `First provider proof can run as an admin-authorized dry-run: ${selected?.label ?? "selected provider proof"}.`;
  if (status === "proof-observed") return `First provider proof has observed dry-run rows for ${selected?.label ?? "a provider lane"}; review storage proof next.`;
  if (status === "waiting-admin-token") return `First provider proof is waiting on admin authorization for ${selected?.label ?? "the selected provider lane"}.`;
  if (status === "waiting-provider-env") return `First provider proof is waiting on provider env for ${selected?.label ?? "football or odds provider"}.`;
  return `First provider proof is blocked by ${selected?.label ?? "provider proof readiness"}.`;
}

function selectedCandidate(candidates: DecisionFirstProviderProofCandidate[]): DecisionFirstProviderProofCandidate | null {
  return (
    candidates.find((candidate) => candidate.status === "observed") ??
    candidates.find((candidate) => candidate.status === "ready-admin-dry-run") ??
    candidates.find((candidate) => candidate.status === "waiting-provider-env") ??
    candidates.find((candidate) => candidate.status === "waiting-admin-token") ??
    candidates[0] ??
    null
  );
}

export function buildDecisionFirstProviderProofRun({
  keyActivationReceipt,
  eplProviderDryRunReceipt,
  eplOddsDryRunReceipt,
  providerActivationQueueReceipt,
  now = new Date()
}: {
  keyActivationReceipt: DecisionProviderKeyActivationReceipt;
  eplProviderDryRunReceipt: DecisionEplProviderDryRunReceipt;
  eplOddsDryRunReceipt: DecisionEplOddsDryRunReceipt;
  providerActivationQueueReceipt: DecisionProviderActivationQueueReceipt;
  now?: Date;
}): DecisionFirstProviderProofRun {
  const candidates = [fixtureCandidate(eplProviderDryRunReceipt), oddsCandidate(eplOddsDryRunReceipt)].sort((a, b) => a.priority - b.priority);
  const selected = selectedCandidate(candidates);
  const status = statusFor({ keyReceipt: keyActivationReceipt, candidates });
  const runHash = stableHash({
    keyReceipt: keyActivationReceipt.receiptHash,
    provider: [eplProviderDryRunReceipt.receiptHash, eplProviderDryRunReceipt.status],
    odds: [eplOddsDryRunReceipt.receiptHash, eplOddsDryRunReceipt.status],
    queue: providerActivationQueueReceipt.receiptHash,
    candidates: candidates.map((candidate) => [candidate.id, candidate.status, candidate.observedRows])
  });
  const canRunAdminDryRun = status === "ready-admin-dry-run" && Boolean(selected?.status === "ready-admin-dry-run");

  return {
    generatedAt: now.toISOString(),
    date: eplProviderDryRunReceipt.date,
    sport: "football",
    mode: "decision-first-provider-proof-run",
    status,
    runHash,
    summary: summaryFor(status, selected),
    input: {
      keyReceiptHash: keyActivationReceipt.receiptHash,
      keyReceiptStatus: keyActivationReceipt.status,
      providerReceiptHash: eplProviderDryRunReceipt.receiptHash,
      providerReceiptStatus: eplProviderDryRunReceipt.status,
      oddsReceiptHash: eplOddsDryRunReceipt.receiptHash,
      oddsReceiptStatus: eplOddsDryRunReceipt.status,
      queueReceiptStatus: providerActivationQueueReceipt.status
    },
    selectedCandidate: selected,
    candidates,
    nextTurn: {
      label: selected?.label ?? "Inspect provider proof readiness",
      url: selected?.runUrl ?? "/api/sports/decision/provider-key-activation-receipt",
      safeToRun: canRunAdminDryRun || status === "waiting-provider-env" || status === "waiting-admin-token",
      reason: selected?.nextAction ?? "Inspect the provider proof route before execution."
    },
    controls: {
      canInspectReadOnly: true,
      canRunAdminDryRun,
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
      "/api/sports/decision/first-provider-proof-run",
      keyActivationReceipt.nextProof.url,
      eplProviderDryRunReceipt.target.path,
      eplOddsDryRunReceipt.target.path,
      ...keyActivationReceipt.proofUrls,
      ...eplProviderDryRunReceipt.proofUrls,
      ...eplOddsDryRunReceipt.proofUrls,
      ...providerActivationQueueReceipt.proofUrls
    ]),
    locks: unique([
      "First provider proof run only selects an admin-authorized dry-run candidate; it does not execute shell commands.",
      "Provider calls must stay dryRun=true and require x-oddspadi-admin-token.",
      "Observed provider counts do not unlock storage writes, training, probability changes, public picks, or staking.",
      ...keyActivationReceipt.locks,
      ...eplProviderDryRunReceipt.locks,
      ...eplOddsDryRunReceipt.locks,
      ...providerActivationQueueReceipt.locks
    ])
  };
}
