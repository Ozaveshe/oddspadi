import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import { getSupabaseRuntimeStatus, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

type EnvMap = Record<string, string | undefined>;

export type DecisionSupabaseProjectIsolationStatus =
  | "ready-isolated"
  | "needs-project-env"
  | "needs-keys"
  | "needs-mcp-proof"
  | "needs-schema-proof"
  | "blocked-cross-project"
  | "blocked-wrong-target"
  | "blocked-invalid-key";

export type DecisionSupabaseProjectIsolationGateStatus = "pass" | "watch" | "block";

export type DecisionSupabaseProjectIsolationGate = {
  id: string;
  status: DecisionSupabaseProjectIsolationGateStatus;
  label: string;
  detail: string;
  nextAction: string;
};

export type DecisionSupabaseProjectIsolationMcpConfig = {
  present: boolean;
  serverName: string | null;
  serverUrl: string | null;
  projectRef: string | null;
  projectScoped: boolean;
  docsEnabled: boolean;
  databaseEnabled: boolean;
};

export type DecisionSupabaseMcpSchemaEvidenceStatus = "not-provided" | "odds-padi-proof" | "missing-op-schema" | "foreign-schema" | "mixed-schema";

export type DecisionSupabaseMcpSchemaEvidence = {
  status: DecisionSupabaseMcpSchemaEvidenceStatus;
  source: string;
  observedTables: string[];
  opTableCount: number;
  expectedTablesPresent: string[];
  missingExpectedTables: string[];
  foreignSchemaSignals: DecisionEngineReadiness["supabase"]["schema"]["foreignSchemaSignals"];
  summary: string;
};

export type DecisionSupabaseProjectIsolation = {
  generatedAt: string;
  mode: "supabase-project-isolation";
  status: DecisionSupabaseProjectIsolationStatus;
  isolationHash: string;
  summary: string;
  expected: {
    projectRef: string;
    projectUrl: string;
  };
  detected: {
    configuredProjectRef: string | null;
    urlProjectRef: string | null;
    projectHost: string | null;
    linkedRef: string | null;
    linkedName: string | null;
    mcpProofRef: string | null;
    observedMcpProjectRef: string | null;
    repoMcpConfig: DecisionSupabaseProjectIsolationMcpConfig;
    mcpSchemaEvidence: DecisionSupabaseMcpSchemaEvidence;
    foreignProjectRefs: Array<{
      ref: string;
      product: string;
      source: string;
    }>;
    foreignSchemaSignals: DecisionEngineReadiness["supabase"]["schema"]["foreignSchemaSignals"];
  };
  keys: {
    publishableConfigured: boolean;
    serviceRoleConfigured: boolean;
    serviceRoleVerified: boolean;
    serviceRoleRejected: boolean;
  };
  gates: DecisionSupabaseProjectIsolationGate[];
  locks: {
    canExposeClientRead: boolean;
    canReadDecisionMemory: boolean;
    canWriteDecisionMemory: boolean;
    canApplyMigrations: boolean;
    canRunProviderDryRun: boolean;
    canRunWriteBackfill: false;
    canTrainModel: false;
    canPublishPicks: false;
  };
  env: {
    requiredProject: string[];
    requiredPublicRead: string[];
    requiredServerWrite: string[];
    requiredMcpProof: string[];
    missing: string[];
  };
  proof: {
    safeCommands: string[];
    verificationUrls: string[];
    docs: string[];
    forbiddenActions: string[];
  };
  nextAction: string;
};

const KNOWN_FOREIGN_PROJECT_REFS: Record<string, string> = {
  zpclagtgczsygrgztlts: "AfroTools",
  obtgxgbcoychelycvrfj: "LATMtools"
};

const ODDSPADI_MCP_EXPECTED_TABLES = [
  "op_model_versions",
  "op_decision_runs",
  "op_decision_evidence_bundles",
  "op_provider_ingestion_runs",
  "op_raw_provider_payloads",
  "op_prediction_outcomes",
  "op_calibration_runs",
  "op_ai_thought_episodes",
  "op_decision_briefings",
  "op_shadow_memory_replay",
  "op_leagues",
  "op_teams",
  "op_fixtures",
  "op_fixture_team_features",
  "op_standings_snapshots",
  "op_odds_snapshots",
  "op_player_availability_snapshots",
  "op_lineup_snapshots",
  "op_live_match_events",
  "op_news_signals",
  "op_weather_snapshots",
  "op_training_feature_snapshots",
  "op_backtest_runs"
];

const MCP_FOREIGN_SCHEMA_SENTINELS = [
  { table: "as_news", product: "AfroTools/AfroStream" },
  { table: "scholarships", product: "AfroTools Scholarship Finder" },
  { table: "business_ideas", product: "AfroTools Business Ideas" },
  { table: "matchday_profiles", product: "Matchday OS" },
  { table: "creator_profiles", product: "AfroTools Creator Tools" },
  { table: "payroll_clients", product: "AfroPayroll Pro" }
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

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function readLinkedProject(workspaceRoot: string): { ref: string | null; name: string | null } {
  const raw = readText(join(workspaceRoot, "supabase", ".temp", "linked-project.json"));
  if (!raw) {
    const ref = readText(join(workspaceRoot, "supabase", ".temp", "project-ref"));
    return { ref, name: null };
  }
  try {
    const parsed = JSON.parse(raw) as { ref?: string; name?: string };
    return { ref: parsed.ref ?? null, name: parsed.name ?? null };
  } catch {
    return { ref: null, name: null };
  }
}

function readRepoMcpConfig(workspaceRoot: string): DecisionSupabaseProjectIsolationMcpConfig {
  const raw = readText(join(workspaceRoot, ".mcp.json"));
  if (!raw) {
    return {
      present: false,
      serverName: null,
      serverUrl: null,
      projectRef: null,
      projectScoped: false,
      docsEnabled: false,
      databaseEnabled: false
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, { url?: string; type?: string }>;
    };
    const entries = Object.entries(parsed.mcpServers ?? {});
    const [serverName, server] = entries.find(([, value]) => typeof value.url === "string" && value.url.includes("supabase.com/mcp")) ?? entries[0] ?? [];
    const serverUrl = typeof server?.url === "string" ? server.url : null;
    let projectRef: string | null = null;
    let features: string[] = [];

    if (serverUrl) {
      const url = new URL(serverUrl);
      projectRef = url.searchParams.get("project_ref");
      features = (url.searchParams.get("features") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return {
      present: true,
      serverName: serverName ?? null,
      serverUrl,
      projectRef,
      projectScoped: projectRef === ODDSPADI_SUPABASE_PROJECT_REF,
      docsEnabled: features.includes("docs") || features.length === 0,
      databaseEnabled: features.includes("database") || features.length === 0
    };
  } catch {
    return {
      present: true,
      serverName: null,
      serverUrl: null,
      projectRef: null,
      projectScoped: false,
      docsEnabled: false,
      databaseEnabled: false
    };
  }
}

function projectRefFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const [ref] = new URL(value).host.split(".");
    return ref || null;
  } catch {
    return null;
  }
}

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
}

function gate(input: DecisionSupabaseProjectIsolationGate): DecisionSupabaseProjectIsolationGate {
  return input;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeTableName(value: string): string {
  return value
    .trim()
    .replace(/^public\./i, "")
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
}

function tableNamesFromUnknown(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return tableNamesFromUnknown(JSON.parse(text));
      } catch {
        return unique(text.split(/[,\s]+/).map(normalizeTableName).filter(Boolean));
      }
    }
    return unique(text.split(/[,\s]+/).map(normalizeTableName).filter(Boolean));
  }
  if (Array.isArray(value)) return unique(value.flatMap((item) => tableNamesFromUnknown(item)));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const tableValue = record.name ?? record.table ?? record.table_name ?? record.tableName;
    if (typeof tableValue === "string") {
      const schema = typeof record.schema === "string" ? record.schema : typeof record.table_schema === "string" ? record.table_schema : "";
      return [normalizeTableName(schema && !tableValue.includes(".") ? `${schema}.${tableValue}` : tableValue)];
    }
    return unique(["tables", "data", "response", "result"].flatMap((key) => tableNamesFromUnknown(record[key])));
  }
  return [];
}

export function parseObservedMcpTableList(value: unknown): string[] {
  return unique(tableNamesFromUnknown(value).map(normalizeTableName).filter(Boolean));
}

export function buildDecisionSupabaseMcpSchemaEvidence({
  observedTables = [],
  source = "not-provided",
  expectedTables = ODDSPADI_MCP_EXPECTED_TABLES
}: {
  observedTables?: string[];
  source?: string;
  expectedTables?: string[];
} = {}): DecisionSupabaseMcpSchemaEvidence {
  const normalizedTables = unique(observedTables.map(normalizeTableName).filter(Boolean)).sort((a, b) => a.localeCompare(b));
  const expectedSet = new Set(expectedTables.map(normalizeTableName));
  const expectedTablesPresent = normalizedTables.filter((table) => expectedSet.has(table));
  const missingExpectedTables = expectedTables.map(normalizeTableName).filter((table) => !expectedTablesPresent.includes(table));
  const foreignSchemaSignals = MCP_FOREIGN_SCHEMA_SENTINELS.map((sentinel) => ({
    table: sentinel.table,
    product: sentinel.product,
    status: normalizedTables.includes(sentinel.table) ? ("present" as const) : ("not-present" as const),
    error: null
  }));
  const presentForeign = foreignSchemaSignals.filter((signal) => signal.status === "present");
  const opTableCount = normalizedTables.filter((table) => table.startsWith("op_")).length;
  const status: DecisionSupabaseMcpSchemaEvidenceStatus = !normalizedTables.length
    ? "not-provided"
    : presentForeign.length && expectedTablesPresent.length
      ? "mixed-schema"
      : presentForeign.length
        ? "foreign-schema"
        : expectedTablesPresent.length === expectedTables.length
          ? "odds-padi-proof"
          : "missing-op-schema";

  return {
    status,
    source,
    observedTables: normalizedTables,
    opTableCount,
    expectedTablesPresent,
    missingExpectedTables,
    foreignSchemaSignals,
    summary:
      status === "not-provided"
        ? "No live MCP schema table list was provided to classify."
        : status === "odds-padi-proof"
          ? `Live MCP table list includes all ${expectedTables.length} expected OddsPadi op_ tables.`
          : status === "foreign-schema"
            ? `Live MCP table list exposes non-OddsPadi sentinel table(s): ${presentForeign.map((signal) => `${signal.table} (${signal.product})`).join(", ")}.`
            : status === "mixed-schema"
              ? `Live MCP table list mixes OddsPadi op_ tables with foreign sentinel table(s): ${presentForeign.map((signal) => signal.table).join(", ")}.`
              : `Live MCP table list has ${opTableCount} op_ table(s) and is missing ${missingExpectedTables.length} expected OddsPadi table(s).`
  };
}

function statusSummary(status: DecisionSupabaseProjectIsolationStatus): string {
  if (status === "ready-isolated") return "Supabase isolation is proven for OddsPadi; downstream write gates can evaluate their own permissions.";
  if (status === "blocked-cross-project") return "Supabase isolation is blocked because a known non-OddsPadi project ref or schema fingerprint is present.";
  if (status === "blocked-wrong-target") return "Supabase isolation is blocked because one or more configured project refs do not match OddsPadi.";
  if (status === "blocked-invalid-key") return "Supabase isolation is blocked because the configured server key was rejected by the OddsPadi project.";
  if (status === "needs-project-env") return "Supabase isolation needs the OddsPadi project ref and URL before any database work can be trusted.";
  if (status === "needs-keys") return "Supabase isolation has the OddsPadi target, but publishable/server keys are still missing or unverified.";
  if (status === "needs-mcp-proof") return "Supabase isolation needs an OddsPadi-scoped MCP proof before live schema work is allowed.";
  return "Supabase isolation needs verified OddsPadi op_ tables before memory writes or training can be considered.";
}

export function buildDecisionSupabaseProjectIsolation({
  readiness = null,
  env = process.env,
  workspaceRoot = process.cwd(),
  observedMcpProjectUrl = null,
  observedMcpTables = parseObservedMcpTableList(env.ODDSPADI_SUPABASE_MCP_OBSERVED_TABLES)
}: {
  readiness?: DecisionEngineReadiness | null;
  env?: EnvMap;
  workspaceRoot?: string;
  observedMcpProjectUrl?: string | null;
  observedMcpTables?: string[];
} = {}): DecisionSupabaseProjectIsolation {
  const runtime = getSupabaseRuntimeStatus(env);
  const linked = readLinkedProject(workspaceRoot);
  const expectedUrl = `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`;
  const mcpProofRef = env.ODDSPADI_SUPABASE_MCP_PROJECT_REF?.trim() || null;
  const observedMcpProjectRef = projectRefFromUrl(observedMcpProjectUrl ?? env.ODDSPADI_OBSERVED_SUPABASE_MCP_URL);
  const normalizedObservedMcpTables = parseObservedMcpTableList(observedMcpTables);
  const mcpSchemaEvidence = buildDecisionSupabaseMcpSchemaEvidence({
    observedTables: normalizedObservedMcpTables,
    source: normalizedObservedMcpTables.length ? "observed-mcp-table-list" : "not-provided"
  });
  const repoMcpConfig = readRepoMcpConfig(workspaceRoot);
  const repoMcpConfigPresent = repoMcpConfig.present;
  const schemaReady = readiness?.supabase.schema.status === "ready";
  const serviceRoleRejected = readiness?.supabase.schema.credentialStatus === "invalid";
  const serviceRoleVerified = readiness?.supabase.schema.credentialStatus === "valid";
  const localLinkMatchesExpected = !linked.ref || linked.ref === ODDSPADI_SUPABASE_PROJECT_REF;
  const targetMatchesExpected = runtime.targetMatchesExpected && localLinkMatchesExpected;
  const mcpScoped = mcpProofRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const configuredRefs = [
    { source: "SUPABASE_PROJECT_REF", ref: runtime.projectRef },
    { source: "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL", ref: runtime.urlProjectRef },
    { source: "Supabase CLI linked project", ref: linked.ref },
    { source: "ODDSPADI_SUPABASE_MCP_PROJECT_REF", ref: mcpProofRef },
    { source: "observed Supabase MCP URL", ref: observedMcpProjectRef }
  ];
  const foreignProjectRefs = configuredRefs.flatMap((item) =>
    item.ref && KNOWN_FOREIGN_PROJECT_REFS[item.ref]
      ? [
          {
            ref: item.ref,
            product: KNOWN_FOREIGN_PROJECT_REFS[item.ref],
            source: item.source
          }
        ]
      : []
  );
  const foreignSchemaSignals = [...(readiness?.supabase.schema.foreignSchemaSignals ?? []), ...mcpSchemaEvidence.foreignSchemaSignals.filter((signal) => signal.status === "present")];
  const presentForeignSchemaSignals = foreignSchemaSignals.filter((signal) => signal.status === "present");
  const mcpSchemaBlocks = mcpSchemaEvidence.status === "foreign-schema" || mcpSchemaEvidence.status === "mixed-schema";
  const wrongRefs = configuredRefs.filter((item) => item.ref && item.ref !== ODDSPADI_SUPABASE_PROJECT_REF);
  const projectConfigured = Boolean(runtime.projectRef && runtime.urlProjectRef);
  const publicKeyReady = runtime.restReadReady;
  const serviceRoleReady = runtime.serverWriteReady && !serviceRoleRejected;
  const missingKeys = unique([...runtime.missingPublicEnv, ...runtime.missingServerEnv]);
  const status: DecisionSupabaseProjectIsolationStatus = foreignProjectRefs.length || presentForeignSchemaSignals.length || mcpSchemaBlocks
    ? "blocked-cross-project"
    : wrongRefs.length
      ? "blocked-wrong-target"
      : !projectConfigured
        ? "needs-project-env"
        : serviceRoleRejected
          ? "blocked-invalid-key"
          : !publicKeyReady || !serviceRoleReady
            ? "needs-keys"
            : !mcpScoped
              ? "needs-mcp-proof"
              : !schemaReady
                ? "needs-schema-proof"
                : "ready-isolated";
  const gates = [
    gate({
      id: "project-target",
      status:
        foreignProjectRefs.length ||
        presentForeignSchemaSignals.length ||
        wrongRefs.some((item) => item.source !== "ODDSPADI_SUPABASE_MCP_PROJECT_REF" && item.source !== "observed Supabase MCP URL")
        ? "block"
        : targetMatchesExpected
          ? "pass"
          : "watch",
      label: "OddsPadi project target",
      detail: presentForeignSchemaSignals.length
        ? `Configured ref matches OddsPadi, but the target exposes non-OddsPadi sentinel table(s): ${presentForeignSchemaSignals
            .map((signal) => `${signal.table} (${signal.product})`)
            .slice(0, 4)
            .join(", ")}.`
        : targetMatchesExpected
        ? `Configured ref, URL ref, and local link point at ${ODDSPADI_SUPABASE_PROJECT_REF}.`
        : `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${runtime.projectRef ?? "missing"}, URL ${runtime.urlProjectRef ?? "missing"}, linked ${
            linked.ref ?? "missing"
          }.`,
      nextAction: presentForeignSchemaSignals.length
        ? "Do not apply migrations here. Confirm the dashboard project/ref, then switch MCP/env to the clean OddsPadi project or explicitly approve a reset/migration strategy."
        : targetMatchesExpected
          ? "Keep the same project ref in local and Netlify env."
          : `Set SUPABASE_PROJECT_REF and Supabase URLs to ${ODDSPADI_SUPABASE_PROJECT_REF}.`
    }),
    gate({
      id: "mcp-scope",
      status: mcpSchemaBlocks ? "block" : mcpScoped ? "pass" : mcpProofRef && mcpProofRef !== ODDSPADI_SUPABASE_PROJECT_REF ? "block" : "watch",
      label: "Project-scoped MCP proof",
      detail: mcpSchemaBlocks
        ? mcpSchemaEvidence.summary
        : mcpScoped
        ? "ODDSPADI_SUPABASE_MCP_PROJECT_REF proves the MCP session is scoped to OddsPadi."
        : repoMcpConfig.projectScoped
          ? "Repo .mcp.json is scoped to OddsPadi, but the active MCP session still needs explicit project-ref proof."
          : repoMcpConfigPresent
            ? `Repo .mcp.json exists but is not scoped to ${ODDSPADI_SUPABASE_PROJECT_REF}; the active MCP session still needs explicit OddsPadi project-ref proof.`
            : "No OddsPadi-scoped MCP proof is present; a generic/global Supabase MCP target is not safe for this repo.",
      nextAction: mcpSchemaBlocks
        ? "Do not apply migrations from this MCP session. Re-authenticate or switch to the clean OddsPadi project before schema work."
        : `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${ODDSPADI_SUPABASE_PROJECT_REF} only after MCP list_tables or project URL proof confirms OddsPadi.`
    }),
    gate({
      id: "public-key",
      status: publicKeyReady ? "pass" : "watch",
      label: "Publishable client key",
      detail: publicKeyReady
        ? "The public Supabase URL and publishable key are configured for future client reads."
        : `Client reads are locked. Missing: ${runtime.missingPublicEnv.join(", ") || "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"}.`,
      nextAction: publicKeyReady ? "Keep service-role or secret keys out of NEXT_PUBLIC env." : "Add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from the OddsPadi project."
    }),
    gate({
      id: "server-key",
      status: serviceRoleRejected ? "block" : serviceRoleVerified ? "pass" : runtime.serverWriteReady ? "watch" : "watch",
      label: "Server-only key",
      detail: serviceRoleRejected
        ? readiness?.supabase.schema.credentialErrorDetail ?? "The configured service key was rejected."
        : serviceRoleVerified
          ? "Server key has read proof against the expected OddsPadi schema."
          : runtime.serverWriteReady
            ? "Server key is present but still needs live schema proof."
            : `Server writes are locked. Missing: ${runtime.missingServerEnv.join(", ") || "SUPABASE_SERVICE_ROLE_KEY"}.`,
      nextAction: serviceRoleVerified
        ? "Keep this key server-only and mirrored only into Netlify secret env."
        : "Add a valid OddsPadi secret/service-role key, restart, and rerun the status endpoint."
    }),
    gate({
      id: "schema-proof",
      status: presentForeignSchemaSignals.length ? "block" : schemaReady ? "pass" : serviceRoleRejected ? "block" : "watch",
      label: "Expected op_ schema",
      detail: schemaReady
        ? `Verified ${readiness?.supabase.schema.verifiedTableCount ?? 0}/${readiness?.supabase.schema.expectedTableCount ?? 0} OddsPadi op_ tables.`
        : readiness?.supabase.schema.detail ?? "Schema proof has not run yet.",
      nextAction: presentForeignSchemaSignals.length
        ? "Clear the foreign-schema proof before migration or training work."
        : schemaReady
          ? "Keep migration manifest and schema checks aligned."
          : "Apply migrations only after project-scoped MCP proof, then rerun /api/sports/decision/status."
    })
  ];
  const isolationHash = stableHash({
    status,
    expectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
    configuredRef: runtime.projectRef,
    urlRef: runtime.urlProjectRef,
    linkedRef: linked.ref,
    mcpProofRef,
    observedMcpProjectRef,
    repoMcpConfig: [repoMcpConfig.projectRef, repoMcpConfig.projectScoped],
    mcpSchemaEvidence: [mcpSchemaEvidence.status, mcpSchemaEvidence.opTableCount, mcpSchemaEvidence.observedTables.slice(0, 12)],
    schemaStatus: readiness?.supabase.schema.status ?? "not-attached",
    credentialStatus: readiness?.supabase.schema.credentialStatus ?? "not-attached",
    foreignSchemaSignals: presentForeignSchemaSignals.map((signal) => signal.table),
    missingKeys
  });
  const cleanSchemaTarget = presentForeignSchemaSignals.length === 0 && !mcpSchemaBlocks;
  const canApplyMigrations = targetMatchesExpected && mcpScoped && !serviceRoleRejected && cleanSchemaTarget;
  const canReadDecisionMemory = targetMatchesExpected && schemaReady && serviceRoleVerified;
  const canWriteDecisionMemory = status === "ready-isolated" && cleanSchemaTarget;
  const nextAction =
    gates.find((item) => item.status === "block")?.nextAction ??
    gates.find((item) => item.status === "watch")?.nextAction ??
    "Proceed to the dedicated runtime, persistence, and training gates.";

  return {
    generatedAt: new Date().toISOString(),
    mode: "supabase-project-isolation",
    status,
    isolationHash,
    summary: statusSummary(status),
    expected: {
      projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      projectUrl: expectedUrl
    },
    detected: {
      configuredProjectRef: runtime.projectRef,
      urlProjectRef: runtime.urlProjectRef,
      projectHost: runtime.projectHost,
      linkedRef: linked.ref,
      linkedName: linked.name,
      mcpProofRef,
      observedMcpProjectRef,
      repoMcpConfig,
      mcpSchemaEvidence,
      foreignProjectRefs,
      foreignSchemaSignals
    },
    keys: {
      publishableConfigured: runtime.publishableKeyConfigured,
      serviceRoleConfigured: runtime.serviceRoleKeyConfigured,
      serviceRoleVerified,
      serviceRoleRejected: Boolean(serviceRoleRejected)
    },
    gates,
    locks: {
      canExposeClientRead: targetMatchesExpected && runtime.publishableKeyConfigured,
      canReadDecisionMemory,
      canWriteDecisionMemory,
      canApplyMigrations,
      canRunProviderDryRun: targetMatchesExpected && runtime.serviceRoleKeyConfigured && !serviceRoleRejected && cleanSchemaTarget,
      canRunWriteBackfill: false,
      canTrainModel: false,
      canPublishPicks: false
    },
    env: {
      requiredProject: ["SUPABASE_PROJECT_REF", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
      requiredPublicRead: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      requiredServerWrite: ["SUPABASE_SERVICE_ROLE_KEY"],
      requiredMcpProof: ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"],
      missing: unique([...missingKeys, ...(mcpScoped ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]), ...(schemaReady ? [] : ["verified op_ schema"])])
    },
    proof: {
      safeCommands: [
        `curl.exe -sS "${safeLocalUrl("/api/sports/decision/status")}"`,
        `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-project-isolation")}"`,
        `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-bootstrap")}"`
      ],
      verificationUrls: ["/api/sports/decision/status", "/api/sports/decision/supabase-project-isolation", "/api/sports/decision/supabase-bootstrap"],
      docs: [
        "https://supabase.com/docs/guides/ai-tools/mcp",
        "https://supabase.com/docs/guides/getting-started/quickstarts/nextjs",
        "https://supabase.com/docs/guides/database/secure-data"
      ],
      forbiddenActions: [
        "Do not run migrations through a global Supabase MCP target.",
        "Do not use AfroTools or LATMtools Supabase refs for OddsPadi work.",
        "Do not apply OddsPadi migrations into a target that exposes AfroTools, Matchday, payroll, scholarship, or creator sentinel tables unless a human explicitly approves that database strategy.",
        "Do not expose service-role or secret keys through NEXT_PUBLIC env.",
        "Do not enable write-mode provider backfills until dry-run counts and schema proof pass.",
        "Do not treat project env presence as memory-write readiness."
      ]
    },
    nextAction
  };
}
