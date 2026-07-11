import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { decisionApiUrl, decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import type { TenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { buildMultiSportCorpusPlan, type TrainingCorpusCommand } from "@/lib/sports/training/multiSportCorpusPlan";

type EnvMap = Record<string, string | undefined>;

export type DecisionSupabaseBootstrapStatus =
  | "ready-dry-run"
  | "needs-mcp"
  | "needs-schema"
  | "needs-keys"
  | "blocked-invalid-keys"
  | "blocked-wrong-target";
export type DecisionSupabaseBootstrapCheckStatus = "pass" | "watch" | "block";
export type DecisionSupabaseBootstrapCommandKind = "verify" | "mcp" | "migration" | "provider-dry-run";

export type DecisionSupabaseBootstrapCheck = {
  id: string;
  status: DecisionSupabaseBootstrapCheckStatus;
  label: string;
  detail: string;
  nextAction: string;
};

export type DecisionSupabaseBootstrapCommand = {
  id: string;
  kind: DecisionSupabaseBootstrapCommandKind;
  label: string;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  expectedEvidence: string;
  missingEnv: string[];
};

export type DecisionSupabaseBootstrapMigration = {
  file: string;
  purpose: string;
  required: boolean;
};

export type DecisionSupabaseBootstrapMcpConfig = {
  present: boolean;
  serverName: string | null;
  serverUrl: string | null;
  projectRef: string | null;
  projectScoped: boolean;
  docsEnabled: boolean;
  databaseEnabled: boolean;
};

export type DecisionSupabaseBootstrap = {
  generatedAt: string;
  status: DecisionSupabaseBootstrapStatus;
  mode: "supabase-project-bootstrap";
  bootstrapHash: string;
  summary: string;
  project: {
    expectedRef: string;
    expectedUrl: string;
    configuredRef: string | null;
    urlRef: string | null;
    linkedRef: string | null;
    linkedName: string | null;
    targetMatchesExpected: boolean;
  };
  mcp: {
    repoConfigPresent: boolean;
    repoConfig: DecisionSupabaseBootstrapMcpConfig;
    scopedProofEnv: string | null;
    scopedProofPasses: boolean;
    expectedServerUrl: "https://mcp.supabase.com/mcp";
    expectedProjectScopedUrl: string;
    recommendedConfig: string;
    configTemplate: string;
    warning: string;
  };
  schema: {
    expectedTableCount: number;
    verifiedTableCount: number;
    missingTables: string[];
    inaccessibleTables: string[];
    credentialErrorTables: string[];
    credentialErrorDetail: string | null;
    credentialStatus: DecisionEngineReadiness["supabase"]["schema"]["credentialStatus"];
    foreignSchemaSignals: DecisionEngineReadiness["supabase"]["schema"]["foreignSchemaSignals"];
    expectedTables: string[];
  };
  migrations: DecisionSupabaseBootstrapMigration[];
  checks: DecisionSupabaseBootstrapCheck[];
  commands: DecisionSupabaseBootstrapCommand[];
  nextCommand: DecisionSupabaseBootstrapCommand | null;
  env: {
    requiredBeforeDryRun: string[];
    requiredBeforeWriteMode: string[];
    missingBeforeDryRun: string[];
    missingBeforeWriteMode: string[];
  };
  credentials: {
    serverKeyConfigured: boolean;
    serverKeyVerified: boolean;
    serverKeyRejected: boolean;
    serverKeyError: string | null;
  };
  safety: {
    canApplyMigrations: boolean;
    canRunProviderDryRun: boolean;
    canRunWriteBackfill: false;
    canPersistDecisions: false;
    canTrainModel: false;
    forbiddenActions: string[];
  };
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

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function safeLocalUrl(path: string): string {
  return decisionApiUrl(path);
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

function readRepoMcpConfig(workspaceRoot: string): DecisionSupabaseBootstrapMcpConfig {
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

function migrationPurpose(file: string): string {
  if (file.includes("decision_engine_foundation")) return "Decision memory, model versions, provider ingestion audit, and raw provider payload archive.";
  if (file.includes("decision_agent_trace")) return "Decision-agent trace fields on stored decision runs.";
  if (file.includes("decision_learning_loop")) return "Outcome settlement and calibration learning loop.";
  if (file.includes("historical_training_backtest_spine")) return "10-year fixture, feature, odds, event, news, weather, and backtest spine.";
  if (file.includes("decision_context_snapshot")) return "Context-adjustment snapshot for persisted decision runs.";
  if (file.includes("ai_thought_episodes")) return "Private AI thought-episode ledger for replay, proof receipts, and later calibration review.";
  return "OddsPadi decision-engine schema migration.";
}

function listMigrations(workspaceRoot: string): DecisionSupabaseBootstrapMigration[] {
  const dir = join(workspaceRoot, "supabase", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      file,
      purpose: migrationPurpose(file),
      required: true
    }));
}

function check(input: DecisionSupabaseBootstrapCheck): DecisionSupabaseBootstrapCheck {
  return input;
}

function command(input: DecisionSupabaseBootstrapCommand): DecisionSupabaseBootstrapCommand {
  const lower = input.command.toLowerCase();
  const safeToRun =
    input.safeToRun &&
    lower.includes("curl.exe") &&
    !lower.includes("persist=1") &&
    !lower.includes("dryrun=0") &&
    (!lower.includes("-x post") || lower.includes("dryrun=1"));
  return {
    ...input,
    safeToRun
  };
}

function commandFromTrainingCommand({
  id,
  input,
  safeToRun
}: {
  id: string;
  input: TrainingCorpusCommand;
  safeToRun: boolean;
}): DecisionSupabaseBootstrapCommand {
  return command({
    id,
    kind: "provider-dry-run",
    label: input.label,
    command: input.command,
    verifyUrl: input.verifyUrl ?? "/api/sports/decision/training/multi-sport-corpus-plan",
    safeToRun,
    expectedEvidence: input.expectedEvidence,
    missingEnv: input.missingEnv
  });
}

function statusFor({
  targetMatchesExpected,
  serverKeysReady,
  serverKeyRejected,
  mcpScoped,
  schemaReady
}: {
  targetMatchesExpected: boolean;
  serverKeysReady: boolean;
  serverKeyRejected: boolean;
  mcpScoped: boolean;
  schemaReady: boolean;
}): DecisionSupabaseBootstrapStatus {
  if (!targetMatchesExpected) return "blocked-wrong-target";
  if (!serverKeysReady) return "needs-keys";
  if (serverKeyRejected) return "blocked-invalid-keys";
  if (!mcpScoped) return "needs-mcp";
  if (!schemaReady) return "needs-schema";
  return "ready-dry-run";
}

function statusSummary(status: DecisionSupabaseBootstrapStatus): string {
  if (status === "ready-dry-run") return "Supabase bootstrap is ready for supervised dry-runs; write-mode training remains locked.";
  if (status === "blocked-invalid-keys") return "Supabase target is correct, but the configured server key was rejected by the new OddsPadi project.";
  if (status === "needs-schema") return "Supabase target and keys are present, but expected OddsPadi op_ tables are not fully verified.";
  if (status === "needs-mcp") return "Supabase keys are present, but project-scoped MCP proof is still missing for safe schema operations.";
  if (status === "needs-keys") return "Supabase project is linked locally, but server/admin/provider keys are not ready for backfill dry-runs.";
  return "Supabase bootstrap is blocked because the configured target does not match the OddsPadi project.";
}

export function buildDecisionSupabaseBootstrap({
  readiness,
  corpusPlan,
  runtime = null,
  env = process.env,
  workspaceRoot = process.cwd()
}: {
  readiness: DecisionEngineReadiness;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  runtime?: DecisionAgentRuntime | null;
  env?: EnvMap;
  workspaceRoot?: string;
}): DecisionSupabaseBootstrap {
  const linked = readLinkedProject(workspaceRoot);
  const migrations = listMigrations(workspaceRoot);
  const repoConfig = readRepoMcpConfig(workspaceRoot);
  const repoConfigPresent = repoConfig.present;
  const scopedProofEnv = env.ODDSPADI_SUPABASE_MCP_PROJECT_REF?.trim() || null;
  const scopedProofPasses = scopedProofEnv === ODDSPADI_SUPABASE_PROJECT_REF;
  const expectedUrl = `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`;
  const expectedProjectScopedMcpUrl = `https://mcp.supabase.com/mcp?project_ref=${ODDSPADI_SUPABASE_PROJECT_REF}&features=database,docs`;
  const recommendedMcpConfig = JSON.stringify(
    {
      mcpServers: {
        supabase: {
          type: "http",
          url: expectedProjectScopedMcpUrl
        }
      }
    },
    null,
    2
  );
  const targetMatchesExpected =
    readiness.supabase.preflight.targetMatchesExpected && (!linked.ref || linked.ref === ODDSPADI_SUPABASE_PROJECT_REF);
  const schemaReady = readiness.supabase.schema.status === "ready";
  const serverKeyRejected = readiness.supabase.schema.credentialStatus === "invalid";
  const serverKeysReady = readiness.supabase.preflight.serverClientConfigured;
  const adminReady = boolEnv(env, "ODDSPADI_ADMIN_TOKEN");
  const apiFootballReady = boolEnv(env, "API_FOOTBALL_KEY") || boolEnv(env, "APISPORTS_KEY") || boolEnv(env, "SPORTS_API_KEY");
  const apiBasketballReady = boolEnv(env, "API_BASKETBALL_KEY") || boolEnv(env, "APISPORTS_KEY") || boolEnv(env, "SPORTS_API_KEY");
  const apiTennisReady = boolEnv(env, "API_TENNIS_KEY") || boolEnv(env, "SPORTS_API_KEY");
  const oddsReady = boolEnv(env, "THE_ODDS_API_KEY") || boolEnv(env, "ODDS_API_KEY");
  const status = statusFor({ targetMatchesExpected, serverKeysReady, serverKeyRejected, mcpScoped: scopedProofPasses, schemaReady });
  const multiSportPlan = buildMultiSportCorpusPlan({ env, baseUrl: decisionSiteOrigin(env) });
  const requiredBeforeDryRun = [
    "ODDSPADI_ADMIN_TOKEN",
    "API_FOOTBALL_KEY or APISPORTS_KEY",
    "API_BASKETBALL_KEY or APISPORTS_KEY",
    "API_TENNIS_KEY or SPORTS_API_KEY",
    "THE_ODDS_API_KEY or ODDS_API_KEY",
    "SUPABASE_URL",
    "valid SUPABASE_SERVICE_ROLE_KEY"
  ];
  const requiredBeforeWriteMode = [
    ...requiredBeforeDryRun,
    "ODDSPADI_SUPABASE_MCP_PROJECT_REF",
    "verified op_ schema",
    "reviewed provider dry-run counts"
  ];
  const missingBeforeDryRun = unique([
    ...(adminReady ? [] : ["ODDSPADI_ADMIN_TOKEN"]),
    ...(apiFootballReady ? [] : ["API_FOOTBALL_KEY or APISPORTS_KEY"]),
    ...(apiBasketballReady ? [] : ["API_BASKETBALL_KEY or APISPORTS_KEY"]),
    ...(apiTennisReady ? [] : ["API_TENNIS_KEY or SPORTS_API_KEY"]),
    ...(oddsReady ? [] : ["THE_ODDS_API_KEY or ODDS_API_KEY"]),
    ...(serverKeysReady ? [] : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
    ...(serverKeyRejected ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : [])
  ]);
  const missingBeforeWriteMode = unique([
    ...missingBeforeDryRun,
    ...(scopedProofPasses ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]),
    ...(schemaReady ? [] : ["verified op_ schema"])
  ]);
  const checks = [
    check({
      id: "project-ref",
      status: targetMatchesExpected ? "pass" : "block",
      label: "OddsPadi project target",
      detail: `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${readiness.supabase.preflight.configuredProjectRef ?? "missing"}; linked ${linked.ref ?? "missing"}.`,
      nextAction: targetMatchesExpected ? "Keep this project ref for local, Netlify, and Supabase CLI operations." : `Retarget Supabase env and CLI link to ${ODDSPADI_SUPABASE_PROJECT_REF}.`
    }),
    check({
      id: "mcp-scope",
      status: scopedProofPasses ? "pass" : "block",
      label: "Project-scoped MCP proof",
      detail: scopedProofPasses
        ? "ODDSPADI_SUPABASE_MCP_PROJECT_REF proves MCP operations are scoped to OddsPadi."
        : repoConfig.projectScoped
          ? "Repo .mcp.json points at the OddsPadi project, but the live MCP session still needs project-ref proof before schema work."
          : `Do not use the generic Supabase MCP for OddsPadi schema work until .mcp.json and the live session are scoped to ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      nextAction: `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${ODDSPADI_SUPABASE_PROJECT_REF} only after the MCP session is confirmed against the OddsPadi project.`
    }),
    check({
      id: "server-keys",
      status: serverKeysReady && !serverKeyRejected ? "pass" : "block",
      label: "Server Supabase credentials",
      detail: serverKeyRejected
        ? readiness.supabase.schema.detail
        : readiness.supabase.preflight.checks.find((item) => item.id === "server-client")?.detail ?? readiness.supabase.detail,
      nextAction: serverKeyRejected
        ? "Replace SUPABASE_SERVICE_ROLE_KEY with a valid secret/service-role key from the new OddsPadi Supabase project, then restart the app."
        : serverKeysReady
          ? "Run schema verification and memory smoke."
          : "Add the OddsPadi SUPABASE_SERVICE_ROLE_KEY to local and Netlify server env."
    }),
    check({
      id: "schema",
      status: schemaReady ? "pass" : readiness.supabase.schema.configured ? "watch" : "block",
      label: "Expected op_ schema",
      detail: readiness.supabase.schema.detail,
      nextAction: schemaReady ? "Keep migrations and readiness checks in sync." : "Apply local migrations to OddsPadi after project-scoped MCP/CLI proof."
    }),
    check({
      id: "provider-dry-run",
      status: multiSportPlan.status === "ready" && !serverKeyRejected ? "pass" : multiSportPlan.blockers.length || multiSportPlan.missingEnvKeys.length || serverKeyRejected ? "block" : "watch",
      label: "First provider dry-runs",
      detail: `${multiSportPlan.adapterReadySports}/${multiSportPlan.sportCount} sport adapters and backtest runners are implemented; next safe command is ${multiSportPlan.nextSafeCommand.label}.`,
      nextAction: serverKeyRejected
        ? "Fix the rejected Supabase service key before running even dry-run provider imports."
        : multiSportPlan.missingEnvKeys[0]
            ? `Set ${multiSportPlan.missingEnvKeys[0]}.`
            : multiSportPlan.blockers[0]
              ? multiSportPlan.blockers[0]
              : multiSportPlan.nextSafeCommand.safeToRun
                ? "Run the next dry-run and inspect normalized counts for the selected sport."
                : "Clear bootstrap blockers first."
    }),
    check({
      id: "runtime-locks",
      status: runtime ? (runtime.locks.some((item) => item.locked) ? "watch" : "pass") : "watch",
      label: "Runtime write locks",
      detail: runtime ? runtime.summary : "Runtime proof has not been attached to this bootstrap object.",
      nextAction: "Keep persist, publish, train, and write backfill locked until runtime and activation proof pass."
    })
  ];
  const sportDryRunCommands = multiSportPlan.sports
    .filter((sport) => sport.sport !== "football")
    .flatMap((sport) =>
      sport.firstDryRunCommand
        ? [
            commandFromTrainingCommand({
              id: `${sport.sport}-backfill-dry-run`,
              input: {
                ...sport.firstDryRunCommand,
                missingEnv: serverKeyRejected
                  ? unique([...sport.firstDryRunCommand.missingEnv, "valid SUPABASE_SERVICE_ROLE_KEY"])
                  : sport.firstDryRunCommand.missingEnv
              },
              safeToRun: sport.firstDryRunCommand.safeToRun && !serverKeyRejected
            })
          ]
        : []
    );
  const commands = [
    command({
      id: "status",
      kind: "verify",
      label: "Verify runtime status",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/status")}"`,
      verifyUrl: "/api/sports/decision/status",
      safeToRun: true,
      expectedEvidence: "Status returns the OddsPadi project ref, server-key state, schema verification, provider readiness, and OpenAI readiness.",
      missingEnv: []
    }),
    command({
      id: "bootstrap",
      kind: "verify",
      label: "Verify bootstrap object",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/supabase-bootstrap")}"`,
      verifyUrl: "/api/sports/decision/supabase-bootstrap",
      safeToRun: true,
      expectedEvidence: "Bootstrap endpoint returns expected project ref, migrations, missing env, and safety locks.",
      missingEnv: []
    }),
    command({
      id: "mcp-proof",
      kind: "mcp",
      label: "Prove MCP project scope",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/status")}"`,
      verifyUrl: "/api/sports/decision/status",
      safeToRun: true,
      expectedEvidence: `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${ODDSPADI_SUPABASE_PROJECT_REF} only after MCP list_tables shows OddsPadi op_ tables.`,
      missingEnv: scopedProofPasses ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"]
    }),
    command({
      id: "schema-check",
      kind: "migration",
      label: "Verify expected op_ tables",
      command: `curl.exe -sS "${safeLocalUrl("/api/sports/decision/status")}"`,
      verifyUrl: "/api/sports/decision/status",
      safeToRun: true,
      expectedEvidence: `All ${readiness.supabase.schema.expectedTableCount} expected op_ tables verify in the OddsPadi project.`,
      missingEnv: serverKeyRejected ? ["valid SUPABASE_SERVICE_ROLE_KEY"] : serverKeysReady ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]
    }),
    command({
      id: "first-backfill-dry-run",
      kind: "provider-dry-run",
      label: "Run first fixture/context dry-run",
      command: corpusPlan.firstCommand,
      verifyUrl: "/api/sports/decision/training/corpus-plan",
      safeToRun: corpusPlan.canRunFirstCommand && !serverKeyRejected,
      expectedEvidence: corpusPlan.firstCommandPurpose,
      missingEnv: serverKeyRejected ? unique([...corpusPlan.missingEnvKeys, "valid SUPABASE_SERVICE_ROLE_KEY"]) : corpusPlan.canRunFirstCommand ? [] : corpusPlan.missingEnvKeys
    }),
    ...sportDryRunCommands
  ];
  const nextCommand = commands.find((item) => item.safeToRun && !item.missingEnv.length) ?? commands[0] ?? null;
  const bootstrapHash = stableHash({
    status,
    expectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
    configuredRef: readiness.supabase.preflight.configuredProjectRef,
    linked,
    scopedProofPasses,
    schema: readiness.supabase.schema.status,
    credentialStatus: readiness.supabase.schema.credentialStatus,
    migrations: migrations.map((item) => item.file),
    missingBeforeDryRun,
    missingBeforeWriteMode
  });

  return {
    generatedAt: new Date().toISOString(),
    status,
    mode: "supabase-project-bootstrap",
    bootstrapHash,
    summary: statusSummary(status),
    project: {
      expectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
      expectedUrl,
      configuredRef: readiness.supabase.preflight.configuredProjectRef,
      urlRef: readiness.supabase.preflight.urlProjectRef,
      linkedRef: linked.ref,
      linkedName: linked.name,
      targetMatchesExpected
    },
    mcp: {
      repoConfigPresent,
      repoConfig,
      scopedProofEnv,
      scopedProofPasses,
      expectedServerUrl: "https://mcp.supabase.com/mcp",
      expectedProjectScopedUrl: expectedProjectScopedMcpUrl,
      recommendedConfig: recommendedMcpConfig,
      configTemplate: repoConfig.projectScoped
        ? `Repo .mcp.json is scoped to ${ODDSPADI_SUPABASE_PROJECT_REF}; authenticate that MCP session and prove it before schema work.`
        : recommendedMcpConfig,
      warning:
        "Generic/global Supabase MCP output is unsafe for OddsPadi unless it lists the OddsPadi op_ tables or the session is otherwise project-ref proven."
    },
    schema: {
      expectedTableCount: readiness.supabase.schema.expectedTableCount,
      verifiedTableCount: readiness.supabase.schema.verifiedTableCount,
      missingTables: readiness.supabase.schema.missingTables,
      inaccessibleTables: readiness.supabase.schema.inaccessibleTables,
      credentialErrorTables: readiness.supabase.schema.credentialErrorTables,
      credentialErrorDetail: readiness.supabase.schema.credentialErrorDetail,
      credentialStatus: readiness.supabase.schema.credentialStatus,
      foreignSchemaSignals: readiness.supabase.schema.foreignSchemaSignals,
      expectedTables: readiness.supabase.preflight.expectedTables
    },
    migrations,
    checks,
    commands,
    nextCommand,
    env: {
      requiredBeforeDryRun,
      requiredBeforeWriteMode,
      missingBeforeDryRun,
      missingBeforeWriteMode
    },
    credentials: {
      serverKeyConfigured: serverKeysReady,
      serverKeyVerified: readiness.supabase.schema.credentialStatus === "valid",
      serverKeyRejected,
      serverKeyError: readiness.supabase.schema.credentialErrorDetail
    },
    safety: {
      canApplyMigrations: targetMatchesExpected && scopedProofPasses && !serverKeyRejected,
      canRunProviderDryRun: corpusPlan.canRunFirstCommand && !serverKeyRejected,
      canRunWriteBackfill: false,
      canPersistDecisions: false,
      canTrainModel: false,
      forbiddenActions: [
        "Do not apply migrations through the generic Supabase MCP target.",
        "Do not run dryRun=0 provider backfills until op_ schema and provider dry-run counts are reviewed.",
        "Do not expose op_ tables to anon or authenticated clients before explicit API/RLS design.",
        "Do not store service_role keys in client-visible NEXT_PUBLIC variables.",
        "Do not treat demo-seed training rows as real model readiness."
      ]
    }
  };
}
