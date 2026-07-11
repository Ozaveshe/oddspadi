import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseSchemaManifestStatus =
  | "ready-live-schema"
  | "contained-mixed-schema"
  | "needs-live-schema"
  | "needs-project-proof"
  | "blocked-cross-project"
  | "blocked-credentials";

export type DecisionSupabaseSchemaManifestGateStatus = "pass" | "watch" | "block";
export type DecisionSupabaseSchemaManifestDomainId =
  | "decision-memory"
  | "fixture-corpus"
  | "market-odds"
  | "availability-context"
  | "live-context"
  | "learning-backtest";

export type DecisionSupabaseSchemaManifestTable = {
  table: string;
  domain: DecisionSupabaseSchemaManifestDomainId;
  localDeclared: boolean;
  localRlsEnabled: boolean;
  localAnonRevoked: boolean;
  localServiceRoleGrant: boolean;
  liveStatus: DecisionEngineReadiness["supabase"]["schema"]["tableChecks"][number]["status"];
  rowCount: number | null;
  migrationFiles: string[];
  status: DecisionSupabaseSchemaManifestGateStatus;
  nextAction: string;
};

export type DecisionSupabaseSchemaManifestDomain = {
  id: DecisionSupabaseSchemaManifestDomainId;
  label: string;
  purpose: string;
  requiredFor: string[];
  tables: string[];
  declaredCount: number;
  verifiedCount: number;
  blockedCount: number;
  status: DecisionSupabaseSchemaManifestGateStatus;
};

export type DecisionSupabaseSchemaManifestGate = {
  id: string;
  label: string;
  status: DecisionSupabaseSchemaManifestGateStatus;
  detail: string;
  nextAction: string;
};

export type DecisionSupabaseSchemaManifest = {
  generatedAt: string;
  mode: "supabase-schema-manifest";
  status: DecisionSupabaseSchemaManifestStatus;
  manifestHash: string;
  summary: string;
  project: {
    expectedRef: string;
    configuredRef: string | null;
    urlRef: string | null;
    linkedRef: string | null;
    repoMcpRef: string | null;
    mcpProofRef: string | null;
    targetMatchesExpected: boolean;
  };
  inventory: {
    expectedTables: number;
    localDeclaredTables: number;
    localRlsTables: number;
    liveVerifiedTables: number;
    missingTables: string[];
    credentialErrorTables: string[];
    inaccessibleTables: string[];
    migrationCount: number;
  };
  domains: DecisionSupabaseSchemaManifestDomain[];
  tables: DecisionSupabaseSchemaManifestTable[];
  gates: DecisionSupabaseSchemaManifestGate[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    missing: string[];
  };
  controls: {
    canInspectLocal: true;
    canUseLiveMcpForSchema: boolean;
    canApplyMigrations: boolean;
    canStoreFixtureCorpus: false;
    canPersistDecisionMemory: false;
    canTrainModels: false;
    canPublishPicks: false;
  };
  docs: {
    rls: "https://supabase.com/docs/guides/database/postgres/row-level-security";
    dataApi: "https://supabase.com/docs/guides/api/securing-your-api";
    mcp: "https://supabase.com/docs/guides/ai-tools/mcp";
  };
};

type LocalTableEvidence = {
  migrationFiles: string[];
  declared: boolean;
  rlsEnabled: boolean;
  anonRevoked: boolean;
  serviceRoleGrant: boolean;
};

const DOMAINS: Array<Omit<DecisionSupabaseSchemaManifestDomain, "declaredCount" | "verifiedCount" | "blockedCount" | "status">> = [
  {
    id: "decision-memory",
    label: "Decision memory",
    purpose: "Store model versions, prediction decisions, AI thoughts, briefing receipts, and replay memory.",
    requiredFor: ["AI decision memory", "explainability", "operator review"],
    tables: ["op_model_versions", "op_decision_runs", "op_decision_evidence_bundles", "op_ai_thought_episodes", "op_decision_briefings"]
  },
  {
    id: "fixture-corpus",
    label: "Fixture and team corpus",
    purpose: "Store leagues, teams, fixtures, standings, historical results, and engineered team features.",
    requiredFor: ["fixtures for the day", "10-year history", "standings", "home/away", "recent form"],
    tables: ["op_leagues", "op_teams", "op_fixtures", "op_fixture_team_features", "op_standings_snapshots", "op_training_feature_snapshots"]
  },
  {
    id: "market-odds",
    label: "Odds intelligence",
    purpose: "Store bookmaker snapshots and provider payload provenance for implied probability and value-edge review.",
    requiredFor: ["bookmaker odds", "market adjustment", "expected value", "closing-line review"],
    tables: ["op_odds_snapshots", "op_provider_ingestion_runs", "op_raw_provider_payloads"]
  },
  {
    id: "availability-context",
    label: "Availability context",
    purpose: "Store injuries, suspensions, lineups, news signals, and football weather context.",
    requiredFor: ["injuries/suspensions", "lineups", "news signals", "weather"],
    tables: ["op_player_availability_snapshots", "op_lineup_snapshots", "op_news_signals", "op_weather_snapshots"]
  },
  {
    id: "live-context",
    label: "Live match context",
    purpose: "Store live match events and score-state changes for late evidence and settlement review.",
    requiredFor: ["live scores", "match events", "in-play evidence"],
    tables: ["op_live_match_events"]
  },
  {
    id: "learning-backtest",
    label: "Learning and backtest",
    purpose: "Store outcomes, calibration runs, shadow replay, and historical backtest metrics.",
    requiredFor: ["settlement", "calibration", "shadow backtest", "training gates"],
    tables: ["op_prediction_outcomes", "op_calibration_runs", "op_shadow_memory_replay", "op_backtest_runs"]
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

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
}

function domainForTable(table: string): DecisionSupabaseSchemaManifestDomainId {
  return DOMAINS.find((domain) => domain.tables.includes(table))?.id ?? "fixture-corpus";
}

function readLocalEvidence(workspaceRoot: string, expectedTables: string[]): Map<string, LocalTableEvidence> {
  const evidence = new Map<string, LocalTableEvidence>(
    expectedTables.map((table) => [
      table,
      {
        migrationFiles: [],
        declared: false,
        rlsEnabled: false,
        anonRevoked: false,
        serviceRoleGrant: false
      }
    ])
  );
  const migrationDir = join(workspaceRoot, "supabase", "migrations");
  if (!existsSync(migrationDir)) return evidence;

  for (const file of readdirSync(migrationDir).filter((item) => item.endsWith(".sql")).sort((a, b) => a.localeCompare(b))) {
    const raw = readFileSync(join(migrationDir, file), "utf8");
    const lower = raw.toLowerCase();
    for (const table of expectedTables) {
      const publicName = `public.${table.toLowerCase()}`;
      if (!lower.includes(publicName) && !lower.includes(table.toLowerCase())) continue;
      const current = evidence.get(table);
      if (!current) continue;
      current.migrationFiles.push(file);
      current.declared ||= lower.includes(`create table if not exists ${publicName}`) || lower.includes(`create table ${publicName}`);
      current.rlsEnabled ||= lower.includes(`alter table ${publicName} enable row level security`);
      current.anonRevoked ||= lower.includes("from anon, authenticated") && lower.includes(publicName);
      current.serviceRoleGrant ||= lower.includes("to service_role") && lower.includes(publicName);
    }
  }

  return evidence;
}

function gate(input: DecisionSupabaseSchemaManifestGate): DecisionSupabaseSchemaManifestGate {
  return input;
}

function manifestStatus({
  isolation,
  binder,
  readiness
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  readiness: DecisionEngineReadiness;
}): DecisionSupabaseSchemaManifestStatus {
  const evidence = isolation.detected.mcpSchemaEvidence;
  const completeObservedOpSchema =
    evidence.expectedTablesPresent.length === readiness.supabase.preflight.expectedTables.length && evidence.missingExpectedTables.length === 0;
  const targetMatchesExpected = readiness.supabase.preflight.targetMatchesExpected && (!isolation.detected.linkedRef || isolation.detected.linkedRef === ODDSPADI_SUPABASE_PROJECT_REF);
  if (isolation.status === "blocked-wrong-target") return "blocked-cross-project";
  if (isolation.status === "blocked-cross-project" && (!targetMatchesExpected || !completeObservedOpSchema || evidence.status !== "mixed-schema")) return "blocked-cross-project";
  if (isolation.status === "blocked-cross-project" && targetMatchesExpected && completeObservedOpSchema && evidence.status === "mixed-schema") {
    return "contained-mixed-schema";
  }
  if (readiness.supabase.schema.credentialStatus === "invalid") return "blocked-credentials";
  if (!binder.controls.canUseMcpForSchema) return "needs-project-proof";
  if (readiness.supabase.schema.status !== "ready") return "needs-live-schema";
  return "ready-live-schema";
}

function statusSummary(status: DecisionSupabaseSchemaManifestStatus): string {
  if (status === "ready-live-schema") return "OddsPadi Supabase schema is locally declared and live-verified; write features still need their own guarded run receipts.";
  if (status === "contained-mixed-schema") return "OddsPadi op_ tables are present inside a mixed public schema; read-only dry-runs can inspect the namespace, but migrations, writes, training, and publishing stay locked.";
  if (status === "blocked-cross-project") return "Supabase schema manifest is blocked because live/project evidence points at a foreign or wrong schema.";
  if (status === "blocked-credentials") return "Supabase schema manifest is blocked because the configured server credential was rejected.";
  if (status === "needs-live-schema") return "Supabase schema manifest has project proof but still needs all expected op_ tables verified live.";
  return "Supabase schema manifest needs OddsPadi project, MCP, and schema proof before migrations or storage writes can unlock.";
}

export function buildDecisionSupabaseSchemaManifest({
  readiness,
  isolation,
  binder,
  workspaceRoot = process.cwd()
}: {
  readiness: DecisionEngineReadiness;
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  workspaceRoot?: string;
}): DecisionSupabaseSchemaManifest {
  const expectedTables = readiness.supabase.preflight.expectedTables;
  const localEvidence = readLocalEvidence(workspaceRoot, expectedTables);
  const liveChecks = new Map(readiness.supabase.schema.tableChecks.map((check) => [check.table, check]));
  const mcpVerifiedTables = new Set(isolation.detected.mcpSchemaEvidence.expectedTablesPresent);
  const tables = expectedTables.map((table) => {
    const local = localEvidence.get(table) ?? {
      migrationFiles: [],
      declared: false,
      rlsEnabled: false,
      anonRevoked: false,
      serviceRoleGrant: false
    };
    const live = liveChecks.get(table);
    const liveStatus: DecisionSupabaseSchemaManifestTable["liveStatus"] =
      live?.status === "verified" || mcpVerifiedTables.has(table) ? "verified" : live?.status ?? "not-checked";
    const tableStatus: DecisionSupabaseSchemaManifestGateStatus =
      liveStatus === "verified" && local.declared && local.rlsEnabled
        ? "pass"
        : liveStatus === "credential-error" || liveStatus === "missing"
          ? "block"
          : "watch";
    return {
      table,
      domain: domainForTable(table),
      localDeclared: local.declared,
      localRlsEnabled: local.rlsEnabled,
      localAnonRevoked: local.anonRevoked,
      localServiceRoleGrant: local.serviceRoleGrant,
      liveStatus,
      rowCount: live?.status === "verified" ? live.rowCount : null,
      migrationFiles: local.migrationFiles,
      status: tableStatus,
      nextAction:
        tableStatus === "pass"
          ? "Keep local SQL, RLS, and live verification aligned."
          : !local.declared
            ? "Add or repair the local migration declaration for this required op_ table."
            : liveStatus === "not-checked"
              ? "Run live OddsPadi schema verification after project-scoped MCP and service credentials are proven."
              : "Apply/verify this table in the OddsPadi Supabase project before storage or training writes."
    };
  });
  const domains = DOMAINS.map((domain) => {
    const domainTables = tables.filter((table) => table.domain === domain.id);
    const declaredCount = domainTables.filter((table) => table.localDeclared).length;
    const verifiedCount = domainTables.filter((table) => table.liveStatus === "verified").length;
    const blockedCount = domainTables.filter((table) => table.status === "block").length;
    const status: DecisionSupabaseSchemaManifestGateStatus =
      blockedCount > 0 ? "block" : declaredCount === domainTables.length && verifiedCount === domainTables.length ? "pass" : "watch";
    return {
      ...domain,
      declaredCount,
      verifiedCount,
      blockedCount,
      status
    };
  });
  const status = manifestStatus({ readiness, isolation, binder });
  const localDeclaredTables = tables.filter((table) => table.localDeclared).length;
  const localRlsTables = tables.filter((table) => table.localRlsEnabled).length;
  const liveVerifiedTables = tables.filter((table) => table.liveStatus === "verified").length;
  const nextBlockingDomain = domains.find((domain) => domain.status === "block") ?? domains.find((domain) => domain.status === "watch") ?? null;
  const gates = [
    gate({
      id: "project-isolation",
      label: "Project isolation",
      status: status === "blocked-cross-project" ? "block" : status === "contained-mixed-schema" ? "watch" : isolation.status === "ready-isolated" || isolation.status === "needs-mcp-proof" ? "watch" : "watch",
      detail: isolation.summary,
      nextAction:
        status === "contained-mixed-schema"
          ? "Use the op_ namespace for read-only dry-run proof only; move production writes to a clean OddsPadi project or explicitly approve containment."
          : isolation.status === "ready-isolated"
            ? "Keep proof attached before any write-mode route is used."
            : "Prove the active MCP/session is scoped to OddsPadi before migrations."
    }),
    gate({
      id: "local-schema",
      label: "Local migration schema",
      status: localDeclaredTables === expectedTables.length && localRlsTables === expectedTables.length ? "pass" : "watch",
      detail: `${localDeclaredTables}/${expectedTables.length} required tables are locally declared and ${localRlsTables}/${expectedTables.length} have local RLS enablement.`,
      nextAction: "Keep the local SQL manifest as the source of truth before applying anything live."
    }),
    gate({
      id: "live-schema",
      label: "Live op_ verification",
      status: readiness.supabase.schema.status === "ready" ? "pass" : readiness.supabase.schema.credentialStatus === "invalid" ? "block" : "watch",
      detail:
        mcpVerifiedTables.size === expectedTables.length && readiness.supabase.schema.credentialStatus === "invalid"
          ? `Live MCP proof verifies ${mcpVerifiedTables.size}/${expectedTables.length} expected op_ tables, but the app server credential is rejected.`
          : readiness.supabase.schema.detail,
      nextAction:
        readiness.supabase.schema.status === "ready"
          ? "Keep readiness table checks green before running provider backfills."
          : "Verify the expected op_ tables in the OddsPadi project with server credentials or project-scoped MCP."
    }),
    gate({
      id: "data-api-rls",
      label: "Data API and RLS",
      status: tables.every((table) => table.localRlsEnabled && table.localServiceRoleGrant) ? "pass" : "watch",
      detail: "Required op_ tables are intended to stay server-only: RLS enabled, anon/auth revoked, service-role grants used by API routes.",
      nextAction: "If Supabase Data API settings require explicit grants, grant only the required server-side roles and keep public client writes closed."
    }),
    gate({
      id: "write-locks",
      label: "Write and training locks",
      status: binder.controls.canWriteProviderRows || binder.controls.canPersistDecisions || binder.controls.canTrainModels ? "block" : "pass",
      detail: "Provider writes, decision persistence, model training, and public picks remain closed from schema proof alone.",
      nextAction: "Unlock write modes only through the dedicated guarded run receipts after live schema proof passes."
    })
  ];
  const manifestHash = stableHash({
    status,
    expectedTables,
    project: [readiness.supabase.preflight.configuredProjectRef, readiness.supabase.preflight.urlProjectRef, isolation.detected.linkedRef],
    local: tables.map((table) => [table.table, table.localDeclared, table.localRlsEnabled, table.localServiceRoleGrant]),
    live: tables.map((table) => [table.table, table.liveStatus, table.rowCount]),
    domains: domains.map((domain) => [domain.id, domain.status, domain.declaredCount, domain.verifiedCount])
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "supabase-schema-manifest",
    status,
    manifestHash,
    summary: statusSummary(status),
    project: {
      expectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
      configuredRef: readiness.supabase.preflight.configuredProjectRef,
      urlRef: readiness.supabase.preflight.urlProjectRef,
      linkedRef: isolation.detected.linkedRef,
      repoMcpRef: isolation.detected.repoMcpConfig.projectRef,
      mcpProofRef: isolation.detected.mcpProofRef,
      targetMatchesExpected: readiness.supabase.preflight.targetMatchesExpected && (!isolation.detected.linkedRef || isolation.detected.linkedRef === ODDSPADI_SUPABASE_PROJECT_REF)
    },
    inventory: {
      expectedTables: expectedTables.length,
      localDeclaredTables,
      localRlsTables,
      liveVerifiedTables,
      missingTables: readiness.supabase.schema.missingTables,
      credentialErrorTables: readiness.supabase.schema.credentialErrorTables,
      inaccessibleTables: readiness.supabase.schema.inaccessibleTables,
      migrationCount: binder.local.migrationCount
    },
    domains,
    tables,
    gates,
    nextAction: {
      label: nextBlockingDomain ? `Verify ${nextBlockingDomain.label}` : "Recheck Supabase schema manifest",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-schema-manifest")}"`,
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: true,
      missing: Array.from(
        new Set([
          ...(binder.controls.canUseMcpForSchema ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]),
          ...(readiness.supabase.schema.credentialStatus === "valid" ? [] : ["valid SUPABASE_SERVICE_ROLE_KEY"]),
          ...(liveVerifiedTables === expectedTables.length ? [] : ["verified op_ schema"])
        ])
      )
    },
    controls: {
      canInspectLocal: true,
      canUseLiveMcpForSchema: binder.controls.canUseMcpForSchema || status === "contained-mixed-schema",
      canApplyMigrations: binder.controls.canApplyMigrations,
      canStoreFixtureCorpus: false,
      canPersistDecisionMemory: false,
      canTrainModels: false,
      canPublishPicks: false
    },
    docs: {
      rls: "https://supabase.com/docs/guides/database/postgres/row-level-security",
      dataApi: "https://supabase.com/docs/guides/api/securing-your-api",
      mcp: "https://supabase.com/docs/guides/ai-tools/mcp"
    }
  };
}
