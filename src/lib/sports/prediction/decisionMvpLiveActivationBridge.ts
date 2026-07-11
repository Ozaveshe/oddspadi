import type { DecisionLiveProviderProbeLane, DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpLiveActivationBridgeStatus =
  | "waiting-football-key"
  | "waiting-odds-key"
  | "waiting-admin-token"
  | "ready-football-dry-run"
  | "ready-odds-dry-run"
  | "ready-storage-review"
  | "provider-warning"
  | "provider-error"
  | "blocked";

export type DecisionMvpLiveActivationBridgeStepStatus = "pass" | "ready" | "waiting" | "locked" | "block";
export type DecisionMvpLiveActivationBridgeStepId =
  | "football-key"
  | "odds-key"
  | "admin-token"
  | "football-dry-run"
  | "odds-dry-run"
  | "storage-review";

export type DecisionMvpLiveActivationBridge = {
  mode: "decision-mvp-live-activation-bridge";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpLiveActivationBridgeStatus;
  bridgeHash: string;
  summary: string;
  minimum: {
    status: DecisionProviderEnvDiagnostic["footballMvpMinimum"]["status"];
    nextMissingEnvName: string | null;
    lanes: Array<{
      id: "football-core" | "football-odds";
      label: string;
      provider: string;
      configured: boolean;
      laneStatus: DecisionLiveProviderProbeLane["status"] | null;
      requiredEnv: string[];
      localEnvLine: string;
      getKeyUrl: string;
      docsUrl: string;
      unlocks: string;
    }>;
  };
  nextRun: {
    laneId: "football-core" | "football-odds" | null;
    label: string;
    command: string | null;
    proofUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  steps: Array<{
    id: DecisionMvpLiveActivationBridgeStepId;
    label: string;
    status: DecisionMvpLiveActivationBridgeStepStatus;
    detail: string;
    proofUrl: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canRunNextDryRun: boolean;
    requiresRunParam: true;
    requiresAdminToken: true;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
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
  footballLane,
  oddsLane,
  adminTokenConfigured
}: {
  footballLane: DecisionLiveProviderProbeLane | null;
  oddsLane: DecisionLiveProviderProbeLane | null;
  adminTokenConfigured: boolean;
}): DecisionMvpLiveActivationBridgeStatus {
  if (!footballLane || !oddsLane) return "blocked";
  if (footballLane.status === "error" || oddsLane.status === "error") return "provider-error";
  if (footballLane.status === "warning" || oddsLane.status === "warning") return "provider-warning";
  if (!footballLane.configured) return "waiting-football-key";
  if (!oddsLane.configured) return "waiting-odds-key";
  if (!adminTokenConfigured) return "waiting-admin-token";
  if (footballLane.status !== "passed") return "ready-football-dry-run";
  if (oddsLane.status !== "passed") return "ready-odds-dry-run";
  return "ready-storage-review";
}

function summaryFor(status: DecisionMvpLiveActivationBridgeStatus): string {
  if (status === "ready-storage-review") return "Football fixtures and odds dry-run evidence are observed; the next move is storage/schema review only.";
  if (status === "ready-football-dry-run") return "Provider keys and admin token are present; run the football fixtures dry-run before odds proof.";
  if (status === "ready-odds-dry-run") return "Football fixture proof is observed; run the bookmaker odds dry-run next.";
  if (status === "waiting-admin-token") return "Football and odds keys are present, but ODDSPADI_ADMIN_TOKEN is still needed before dry-run proof.";
  if (status === "waiting-odds-key") return "Football key is ready, but the bookmaker odds key is still required for value/EV proof.";
  if (status === "waiting-football-key") return "The MVP live bridge is waiting for the football provider key before fixture proof can run.";
  if (status === "provider-warning") return "A provider proof returned evidence that needs operator review before trust can rise.";
  if (status === "provider-error") return "A provider proof failed; repair credentials, quota, request parameters, or normalization before continuing.";
  return "The MVP live bridge cannot select both football and odds proof lanes.";
}

function stepStatus({
  id,
  status,
  footballLane,
  oddsLane,
  adminTokenConfigured
}: {
  id: DecisionMvpLiveActivationBridgeStepId;
  status: DecisionMvpLiveActivationBridgeStatus;
  footballLane: DecisionLiveProviderProbeLane | null;
  oddsLane: DecisionLiveProviderProbeLane | null;
  adminTokenConfigured: boolean;
}): DecisionMvpLiveActivationBridgeStepStatus {
  if (status === "provider-error" || status === "blocked") return id === "storage-review" ? "block" : "locked";
  if (id === "football-key") return footballLane?.configured ? "pass" : "waiting";
  if (id === "odds-key") return oddsLane?.configured ? "pass" : footballLane?.configured ? "waiting" : "locked";
  if (id === "admin-token") return adminTokenConfigured ? "pass" : footballLane?.configured && oddsLane?.configured ? "waiting" : "locked";
  if (id === "football-dry-run") {
    if (footballLane?.status === "passed") return "pass";
    return status === "ready-football-dry-run" ? "ready" : "locked";
  }
  if (id === "odds-dry-run") {
    if (oddsLane?.status === "passed") return "pass";
    return status === "ready-odds-dry-run" ? "ready" : "locked";
  }
  return status === "ready-storage-review" ? "ready" : "locked";
}

function laneMetadata(lane: DecisionLiveProviderProbeLane | null, fallback: "football-core" | "football-odds") {
  if (fallback === "football-core") {
    return {
      id: fallback,
      label: lane?.label ?? "Football fixtures and context",
      provider: lane?.provider ?? "api-football",
      configured: Boolean(lane?.configured),
      laneStatus: lane?.status ?? null,
      requiredEnv: lane?.requiredEnv ?? ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      localEnvLine: "API_FOOTBALL_KEY=paste_api_football_key_here",
      getKeyUrl: "https://dashboard.api-football.com/",
      docsUrl: "https://www.api-football.com/documentation-v3",
      unlocks: lane?.unlocks ?? "Fixtures, historical results, standings, lineups, live scores, and match events."
    };
  }
  return {
    id: fallback,
    label: lane?.label ?? "Football bookmaker odds",
    provider: lane?.provider ?? "the-odds-api",
    configured: Boolean(lane?.configured),
    laneStatus: lane?.status ?? null,
    requiredEnv: lane?.requiredEnv ?? ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    localEnvLine: "THE_ODDS_API_KEY=paste_the_odds_api_key_here",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    unlocks: lane?.unlocks ?? "Bookmaker prices for implied probability, no-vig edge, expected value, and market movement."
  };
}

export function buildDecisionMvpLiveActivationBridge({
  date,
  sport,
  providerEnvDiagnostic,
  liveProviderProbeLedger,
  providerProofGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  providerProofGate: DecisionMvpProviderProofGate;
  now?: Date;
}): DecisionMvpLiveActivationBridge {
  const footballLane = liveProviderProbeLedger.lanes.find((lane) => lane.id === "football-core") ?? null;
  const oddsLane = liveProviderProbeLedger.lanes.find((lane) => lane.id === "football-odds") ?? null;
  const adminTokenConfigured = Boolean(providerProofGate.selected?.adminTokenConfigured);
  const status = statusFor({ footballLane, oddsLane, adminTokenConfigured });
  const selectedLane = status === "ready-odds-dry-run" ? oddsLane : status === "ready-football-dry-run" ? footballLane : null;
  const nextRun = {
    laneId: selectedLane?.id === "football-core" || selectedLane?.id === "football-odds" ? selectedLane.id : null,
    label: selectedLane ? `Run ${selectedLane.label} dry-run` : status === "ready-storage-review" ? "Review storage/schema evidence" : "Resolve MVP live bridge blocker",
    command: selectedLane?.command ?? null,
    proofUrl: selectedLane ? "/api/sports/decision/live-provider-probe-ledger" : "/api/sports/decision/mvp-live-activation-bridge",
    safeToRun: Boolean(selectedLane && adminTokenConfigured && selectedLane.configured && selectedLane.status !== "passed"),
    expectedEvidence: selectedLane
      ? "Provider dry-run returns fetched and normalized counts while writes, training, publishing, and staking remain locked."
      : status === "ready-storage-review"
        ? "Storage/schema review can inspect provider evidence hashes; no model authority changes yet."
        : "Missing key, admin token, or provider repair evidence must clear first."
  };
  const steps: DecisionMvpLiveActivationBridge["steps"] = [
    {
      id: "football-key",
      label: "Football key",
      status: stepStatus({ id: "football-key", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: "Add API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY locally and in Netlify.",
      proofUrl: "/api/sports/decision/provider-env-diagnostic"
    },
    {
      id: "odds-key",
      label: "Odds key",
      status: stepStatus({ id: "odds-key", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: "Add THE_ODDS_API_KEY or ODDS_API_KEY locally and in Netlify so EV and no-vig checks can use real bookmaker prices.",
      proofUrl: "/api/sports/decision/provider-env-diagnostic"
    },
    {
      id: "admin-token",
      label: "Admin token",
      status: stepStatus({ id: "admin-token", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: "Set ODDSPADI_ADMIN_TOKEN server-side; the bridge only shows the env-name requirement, never the token value.",
      proofUrl: "/api/sports/decision/mvp-provider-proof-gate"
    },
    {
      id: "football-dry-run",
      label: "Football fixture proof",
      status: stepStatus({ id: "football-dry-run", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: footballLane?.nextAction ?? "Run football fixture/context dry-run and inspect normalized rows.",
      proofUrl: "/api/sports/decision/live-provider-probe-ledger"
    },
    {
      id: "odds-dry-run",
      label: "Odds market proof",
      status: stepStatus({ id: "odds-dry-run", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: oddsLane?.nextAction ?? "Run bookmaker odds dry-run and inspect normalized odds events.",
      proofUrl: "/api/sports/decision/live-provider-probe-ledger"
    },
    {
      id: "storage-review",
      label: "Storage review",
      status: stepStatus({ id: "storage-review", status, footballLane, oddsLane, adminTokenConfigured }),
      detail: "Only after both provider dry-runs are observed, review Supabase/schema readiness before any persisted rows.",
      proofUrl: "/api/sports/decision/mvp-storage-corpus-gate"
    }
  ];

  return {
    mode: "decision-mvp-live-activation-bridge",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    bridgeHash: stableHash({
      date,
      sport,
      status,
      env: [
        providerEnvDiagnostic.footballMvpMinimum.status,
        providerEnvDiagnostic.footballMvpMinimum.nextMissingEnvName,
        providerEnvDiagnostic.footballMvpMinimum.configuredKeys,
        providerEnvDiagnostic.footballMvpMinimum.missingKeys
      ],
      providerGate: [providerProofGate.gateHash, providerProofGate.status, adminTokenConfigured],
      lanes: [footballLane, oddsLane].map((lane) => [lane?.id, lane?.configured, lane?.status, lane?.result.syncStatus, lane?.result.normalized])
    }),
    summary: summaryFor(status),
    minimum: {
      status: providerEnvDiagnostic.footballMvpMinimum.status,
      nextMissingEnvName: providerEnvDiagnostic.footballMvpMinimum.nextMissingEnvName,
      lanes: [laneMetadata(footballLane, "football-core"), laneMetadata(oddsLane, "football-odds")]
    },
    nextRun,
    steps,
    controls: {
      canInspectReadOnly: true,
      canRunNextDryRun: nextRun.safeToRun,
      requiresRunParam: true,
      requiresAdminToken: true,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-live-activation-bridge",
      "/api/sports/decision/provider-env-diagnostic",
      "/api/sports/decision/mvp-provider-proof-gate",
      "/api/sports/decision/live-provider-probe-ledger",
      "/api/sports/decision/mvp-storage-corpus-gate",
      ...liveProviderProbeLedger.proofUrls,
      ...providerProofGate.proofUrls,
      providerEnvDiagnostic.footballMvpMinimum.proofUrl
    ]),
    locks: unique([
      "MVP live activation bridge never reads, prints, writes, or validates plaintext provider keys or admin tokens.",
      "The bridge can select the next dry-run but cannot execute shell commands, write env files, write Netlify env, persist provider rows, train models, publish picks, stake, or adjust probabilities.",
      "Football fixture proof and odds proof are both required before storage/schema review.",
      ...liveProviderProbeLedger.locks,
      ...providerProofGate.locks
    ])
  };
}
