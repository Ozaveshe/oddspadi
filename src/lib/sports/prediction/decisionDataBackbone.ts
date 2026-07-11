import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionDataSourceCoverage } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import type { DecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import type { DecisionSupabaseLiveSchemaActivationPacket } from "@/lib/sports/prediction/decisionSupabaseLiveSchemaActivationPacket";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { HistoricalCorpusAcquisition } from "@/lib/sports/training/historicalCorpusAcquisition";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";

export type DecisionDataBackboneStatus =
  | "ready-provider-dry-run"
  | "needs-provider-env"
  | "needs-storage-proof"
  | "needs-corpus"
  | "blocked-credentials"
  | "blocked-cross-project";

export type DecisionDataBackboneGateStatus = "pass" | "watch" | "block";

export type DecisionDataBackboneGate = {
  id: string;
  label: string;
  status: DecisionDataBackboneGateStatus;
  score: number;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionDataBackboneRequirement = {
  id: string;
  label: string;
  cells: number;
  providerBacked: number;
  computed: number;
  mock: number;
  missing: number;
  blockedRequired: number;
  storageTables: string[];
  proofUrl: string;
  status: DecisionDataBackboneGateStatus;
  nextAction: string;
};

export type DecisionDataBackbone = {
  generatedAt: string;
  mode: "data-backbone";
  status: DecisionDataBackboneStatus;
  backboneHash: string;
  summary: string;
  readinessScore: number;
  inputs: {
    coverageStatus: DecisionDataSourceCoverage["status"];
    dataAuthorityStatus: DecisionDataAuthority["status"];
    schemaManifestStatus: DecisionSupabaseSchemaManifest["status"];
    liveSchemaActivationStatus: DecisionSupabaseLiveSchemaActivationPacket["status"];
    containmentStatus: DecisionSupabaseContainmentPolicy["status"] | "not-evaluated";
    historicalCorpusStatus: HistoricalCorpusAcquisition["status"];
    trainingReadinessStatus: TrainingReadiness["status"];
  };
  totals: {
    requirements: number;
    providerBackedRequirements: number;
    computedRequirements: number;
    mockRequirements: number;
    missingRequirements: number;
    blockedRequiredSignals: number;
    storageTablesExpected: number;
    storageTablesLiveVerified: number;
    estimatedHistoricalMatches: number;
    estimatedOddsSnapshots: number;
    daysUntilEplStart: number;
  };
  gates: DecisionDataBackboneGate[];
  requirements: DecisionDataBackboneRequirement[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    missing: string[];
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canApplySchema: boolean;
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

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 50): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
}

function requirementStatus(requirement: DecisionDataBackboneRequirement): DecisionDataBackboneGateStatus {
  if (requirement.blockedRequired > 0 || requirement.missing > 0) return "block";
  if (requirement.mock > 0 || requirement.computed > 0) return "watch";
  return "pass";
}

function buildRequirements(coverage: DecisionDataSourceCoverage): DecisionDataBackboneRequirement[] {
  return coverage.cells
    .filter((cell) => cell.requiredForLive)
    .map((cell) => {
      const requirement = {
        id: cell.id,
        label: `${cell.sport}: ${cell.label}`,
        cells: 1,
        providerBacked: cell.status === "provider-backed" ? 1 : 0,
        computed: cell.status === "computed" ? 1 : 0,
        mock: cell.status === "mock" ? 1 : 0,
        missing: cell.status === "missing" ? 1 : 0,
        blockedRequired: cell.requiredForLive && (cell.status === "missing" || cell.status === "mock") ? 1 : 0,
        storageTables: cell.storageTables,
        proofUrl: cell.proofUrl,
        status: "watch" as DecisionDataBackboneGateStatus,
        nextAction: cell.nextAction
      };
      return {
        ...requirement,
        status: requirementStatus(requirement)
      };
    })
    .sort((a, b) => {
      const rank = { block: 3, watch: 2, pass: 1 };
      return rank[b.status] - rank[a.status] || b.blockedRequired - a.blockedRequired || a.label.localeCompare(b.label);
    });
}

function gate(input: DecisionDataBackboneGate): DecisionDataBackboneGate {
  return input;
}

function scoreGate(status: DecisionDataBackboneGateStatus, base: number): number {
  if (status === "pass") return base;
  if (status === "watch") return Math.round(base * 0.55);
  return 0;
}

function statusFor({
  schemaManifest,
  liveSchemaActivation,
  containmentPolicy,
  dataAuthority,
  historicalCorpus,
  trainingReadiness
}: {
  schemaManifest: DecisionSupabaseSchemaManifest;
  liveSchemaActivation: DecisionSupabaseLiveSchemaActivationPacket;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  dataAuthority: DecisionDataAuthority;
  historicalCorpus: HistoricalCorpusAcquisition;
  trainingReadiness: TrainingReadiness;
}): DecisionDataBackboneStatus {
  const containedDryRun = Boolean(containmentPolicy?.controls.canRunProviderDryRun);
  if ((schemaManifest.status === "blocked-cross-project" || liveSchemaActivation.status === "blocked-cross-project") && !containedDryRun) return "blocked-cross-project";
  if (schemaManifest.status === "blocked-credentials" || liveSchemaActivation.status === "blocked-credentials") return "blocked-credentials";
  if (schemaManifest.status !== "ready-live-schema" && !containedDryRun) return "needs-storage-proof";
  if (dataAuthority.status === "needs-provider-env") return "needs-provider-env";
  if (historicalCorpus.status !== "ready-dry-run" || trainingReadiness.status !== "trainable-shadow") return "needs-corpus";
  return "ready-provider-dry-run";
}

function summaryFor(status: DecisionDataBackboneStatus): string {
  if (status === "ready-provider-dry-run") return "Data backbone is ready for supervised provider dry-runs; writes, training, and public picks remain locked.";
  if (status === "blocked-cross-project") return "Data backbone is blocked because Supabase project/schema evidence points at a wrong or foreign target.";
  if (status === "blocked-credentials") return "Data backbone is blocked because the OddsPadi Supabase server credential is rejected.";
  if (status === "needs-storage-proof") return "Data backbone needs live OddsPadi op_ schema proof before provider rows, decision memory, or training can persist.";
  if (status === "needs-provider-env") return "Data backbone needs provider keys before required feeds can run dry-runs.";
  return "Data backbone needs the historical corpus, feature snapshots, labels, and backtests before learned model behavior can activate.";
}

export function buildDecisionDataBackbone({
  dataSourceCoverage,
  dataAuthority,
  schemaManifest,
  liveSchemaActivation,
  containmentPolicy = null,
  historicalCorpus,
  trainingReadiness,
  now = new Date()
}: {
  dataSourceCoverage: DecisionDataSourceCoverage;
  dataAuthority: DecisionDataAuthority;
  schemaManifest: DecisionSupabaseSchemaManifest;
  liveSchemaActivation: DecisionSupabaseLiveSchemaActivationPacket;
  containmentPolicy?: DecisionSupabaseContainmentPolicy | null;
  historicalCorpus: HistoricalCorpusAcquisition;
  trainingReadiness: TrainingReadiness;
  now?: Date;
}): DecisionDataBackbone {
  const requirements = buildRequirements(dataSourceCoverage);
  const containedDryRun = Boolean(containmentPolicy?.controls.canRunProviderDryRun);
  const storageGateStatus: DecisionDataBackboneGateStatus =
    schemaManifest.status === "ready-live-schema" || containedDryRun
      ? "pass"
      : schemaManifest.status === "blocked-credentials" || schemaManifest.status === "blocked-cross-project"
        ? "block"
        : "watch";
  const providerGateStatus: DecisionDataBackboneGateStatus =
    dataAuthority.status === "dry-run-ready" || dataAuthority.status === "live-authorized"
      ? "pass"
      : dataAuthority.status === "needs-provider-env"
        ? "watch"
        : "block";
  const coverageGateStatus: DecisionDataBackboneGateStatus =
    dataSourceCoverage.totals.blockedRequired > 0 ? "block" : dataSourceCoverage.totals.mock || dataSourceCoverage.totals.computed ? "watch" : "pass";
  const corpusGateStatus: DecisionDataBackboneGateStatus =
    historicalCorpus.status === "ready-dry-run" && trainingReadiness.status === "trainable-shadow"
      ? "pass"
      : historicalCorpus.status === "waiting-env"
        ? "watch"
        : "block";
  const gates = [
    gate({
      id: "storage-proof",
      label: "Storage proof",
      status: storageGateStatus,
      score: scoreGate(storageGateStatus, 30),
      detail: `${schemaManifest.inventory.liveVerifiedTables}/${schemaManifest.inventory.expectedTables} op_ tables live-verified; activation ${liveSchemaActivation.status.replaceAll("-", " ")}; containment ${containmentPolicy?.status ?? "not evaluated"}.`,
      nextAction: containedDryRun ? containmentPolicy?.summary ?? liveSchemaActivation.summary : liveSchemaActivation.summary,
      proofUrl: containedDryRun ? "/api/sports/decision/supabase-storage-proof-ledger" : "/api/sports/decision/supabase-live-schema-activation"
    }),
    gate({
      id: "provider-feeds",
      label: "Provider feeds",
      status: providerGateStatus,
      score: scoreGate(providerGateStatus, 25),
      detail: `${dataAuthority.totals.dryRunReady} dry-run-ready families; ${dataAuthority.totals.needsProviderEnv} waiting on provider env; ${dataAuthority.totals.needsSupabaseProof} need storage proof.`,
      nextAction: dataAuthority.summary,
      proofUrl: "/api/sports/decision/data-authority"
    }),
    gate({
      id: "coverage-requirements",
      label: "Coverage requirements",
      status: coverageGateStatus,
      score: scoreGate(coverageGateStatus, 20),
      detail: `${dataSourceCoverage.totals.readyRequired} required cells ready; ${dataSourceCoverage.totals.blockedRequired} required cells blocked; ${dataSourceCoverage.totals.mock} mock; ${dataSourceCoverage.totals.computed} computed.`,
      nextAction: dataSourceCoverage.topGaps[0]?.nextAction ?? "Keep replacing computed/mock feeds with provider-backed evidence.",
      proofUrl: "/api/sports/decision/data-source-coverage"
    }),
    gate({
      id: "historical-corpus",
      label: "Historical corpus",
      status: corpusGateStatus,
      score: scoreGate(corpusGateStatus, 25),
      detail: `${historicalCorpus.historicalWindow.estimatedMatches} estimated historical matches and ${historicalCorpus.historicalWindow.estimatedOddsSnapshots} odds snapshots planned; ${historicalCorpus.totals.corpusDeficits} corpus deficits remain.`,
      nextAction: historicalCorpus.summary,
      proofUrl: "/api/sports/decision/training/historical-corpus-acquisition"
    })
  ];
  const readinessScore = clamp(gates.reduce((sum, item) => sum + item.score, 0));
  const status = statusFor({ schemaManifest, liveSchemaActivation, containmentPolicy, dataAuthority, historicalCorpus, trainingReadiness });
  const topRequirement = requirements.find((item) => item.status === "block") ?? requirements.find((item) => item.status === "watch") ?? requirements[0] ?? null;
  const nextAction =
    status === "blocked-credentials" || status === "blocked-cross-project" || status === "needs-storage-proof"
      ? liveSchemaActivation.nextCommand
      : dataAuthority.nextCommand.safeToRun
        ? {
            label: dataAuthority.nextCommand.label,
            command: dataAuthority.nextCommand.command ?? safeLocalUrl(dataAuthority.nextCommand.verifyUrl),
            verifyUrl: dataAuthority.nextCommand.verifyUrl,
            safeToRun: dataAuthority.nextCommand.safeToRun,
            missing: [],
            expectedEvidence: dataAuthority.nextCommand.expectedEvidence
          }
        : historicalCorpus.nextSafeCommands.find((item) => item.safeToRun && !item.missingEnv.length) ?? null;
  const normalizedNextAction = nextAction
    ? {
        label: nextAction.label,
        command: nextAction.command ?? safeLocalUrl(nextAction.verifyUrl ?? "/api/sports/decision/data-backbone"),
        verifyUrl: nextAction.verifyUrl ?? "/api/sports/decision/data-backbone",
        safeToRun: Boolean(nextAction.safeToRun),
        missing: "missing" in nextAction ? nextAction.missing : "missingEnv" in nextAction ? nextAction.missingEnv : [],
        expectedEvidence: nextAction.expectedEvidence
      }
    : {
        label: topRequirement ? `Resolve ${topRequirement.label}` : "Inspect data backbone",
        command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/data-backbone")}"`,
        verifyUrl: "/api/sports/decision/data-backbone",
        safeToRun: true,
        missing: [],
        expectedEvidence: topRequirement?.nextAction ?? "Data backbone returns the current storage, provider, coverage, and corpus state."
      };
  const storageTables = unique(requirements.flatMap((item) => item.storageTables), 100);
  const backboneHash = stableHash({
    status,
    readinessScore,
    gates: gates.map((item) => [item.id, item.status, item.score]),
    inputs: [
      dataSourceCoverage.status,
      dataAuthority.status,
      schemaManifest.status,
      liveSchemaActivation.status,
      containmentPolicy?.status ?? "not-evaluated",
      historicalCorpus.status,
      trainingReadiness.status
    ],
    requirements: requirements.map((item) => [item.id, item.status, item.blockedRequired])
  });

  return {
    generatedAt: now.toISOString(),
    mode: "data-backbone",
    status,
    backboneHash,
    summary: summaryFor(status),
    readinessScore,
    inputs: {
      coverageStatus: dataSourceCoverage.status,
      dataAuthorityStatus: dataAuthority.status,
      schemaManifestStatus: schemaManifest.status,
      liveSchemaActivationStatus: liveSchemaActivation.status,
      containmentStatus: containmentPolicy?.status ?? "not-evaluated",
      historicalCorpusStatus: historicalCorpus.status,
      trainingReadinessStatus: trainingReadiness.status
    },
    totals: {
      requirements: requirements.length,
      providerBackedRequirements: requirements.filter((item) => item.providerBacked > 0).length,
      computedRequirements: requirements.filter((item) => item.computed > 0).length,
      mockRequirements: requirements.filter((item) => item.mock > 0).length,
      missingRequirements: requirements.filter((item) => item.missing > 0).length,
      blockedRequiredSignals: requirements.reduce((sum, item) => sum + item.blockedRequired, 0),
      storageTablesExpected: schemaManifest.inventory.expectedTables,
      storageTablesLiveVerified: schemaManifest.inventory.liveVerifiedTables,
      estimatedHistoricalMatches: historicalCorpus.historicalWindow.estimatedMatches,
      estimatedOddsSnapshots: historicalCorpus.historicalWindow.estimatedOddsSnapshots,
      daysUntilEplStart: historicalCorpus.upcomingEpl.daysUntilStart
    },
    gates,
    requirements,
    nextAction: normalizedNextAction,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: dataAuthority.controls.canRunProviderDryRun && (schemaManifest.status === "ready-live-schema" || containedDryRun),
      canApplySchema: liveSchemaActivation.controls.canRequestSchemaApply,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    locks: unique([
      "Provider dry-runs cannot become writes from this backbone object.",
      "Decision memory and training stay locked until Supabase schema, provider dry-runs, corpus backtests, and explicit admin approval pass.",
      "Mock, computed, or dry-run-only feeds cannot raise public decision actionability.",
      ...schemaManifest.gates.filter((item) => item.status !== "pass").map((item) => item.nextAction),
      ...liveSchemaActivation.locks,
      ...historicalCorpus.locks,
      ...dataAuthority.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/data-authority",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/supabase-live-schema-activation",
      "/api/sports/decision/training/historical-corpus-acquisition",
      ...dataSourceCoverage.proofUrls,
      ...dataAuthority.proofUrls,
      ...historicalCorpus.proofUrls
    ])
  };
}
