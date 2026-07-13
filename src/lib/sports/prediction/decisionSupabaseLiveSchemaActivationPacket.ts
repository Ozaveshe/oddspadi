import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseLiveSchemaActivationStatus =
  | "ready-to-verify-live-schema"
  | "contained-read-only"
  | "ready-to-apply-schema"
  | "blocked-credentials"
  | "blocked-cross-project"
  | "needs-mcp-proof"
  | "needs-live-schema";

export type DecisionSupabaseLiveSchemaActivationGateStatus = "pass" | "watch" | "block";
export type DecisionSupabaseLiveSchemaActivationCommandKind = "verify" | "operator" | "sql-reference";

export type DecisionSupabaseLiveSchemaActivationGate = {
  id: string;
  label: string;
  status: DecisionSupabaseLiveSchemaActivationGateStatus;
  detail: string;
  nextAction: string;
};

export type DecisionSupabaseLiveSchemaActivationCommand = {
  id: string;
  kind: DecisionSupabaseLiveSchemaActivationCommandKind;
  label: string;
  command: string;
  verifyUrl: string | null;
  safeToRun: boolean;
  expectedEvidence: string;
  missing: string[];
};

export type DecisionSupabaseLiveSchemaActivationSqlProbe = {
  id: string;
  label: string;
  sql: string;
  expectedEvidence: string;
  writeRisk: "read-only" | "ddl" | "forbidden";
};

export type DecisionSupabaseLiveSchemaActivationPacket = {
  generatedAt: string;
  mode: "supabase-live-schema-activation-packet";
  status: DecisionSupabaseLiveSchemaActivationStatus;
  activationHash: string;
  summary: string;
  target: {
    projectRef: string;
    configuredRef: string | null;
    urlRef: string | null;
    linkedRef: string | null;
    repoMcpRef: string | null;
    liveMcpProofRef: string | null;
  };
  inventory: {
    expectedTables: number;
    localDeclaredTables: number;
    localRlsTables: number;
    liveVerifiedTables: number;
    credentialErrorTables: number;
    migrationCount: number;
  };
  gates: DecisionSupabaseLiveSchemaActivationGate[];
  commands: DecisionSupabaseLiveSchemaActivationCommand[];
  sqlProbes: DecisionSupabaseLiveSchemaActivationSqlProbe[];
  nextCommand: DecisionSupabaseLiveSchemaActivationCommand;
  operatorChecklist: string[];
  controls: {
    canInspectReadOnly: true;
    canTrustCurrentMcp: boolean;
    canReplaceCredential: boolean;
    canVerifyLiveSchema: boolean;
    canRequestSchemaApply: boolean;
    canStoreProviderRows: false;
    canPersistDecisionMemory: false;
    canTrainModels: false;
    canPublishPicks: false;
  };
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

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
}

function gate(input: DecisionSupabaseLiveSchemaActivationGate): DecisionSupabaseLiveSchemaActivationGate {
  return input;
}

function command(input: DecisionSupabaseLiveSchemaActivationCommand): DecisionSupabaseLiveSchemaActivationCommand {
  const lower = input.command.toLowerCase();
  const safeToRun =
    input.safeToRun &&
    lower.includes("curl.exe") &&
    !lower.includes("persist=1") &&
    !lower.includes("dryrun=0") &&
    !lower.includes("apply_migration") &&
    !lower.includes("service_role");
  return {
    ...input,
    safeToRun
  };
}

function statusFor({
  isolation,
  binder,
  manifest,
  readiness
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  manifest: DecisionSupabaseSchemaManifest;
  readiness: DecisionEngineReadiness;
}): DecisionSupabaseLiveSchemaActivationStatus {
  if (manifest.status === "contained-mixed-schema") return "contained-read-only";
  if (isolation.status === "blocked-cross-project" || isolation.status === "blocked-wrong-target" || manifest.status === "blocked-cross-project") return "blocked-cross-project";
  if (readiness.supabase.schema.credentialStatus === "invalid" || manifest.status === "blocked-credentials") return "blocked-credentials";
  if (!binder.controls.canUseMcpForSchema) return "needs-mcp-proof";
  if (manifest.status === "ready-live-schema") return "ready-to-verify-live-schema";
  if (binder.controls.canApplyMigrations && manifest.inventory.localDeclaredTables === manifest.inventory.expectedTables) return "ready-to-apply-schema";
  return "needs-live-schema";
}

function statusSummary(status: DecisionSupabaseLiveSchemaActivationStatus): string {
  if (status === "ready-to-verify-live-schema") return "Live OddsPadi schema is verified; keep write-mode routes locked until provider dry-runs and storage receipts pass.";
  if (status === "contained-read-only") return "Live OddsPadi op_ schema is present inside a mixed public schema; read-only provider dry-runs may inspect it, but schema apply and writes stay locked.";
  if (status === "ready-to-apply-schema") return "OddsPadi project, MCP proof, and local schema are ready for a supervised live schema apply step.";
  if (status === "blocked-cross-project") return "Live schema activation is blocked because project or MCP evidence points at a foreign/wrong schema.";
  if (status === "blocked-credentials") return "Live schema activation is blocked until the OddsPadi server credential is replaced and the app is restarted.";
  if (status === "needs-mcp-proof") return "Live schema activation needs project-scoped Supabase MCP proof before any schema operation.";
  return "Live schema activation needs all expected OddsPadi op_ tables verified before storage, training, or persistence can unlock.";
}

export function buildDecisionSupabaseLiveSchemaActivationPacket({
  readiness,
  isolation,
  binder,
  manifest
}: {
  readiness: DecisionEngineReadiness;
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  manifest: DecisionSupabaseSchemaManifest;
}): DecisionSupabaseLiveSchemaActivationPacket {
  const credentialBlocked = readiness.supabase.schema.credentialStatus === "invalid" || manifest.status === "blocked-credentials";
  const linkedTargetSafe = !isolation.detected.linkedRef || isolation.detected.linkedRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const targetReady = manifest.project.targetMatchesExpected && linkedTargetSafe;
  const mcpProofReady = binder.controls.canUseMcpForSchema;
  const localSchemaReady =
    manifest.inventory.localDeclaredTables === manifest.inventory.expectedTables &&
    manifest.inventory.localRlsTables === manifest.inventory.expectedTables;
  const status = statusFor({ isolation, binder, manifest, readiness });
  const containedReadOnly = status === "contained-read-only";
  const liveSchemaReady = manifest.status === "ready-live-schema" || containedReadOnly;
  const canRequestSchemaApply = !containedReadOnly && binder.controls.canApplyMigrations && localSchemaReady && !credentialBlocked;
  const gates = [
    gate({
      id: "target-project",
      label: "OddsPadi project target",
      status: status === "blocked-cross-project" ? "block" : containedReadOnly ? "watch" : targetReady ? "pass" : "watch",
      detail: `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${manifest.project.configuredRef ?? "missing"}; URL ${manifest.project.urlRef ?? "missing"}; linked ${manifest.project.linkedRef ?? "missing"}.`,
      nextAction: containedReadOnly
        ? "Keep this as read-only contained proof; do not apply schema or write rows from the mixed public schema."
        : targetReady
          ? "Keep local, Netlify, CLI, and MCP evidence pointed at this ref."
          : `Retarget every Supabase environment and CLI link to ${ODDSPADI_SUPABASE_PROJECT_REF}.`
    }),
    gate({
      id: "server-credential",
      label: "Server credential",
      status: credentialBlocked ? "block" : readiness.supabase.schema.credentialStatus === "valid" ? "pass" : "watch",
      detail: credentialBlocked
        ? readiness.supabase.schema.credentialErrorDetail ?? "The configured server credential was rejected while checking op_ tables."
        : readiness.supabase.schema.credentialStatus === "valid"
          ? "Server credential produced live schema reads."
          : "Server credential has not produced live schema proof yet.",
      nextAction: credentialBlocked
        ? "Replace the server-only Supabase secret/service-role key from the OddsPadi project and restart the app."
        : "Keep the service credential server-only and re-run schema verification."
    }),
    gate({
      id: "mcp-proof",
      label: "Project-scoped MCP proof",
      status: mcpProofReady || containedReadOnly ? "pass" : isolation.detected.mcpSchemaEvidence.status === "foreign-schema" || isolation.detected.mcpSchemaEvidence.status === "mixed-schema" ? "block" : "watch",
      detail: isolation.detected.mcpSchemaEvidence.summary,
      nextAction: mcpProofReady || containedReadOnly
        ? "Keep the MCP proof receipt attached before any schema operation."
        : `Use a Supabase MCP session scoped to ${ODDSPADI_SUPABASE_PROJECT_REF}; do not use the current generic/foreign schema output.`
    }),
    gate({
      id: "local-schema-safety",
      label: "Local schema safety",
      status: localSchemaReady ? "pass" : "watch",
      detail: `${manifest.inventory.localDeclaredTables}/${manifest.inventory.expectedTables} tables declared; ${manifest.inventory.localRlsTables}/${manifest.inventory.expectedTables} tables have local RLS enablement.`,
      nextAction: localSchemaReady ? "Treat local migrations as the schema source of truth after project proof passes." : "Repair local migrations before attempting any live apply."
    }),
    gate({
      id: "live-op-schema",
      label: "Live op_ schema",
      status: liveSchemaReady ? "pass" : credentialBlocked ? "block" : "watch",
      detail: `${manifest.inventory.liveVerifiedTables}/${manifest.inventory.expectedTables} expected op_ tables are live-verified.`,
      nextAction: liveSchemaReady
        ? "Proceed only to guarded provider dry-runs and storage receipts."
        : "Verify all expected op_ tables through the app readiness endpoint after credentials and MCP scope are fixed."
    }),
    gate({
      id: "write-mode-locks",
      label: "Write mode locks",
      status: "pass",
      detail: "This packet never unlocks provider writes, decision persistence, model training, or public pick publishing by itself.",
      nextAction: "Use provider dry-run receipts, backtest proof, and explicit admin-gated write routes for later unlocks."
    })
  ];
  const commands = [
    command({
      id: "schema-manifest",
      kind: "verify",
      label: "Read schema manifest",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-schema-manifest")}"`,
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: true,
      expectedEvidence: "Returns expected table inventory, local migration/RLS counts, live table proof, and write locks.",
      missing: []
    }),
    command({
      id: "project-isolation",
      kind: "verify",
      label: "Read project isolation",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-project-isolation")}"`,
      verifyUrl: "/api/sports/decision/supabase-project-isolation",
      safeToRun: true,
      expectedEvidence: "Returns project ref, repo MCP scope, live MCP proof status, and foreign schema signals.",
      missing: []
    }),
    command({
      id: "status-after-credential",
      kind: "verify",
      label: "Recheck status after credential update",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/status")}"`,
      verifyUrl: "/api/sports/decision/status",
      safeToRun: true,
      expectedEvidence: "After a server restart, Supabase credential status becomes valid and op_ tables move out of credential-error.",
      missing: credentialBlocked ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : []
    }),
    command({
      id: "mcp-operator-proof",
      kind: "operator",
      label: "Attach MCP project proof",
      command: `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${ODDSPADI_SUPABASE_PROJECT_REF} only after a live MCP list_tables proof shows the OddsPadi op_ schema.`,
      verifyUrl: "/api/sports/decision/supabase-proof-binder",
      safeToRun: false,
      expectedEvidence: "Proof binder reports repo MCP scope and live MCP proof for the OddsPadi project.",
      missing: mcpProofReady ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]
    }),
    command({
      id: "schema-apply-operator-step",
      kind: "operator",
      label: "Apply local migrations under supervision",
      command: "Use the project-scoped Supabase MCP or CLI only after this packet reports ready-to-apply-schema; do not run against a generic/global Supabase target.",
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: false,
      expectedEvidence: `All ${manifest.inventory.expectedTables} expected op_ tables verify live in OddsPadi after apply.`,
      missing: canRequestSchemaApply ? [] : Array.from(new Set([...manifest.nextAction.missing, ...(mcpProofReady ? [] : ["project-scoped MCP"]), ...(localSchemaReady ? [] : ["complete local schema"])]))
    })
  ];
  const nextCommand = commands.find((item) => item.safeToRun && !item.missing.length) ?? commands[0];
  const sqlProbes = [
    {
      id: "list-op-tables",
      label: "List live op_ tables",
      sql: "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'op_%' order by table_name;",
      expectedEvidence: `Returns all ${manifest.inventory.expectedTables} expected OddsPadi op_ table names and no foreign product sentinel tables.`,
      writeRisk: "read-only" as const
    },
    {
      id: "rls-flags",
      label: "Check RLS flags",
      sql: "select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'op_%' order by tablename;",
      expectedEvidence: "Every expected op_ table has rowsecurity enabled.",
      writeRisk: "read-only" as const
    }
  ];
  const operatorChecklist = [
    "Replace only the server-side Supabase secret/service-role key for the OddsPadi project; do not paste or expose the value in chat, logs, or source.",
    "Restart the local Next.js server so readiness uses the new credential.",
    `Prove the active Supabase MCP session is scoped to ${ODDSPADI_SUPABASE_PROJECT_REF} and not the generic AfroTools/LATMtools/global schema.`,
    "Run the schema manifest and project-isolation endpoints until credentials, MCP proof, and live op_ table counts line up.",
    "Apply local migrations only after this packet reaches ready-to-apply-schema, then re-run status and schema manifest before any provider write route.",
    "Keep fixture storage, decision persistence, model training, and public picks locked until their separate dry-run/backtest/admin receipts pass."
  ];
  const activationHash = stableHash({
    status,
    target: manifest.project,
    inventory: manifest.inventory,
    gates: gates.map((item) => [item.id, item.status]),
    commands: commands.map((item) => [item.id, item.safeToRun, item.missing])
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "supabase-live-schema-activation-packet",
    status,
    activationHash,
    summary: statusSummary(status),
    target: {
      projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      configuredRef: manifest.project.configuredRef,
      urlRef: manifest.project.urlRef,
      linkedRef: manifest.project.linkedRef,
      repoMcpRef: manifest.project.repoMcpRef,
      liveMcpProofRef: manifest.project.mcpProofRef
    },
    inventory: {
      expectedTables: manifest.inventory.expectedTables,
      localDeclaredTables: manifest.inventory.localDeclaredTables,
      localRlsTables: manifest.inventory.localRlsTables,
      liveVerifiedTables: manifest.inventory.liveVerifiedTables,
      credentialErrorTables: manifest.inventory.credentialErrorTables.length,
      migrationCount: manifest.inventory.migrationCount
    },
    gates,
    commands,
    sqlProbes,
    nextCommand,
    operatorChecklist,
    controls: {
      canInspectReadOnly: true,
      canTrustCurrentMcp: mcpProofReady || containedReadOnly,
      canReplaceCredential: targetReady,
      canVerifyLiveSchema: !credentialBlocked && targetReady,
      canRequestSchemaApply,
      canStoreProviderRows: false,
      canPersistDecisionMemory: false,
      canTrainModels: false,
      canPublishPicks: false
    },
    locks: [
      containedReadOnly
        ? "Contained mode allows read-only op_ inspection only; do not apply schema or write rows from the mixed public schema."
        : "Do not run live schema operations while the active MCP/table list points at a foreign schema.",
      "Do not expose service-role or secret keys in client code, terminal output, screenshots, or chat.",
      "Do not use Data API exposure as a substitute for RLS; both access and row-level posture must be deliberate.",
      "Do not enable provider writes, decision persistence, training, or public picks from schema activation alone."
    ]
  };
}
