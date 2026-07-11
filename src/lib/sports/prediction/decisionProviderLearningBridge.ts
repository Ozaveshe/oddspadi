import type { ApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";
import type { ProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import type { Sport } from "@/lib/sports/types";

export type DecisionProviderLearningBridgeStatus =
  | "historical-proof-ready"
  | "ready-historical-dry-run"
  | "future-season-ready"
  | "waiting-admin-run"
  | "waiting-provider-key"
  | "provider-error"
  | "safe-hold";

export type DecisionProviderLearningBridge = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-provider-learning-bridge";
  status: DecisionProviderLearningBridgeStatus;
  bridgeHash: string;
  summary: string;
  provider: "api-football";
  entitlement: {
    status: ApiFootballEntitlementProbe["status"];
    futureSeason: string;
    futureSignal: ApiFootballEntitlementProbe["currentSeason"]["entitlementSignal"];
    futureReason: string | null;
    historicalAccessible: number;
    selectedHistoricalSeason: string | null;
  };
  dryRun: {
    requested: boolean;
    adminAuthorized: boolean;
    status: ProviderCorpusDryRunQueue["status"] | "not-run";
    selectedJobId: string | null;
    fetched: number;
    normalized: number;
    passed: number;
    failed: number;
    verifyUrl: string | null;
    command: string | null;
  };
  learningImpact: {
    canInformFeatureDesign: boolean;
    canUseForTraining: false;
    confidenceEffect: "evidence-added" | "waiting-proof" | "blocked";
    evidenceDebtDelta: number;
    nextAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunHistoricalDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFor(entitlement: ApiFootballEntitlementProbe, providerQueue: ProviderCorpusDryRunQueue | null): DecisionProviderLearningBridgeStatus {
  if (entitlement.status === "missing-provider-key") return "waiting-provider-key";
  if (entitlement.status === "admin-required") return "waiting-admin-run";
  if (providerQueue?.status === "provider-error" || entitlement.status === "provider-error") return "provider-error";
  if (providerQueue?.status === "dry-run-passed" && providerQueue.totals.normalized > 0) return "historical-proof-ready";
  if (entitlement.status === "historical-fallback-ready" && entitlement.providerCorpusDryRun.ready) return "ready-historical-dry-run";
  if (entitlement.status === "future-season-ready") return "future-season-ready";
  if (entitlement.status === "ready-admin-run") return "waiting-admin-run";
  return "safe-hold";
}

function summaryFor(status: DecisionProviderLearningBridgeStatus, normalized: number, selectedSeason: string | null): string {
  if (status === "historical-proof-ready") {
    return `Provider learning bridge has read-only EPL ${selectedSeason ?? "historical"} dry-run proof with ${normalized} normalized sample row(s); storage and training remain locked.`;
  }
  if (status === "ready-historical-dry-run") return `Provider learning bridge can run an accessible EPL ${selectedSeason ?? "historical"} fallback season before the 2026 paid entitlement is upgraded.`;
  if (status === "future-season-ready") return "Provider learning bridge can inspect future EPL fixtures in read-only mode.";
  if (status === "waiting-provider-key") return "Provider learning bridge is waiting for API-Football/APISports credentials.";
  if (status === "waiting-admin-run") return "Provider learning bridge is waiting for a supervised run=1 admin-authorized provider proof.";
  if (status === "provider-error") return "Provider learning bridge hit provider errors that need repair before evidence can enter the reasoning loop.";
  return "Provider learning bridge is in safe hold.";
}

function nextActionFor(status: DecisionProviderLearningBridgeStatus, selectedSeason: string | null): string {
  if (status === "historical-proof-ready") return "Use this dry-run proof to design feature materialization and storage receipts; do not train until Supabase write/read receipts pass.";
  if (status === "ready-historical-dry-run") return `Run the EPL ${selectedSeason ?? "historical"} provider corpus dry-run with run=1 and the admin header.`;
  if (status === "future-season-ready") return "Run the EPL fixture map dry-run, then attach standings, availability, lineups, odds, and storage proof.";
  if (status === "waiting-provider-key") return "Set API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY.";
  if (status === "waiting-admin-run") return "Run the bridge with run=1 and x-oddspadi-admin-token.";
  return "Inspect entitlement and provider queue receipts before letting this proof influence beliefs.";
}

export function buildDecisionProviderLearningBridge({
  date,
  sport,
  entitlementProbe,
  providerQueue = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  entitlementProbe: ApiFootballEntitlementProbe;
  providerQueue?: ProviderCorpusDryRunQueue | null;
  now?: Date;
}): DecisionProviderLearningBridge {
  const selectedSeason = entitlementProbe.providerCorpusDryRun.season;
  const status = statusFor(entitlementProbe, providerQueue);
  const normalized = providerQueue?.totals.normalized ?? 0;
  const fetched = providerQueue?.totals.fetched ?? 0;
  const canInformFeatureDesign = status === "historical-proof-ready";
  const verifyUrl = entitlementProbe.providerCorpusDryRun.verifyUrl;
  const command = entitlementProbe.providerCorpusDryRun.command;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-provider-learning-bridge",
    status,
    bridgeHash: stableHash({
      date,
      sport,
      entitlement: [entitlementProbe.status, entitlementProbe.currentSeason.entitlementSignal, selectedSeason],
      providerQueue: providerQueue ? [providerQueue.status, providerQueue.selectedJobId, providerQueue.totals] : null
    }),
    summary: summaryFor(status, normalized, selectedSeason),
    provider: "api-football",
    entitlement: {
      status: entitlementProbe.status,
      futureSeason: entitlementProbe.currentSeason.season,
      futureSignal: entitlementProbe.currentSeason.entitlementSignal,
      futureReason: entitlementProbe.currentSeason.reason,
      historicalAccessible: entitlementProbe.totals.historicalAccessible,
      selectedHistoricalSeason: selectedSeason
    },
    dryRun: {
      requested: Boolean(providerQueue?.runRequested),
      adminAuthorized: Boolean(providerQueue?.adminAuthorized),
      status: providerQueue?.status ?? "not-run",
      selectedJobId: providerQueue?.selectedJobId ?? entitlementProbe.providerCorpusDryRun.jobId,
      fetched,
      normalized,
      passed: providerQueue?.totals.passed ?? 0,
      failed: providerQueue?.totals.failed ?? 0,
      verifyUrl,
      command
    },
    learningImpact: {
      canInformFeatureDesign,
      canUseForTraining: false,
      confidenceEffect: canInformFeatureDesign ? "evidence-added" : status === "provider-error" || status === "waiting-provider-key" ? "blocked" : "waiting-proof",
      evidenceDebtDelta: canInformFeatureDesign ? -12 : status === "ready-historical-dry-run" ? -4 : 0,
      nextAction: nextActionFor(status, selectedSeason)
    },
    controls: {
      canInspectReadOnly: true,
      canRunHistoricalDryRun: entitlementProbe.providerCorpusDryRun.ready && (!providerQueue?.runRequested || providerQueue.adminAuthorized),
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-learning-bridge",
      "/api/sports/decision/training/api-football-entitlement-probe",
      "/api/sports/decision/training/provider-corpus-dry-run-queue",
      verifyUrl,
      providerQueue?.nextJob?.verifyUrl
    ]),
    locks: [
      "Provider learning bridge is read-only and cannot write provider, training, decision, or public-pick rows.",
      "Historical dry-run proof may lower evidence debt for feature design only; it cannot train or promote models without Supabase storage receipts.",
      "Future 2026 EPL fixtures remain locked until API-Football/APISports entitlement proves access.",
      "Provider keys and admin tokens must never appear in this bridge."
    ]
  };
}
