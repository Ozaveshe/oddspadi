import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseProofBinderStatus =
  | "ready-proof"
  | "needs-project-env"
  | "needs-mcp-proof"
  | "needs-schema-proof"
  | "blocked-invalid-key"
  | "blocked-cross-project";

export type DecisionSupabaseProofBinderGateStatus = "pass" | "watch" | "block";

export type DecisionSupabaseProofBinderGate = {
  id: string;
  label: string;
  status: DecisionSupabaseProofBinderGateStatus;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionSupabaseProofBinderMigration = {
  file: string;
  declaresTables: string[];
};

export type DecisionSupabaseProofBinder = {
  generatedAt: string;
  mode: "supabase-proof-binder";
  status: DecisionSupabaseProofBinderStatus;
  binderHash: string;
  summary: string;
  expected: {
    projectRef: string;
    projectUrl: string;
    tableCount: number;
    tables: string[];
  };
  observed: {
    configuredRef: string | null;
    urlRef: string | null;
    linkedRef: string | null;
    repoMcpRef: string | null;
    mcpProofRef: string | null;
    repoMcpScoped: boolean;
    mcpSchemaEvidence: DecisionSupabaseProjectIsolation["detected"]["mcpSchemaEvidence"];
    schemaStatus: DecisionEngineReadiness["supabase"]["schema"]["status"];
    credentialStatus: DecisionEngineReadiness["supabase"]["schema"]["credentialStatus"];
    verifiedTableCount: number;
    missingTables: string[];
    inaccessibleTables: string[];
    foreignSchemaSignals: DecisionEngineReadiness["supabase"]["schema"]["foreignSchemaSignals"];
  };
  local: {
    migrationCount: number;
    migrations: DecisionSupabaseProofBinderMigration[];
    declaresExpectedTables: boolean;
    missingDeclaredTables: string[];
  };
  gates: DecisionSupabaseProofBinderGate[];
  nextProof: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
    missingEnv: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canUseMcpForSchema: boolean;
    canApplyMigrations: boolean;
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

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
}

function gate(input: DecisionSupabaseProofBinderGate): DecisionSupabaseProofBinderGate {
  return input;
}

function readMigrationDeclarations(workspaceRoot: string, expectedTables: string[]): DecisionSupabaseProofBinderMigration[] {
  const dir = join(workspaceRoot, "supabase", "migrations");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8").toLowerCase();
      return {
        file,
        declaresTables: expectedTables.filter((table) => raw.includes(table.toLowerCase()))
      };
    });
}

function binderStatus({
  isolation,
  targetReady,
  credentialInvalid,
  mcpProofReady,
  schemaReady
}: {
  isolation: DecisionSupabaseProjectIsolation;
  targetReady: boolean;
  credentialInvalid: boolean;
  mcpProofReady: boolean;
  schemaReady: boolean;
}): DecisionSupabaseProofBinderStatus {
  if (isolation.status === "blocked-cross-project" || isolation.status === "blocked-wrong-target") return "blocked-cross-project";
  if (credentialInvalid || isolation.status === "blocked-invalid-key") return "blocked-invalid-key";
  if (!targetReady) return "needs-project-env";
  if (!mcpProofReady) return "needs-mcp-proof";
  if (!schemaReady) return "needs-schema-proof";
  return "ready-proof";
}

function statusSummary(status: DecisionSupabaseProofBinderStatus): string {
  if (status === "ready-proof") return "Supabase project, MCP scope, credentials, schema, and local migrations are aligned for read-only proof review.";
  if (status === "blocked-cross-project") return "Supabase proof is blocked because configured evidence points at a wrong or foreign project/schema.";
  if (status === "blocked-invalid-key") return "Supabase proof is blocked because the configured server key was rejected.";
  if (status === "needs-project-env") return "Supabase proof still needs the OddsPadi project env and URL to line up.";
  if (status === "needs-mcp-proof") return "Supabase proof still needs an explicit OddsPadi-scoped MCP observation before schema work.";
  return "Supabase proof still needs all expected OddsPadi op_ tables to verify against the live project.";
}

export function buildDecisionSupabaseProofBinder({
  readiness,
  isolation,
  workspaceRoot = process.cwd()
}: {
  readiness: DecisionEngineReadiness;
  isolation: DecisionSupabaseProjectIsolation;
  workspaceRoot?: string;
}): DecisionSupabaseProofBinder {
  const expectedTables = readiness.supabase.preflight.expectedTables;
  const migrations = readMigrationDeclarations(workspaceRoot, expectedTables);
  const declaredTables = new Set(migrations.flatMap((migration) => migration.declaresTables));
  const missingDeclaredTables = expectedTables.filter((table) => !declaredTables.has(table));
  const declaresExpectedTables = expectedTables.length > 0 && missingDeclaredTables.length === 0;
  const schemaReady = readiness.supabase.schema.status === "ready";
  const credentialInvalid = readiness.supabase.schema.credentialStatus === "invalid";
  const targetReady =
    readiness.supabase.preflight.targetMatchesExpected &&
    (!isolation.detected.linkedRef || isolation.detected.linkedRef === ODDSPADI_SUPABASE_PROJECT_REF);
  const mcpProofReady = isolation.detected.mcpProofRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const repoMcpScoped = isolation.detected.repoMcpConfig.projectScoped;
  const foreignSchemaPresent = isolation.detected.foreignSchemaSignals.some((signal) => signal.status === "present");
  const mcpSchemaBlocked = isolation.detected.mcpSchemaEvidence.status === "foreign-schema" || isolation.detected.mcpSchemaEvidence.status === "mixed-schema";
  const mcpSchemaProofReady = isolation.detected.mcpSchemaEvidence.status === "odds-padi-proof" || isolation.detected.mcpSchemaEvidence.status === "not-provided";
  const status = binderStatus({ isolation, targetReady, credentialInvalid, mcpProofReady, schemaReady });
  const gates = [
    gate({
      id: "project-target",
      label: "Expected project",
      status: status === "blocked-cross-project" ? "block" : targetReady ? "pass" : "watch",
      detail: `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${readiness.supabase.preflight.configuredProjectRef ?? "missing"}; URL ${
        readiness.supabase.preflight.urlProjectRef ?? "missing"
      }; linked ${isolation.detected.linkedRef ?? "missing"}.`,
      nextAction: targetReady ? "Keep the same OddsPadi ref in local, Netlify, CLI, and MCP config." : `Point all Supabase env and local link values at ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      proofUrl: "/api/sports/decision/supabase-project-isolation"
    }),
    gate({
      id: "repo-mcp-config",
      label: "Repo MCP config",
      status: repoMcpScoped ? "pass" : isolation.detected.repoMcpConfig.present ? "watch" : "block",
      detail: repoMcpScoped
        ? "Repo .mcp.json is scoped to the OddsPadi project with database/docs features."
        : isolation.detected.repoMcpConfig.present
          ? `Repo .mcp.json exists, but project_ref is ${isolation.detected.repoMcpConfig.projectRef ?? "missing"}.`
          : "Repo .mcp.json is missing, so MCP schema work is not project-scoped from the workspace.",
      nextAction: `Use https://mcp.supabase.com/mcp?project_ref=${ODDSPADI_SUPABASE_PROJECT_REF}&features=database,docs for this repo.`,
      proofUrl: "/api/sports/decision/supabase-bootstrap"
    }),
    gate({
      id: "live-mcp-proof",
      label: "Live MCP observation",
      status: mcpSchemaBlocked ? "block" : mcpProofReady ? "pass" : "watch",
      detail: mcpSchemaBlocked
        ? isolation.detected.mcpSchemaEvidence.summary
        : mcpProofReady
        ? "ODDSPADI_SUPABASE_MCP_PROJECT_REF has been set after live MCP proof."
        : "The route cannot call Codex MCP directly; operator proof must show live list_tables against OddsPadi op_ tables before enabling schema operations.",
      nextAction: mcpSchemaBlocked
        ? "Switch the active MCP session/project before applying migrations or enabling persistence."
        : `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${ODDSPADI_SUPABASE_PROJECT_REF} only after MCP list_tables proves the OddsPadi op_ schema.`,
      proofUrl: "/api/sports/decision/status"
    }),
    gate({
      id: "mcp-schema-evidence",
      label: "MCP schema evidence",
      status: mcpSchemaBlocked ? "block" : mcpSchemaProofReady ? "pass" : "watch",
      detail: isolation.detected.mcpSchemaEvidence.summary,
      nextAction: mcpSchemaProofReady
        ? "Keep MCP schema evidence attached to the operator receipt."
        : "Capture an MCP table list that includes the expected OddsPadi op_ tables before schema operations.",
      proofUrl: "/api/sports/decision/supabase-project-isolation"
    }),
    gate({
      id: "server-key",
      label: "Server credential",
      status: credentialInvalid ? "block" : readiness.supabase.schema.credentialStatus === "valid" ? "pass" : readiness.supabase.preflight.serverClientConfigured ? "watch" : "block",
      detail: credentialInvalid
        ? readiness.supabase.schema.credentialErrorDetail ?? "Supabase rejected the configured server key."
        : readiness.supabase.schema.credentialStatus === "valid"
          ? "Server key has live schema proof."
          : readiness.supabase.preflight.serverClientConfigured
            ? "Server key exists but has not produced valid OddsPadi schema proof."
            : "Server key is missing, so live schema proof and writes are locked.",
      nextAction: credentialInvalid
        ? "Replace the service-role/secret key with one from the OddsPadi project and restart the app."
        : "Keep the secret key server-only and rerun readiness after restart.",
      proofUrl: "/api/sports/decision/status"
    }),
    gate({
      id: "op-schema",
      label: "Expected op_ tables",
      status: foreignSchemaPresent || credentialInvalid ? "block" : schemaReady ? "pass" : "watch",
      detail: `Verified ${readiness.supabase.schema.verifiedTableCount}/${readiness.supabase.schema.expectedTableCount}; missing ${readiness.supabase.schema.missingTables.length}; inaccessible ${readiness.supabase.schema.inaccessibleTables.length}.`,
      nextAction: schemaReady ? "Keep readiness expected table list aligned with migrations." : "Apply local migrations only after target, MCP, and credentials are proven.",
      proofUrl: "/api/sports/decision/status"
    }),
    gate({
      id: "local-migrations",
      label: "Local migration manifest",
      status: declaresExpectedTables ? "pass" : migrations.length ? "watch" : "block",
      detail: `${migrations.length} migration file(s) declare ${declaredTables.size}/${expectedTables.length} expected table names.`,
      nextAction: declaresExpectedTables
        ? "Use these migrations as the source of truth after live project proof passes."
        : `Review migrations for missing declarations: ${missingDeclaredTables.slice(0, 6).join(", ") || "expected op_ tables"}.`,
      proofUrl: "/api/sports/decision/supabase-proof-binder"
    }),
    gate({
      id: "foreign-schema",
      label: "Foreign schema signals",
      status: foreignSchemaPresent || isolation.detected.foreignProjectRefs.length ? "block" : "pass",
      detail: foreignSchemaPresent
        ? `Detected foreign table signals: ${isolation.detected.foreignSchemaSignals
            .filter((signal) => signal.status === "present")
            .map((signal) => `${signal.table} (${signal.product})`)
            .slice(0, 5)
            .join(", ")}.`
        : isolation.detected.foreignProjectRefs.length
          ? `Detected foreign refs: ${isolation.detected.foreignProjectRefs.map((item) => `${item.product}:${item.ref}`).join(", ")}.`
          : "No known foreign project refs or sentinel schema signals are present in app readiness.",
      nextAction: foreignSchemaPresent || isolation.detected.foreignProjectRefs.length ? "Do not write or migrate until this project confusion is cleared." : "Continue with read-only proof gates.",
      proofUrl: "/api/sports/decision/supabase-project-isolation"
    })
  ];
  const nextBlockingGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? null;
  const canUseMcpForSchema = targetReady && mcpProofReady && !foreignSchemaPresent && !mcpSchemaBlocked && !credentialInvalid;
  const canApplyMigrations = canUseMcpForSchema && declaresExpectedTables && !schemaReady;
  const binderHash = stableHash({
    status,
    expectedTables,
    project: [readiness.supabase.preflight.configuredProjectRef, readiness.supabase.preflight.urlProjectRef, isolation.detected.linkedRef],
    repoMcp: [isolation.detected.repoMcpConfig.projectRef, repoMcpScoped],
    mcpProof: isolation.detected.mcpProofRef,
    schema: [readiness.supabase.schema.status, readiness.supabase.schema.credentialStatus, readiness.supabase.schema.verifiedTableCount],
    migrations: migrations.map((migration) => [migration.file, migration.declaresTables.length]),
    missingDeclaredTables
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "supabase-proof-binder",
    status,
    binderHash,
    summary: statusSummary(status),
    expected: {
      projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      projectUrl: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      tableCount: expectedTables.length,
      tables: expectedTables
    },
    observed: {
      configuredRef: readiness.supabase.preflight.configuredProjectRef,
      urlRef: readiness.supabase.preflight.urlProjectRef,
      linkedRef: isolation.detected.linkedRef,
      repoMcpRef: isolation.detected.repoMcpConfig.projectRef,
      mcpProofRef: isolation.detected.mcpProofRef,
      repoMcpScoped,
      mcpSchemaEvidence: isolation.detected.mcpSchemaEvidence,
      schemaStatus: readiness.supabase.schema.status,
      credentialStatus: readiness.supabase.schema.credentialStatus,
      verifiedTableCount: readiness.supabase.schema.verifiedTableCount,
      missingTables: readiness.supabase.schema.missingTables,
      inaccessibleTables: readiness.supabase.schema.inaccessibleTables,
      foreignSchemaSignals: readiness.supabase.schema.foreignSchemaSignals
    },
    local: {
      migrationCount: migrations.length,
      migrations,
      declaresExpectedTables,
      missingDeclaredTables
    },
    gates,
    nextProof: {
      label: nextBlockingGate?.label ?? "Recheck proof binder",
      command: `curl.exe -sS "${safeLocalUrl(nextBlockingGate?.proofUrl ?? "/api/sports/decision/supabase-proof-binder")}"`,
      verifyUrl: nextBlockingGate?.proofUrl ?? "/api/sports/decision/supabase-proof-binder",
      safeToRun: true,
      expectedEvidence: nextBlockingGate?.detail ?? "Supabase proof binder stays ready without enabling writes.",
      missingEnv: Array.from(
        new Set([
          ...(targetReady ? [] : ["SUPABASE_PROJECT_REF", "SUPABASE_URL"]),
          ...(mcpProofReady ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]),
          ...(credentialInvalid || readiness.supabase.schema.credentialStatus !== "valid" ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : []),
          ...(schemaReady ? [] : ["verified op_ schema"])
        ])
      )
    },
    controls: {
      canInspectReadOnly: true,
      canUseMcpForSchema,
      canApplyMigrations,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    locks: [
      "No provider writes until OddsPadi project, MCP proof, credentials, and schema all pass.",
      "No decision persistence until op_ memory tables verify in the expected project.",
      "No model training until the 10-year corpus is imported, settled, and backtest-ready.",
      "No public pick publishing or public-action upgrade from Supabase proof alone.",
      "No OpenAI review unlock until OPENAI_API_KEY is configured and the guarded review route is explicitly requested."
    ],
    proofUrls: [
      "/api/sports/decision/status",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/supabase-bootstrap",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
