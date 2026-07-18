import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { DecisionSupabaseCleanProjectCutover } from "@/lib/sports/prediction/decisionSupabaseCleanProjectCutover";
import type { DecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import type { DecisionSupabaseLiveMcpProofArtifactRead } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseStorageProofLedgerStatus =
  | "clean-storage-proof"
  | "contained-read-only"
  | "blocked-mixed-schema"
  | "needs-live-proof"
  | "blocked-credentials"
  | "blocked-cross-project";

export type DecisionSupabaseStorageProofLedgerDomainId =
  | "provider-raw"
  | "fixture-spine"
  | "market-odds"
  | "context-signals"
  | "live-events"
  | "decision-memory"
  | "training-backtest";

export type DecisionSupabaseStorageProofLedgerDomain = {
  id: DecisionSupabaseStorageProofLedgerDomainId;
  label: string;
  purpose: string;
  tables: string[];
  expectedTables: number;
  localDeclared: number;
  localRlsProtected: number;
  localPublicRevoked: number;
  serviceGrantDeclared: number;
  liveVerified: number;
  mcpObserved: number;
  status: "pass" | "watch" | "block";
  nextAction: string;
};

export type DecisionSupabaseStorageProofLedger = {
  generatedAt: string;
  mode: "supabase-storage-proof-ledger";
  status: DecisionSupabaseStorageProofLedgerStatus;
  ledgerHash: string;
  summary: string;
  project: {
    expectedRef: string;
    configuredRef: string | null;
    urlRef: string | null;
    mcpProofRef: string | null;
    artifactPath: string;
    artifactValid: boolean;
    artifactVerifiedAt: string | null;
  };
  totals: {
    domains: number;
    expectedTables: number;
    localDeclared: number;
    localRlsProtected: number;
    localPublicRevoked: number;
    serviceGrantDeclared: number;
    liveVerified: number;
    mcpObserved: number;
    foreignSignals: number;
  };
  domains: DecisionSupabaseStorageProofLedgerDomain[];
  accessPosture: {
    publicClientGrants: string;
    serverGrant: string;
    allRlsEnabled: boolean;
    rlsEnabledCount: number;
    publicBrowserWritesClosed: boolean;
    serviceRoleWritePathOnly: boolean;
  };
  contamination: {
    status: DecisionSupabaseMcpObservationReceipt["status"];
    foreignSignals: Array<{ table: string; product: string }>;
    currentSchemaEvidence: DecisionSupabaseCleanProjectCutover["target"]["currentSchemaEvidence"];
    requiredDecision: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canUseOpTablesAsReadScope: boolean;
    canApplyMigrations: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    proofUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

const DOMAINS: Array<Omit<DecisionSupabaseStorageProofLedgerDomain, "localDeclared" | "localRlsProtected" | "localPublicRevoked" | "serviceGrantDeclared" | "liveVerified" | "mcpObserved" | "status" | "nextAction">> = [
  {
    id: "provider-raw",
    label: "Provider raw intake",
    purpose: "Audit every provider pull, raw payload, provider run, and normalization trace before rows become model inputs.",
    tables: ["op_provider_ingestion_runs", "op_raw_provider_payloads"],
    expectedTables: 2
  },
  {
    id: "fixture-spine",
    label: "Fixture and team spine",
    purpose: "Hold fixtures, leagues, teams, standings, home/away features, recent form, and historical score rows.",
    tables: ["op_leagues", "op_teams", "op_fixtures", "op_fixture_team_features", "op_standings_snapshots"],
    expectedTables: 5
  },
  {
    id: "market-odds",
    label: "Odds intelligence",
    purpose: "Store bookmaker markets, implied probabilities, margin-adjusted probabilities, value edge, and closing-line evidence.",
    tables: ["op_odds_snapshots"],
    expectedTables: 1
  },
  {
    id: "context-signals",
    label: "Context signals",
    purpose: "Track injuries, suspensions, lineups, news, weather, and availability adjustments.",
    tables: ["op_player_availability_snapshots", "op_lineup_snapshots", "op_news_signals", "op_weather_snapshots"],
    expectedTables: 4
  },
  {
    id: "live-events",
    label: "Live match events",
    purpose: "Capture live scores and match events for in-play state, post-match settlement, and replay audits.",
    tables: ["op_live_match_events"],
    expectedTables: 1
  },
  {
    id: "decision-memory",
    label: "Decision memory",
    purpose: "Store model versions, decision runs, AI thought episodes, briefings, outcomes, calibration, and memory replay.",
    tables: ["op_model_versions", "op_decision_runs", "op_ai_thought_episodes", "op_decision_briefings", "op_prediction_outcomes", "op_calibration_runs", "op_calibration_candidates", "op_calibration_promotions", "op_model_comparison_receipts", "op_shadow_memory_replay"],
    expectedTables: 10
  },
  {
    id: "training-backtest",
    label: "Training and backtest",
    purpose: "Hold engineered feature snapshots and backtest runs for shadow learning and threshold calibration.",
    tables: ["op_training_feature_snapshots", "op_backtest_runs"],
    expectedTables: 2
  }
];

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

function statusFor({
  manifest,
  containment,
  foreignSignals,
  expectedTables,
  liveVerified,
  mcpObserved
}: {
  manifest: DecisionSupabaseSchemaManifest;
  containment: DecisionSupabaseContainmentPolicy;
  foreignSignals: number;
  expectedTables: number;
  liveVerified: number;
  mcpObserved: number;
}): DecisionSupabaseStorageProofLedgerStatus {
  if (containment.status === "clean-authoritative") return "clean-storage-proof";
  if (containment.status === "contained-dry-run" && foreignSignals > 0 && liveVerified === expectedTables && mcpObserved === expectedTables) return "contained-read-only";
  if (manifest.status === "blocked-credentials") return "blocked-credentials";
  if (manifest.status === "blocked-cross-project") return "blocked-cross-project";
  if (foreignSignals > 0 && liveVerified === expectedTables && mcpObserved === expectedTables) return "contained-read-only";
  if (foreignSignals > 0) return "blocked-mixed-schema";
  return "needs-live-proof";
}

function summaryFor(status: DecisionSupabaseStorageProofLedgerStatus, expectedTables: number, liveVerified: number, foreignSignals: number): string {
  if (status === "clean-storage-proof") return `Storage proof is clean across ${liveVerified}/${expectedTables} tables; write paths still need dedicated provider receipts.`;
  if (status === "contained-read-only") {
    return `All ${liveVerified}/${expectedTables} OddsPadi op_ tables are present, but ${foreignSignals} foreign schema signal(s) keep writes locked; read-only provider dry-runs may proceed.`;
  }
  if (status === "blocked-mixed-schema") return `Storage proof is blocked by ${foreignSignals} foreign schema signal(s); use a clean project or approve a deliberate cutover strategy.`;
  if (status === "blocked-credentials") return "Storage proof is blocked because the app server credential is rejected.";
  if (status === "blocked-cross-project") return "Storage proof is blocked because project evidence points at a wrong or mixed schema.";
  return `Storage proof still needs complete live schema evidence: ${liveVerified}/${expectedTables} expected op_ tables verified.`;
}

function buildDomain({
  domain,
  manifest,
  observedTables
}: {
  domain: (typeof DOMAINS)[number];
  manifest: DecisionSupabaseSchemaManifest;
  observedTables: Set<string>;
}): DecisionSupabaseStorageProofLedgerDomain {
  const manifestTables = new Map(manifest.tables.map((table) => [table.table, table]));
  const localDeclared = domain.tables.filter((table) => manifestTables.get(table)?.localDeclared).length;
  const localRlsProtected = domain.tables.filter((table) => manifestTables.get(table)?.localRlsEnabled).length;
  const localPublicRevoked = domain.tables.filter((table) => manifestTables.get(table)?.localAnonRevoked).length;
  const serviceGrantDeclared = domain.tables.filter((table) => manifestTables.get(table)?.localServiceRoleGrant).length;
  const liveVerified = domain.tables.filter((table) => manifestTables.get(table)?.liveStatus === "verified").length;
  const mcpObserved = domain.tables.filter((table) => observedTables.has(table)).length;
  const status: DecisionSupabaseStorageProofLedgerDomain["status"] =
    liveVerified === domain.expectedTables && mcpObserved === domain.expectedTables && localRlsProtected === domain.expectedTables
      ? "pass"
      : liveVerified === 0 || mcpObserved === 0
        ? "block"
        : "watch";

  return {
    ...domain,
    localDeclared,
    localRlsProtected,
    localPublicRevoked,
    serviceGrantDeclared,
    liveVerified,
    mcpObserved,
    status,
    nextAction:
      status === "pass"
        ? "Keep this domain read-only until provider dry-runs, admin authorization, and write receipts pass."
        : "Repair local/live schema proof for this domain before any provider write or training task depends on it."
  };
}

export function buildDecisionSupabaseStorageProofLedger({
  manifest,
  mcpObservationReceipt,
  containmentPolicy,
  cleanProjectCutover,
  storageActivationChecklist,
  liveMcpProofArtifact,
  now = new Date()
}: {
  manifest: DecisionSupabaseSchemaManifest;
  mcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  containmentPolicy: DecisionSupabaseContainmentPolicy;
  cleanProjectCutover: DecisionSupabaseCleanProjectCutover;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  liveMcpProofArtifact: DecisionSupabaseLiveMcpProofArtifactRead;
  now?: Date;
}): DecisionSupabaseStorageProofLedger {
  const observedTables = new Set(mcpObservationReceipt.observed.expectedTablesPresent);
  const domains = DOMAINS.map((domain) => buildDomain({ domain, manifest, observedTables }));
  const foreignSignals = mcpObservationReceipt.observed.foreignSignals;
  const expectedTables = manifest.inventory.expectedTables;
  const liveVerified = manifest.inventory.liveVerifiedTables;
  const mcpObserved = mcpObservationReceipt.observed.expectedTablesPresent.length;
  const status = statusFor({
    manifest,
    containment: containmentPolicy,
    foreignSignals: foreignSignals.length,
    expectedTables,
    liveVerified,
    mcpObserved
  });
  const accessPosture = {
    publicClientGrants: liveMcpProofArtifact.artifact?.publicClientGrants ?? "unknown",
    serverGrant: liveMcpProofArtifact.artifact?.serverGrant ?? "unknown",
    allRlsEnabled: liveMcpProofArtifact.artifact?.allRlsEnabled ?? domains.every((domain) => domain.localRlsProtected === domain.expectedTables),
    rlsEnabledCount: liveMcpProofArtifact.artifact?.rlsEnabledCount ?? manifest.inventory.localRlsTables,
    publicBrowserWritesClosed:
      (liveMcpProofArtifact.artifact?.publicClientGrants ?? "unknown") === "none" &&
      domains.every((domain) => domain.localPublicRevoked === domain.expectedTables),
    serviceRoleWritePathOnly:
      (liveMcpProofArtifact.artifact?.serverGrant ?? "unknown") === "service_role" &&
      domains.every((domain) => domain.serviceGrantDeclared === domain.expectedTables)
  };
  const canRunProviderDryRun = containmentPolicy.controls.canRunProviderDryRun || storageActivationChecklist.controls.canRunProviderDryRun;
  const nextAction =
    status === "contained-read-only"
      ? {
          label: "Run only guarded provider dry-runs",
          proofUrl: "/api/sports/decision/live-provider-probe-ledger",
          safeToRun: true,
          expectedEvidence: "Provider probes return fetched and normalized counts while canWriteProviderRows remains false."
        }
      : status === "clean-storage-proof"
        ? {
            label: "Review provider write receipts",
            proofUrl: "/api/sports/decision/provider-batch-manifest",
            safeToRun: true,
            expectedEvidence: "Provider batch manifest identifies dry-run lanes before any admin-gated write path."
          }
        : {
            label: "Resolve clean Supabase authority",
            proofUrl: "/api/sports/decision/supabase-clean-project-cutover",
            safeToRun: true,
            expectedEvidence: "Clean-project cutover reports zero foreign schema signals and a complete OddsPadi op_ schema."
          };

  return {
    generatedAt: now.toISOString(),
    mode: "supabase-storage-proof-ledger",
    status,
    ledgerHash: stableHash({
      status,
      project: manifest.project,
      domains: domains.map((domain) => [domain.id, domain.status, domain.liveVerified, domain.mcpObserved]),
      accessPosture,
      foreignSignals
    }),
    summary: summaryFor(status, expectedTables, liveVerified, foreignSignals.length),
    project: {
      expectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
      configuredRef: manifest.project.configuredRef,
      urlRef: manifest.project.urlRef,
      mcpProofRef: manifest.project.mcpProofRef,
      artifactPath: liveMcpProofArtifact.path,
      artifactValid: liveMcpProofArtifact.valid,
      artifactVerifiedAt: liveMcpProofArtifact.artifact?.verifiedAt ?? null
    },
    totals: {
      domains: domains.length,
      expectedTables,
      localDeclared: manifest.inventory.localDeclaredTables,
      localRlsProtected: manifest.inventory.localRlsTables,
      localPublicRevoked: domains.reduce((sum, domain) => sum + domain.localPublicRevoked, 0),
      serviceGrantDeclared: domains.reduce((sum, domain) => sum + domain.serviceGrantDeclared, 0),
      liveVerified,
      mcpObserved,
      foreignSignals: foreignSignals.length
    },
    domains,
    accessPosture,
    contamination: {
      status: mcpObservationReceipt.status,
      foreignSignals,
      currentSchemaEvidence: cleanProjectCutover.target.currentSchemaEvidence,
      requiredDecision:
        foreignSignals.length > 0
          ? "Use a clean OddsPadi Supabase project for production writes, or explicitly approve a mixed-schema containment strategy before ingestion."
          : "Keep the clean project proof attached while provider dry-runs and write receipts are reviewed."
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun,
      canUseOpTablesAsReadScope: containmentPolicy.controls.canUseOpTablesAsReadScope,
      canApplyMigrations: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction,
    proofUrls: unique([
      "/api/sports/decision/supabase-storage-proof-ledger",
      "/api/sports/decision/supabase-containment-policy",
      "/api/sports/decision/supabase-clean-project-cutover",
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/live-provider-probe-ledger"
    ]),
    locks: unique([
      "No provider writes from storage proof alone.",
      "No decision persistence until clean authority, provider receipts, and admin-gated write routes pass.",
      "No training rows, model promotion, public picks, or staking while foreign schema signals are present.",
      accessPosture.publicBrowserWritesClosed
        ? "Browser/public roles remain closed for storage tables."
        : "Public client grants are not fully proven closed; keep public writes locked.",
      ...cleanProjectCutover.locks,
      ...storageActivationChecklist.locks
    ])
  };
}
