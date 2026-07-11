import type { DecisionLiveProviderProbeLane, DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionMvpProviderSetupPacket, DecisionMvpProviderSetupStep } from "@/lib/sports/prediction/decisionMvpProviderSetupPacket";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProviderProofGateStatus =
  | "waiting-provider-env"
  | "waiting-admin-token"
  | "ready-dry-run"
  | "proof-observed"
  | "provider-warning"
  | "provider-error"
  | "blocked";

export type DecisionMvpProviderProofGate = {
  mode: "decision-mvp-provider-proof-gate";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProviderProofGateStatus;
  gateHash: string;
  summary: string;
  selected: {
    providerId: DecisionMvpProviderSetupStep["id"];
    liveLaneId: DecisionLiveProviderProbeLane["id"] | null;
    label: string;
    provider: string;
    providerConfigured: boolean;
    adminTokenConfigured: boolean;
    liveLaneStatus: DecisionLiveProviderProbeLane["status"] | null;
    requiredEnv: string[];
    missingEnv: string[];
    runUrl: string;
    proofUrl: string;
    command: string;
    safeToRunNow: boolean;
  } | null;
  acceptanceCriteria: string[];
  rejectionCriteria: string[];
  nextAction: {
    label: string;
    detail: string;
    proofUrl: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedDryRun: boolean;
    requiresRunParam: true;
    requiresAdminToken: true;
    canExecuteShell: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function liveLaneIdFor(providerId: DecisionMvpProviderSetupStep["id"]): DecisionLiveProviderProbeLane["id"] | null {
  if (providerId === "football-core") return "football-core";
  if (providerId === "odds-markets") return "football-odds";
  if (providerId === "basketball-core") return "basketball-core";
  if (providerId === "tennis-core") return "tennis-core";
  return null;
}

function selectedStep(setupPacket: DecisionMvpProviderSetupPacket, liveProviderProbeLedger: DecisionLiveProviderProbeLedger): DecisionMvpProviderSetupStep | null {
  const errorLane = liveProviderProbeLedger.lanes.find((lane) => lane.status === "error");
  const errorStep = errorLane ? setupPacket.steps.find((step) => liveLaneIdFor(step.id) === errorLane.id) : null;
  const passedLane = liveProviderProbeLedger.lanes.find((lane) => lane.status === "passed");
  const passedStep = passedLane ? setupPacket.steps.find((step) => liveLaneIdFor(step.id) === passedLane.id) : null;
  return (
    errorStep ??
    passedStep ??
    setupPacket.steps.find((step) => {
      const liveLaneId = liveLaneIdFor(step.id);
      const liveLane = liveProviderProbeLedger.lanes.find((lane) => lane.id === liveLaneId);
      return step.critical && step.status === "configured" && liveLane?.status !== "passed";
    }) ??
    setupPacket.steps.find((step) => step.critical && step.status !== "configured") ??
    setupPacket.steps.find((step) => step.status !== "configured") ??
    setupPacket.steps.find((step) => {
      const liveLaneId = liveLaneIdFor(step.id);
      const liveLane = liveProviderProbeLedger.lanes.find((lane) => lane.id === liveLaneId);
      return step.critical && liveLane?.status !== "passed";
    }) ??
    setupPacket.steps[0] ??
    null
  );
}

function statusFor({
  step,
  liveLane,
  adminTokenConfigured
}: {
  step: DecisionMvpProviderSetupStep | null;
  liveLane: DecisionLiveProviderProbeLane | null;
  adminTokenConfigured: boolean;
}): DecisionMvpProviderProofGateStatus {
  if (!step) return "blocked";
  if (liveLane?.status === "error") return "provider-error";
  if (liveLane?.status === "warning") return "provider-warning";
  if (liveLane?.status === "passed") return "proof-observed";
  if (step.status !== "configured") return "waiting-provider-env";
  if (!adminTokenConfigured || liveLane?.status === "admin-required") return "waiting-admin-token";
  if (liveLane?.configured) return "ready-dry-run";
  return "blocked";
}

function summaryFor(status: DecisionMvpProviderProofGateStatus, selected: DecisionMvpProviderProofGate["selected"]): string {
  if (status === "proof-observed") return `${selected?.label ?? "Selected provider proof"} has observed dry-run rows; move only to storage/schema review.`;
  if (status === "ready-dry-run") return `${selected?.label ?? "Selected provider proof"} is ready for an admin-authorized dry-run proof.`;
  if (status === "waiting-admin-token") return `${selected?.label ?? "Selected provider proof"} has provider env but still needs ODDSPADI_ADMIN_TOKEN for run=1 proof.`;
  if (status === "provider-warning") return `${selected?.label ?? "Selected provider proof"} returned provider evidence that needs operator review before trust can rise.`;
  if (status === "provider-error") return `${selected?.label ?? "Selected provider proof"} reached the provider path but failed.`;
  if (status === "waiting-provider-env") return `${selected?.label ?? "Selected provider proof"} is waiting on provider env before live proof can run.`;
  return "Provider proof gate is blocked because no provider setup step can be selected.";
}

function nextActionFor(status: DecisionMvpProviderProofGateStatus, selected: DecisionMvpProviderProofGate["selected"]): DecisionMvpProviderProofGate["nextAction"] {
  if (status === "ready-dry-run") {
    return {
      label: `Run ${selected?.label ?? "provider"} dry-run proof`,
      detail: "Use run=1 with x-oddspadi-admin-token; inspect fetched and normalized counts only.",
      proofUrl: selected?.runUrl ?? "/api/sports/decision/live-provider-probe-ledger?run=1"
    };
  }
  if (status === "proof-observed") {
    return {
      label: "Review storage proof, still no writes",
      detail: "Provider dry-run rows can only advance to storage/schema readiness review; probabilities and public actions stay unchanged.",
      proofUrl: "/api/sports/decision/storage-activation-checklist"
    };
  }
  if (status === "waiting-admin-token") {
    return {
      label: "Configure admin proof token",
      detail: "Set ODDSPADI_ADMIN_TOKEN server-side, restart localhost, then run only the selected dry-run proof with the admin header.",
      proofUrl: selected?.proofUrl ?? "/api/sports/decision/live-provider-probe-ledger"
    };
  }
  if (status === "waiting-provider-env") {
    return {
      label: `Configure ${selected?.requiredEnv[0] ?? "provider key"}`,
      detail: "Save the provider key manually in .env.local and Netlify, restart localhost, then return to this proof gate.",
      proofUrl: "/api/sports/decision/mvp-provider-setup-packet"
    };
  }
  return {
    label: "Inspect provider proof result",
    detail: selected?.liveLaneStatus === "error" ? "Repair provider credentials, quota, request parameters, or response normalization." : "Review provider warnings before any trust change.",
    proofUrl: selected?.proofUrl ?? "/api/sports/decision/live-provider-probe-ledger"
  };
}

export function buildDecisionMvpProviderProofGate({
  date,
  sport,
  setupPacket,
  liveProviderProbeLedger,
  adminTokenConfigured,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  setupPacket: DecisionMvpProviderSetupPacket;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  adminTokenConfigured: boolean;
  now?: Date;
}): DecisionMvpProviderProofGate {
  const step = selectedStep(setupPacket, liveProviderProbeLedger);
  const liveLaneId = step ? liveLaneIdFor(step.id) : null;
  const liveLane = liveProviderProbeLedger.lanes.find((lane) => lane.id === liveLaneId) ?? null;
  const runUrl = `/api/sports/decision/live-provider-probe-ledger?date=${date}&sport=${sport}&run=1`;
  const selected = step
    ? {
        providerId: step.id,
        liveLaneId,
        label: step.label,
        provider: step.provider,
        providerConfigured: step.status === "configured",
        adminTokenConfigured,
        liveLaneStatus: liveLane?.status ?? null,
        requiredEnv: step.acceptedEnvNames,
        missingEnv: step.status === "configured" ? [] : step.acceptedEnvNames,
        runUrl,
        proofUrl: liveLane?.command ? "/api/sports/decision/live-provider-probe-ledger" : step.proofUrl,
        command: liveLane?.command ?? `GET ${runUrl} with x-oddspadi-admin-token`,
        safeToRunNow: step.status === "configured" && adminTokenConfigured && Boolean(liveLane?.configured)
      }
    : null;
  const status = statusFor({ step, liveLane, adminTokenConfigured });

  return {
    mode: "decision-mvp-provider-proof-gate",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    gateHash: stableHash({
      date,
      sport,
      status,
      setup: [setupPacket.setupHash, setupPacket.status],
      live: [liveProviderProbeLedger.ledgerHash, liveProviderProbeLedger.status],
      selected: selected ? [selected.providerId, selected.liveLaneId, selected.providerConfigured, selected.adminTokenConfigured, selected.liveLaneStatus] : null
    }),
    summary: summaryFor(status, selected),
    selected,
    acceptanceCriteria: [
      "Provider dry-run request keeps dryRun=true.",
      "run=1 is paired with x-oddspadi-admin-token; the token value is never returned.",
      "Provider result reports fetched and normalized counts greater than zero.",
      "Provider response has a receipt/hash or endpoint evidence for operator review.",
      "The proof result does not write provider rows, odds snapshots, training rows, or public predictions."
    ],
    rejectionCriteria: [
      "Missing provider env names or setup placeholders remain.",
      "ODDSPADI_ADMIN_TOKEN is missing or the admin header is not authorized.",
      "Provider returns quota, auth, request-parameter, or normalization errors.",
      "Normalized row count is zero for the selected proof.",
      "Any path attempts storage writes, training, probability changes, publishing, or staking."
    ],
    nextAction: nextActionFor(status, selected),
    controls: {
      canInspectReadOnly: true,
      canRunSelectedDryRun: status === "ready-dry-run",
      requiresRunParam: true,
      requiresAdminToken: true,
      canExecuteShell: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-provider-proof-gate",
      "/api/sports/decision/live-provider-probe-ledger",
      "/api/sports/decision/first-provider-proof-run",
      "/api/sports/decision/first-provider-proof-receipt",
      selected?.runUrl,
      selected?.proofUrl,
      ...setupPacket.proofUrls,
      ...liveProviderProbeLedger.proofUrls
    ]),
    locks: [
      "MVP provider proof gate never returns provider keys or admin token values.",
      "The selected proof can only run as a dry-run and cannot write provider rows, snapshots, or training rows.",
      "Observed provider rows can move only to storage/schema review; they cannot adjust probabilities, confidence, public picks, or stake.",
      ...setupPacket.locks,
      ...liveProviderProbeLedger.locks
    ]
  };
}
