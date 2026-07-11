import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { DecisionProviderIngestionEvidence, DecisionProviderIngestionSignal } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import type { TenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";

export type DecisionDataAuthorityStatus = "live-authorized" | "dry-run-ready" | "needs-provider-env" | "needs-supabase-proof" | "training-blocked" | "blocked";
export type DecisionDataAuthorityFamilyStatus =
  | "live-authorized"
  | "computed-shadow"
  | "dry-run-ready"
  | "needs-provider-env"
  | "needs-supabase-proof"
  | "training-blocked"
  | "blocked";
export type DecisionDataAuthorityUse = "allowed" | "shadow-only" | "dry-run-only" | "blocked";
export type DecisionDataAuthorityStepStatus = "ready" | "waiting" | "blocked";

export type DecisionDataAuthorityFamily = {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionDataAuthorityFamilyStatus;
  priority: DecisionProviderIngestionSignal["priority"];
  provider: string;
  liveDecisionUse: DecisionDataAuthorityUse;
  trainingUse: DecisionDataAuthorityUse;
  storageUse: DecisionDataAuthorityUse;
  affectedMatches: number;
  authorityScore: number;
  blockers: string[];
  missingEnv: string[];
  storageMissing: string[];
  storageTables: string[];
  command: string;
  verifyUrl: string;
  expectedEvidence: string;
  decisionImpact: string;
  modelImpact: string;
};

export type DecisionDataAuthorityStep = {
  id: string;
  label: string;
  status: DecisionDataAuthorityStepStatus;
  command: string | null;
  verifyUrl: string;
  expectedEvidence: string;
  blockedBy: string[];
};

export type DecisionDataAuthority = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "data-authority";
  status: DecisionDataAuthorityStatus;
  authorityHash: string;
  summary: string;
  trustScore: number;
  totals: {
    families: number;
    liveAuthorized: number;
    computedShadow: number;
    dryRunReady: number;
    needsProviderEnv: number;
    needsSupabaseProof: number;
    trainingBlocked: number;
    blocked: number;
  };
  input: {
    dataIntakeStatus: DecisionDataIntakeQueue["status"];
    providerIngestionStatus: DecisionProviderIngestionEvidence["status"];
    modelGovernanceStatus: DecisionModelGovernance["status"];
    supabaseIsolationStatus: DecisionSupabaseProjectIsolation["status"];
    containmentStatus: DecisionSupabaseContainmentPolicy["status"] | "not-evaluated";
    trainingStatus: TrainingDataSnapshot["status"];
    corpusStatus: TenYearFootballCorpusBackfillPlan["status"];
  };
  topFamily: DecisionDataAuthorityFamily | null;
  families: DecisionDataAuthorityFamily[];
  activationSteps: DecisionDataAuthorityStep[];
  decisionPolicy: {
    canUseProviderBackedLiveSignals: boolean;
    canUseComputedSignals: boolean;
    canUseMockSignals: false;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    publicDecisionCeiling: "consider-disabled" | "monitor-only" | "avoid-only";
    reason: string;
  };
  nextCommand: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canRunReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function priorityWeight(priority: DecisionProviderIngestionSignal["priority"]): number {
  if (priority === "critical") return 24;
  if (priority === "high") return 18;
  if (priority === "medium") return 12;
  return 6;
}

function safeDryRun(command: string): boolean {
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && lower.includes("dryrun=1") && !lower.includes("dryrun=0") && !lower.includes("persist=1") && !lower.includes("publish=1");
}

function familyStatus({
  signal,
  dataIntake,
  governance,
  supabaseIsolation,
  containmentPolicy,
  training
}: {
  signal: DecisionProviderIngestionSignal;
  dataIntake: DecisionDataIntakeQueue;
  governance: DecisionModelGovernance;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  training: TrainingDataSnapshot;
}): DecisionDataAuthorityFamilyStatus {
  const containedDryRun = Boolean(containmentPolicy?.controls.canRunProviderDryRun);
  if (supabaseIsolation.status.startsWith("blocked") && !containedDryRun) return "blocked";
  if (signal.status === "blocked") return "blocked";
  if (signal.status === "needs-env") return "needs-provider-env";
  if (signal.status === "needs-supabase-proof") return "needs-supabase-proof";
  if (signal.status === "ready") return "dry-run-ready";
  if (governance.status === "blocked" || training.status === "failed" || dataIntake.status === "blocked") return "training-blocked";
  if (signal.status === "watch") return "computed-shadow";
  return governance.status === "approved" && supabaseIsolation.status === "ready-isolated" ? "live-authorized" : "computed-shadow";
}

function useFor(status: DecisionDataAuthorityFamilyStatus, target: "live" | "training" | "storage"): DecisionDataAuthorityUse {
  if (status === "live-authorized") return "allowed";
  if (status === "dry-run-ready") return target === "live" ? "shadow-only" : "dry-run-only";
  if (status === "computed-shadow") return target === "live" ? "shadow-only" : "blocked";
  return "blocked";
}

function blockersFor({
  status,
  signal,
  governance,
  supabaseIsolation,
  containmentPolicy,
  training
}: {
  status: DecisionDataAuthorityFamilyStatus;
  signal: DecisionProviderIngestionSignal;
  governance: DecisionModelGovernance;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  training: TrainingDataSnapshot;
}): string[] {
  if (status === "live-authorized" || status === "computed-shadow" || status === "dry-run-ready") return [];
  return unique([
    ...signal.missingEnv,
    ...signal.storageMissing,
    supabaseIsolation.status.startsWith("blocked") && !containmentPolicy?.controls.canRunProviderDryRun ? supabaseIsolation.summary : null,
    supabaseIsolation.status.startsWith("blocked") && containmentPolicy?.controls.canRunProviderDryRun ? containmentPolicy.summary : null,
    governance.status === "blocked" ? governance.summary : null,
    training.status === "failed" ? training.reason ?? training.readiness.detail : null
  ]);
}

function family({
  signal,
  dataIntake,
  governance,
  supabaseIsolation,
  containmentPolicy,
  training
}: {
  signal: DecisionProviderIngestionSignal;
  dataIntake: DecisionDataIntakeQueue;
  governance: DecisionModelGovernance;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  training: TrainingDataSnapshot;
}): DecisionDataAuthorityFamily {
  const status = familyStatus({ signal, dataIntake, governance, supabaseIsolation, containmentPolicy, training });
  const blockerCount = signal.missingEnv.length + signal.storageMissing.length + (status === "blocked" ? 3 : 0);
  const authorityScore = clamp(
    priorityWeight(signal.priority) +
      (signal.status === "ready" ? 40 : signal.status === "watch" ? 22 : 0) +
      (supabaseIsolation.status === "ready-isolated" ? 18 : containmentPolicy?.controls.canRunProviderDryRun ? 10 : 0) +
      (governance.status === "approved" ? 18 : governance.status === "shadow" ? 8 : 0) -
      blockerCount * 7
  );
  return {
    id: `data-authority-${signal.category}`,
    category: signal.category,
    label: signal.label,
    status,
    priority: signal.priority,
    provider: signal.provider,
    liveDecisionUse: useFor(status, "live"),
    trainingUse: useFor(status, "training"),
    storageUse: useFor(status, "storage"),
    affectedMatches: signal.affectedMatches,
    authorityScore,
    blockers: blockersFor({ status, signal, governance, supabaseIsolation, containmentPolicy, training }),
    missingEnv: signal.missingEnv,
    storageMissing: signal.storageMissing,
    storageTables: signal.storageTables,
    command: signal.command,
    verifyUrl: signal.verifyUrl,
    expectedEvidence: signal.expectedEvidence,
    decisionImpact: signal.decisionImpact,
    modelImpact: signal.modelImpact
  };
}

function authorityStatus(families: DecisionDataAuthorityFamily[], provider: DecisionProviderIngestionEvidence, governance: DecisionModelGovernance): DecisionDataAuthorityStatus {
  if (families.some((item) => item.status === "live-authorized") && governance.status === "approved") return "live-authorized";
  if (families.some((item) => item.status === "dry-run-ready") || provider.controls.canRunProviderDryRun) return "dry-run-ready";
  if (provider.status === "needs-env" || families.some((item) => item.status === "needs-provider-env")) return "needs-provider-env";
  if (provider.status === "needs-supabase-proof" || families.some((item) => item.status === "needs-supabase-proof")) return "needs-supabase-proof";
  if (governance.status === "blocked" || families.some((item) => item.status === "training-blocked")) return "training-blocked";
  return "blocked";
}

function topFamily(families: DecisionDataAuthorityFamily[]): DecisionDataAuthorityFamily | null {
  return (
    families
      .filter((item) => item.status === "dry-run-ready" || item.status === "needs-provider-env" || item.status === "needs-supabase-proof" || item.status === "blocked")
      .sort((a, b) => b.authorityScore - a.authorityScore || priorityWeight(b.priority) - priorityWeight(a.priority))[0] ??
    families.sort((a, b) => b.authorityScore - a.authorityScore)[0] ??
    null
  );
}

function step(input: DecisionDataAuthorityStep): DecisionDataAuthorityStep {
  return input;
}

function buildSteps({
  provider,
  supabaseIsolation,
  containmentPolicy,
  governance,
  training,
  corpusPlan,
  next
}: {
  provider: DecisionProviderIngestionEvidence;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  governance: DecisionModelGovernance;
  training: TrainingDataSnapshot;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  next: DecisionDataAuthorityFamily | null;
}): DecisionDataAuthorityStep[] {
  const containedDryRun = Boolean(containmentPolicy?.controls.canRunProviderDryRun);
  const supabaseReady = supabaseIsolation.status === "ready-isolated" || containedDryRun;
  const dryRunReady = Boolean(next && next.status === "dry-run-ready" && safeDryRun(next.command));
  return [
    step({
      id: "prove-oddspadi-supabase",
      label: containedDryRun ? "Use contained Supabase read scope" : "Prove OddsPadi Supabase target",
      status: supabaseReady ? "ready" : "blocked",
      command: decisionCurlCommand(containedDryRun ? "/api/sports/decision/supabase-storage-proof-ledger" : "/api/sports/decision/supabase-project-isolation"),
      verifyUrl: containedDryRun ? "/api/sports/decision/supabase-storage-proof-ledger" : "/api/sports/decision/supabase-project-isolation",
      expectedEvidence: containedDryRun
        ? "Storage ledger shows complete op_ tables and mixed-schema containment while writes stay locked."
        : "Expected, configured, URL, linked, and MCP project refs all point at OddsPadi before storage can unlock.",
      blockedBy: supabaseReady ? [] : [supabaseIsolation.nextAction]
    }),
    step({
      id: "run-provider-dry-run",
      label: "Run first provider dry-run",
      status: dryRunReady ? "ready" : provider.status === "needs-env" ? "waiting" : "blocked",
      command: dryRunReady ? next?.command ?? null : null,
      verifyUrl: next?.verifyUrl ?? "/api/sports/decision/provider-ingestion-evidence",
      expectedEvidence: next?.expectedEvidence ?? "A provider dry-run returns normalized counts without writing rows.",
      blockedBy: dryRunReady ? [] : unique([next?.missingEnv.join(", "), next?.storageMissing.join(", "), provider.summary])
    }),
    step({
      id: "verify-storage-schema",
      label: "Verify storage schema",
      status: provider.supabase.storageReady ? "ready" : "blocked",
      command: decisionCurlCommand("/api/sports/decision/provider-ingestion-evidence"),
      verifyUrl: "/api/sports/decision/provider-ingestion-evidence",
      expectedEvidence: "Provider ingestion evidence reports all required op_ storage tables verified for the OddsPadi project.",
      blockedBy: provider.supabase.storageReady ? [] : provider.supabase.missingForStorage
    }),
    step({
      id: "backfill-corpus-dry-run",
      label: "Backfill corpus dry-run",
      status: corpusPlan.canRunFirstCommand ? "ready" : corpusPlan.missingEnvKeys.length ? "waiting" : "blocked",
      command: corpusPlan.canRunFirstCommand ? corpusPlan.firstCommand : null,
      verifyUrl: "/api/sports/decision/training/corpus-plan",
      expectedEvidence: "The 10-year corpus plan returns normalized fixture, context, odds, and feature candidate counts in dry-run mode.",
      blockedBy: unique([...corpusPlan.missingEnvKeys, ...corpusPlan.blockers])
    }),
    step({
      id: "enable-learning-after-backtest",
      label: "Enable learning after backtest",
      status: governance.status === "approved" && training.readiness.readyForTraining ? "ready" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/model-governance",
      expectedEvidence: "Model governance approves learned guardrails after real corpus, target labels, calibration, backtests, and drift checks pass.",
      blockedBy: governance.status === "approved" && training.readiness.readyForTraining ? [] : governance.nextActions
    })
  ];
}

function summaryFor(status: DecisionDataAuthorityStatus, totals: DecisionDataAuthority["totals"], next: DecisionDataAuthorityFamily | null): string {
  if (status === "live-authorized") return `Data authority allows live provider-backed influence across ${totals.liveAuthorized} signal family/families.`;
  if (status === "dry-run-ready") return `Data authority is dry-run ready; next family is ${next?.label ?? "none"} while writes and training stay locked.`;
  if (status === "needs-provider-env") return `Data authority needs provider/admin env before dry-runs can start; ${totals.needsProviderEnv} family/families are waiting.`;
  if (status === "needs-supabase-proof") return "Data authority needs OddsPadi Supabase project, credential, MCP, and op_ schema proof before storage or training can unlock.";
  if (status === "training-blocked") return "Data authority keeps learned guardrails in shadow mode because corpus, labels, calibration, backtests, or runtime storage are blocked.";
  return "Data authority is blocked; no live, dry-run, storage, or training path is currently authorized.";
}

function totalsFor(families: DecisionDataAuthorityFamily[]): DecisionDataAuthority["totals"] {
  return {
    families: families.length,
    liveAuthorized: families.filter((item) => item.status === "live-authorized").length,
    computedShadow: families.filter((item) => item.status === "computed-shadow").length,
    dryRunReady: families.filter((item) => item.status === "dry-run-ready").length,
    needsProviderEnv: families.filter((item) => item.status === "needs-provider-env").length,
    needsSupabaseProof: families.filter((item) => item.status === "needs-supabase-proof").length,
    trainingBlocked: families.filter((item) => item.status === "training-blocked").length,
    blocked: families.filter((item) => item.status === "blocked").length
  };
}

export function buildDecisionDataAuthority({
  date,
  sport,
  dataIntake,
  providerIngestionEvidence,
  modelGovernance,
  supabaseIsolation,
  containmentPolicy = null,
  training,
  corpusPlan,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  modelGovernance: DecisionModelGovernance;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  training: TrainingDataSnapshot;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  now?: Date;
}): DecisionDataAuthority {
  const families = providerIngestionEvidence.providerSignals.map((signal) =>
    family({ signal, dataIntake, governance: modelGovernance, supabaseIsolation, containmentPolicy, training })
  );
  const totals = totalsFor(families);
  const status = authorityStatus(families, providerIngestionEvidence, modelGovernance);
  const next = topFamily(families);
  const activationSteps = buildSteps({
    provider: providerIngestionEvidence,
    supabaseIsolation,
    containmentPolicy,
    governance: modelGovernance,
    training,
    corpusPlan,
    next
  });
  const canRunProviderDryRun = Boolean(next && next.status === "dry-run-ready" && safeDryRun(next.command));
  const score = clamp(
    providerIngestionEvidence.dataCoverage.score * 0.35 +
      modelGovernance.trustScore * 0.35 +
      (supabaseIsolation.status === "ready-isolated" ? 100 : containmentPolicy?.controls.canRunProviderDryRun ? 58 : 0) * 0.3
  );
  const authorityHash = stableHash({
    date,
    sport,
    dataIntake: [dataIntake.status, dataIntake.coverageScore],
    provider: [providerIngestionEvidence.status, providerIngestionEvidence.evidenceHash],
    governance: [modelGovernance.status, modelGovernance.trustScore],
    supabase: [supabaseIsolation.status, supabaseIsolation.isolationHash],
    families: families.map((item) => [item.category, item.status, item.authorityScore]),
    status
  });
  const ceiling: DecisionDataAuthority["decisionPolicy"]["publicDecisionCeiling"] =
    status === "live-authorized" ? "monitor-only" : status === "dry-run-ready" || status === "needs-provider-env" ? "avoid-only" : "consider-disabled";
  const nextCommand = activationSteps.find((item) => item.status === "ready" && item.command) ?? activationSteps.find((item) => item.command) ?? activationSteps[0];

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "data-authority",
    status,
    authorityHash,
    summary: summaryFor(status, totals, next),
    trustScore: score,
    totals,
    input: {
      dataIntakeStatus: dataIntake.status,
      providerIngestionStatus: providerIngestionEvidence.status,
      modelGovernanceStatus: modelGovernance.status,
      supabaseIsolationStatus: supabaseIsolation.status,
      containmentStatus: containmentPolicy?.status ?? "not-evaluated",
      trainingStatus: training.status,
      corpusStatus: corpusPlan.status
    },
    topFamily: next,
    families,
    activationSteps,
    decisionPolicy: {
      canUseProviderBackedLiveSignals: status === "live-authorized",
      canUseComputedSignals: true,
      canUseMockSignals: false,
      canRunProviderDryRun,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      publicDecisionCeiling: ceiling,
      reason: summaryFor(status, totals, next)
    },
    nextCommand: {
      label: nextCommand?.label ?? "Inspect data authority",
      command: nextCommand?.command ?? null,
      verifyUrl: nextCommand?.verifyUrl ?? "/api/sports/decision/data-authority",
      safeToRun: Boolean(nextCommand?.status === "ready" && nextCommand.command && !nextCommand.blockedBy.length),
      expectedEvidence: nextCommand?.expectedEvidence ?? "Data authority returns current signal-family permissions."
    },
    controls: {
      canRunReadOnly: true,
      canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    locks: unique([
      "Do not write provider rows until OddsPadi Supabase isolation, credentials, MCP proof, and op_ schema verification pass.",
      "Do not train models until real finished fixtures, real odds snapshots, feature snapshots, target labels, calibration, backtests, and drift checks pass.",
      "Do not let mock-backed or dry-run-only signals upgrade a public action.",
      ...providerIngestionEvidence.controls.forbiddenActions,
      ...supabaseIsolation.proof.forbiddenActions
    ]),
    proofUrls: unique([
      "/api/sports/decision/data-authority",
      "/api/sports/decision/data-intake",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/model-governance",
      "/api/sports/decision/training/corpus-plan",
      ...providerIngestionEvidence.proofUrls,
      ...supabaseIsolation.proof.verificationUrls
    ])
  };
}
