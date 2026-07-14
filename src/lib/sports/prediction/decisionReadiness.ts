import { existsSync } from "node:fs";
import { join } from "node:path";
import { configuredEnvKeys as configuredSecretEnvKeys, hasAnyConfiguredEnv, hasConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF, type SupabaseApiKeyProfile } from "@/lib/supabase/server";
import { getSportsProviderRuntimeStatus } from "@/lib/sports/providers/providerBackedProvider";
import type { DecisionDataSignalCategory, DecisionEnhancementResult } from "@/lib/sports/types";
import { getMatchPrediction } from "@/lib/sports/service";
import { buildDecisionEvidenceGraph, type DecisionEvidenceGraph } from "./decisionEvidenceGraph";
import { DECISION_ENGINE_VERSION } from "./decisionEngine";
import { getDecisionMemorySnapshot } from "./decisionMemory";
import { persistDecisionRun, type DecisionPersistenceResult } from "./decisionPersistence";
import { buildDecisionReflection } from "./decisionReflection";
import { buildDecisionRehearsal } from "./decisionRehearsal";
import { buildDecisionSlateThinking } from "./decisionSlateThinking";
import { buildDecisionThinkingIntrospection, type DecisionThinkingIntrospection } from "./decisionThinkingIntrospection";
import { buildDecisionWorkingMemory } from "./decisionWorkingMemory";
import { runDecisionEnhancementWithOpenAI } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

type EnvMap = Record<string, string | undefined>;

type SupabaseAccessError = {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
};

export type ReadinessStatus = "ready" | "warning" | "blocked";
export type SelfTestStatus = "passed" | "warning" | "failed" | "skipped";
export type ProviderConnectionStatus = "live-runtime" | "configured" | "missing" | "adapter-pending";
export type ProviderImplementationStatus = "live-runtime" | "historical-sync-ready" | "planned";

const ODDSPADI_SUPABASE_REQUIRED_TABLES = [
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

const ODDSPADI_SUPABASE_TABLE_PURPOSE: Record<string, SupabaseSchemaTableCheck["requiredFor"]> = {
  op_model_versions: "decision-memory",
  op_decision_runs: "decision-memory",
  op_decision_evidence_bundles: "decision-memory",
  op_provider_ingestion_runs: "provider-ingestion",
  op_raw_provider_payloads: "provider-ingestion",
  op_prediction_outcomes: "learning-loop",
  op_calibration_runs: "learning-loop",
  op_ai_thought_episodes: "decision-memory",
  op_decision_briefings: "decision-memory",
  op_shadow_memory_replay: "learning-loop",
  op_leagues: "training-corpus",
  op_teams: "training-corpus",
  op_fixtures: "training-corpus",
  op_fixture_team_features: "training-corpus",
  op_standings_snapshots: "training-corpus",
  op_odds_snapshots: "training-corpus",
  op_player_availability_snapshots: "training-corpus",
  op_lineup_snapshots: "training-corpus",
  op_live_match_events: "training-corpus",
  op_news_signals: "training-corpus",
  op_weather_snapshots: "training-corpus",
  op_training_feature_snapshots: "training-corpus",
  op_backtest_runs: "training-corpus"
};

const FOREIGN_SUPABASE_SCHEMA_SENTINELS = [
  { table: "as_news", product: "AfroTools/AfroStream" },
  { table: "scholarships", product: "AfroTools Scholarship Finder" },
  { table: "business_ideas", product: "AfroTools Business Ideas" },
  { table: "matchday_profiles", product: "Matchday OS" },
  { table: "creator_profiles", product: "AfroTools Creator Tools" },
  { table: "payroll_clients", product: "AfroPayroll Pro" }
];

export type EngineReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
};

export type SupabaseProjectPreflightCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  requiredAction: string | null;
};

export type SupabaseProjectPreflight = {
  status: ReadinessStatus;
  expectedProjectRef: string;
  configuredProjectRef: string | null;
  urlProjectRef: string | null;
  projectHost: string | null;
  targetMatchesExpected: boolean;
  publicClientConfigured: boolean;
  serverClientConfigured: boolean;
  publicKeyProfile: SupabaseApiKeyProfile;
  serverKeyProfile: SupabaseApiKeyProfile;
  mcpConfigPresent: boolean;
  expectedTables: string[];
  expectedTableCount: number;
  missingEnv: string[];
  checks: SupabaseProjectPreflightCheck[];
  nextActions: string[];
  summary: string;
};

export type SupabaseCredentialStatus = "not-checked" | "valid" | "invalid";
export type SupabaseSchemaTableCheckStatus = "verified" | "missing" | "inaccessible" | "credential-error" | "not-checked";

export type SupabaseSchemaTableCheck = {
  table: string;
  status: SupabaseSchemaTableCheckStatus;
  rowCount: number | null;
  error: string | null;
  requiredFor: "decision-memory" | "learning-loop" | "training-corpus" | "provider-ingestion";
};

export type SupabaseForeignSchemaSignal = {
  table: string;
  product: string;
  status: "present" | "not-present" | "inaccessible";
  error: string | null;
};

export type SupabaseSchemaVerification = {
  status: ReadinessStatus;
  configured: boolean;
  checkedAt: string;
  expectedTableCount: number;
  verifiedTableCount: number;
  missingTables: string[];
  inaccessibleTables: string[];
  credentialErrorTables: string[];
  credentialErrorDetail: string | null;
  credentialStatus: SupabaseCredentialStatus;
  foreignSchemaSignals: SupabaseForeignSchemaSignal[];
  tableChecks: SupabaseSchemaTableCheck[];
  detail: string;
};

export type ProviderReadinessGroup = {
  id: string;
  label: string;
  status: ProviderConnectionStatus;
  readinessStatus: ReadinessStatus;
  configured: boolean;
  envKeys: string[];
  configuredEnvKeys: string[];
  missingEnvKeys: string[];
  implementationStatus: ProviderImplementationStatus;
  currentUse: string;
  decisionImpact: string;
  unlocks: DecisionDataSignalCategory[];
  nextAction: string;
};

export type DecisionEngineReadiness = {
  generatedAt: string;
  engineVersion: string;
  runtimeMode: "demo-mock" | "provider-backed";
  deterministicCore: {
    status: ReadinessStatus;
    detail: string;
  };
  openAi: {
    status: ReadinessStatus;
    configured: boolean;
    model: string;
    detail: string;
  };
  supabase: {
    status: ReadinessStatus;
    configured: boolean;
    projectRef: string | null;
    projectHost: string | null;
    missingEnv: string[];
    detail: string;
    preflight: SupabaseProjectPreflight;
    schema: SupabaseSchemaVerification;
  };
  dataProviders: {
    status: ReadinessStatus;
    sportsApiConfigured: boolean;
    oddsApiConfigured: boolean;
    liveScoresApiConfigured: boolean;
    newsApiConfigured: boolean;
    weatherApiConfigured: boolean;
    liveRuntimeBacked: boolean;
    runtimeProvider: string;
    configuredGroups: number;
    missingGroups: number;
    adapterPendingGroups: number;
    configuredSignalCoverage: number;
    liveRuntimeSignalCoverage: number;
    totalProductionSignals: number;
    groups: ProviderReadinessGroup[];
    nextProviderActions: string[];
    detail: string;
  };
  trainingData: {
    status: ReadinessStatus;
    configured: boolean;
    detail: string;
  };
  checks: EngineReadinessCheck[];
};

export type DecisionEngineSelfTest = {
  generatedAt: string;
  health: "pass" | "warn" | "fail";
  matchId: string;
  checks: Array<{
    id: string;
    label: string;
    status: SelfTestStatus;
    detail: string;
  }>;
  aiProofs: {
    evidenceGraph: {
      status: DecisionEvidenceGraph["status"];
      graphHash: string;
      nodes: number;
      edges: number;
      activePath: string[];
      proofUrls: string[];
      controls: DecisionEvidenceGraph["controls"];
    };
    thinkingIntrospection: {
      status: DecisionThinkingIntrospection["status"];
      introspectionHash: string;
      layers: number;
      pass: number;
      watch: number;
      block: number;
      focus: DecisionThinkingIntrospection["focus"];
      proofUrls: string[];
      controls: DecisionThinkingIntrospection["controls"];
    };
  };
  enhancement: DecisionEnhancementResult;
  persistence: DecisionPersistenceResult;
  readiness: DecisionEngineReadiness;
};

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function boolAnyEnv(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function configuredEnvKeys(env: EnvMap, keys: string[]): string[] {
  return configuredSecretEnvKeys(env, keys);
}

function mcpConfigPresent(): boolean {
  return existsSync(join(process.cwd(), ".mcp.json"));
}

function buildSupabaseProjectPreflight(env: EnvMap, runtime: ReturnType<typeof getSupabaseRuntimeStatus>): SupabaseProjectPreflight {
  void env;
  const configuredProjectRef = runtime.projectRef;
  const urlProjectRef = runtime.urlProjectRef;
  const targetConfigured = Boolean(configuredProjectRef || urlProjectRef);
  const targetMatchesExpected = runtime.targetMatchesExpected;
  const publicClientConfigured = runtime.restReadReady;
  const serverClientConfigured = runtime.serverWriteReady;
  const hasMcpConfig = mcpConfigPresent();
  const missingEnv = Array.from(new Set([...runtime.missingPublicEnv, ...runtime.missingServerEnv]));

  const checks: SupabaseProjectPreflightCheck[] = [
    {
      id: "project-ref",
      label: "OddsPadi project target",
      status: targetMatchesExpected ? "ready" : targetConfigured ? "blocked" : "warning",
      detail: targetMatchesExpected
        ? `SUPABASE_PROJECT_REF and URL point at ${ODDSPADI_SUPABASE_PROJECT_REF}.`
        : !targetConfigured
          ? "No Supabase project ref or URL is configured yet."
        : `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; found project ref ${configuredProjectRef ?? "missing"} and URL ref ${
            urlProjectRef ?? "missing"
          }.`,
      requiredAction: targetMatchesExpected
        ? null
        : `Set SUPABASE_PROJECT_REF and SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL to the OddsPadi project ${ODDSPADI_SUPABASE_PROJECT_REF}.`
    },
    {
      id: "public-client",
      label: "Public read client",
      status: publicClientConfigured ? "ready" : "warning",
      detail: publicClientConfigured
        ? `Public Supabase URL and ${runtime.publishableKeyProfile.kind} key are configured for client-side reads.`
        : `Client-side Supabase reads are not configured. Missing: ${runtime.missingPublicEnv.join(", ")}. ${runtime.publishableKeyProfile.recommendation}`,
      requiredAction: publicClientConfigured ? null : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY with a browser-safe publishable key."
    },
    {
      id: "server-client",
      label: "Server write client",
      status: serverClientConfigured ? "ready" : "warning",
      detail: serverClientConfigured
        ? `Server-side Supabase URL and ${runtime.serverKeyProfile.kind} key are present; schema verification confirms whether the key is valid.`
        : `Server-side reads/writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}. ${runtime.serverKeyProfile.recommendation}`,
      requiredAction: serverClientConfigured ? null : "Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in local and Netlify server env."
    },
    {
      id: "mcp-config",
      label: "Repo-local MCP config",
      status: hasMcpConfig ? "ready" : "warning",
      detail: hasMcpConfig
        ? "A repo-local .mcp.json exists for this workspace."
        : "No repo-local .mcp.json exists, so live schema inspection depends on global MCP tool configuration.",
      requiredAction: hasMcpConfig ? null : "Add or authenticate an OddsPadi-specific Supabase MCP config before applying live schema changes."
    },
    {
      id: "schema-manifest",
      label: "Expected schema manifest",
      status: "warning",
      detail: `${ODDSPADI_SUPABASE_REQUIRED_TABLES.length} server-only op_ tables are declared in repo migrations; live table existence still needs Supabase credentials or MCP inspection.`,
      requiredAction: serverClientConfigured ? "Run a live schema read to verify the op_ tables exist in the OddsPadi project." : "Set server env before live schema verification."
    }
  ];
  const status: ReadinessStatus = checks.some((check) => check.status === "blocked")
    ? "blocked"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ready";
  const nextActions = checks.flatMap((check) => (check.requiredAction ? [check.requiredAction] : [])).slice(0, 5);

  return {
    status,
    expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
    configuredProjectRef,
    urlProjectRef,
    projectHost: runtime.projectHost,
    targetMatchesExpected,
    publicClientConfigured,
    serverClientConfigured,
    publicKeyProfile: runtime.publishableKeyProfile,
    serverKeyProfile: runtime.serverKeyProfile,
    mcpConfigPresent: hasMcpConfig,
    expectedTables: ODDSPADI_SUPABASE_REQUIRED_TABLES,
    expectedTableCount: ODDSPADI_SUPABASE_REQUIRED_TABLES.length,
    missingEnv,
    checks,
    nextActions,
    summary:
      status === "blocked"
        ? "Supabase project targeting is blocked; the configured ref/URL do not both match the OddsPadi project."
        : !targetMatchesExpected
          ? "Supabase is not linked yet; add the OddsPadi project ref, URL, and keys before enabling memory or training."
        : serverClientConfigured
          ? "Supabase targets the OddsPadi project; run live schema verification before enabling ingestion writes."
          : "Supabase targets the OddsPadi project, but keys are missing so memory, training, and writes remain offline."
  };
}

function notCheckedSchemaVerification(detail: string, configured = false): SupabaseSchemaVerification {
  return {
    status: "warning",
    configured,
    checkedAt: new Date().toISOString(),
    expectedTableCount: ODDSPADI_SUPABASE_REQUIRED_TABLES.length,
    verifiedTableCount: 0,
    missingTables: [],
    inaccessibleTables: [],
    credentialErrorTables: [],
    credentialErrorDetail: null,
    credentialStatus: "not-checked",
    foreignSchemaSignals: [],
    tableChecks: ODDSPADI_SUPABASE_REQUIRED_TABLES.map((table) => ({
      table,
      status: "not-checked",
      rowCount: null,
      error: null,
      requiredFor: ODDSPADI_SUPABASE_TABLE_PURPOSE[table] ?? "training-corpus"
    })),
    detail
  };
}

function isSupabaseCredentialError(error: SupabaseAccessError | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  const statusText = error?.statusText?.toLowerCase() ?? "";
  return (
    error?.status === 401 ||
    statusText.includes("unauthorized") ||
    message.includes("invalid api key") ||
    message.includes("invalid jwt") ||
    message.includes("jwt malformed")
  );
}

export function classifySupabaseTableError(error: SupabaseAccessError | null): SupabaseSchemaTableCheckStatus {
  if (!error) return "verified";
  if (isSupabaseCredentialError(error)) return "credential-error";
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "42P01" || error.code === "PGRST205" || message.includes("could not find the table") || message.includes("does not exist")) {
    return "missing";
  }
  return "inaccessible";
}

function schemaVerificationDetail({
  status,
  verifiedTableCount,
  expectedTableCount,
  missingTables,
  inaccessibleTables,
  credentialErrorDetail,
  foreignSchemaSignals
}: {
  status: ReadinessStatus;
  verifiedTableCount: number;
  expectedTableCount: number;
  missingTables: string[];
  inaccessibleTables: string[];
  credentialErrorDetail: string | null;
  foreignSchemaSignals?: SupabaseForeignSchemaSignal[];
}): string {
  const presentForeignSignals = foreignSchemaSignals?.filter((signal) => signal.status === "present") ?? [];
  const foreignDetail = presentForeignSignals.length
    ? ` The same target also exposes non-OddsPadi sentinel table(s): ${presentForeignSignals
        .map((signal) => `${signal.table} (${signal.product})`)
        .slice(0, 4)
        .join(", ")}. Do not apply migrations, ingest provider data, train, or persist decisions until the Supabase project is re-proven.`
    : "";
  if (presentForeignSignals.length) {
    return `Verified ${verifiedTableCount}/${expectedTableCount} expected OddsPadi op_ tables, but Supabase isolation is not clean.${foreignDetail}`;
  }
  if (status === "ready") return `Verified all ${verifiedTableCount} expected OddsPadi op_ tables.`;
  if (credentialErrorDetail) {
    return `Supabase rejected the configured service key for project ${ODDSPADI_SUPABASE_PROJECT_REF}: ${credentialErrorDetail}. Replace SUPABASE_SERVICE_ROLE_KEY with a valid secret/service-role key for the new OddsPadi project, then restart the app.`;
  }
  if (status === "blocked") return `Missing required OddsPadi tables: ${missingTables.join(", ")}.${foreignDetail}`;
  if (inaccessibleTables.length === expectedTableCount) {
    return `Supabase accepted the configured server key, but none of the expected OddsPadi op_ tables were readable through the Data API. Apply the OddsPadi migrations to project ${ODDSPADI_SUPABASE_PROJECT_REF}, then confirm table exposure/permissions for server-side REST reads.${foreignDetail}`;
  }
  return `Could not access ${inaccessibleTables.length} expected OddsPadi table(s): ${inaccessibleTables.slice(0, 3).join(", ")}.${foreignDetail}`;
}

async function verifyForeignSchemaSignals(client: NonNullable<ReturnType<typeof getSupabaseServerClient>>): Promise<SupabaseForeignSchemaSignal[]> {
  return Promise.all(
    FOREIGN_SUPABASE_SCHEMA_SENTINELS.map(async (signal): Promise<SupabaseForeignSchemaSignal> => {
      const { error, status: responseStatus, statusText } = await client.from(signal.table).select("id", { count: "exact" }).limit(1);
      const accessError = error ? { ...error, status: responseStatus, statusText } : null;
      const status = classifySupabaseTableError(accessError);

      return {
        table: signal.table,
        product: signal.product,
        status: status === "verified" ? "present" : status === "missing" ? "not-present" : "inaccessible",
        error: accessError ? accessError.message || accessError.code || accessError.statusText || "Unknown Supabase table access error" : null
      };
    })
  );
}

export async function verifySupabaseSchemaTables(env: EnvMap = process.env): Promise<SupabaseSchemaVerification> {
  const runtime = getSupabaseRuntimeStatus(env);
  if (!runtime.serverWriteReady) {
    return notCheckedSchemaVerification(`Supabase schema was not checked. Missing: ${runtime.missingServerEnv.join(", ")}.`);
  }

  const client = getSupabaseServerClient(env);
  if (!client) {
    return notCheckedSchemaVerification("Supabase schema was not checked because the guarded server client could not be created.", true);
  }

  const [tableChecks, foreignSchemaSignals] = await Promise.all([
    Promise.all(
      ODDSPADI_SUPABASE_REQUIRED_TABLES.map(async (table): Promise<SupabaseSchemaTableCheck> => {
        const { count, error, status: responseStatus, statusText } = await client.from(table).select("id", { count: "exact" }).limit(1);
        const accessError = error ? { ...error, status: responseStatus, statusText } : null;
        const status = classifySupabaseTableError(accessError);

        return {
          table,
          status,
          rowCount: status === "verified" ? count ?? 0 : null,
          error: accessError ? accessError.message || accessError.code || accessError.statusText || "Unknown Supabase table access error" : null,
          requiredFor: ODDSPADI_SUPABASE_TABLE_PURPOSE[table] ?? "training-corpus"
        };
      })
    ),
    verifyForeignSchemaSignals(client)
  ]);
  const missingTables = tableChecks.filter((check) => check.status === "missing").map((check) => check.table);
  const inaccessibleTables = tableChecks.filter((check) => check.status === "inaccessible").map((check) => check.table);
  const credentialErrorTables = tableChecks.filter((check) => check.status === "credential-error").map((check) => check.table);
  const credentialErrorDetail = tableChecks.find((check) => check.status === "credential-error")?.error ?? null;
  const verifiedTableCount = tableChecks.filter((check) => check.status === "verified").length;
  const presentForeignSignals = foreignSchemaSignals.filter((signal) => signal.status === "present");
  const status: ReadinessStatus = credentialErrorTables.length
    ? "blocked"
    : missingTables.length
      ? "blocked"
      : presentForeignSignals.length
        ? "blocked"
        : inaccessibleTables.length
          ? "warning"
          : "ready";

  return {
    status,
    configured: true,
    checkedAt: new Date().toISOString(),
    expectedTableCount: ODDSPADI_SUPABASE_REQUIRED_TABLES.length,
    verifiedTableCount,
    missingTables,
    inaccessibleTables,
    credentialErrorTables,
    credentialErrorDetail,
    credentialStatus: credentialErrorTables.length ? "invalid" : "valid",
    foreignSchemaSignals,
    tableChecks,
    detail: schemaVerificationDetail({
      status,
      verifiedTableCount,
      expectedTableCount: ODDSPADI_SUPABASE_REQUIRED_TABLES.length,
      missingTables,
      inaccessibleTables,
      credentialErrorDetail,
      foreignSchemaSignals
    })
  };
}

function uniqueSignalCount(signals: DecisionDataSignalCategory[]): number {
  return new Set(signals).size;
}

function coveragePercent(covered: number, total: number): number {
  if (!total) return 0;
  return Math.round((covered / total) * 100);
}

function selfTestHealth(checks: DecisionEngineSelfTest["checks"]): DecisionEngineSelfTest["health"] {
  if (checks.some((check) => check.status === "failed")) return "fail";
  if (checks.some((check) => check.status === "warning")) return "warn";
  return "pass";
}

function selfTestDateFromKickoff(kickoffTime: string | undefined): string {
  const match = kickoffTime?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? new Date().toISOString().slice(0, 10);
}

function updateReadinessCheck(readiness: DecisionEngineReadiness, id: string, detail: string) {
  const check = readiness.checks.find((item) => item.id === id);
  if (!check) return;
  check.status = "warning";
  check.detail = detail;
}

export function buildDecisionEngineReadiness(env: EnvMap = process.env): DecisionEngineReadiness {
  const supabase = getSupabaseRuntimeStatus(env);
  const supabasePreflight = buildSupabaseProjectPreflight(env, supabase);
  const supabaseSchema = notCheckedSchemaVerification(
    supabase.serverWriteReady
      ? "Supabase schema verification has not run yet."
      : `Supabase schema was not checked. Missing: ${supabase.missingServerEnv.join(", ")}.`,
    supabase.serverWriteReady
  );
  const supabaseStatus: ReadinessStatus = supabasePreflight.status === "blocked" ? "blocked" : supabase.serverWriteReady ? "ready" : "warning";
  const openAiConfigured = boolEnv(env, "OPENAI_API_KEY");
  const model = getDecisionOpenAIModel(env);
  const footballApiConfigured = boolAnyEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const sportsApiConfigured = boolAnyEnv(env, ["SPORTS_API_KEY", "API_FOOTBALL_KEY", "API_BASKETBALL_KEY", "API_TENNIS_KEY", "APISPORTS_KEY"]);
  const oddsApiConfigured = boolAnyEnv(env, ["ODDS_API_KEY", "THE_ODDS_API_KEY"]);
  const liveScoresApiConfigured = boolEnv(env, "LIVE_SCORES_API_KEY");
  const newsApiConfigured = boolEnv(env, "NEWS_API_KEY");
  const weatherApiConfigured = boolAnyEnv(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]);
  const weatherContextAvailable = footballApiConfigured;
  const providerKeysConfigured = sportsApiConfigured && oddsApiConfigured;
  const liveEventsRuntimeConfigured = footballApiConfigured;
  const fullContextRuntimeConfigured = footballApiConfigured && liveEventsRuntimeConfigured && weatherContextAvailable && newsApiConfigured;
  const liveEventEnvKeys = ["API_FOOTBALL_KEY", "API_BASKETBALL_KEY", "API_TENNIS_KEY", "APISPORTS_KEY", "SPORTS_API_KEY", "LIVE_SCORES_API_KEY"];
  const providerRuntime = getSportsProviderRuntimeStatus(env);
  const runtimeProvider = providerRuntime.runtimeProvider;
  const liveRuntimeBacked = providerRuntime.liveRuntimeBacked;
  const productionSignals: DecisionDataSignalCategory[] = [
    "fixtures",
    "historical-results",
    "standings",
    "home-away",
    "recent-form",
    "injuries",
    "suspensions",
    "lineups",
    "odds",
    "live-scores",
    "match-events",
    "news",
    "weather",
    "training"
  ];
  const totalProductionSignals = uniqueSignalCount(productionSignals);
  const providerGroups: ProviderReadinessGroup[] = [
    {
      id: "football-fixtures-history",
      label: "Football fixtures and results",
      status: footballApiConfigured ? "live-runtime" : "missing",
      readinessStatus: footballApiConfigured ? "ready" : "warning",
      configured: footballApiConfigured,
      envKeys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      configuredEnvKeys: configuredEnvKeys(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]),
      missingEnvKeys: configuredEnvKeys(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]).length
        ? []
        : ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      implementationStatus: footballApiConfigured ? "live-runtime" : "historical-sync-ready",
      currentUse: footballApiConfigured
        ? "Today's football fixtures can be fetched through the live SportsDataProvider adapter; historical sync remains available."
        : "Historical football fixture sync is implemented through the provider-sync endpoint; live predictions fall back to the mock provider.",
      decisionImpact: "Unlocks real fixtures, live/finished scores, form proxies, home/away features, and the first historical training rows.",
      unlocks: ["fixtures", "historical-results", "home-away", "recent-form", "training"],
      nextAction: footballApiConfigured
        ? "Run provider-backed browser/API checks, then add standings and lineup normalizers."
        : "Add API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY."
    },
    {
      id: "football-standings-lineups",
      label: "Standings, lineups, injuries, and suspensions",
      status: footballApiConfigured ? "live-runtime" : "missing",
      readinessStatus: footballApiConfigured ? "ready" : "warning",
      configured: footballApiConfigured,
      envKeys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      configuredEnvKeys: configuredEnvKeys(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]),
      missingEnvKeys: configuredEnvKeys(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]).length
        ? []
        : ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      implementationStatus: footballApiConfigured ? "live-runtime" : "historical-sync-ready",
      currentUse: footballApiConfigured
        ? "Provider-backed football decisions can consume API-Football lineups, injuries, suspensions, and standings as bounded context signals."
        : "Historical standings, lineup, injury, and suspension sync is implemented through the provider-sync endpoint; live decisions need a sports API key.",
      decisionImpact: "Removes major pre-match uncertainty around standings context, starting elevens, absences, injuries, and suspensions.",
      unlocks: ["standings", "lineups", "injuries", "suspensions"],
      nextAction: footballApiConfigured
        ? "Add source freshness checks and expand provider context to weather/news signals."
        : "Choose the football data provider and add its API key."
    },
    {
      id: "bookmaker-odds",
      label: "Bookmaker odds",
      status: sportsApiConfigured && oddsApiConfigured ? "live-runtime" : oddsApiConfigured ? "configured" : "missing",
      readinessStatus: sportsApiConfigured && oddsApiConfigured ? "ready" : "warning",
      configured: oddsApiConfigured,
      envKeys: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      configuredEnvKeys: configuredEnvKeys(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]),
      missingEnvKeys: configuredEnvKeys(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]).length ? [] : ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      implementationStatus: sportsApiConfigured && oddsApiConfigured ? "live-runtime" : "historical-sync-ready",
      currentUse:
        sportsApiConfigured && oddsApiConfigured
          ? "Current H2H odds can be merged into provider-backed football fixtures; historical h2h sync remains available."
          : "Historical h2h odds sync is implemented; live odds need both football fixtures and odds keys.",
      decisionImpact: "Unlocks market prices, no-vig probabilities, EV, closing-line value, and calibration against bookmaker movement.",
      unlocks: ["odds", "training"],
      nextAction: oddsApiConfigured
        ? "Run provider-backed odds checks, then expand markets beyond H2H where the provider supports them."
        : "Add THE_ODDS_API_KEY or ODDS_API_KEY."
    },
    {
      id: "live-scores-events",
      label: "Live scores and match events",
      status: liveEventsRuntimeConfigured ? "live-runtime" : liveScoresApiConfigured ? "adapter-pending" : "missing",
      readinessStatus: liveEventsRuntimeConfigured ? "ready" : "warning",
      configured: liveEventsRuntimeConfigured || liveScoresApiConfigured,
      envKeys: liveEventEnvKeys,
      configuredEnvKeys: configuredEnvKeys(env, liveEventEnvKeys),
      missingEnvKeys: configuredEnvKeys(env, liveEventEnvKeys).length ? [] : liveEventEnvKeys,
      implementationStatus: liveEventsRuntimeConfigured ? "live-runtime" : "historical-sync-ready",
      currentUse: liveEventsRuntimeConfigured
        ? "API-Football fixture status, scores, and fixture events can feed live football decisions through the provider-backed runtime."
        : liveScoresApiConfigured
          ? "A standalone live-score key is configured, but that provider adapter is not wired to the decision runtime yet."
          : "Historical API-Football event archive sync is implemented; live score and event-level runtime waits for API-Football or a selected live-events provider key.",
      decisionImpact: "Unlocks in-play score state, red cards, substitutions, injuries, tempo, and late abstention gates.",
      unlocks: ["live-scores", "match-events"],
      nextAction: liveEventsRuntimeConfigured
        ? "Archive event snapshots for backtesting, then add richer minute-by-minute event weighting."
        : liveScoresApiConfigured
          ? "Implement the selected standalone live score/event adapter and bind it to monitoring-plan invalidation triggers."
          : "Add API_FOOTBALL_KEY, APISPORTS_KEY, SPORTS_API_KEY, or choose a standalone live-events provider."
    },
    {
      id: "news-injury-context",
      label: "News context",
      status: sportsApiConfigured && newsApiConfigured ? "live-runtime" : newsApiConfigured ? "configured" : "missing",
      readinessStatus: sportsApiConfigured && newsApiConfigured ? "ready" : "warning",
      configured: newsApiConfigured,
      envKeys: ["NEWS_API_KEY"],
      configuredEnvKeys: configuredEnvKeys(env, ["NEWS_API_KEY"]),
      missingEnvKeys: configuredEnvKeys(env, ["NEWS_API_KEY"]).length ? [] : ["NEWS_API_KEY"],
      implementationStatus: sportsApiConfigured && newsApiConfigured ? "live-runtime" : "historical-sync-ready",
      currentUse:
        sportsApiConfigured && newsApiConfigured
          ? "Provider-backed football fixtures can scan NewsAPI headlines and descriptions for late team-news risk signals."
          : "News archive sync is implemented through provider-sync; live news extraction waits for NEWS_API_KEY plus provider-backed football fixtures.",
      decisionImpact: "Unlocks late narrative team news, manager comments, unsupported-claim checks, and additional AI reviewer evidence.",
      unlocks: ["news"],
      nextAction: newsApiConfigured
        ? "Archive normalized news snapshots for backtesting and add stronger source allowlists."
        : "Add NEWS_API_KEY or choose a sports news/injury feed."
    },
    {
      id: "weather-context",
      label: "Weather context",
      status: weatherContextAvailable ? "live-runtime" : "missing",
      readinessStatus: weatherContextAvailable ? "ready" : "warning",
      configured: weatherContextAvailable,
      envKeys: ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"],
      configuredEnvKeys: configuredEnvKeys(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]),
      missingEnvKeys: weatherContextAvailable ? [] : ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      implementationStatus: weatherContextAvailable ? "live-runtime" : "historical-sync-ready",
      currentUse:
        weatherContextAvailable
          ? weatherApiConfigured
            ? "Provider-backed football fixtures can use OpenWeather by venue city, with Open-Meteo available as the keyless forecast path."
            : "Provider-backed football fixtures use keyless Open-Meteo forecasts by venue city and kickoff time."
          : "Weather context waits for provider-backed football fixtures with a venue city; Open-Meteo itself needs no API key.",
      decisionImpact: "Unlocks weather adjustments for totals, tempo, match quality, and avoid rules where conditions matter.",
      unlocks: ["weather"],
      nextAction: weatherContextAvailable
        ? "Verify venue-city coverage and archive Open-Meteo snapshots for backtesting."
        : "Configure API-Football so fixtures provide venue-city evidence; OpenWeather is optional."
    }
  ];
  const configuredSignals = uniqueSignalCount(providerGroups.filter((group) => group.configured).flatMap((group) => group.unlocks));
  const liveRuntimeSignals = liveRuntimeBacked
    ? uniqueSignalCount(providerGroups.filter((group) => group.status === "live-runtime").flatMap((group) => group.unlocks))
    : 0;
  const adapterPendingGroups = providerGroups.filter((group) => group.status === "adapter-pending").length;
  const missingGroups = providerGroups.filter((group) => group.status === "missing").length;
  const configuredGroups = providerGroups.filter((group) => group.configured).length;
  const nextProviderActions = providerGroups
    .filter((group) => group.status !== "live-runtime")
    .map((group) => `${group.label}: ${group.nextAction}`)
    .slice(0, 6);

  const checks: EngineReadinessCheck[] = [
    {
      id: "deterministic-core",
      label: "Deterministic decision core",
      status: "ready",
      detail: "Poisson, value edge, factor scoring, sensitivity checks, and guardrails are available."
    },
    {
      id: "openai-enhancer",
      label: "OpenAI enhancement",
      status: openAiConfigured ? "ready" : "warning",
      detail: openAiConfigured
        ? `Responses API enhancement is configured with ${model}.`
        : "OPENAI_API_KEY is not configured; deterministic summaries remain active."
    },
    {
      id: "supabase-project-target",
      label: "Supabase project target",
      status: supabasePreflight.targetMatchesExpected ? "ready" : "blocked",
      detail: supabasePreflight.summary
    },
    {
      id: "supabase-writes",
      label: "Supabase decision writes",
      status: supabaseStatus === "ready" ? "ready" : supabaseStatus === "blocked" ? "blocked" : "warning",
      detail: supabase.serverWriteReady
        ? `Server-side writes can target ${supabase.projectRef ?? supabase.projectHost ?? "the configured project"}.`
        : `Server-side writes are paused. Missing: ${supabase.missingServerEnv.join(", ")}.`
    },
    {
      id: "supabase-schema",
      label: "Supabase schema verification",
      status: supabaseSchema.status,
      detail: supabaseSchema.detail
    },
    {
      id: "decision-memory",
      label: "Decision memory and learning loop",
      status: supabase.serverWriteReady ? "ready" : "warning",
      detail: supabase.serverWriteReady
        ? "Recent decision reads, outcome tracking, and calibration-run storage are available through server API routes."
        : "Decision memory is implemented but waits for Supabase server credentials."
    },
    {
      id: "historical-training",
      label: "Historical training and backtests",
      status: supabase.serverWriteReady ? "warning" : "warning",
      detail: supabase.serverWriteReady
        ? "Training tables and backtest storage are implemented; import finished fixtures, odds, features, and closing prices before trusting calibration."
        : "Historical training code is implemented but waits for Supabase server credentials."
    },
    {
      id: "market-data",
      label: "Fixture and odds providers",
      status: providerKeysConfigured ? "warning" : "warning",
      detail: providerKeysConfigured
        ? "Fixture and odds provider keys are configured; the live runtime can fetch provider-backed football fixtures and current H2H odds."
        : "The MVP is still using the deterministic mock provider for fixtures and odds."
    },
    {
      id: "news-live-context",
      label: "Availability, news, weather, and live context",
      status: fullContextRuntimeConfigured ? "ready" : "warning",
      detail: fullContextRuntimeConfigured
        ? "Structured injuries, suspensions, lineups, live events, keyless weather, and licensed news can flow into provider-backed football context."
        : footballApiConfigured
          ? "API-Football can provide lineups, injuries, suspensions, standings, and live events; keyless Open-Meteo covers forecastable venue weather, while a licensed news feed is still missing."
          : "Lineups, injuries, suspensions, live events, news, and weather remain missing or mock-backed signals."
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    engineVersion: DECISION_ENGINE_VERSION,
    runtimeMode: liveRuntimeBacked ? "provider-backed" : "demo-mock",
    deterministicCore: {
      status: "ready",
      detail: "The rules-and-model engine can rank matches without external AI."
    },
    openAi: {
      status: openAiConfigured ? "ready" : "warning",
      configured: openAiConfigured,
      model,
      detail: openAiConfigured ? "LLM enhancement is available for public summaries." : "LLM enhancement is optional and currently off."
    },
    supabase: {
      status: supabaseStatus,
      configured: supabase.serverWriteReady,
      projectRef: supabase.projectRef,
      projectHost: supabase.projectHost,
      missingEnv: supabase.missingServerEnv,
      detail: supabase.serverWriteReady
        ? "Decision-run persistence can write through server API routes."
        : supabasePreflight.summary,
      preflight: supabasePreflight,
      schema: supabaseSchema
    },
    dataProviders: {
      status: liveRuntimeBacked ? "ready" : "warning",
      sportsApiConfigured,
      oddsApiConfigured,
      liveScoresApiConfigured,
      newsApiConfigured,
      weatherApiConfigured: weatherContextAvailable,
      liveRuntimeBacked,
      runtimeProvider,
      configuredGroups,
      missingGroups,
      adapterPendingGroups,
      configuredSignalCoverage: coveragePercent(configuredSignals, totalProductionSignals),
      liveRuntimeSignalCoverage: coveragePercent(liveRuntimeSignals, totalProductionSignals),
      totalProductionSignals,
      groups: providerGroups,
      nextProviderActions,
      detail: liveRuntimeBacked
        ? "Live football predictions can use provider-backed fixtures; odds are provider-backed when THE_ODDS_API_KEY or ODDS_API_KEY is present."
        : providerKeysConfigured
          ? "Provider keys are present for sync work, but today's decision runtime still uses the mock provider adapter."
          : "Mock provider is active until real sports data keys and live adapters are added."
    },
    trainingData: {
      status: supabase.serverWriteReady ? "warning" : "warning",
      configured: supabase.serverWriteReady,
      detail: supabase.serverWriteReady
        ? "The training/backtest spine is available; it needs historical provider ingestion before model calibration is production-grade."
        : "Training/backtest storage is ready in code but waiting for the OddsPadi Supabase env."
    },
    checks
  };
}

export async function verifyDecisionEngineReadiness(): Promise<DecisionEngineReadiness> {
  const readiness = buildDecisionEngineReadiness();

  if (!readiness.supabase.configured) return readiness;

  const [schema, memory] = await Promise.all([verifySupabaseSchemaTables(), getDecisionMemorySnapshot({ limit: 1 })]);
  readiness.supabase.schema = schema;
  updateReadinessCheck(readiness, "supabase-schema", schema.detail);
  const schemaCheck = readiness.checks.find((item) => item.id === "supabase-schema");
  if (schemaCheck) schemaCheck.status = schema.status;

  if (schema.status !== "ready") {
    readiness.supabase.status = schema.status === "blocked" ? "blocked" : "warning";
    readiness.supabase.configured = false;
    readiness.supabase.detail = schema.detail;
    readiness.trainingData.status = "warning";
    readiness.trainingData.configured = false;
    readiness.trainingData.detail = `Training/backtest storage cannot be trusted until schema verification passes: ${schema.detail}`;

    updateReadinessCheck(readiness, "supabase-writes", schema.detail);
    updateReadinessCheck(readiness, "decision-memory", `Decision memory waits for schema verification: ${schema.detail}`);
    updateReadinessCheck(readiness, "historical-training", readiness.trainingData.detail);
    if (schema.status === "blocked") {
      const writesCheck = readiness.checks.find((item) => item.id === "supabase-writes");
      if (writesCheck) writesCheck.status = "blocked";
    }
  }

  if (memory.status === "failed") {
    const reason = memory.reason ?? "Supabase server read failed.";
    const detail = `Supabase env points at ${readiness.supabase.projectRef ?? "the configured project"}, but the server read failed: ${reason}. Replace SUPABASE_SERVICE_ROLE_KEY with a valid key for this project before persisting decisions.`;

    readiness.supabase.status = readiness.supabase.status === "blocked" ? "blocked" : "warning";
    readiness.supabase.configured = false;
    readiness.supabase.detail = readiness.supabase.schema.status !== "ready" ? `${readiness.supabase.schema.detail} ${detail}` : detail;
    readiness.trainingData.status = "warning";
    readiness.trainingData.configured = false;
    readiness.trainingData.detail = `Training/backtest storage is implemented, but Supabase credentials are not verified: ${reason}.`;

    updateReadinessCheck(readiness, "supabase-writes", detail);
    updateReadinessCheck(readiness, "decision-memory", detail);
    updateReadinessCheck(readiness, "historical-training", readiness.trainingData.detail);
  } else if (memory.status === "ready" && schema.status === "ready") {
    readiness.supabase.detail = `Supabase server read verified for ${readiness.supabase.projectRef ?? readiness.supabase.projectHost ?? "the configured project"}. Decision-run persistence can write through server API routes.`;
  }

  return readiness;
}

export async function runDecisionEngineSelfTest({
  matchId = "epl-001",
  enhance = false,
  persist = false,
  env = process.env
}: {
  matchId?: string;
  enhance?: boolean;
  persist?: boolean;
  env?: EnvMap;
} = {}): Promise<DecisionEngineSelfTest> {
  const readiness = buildDecisionEngineReadiness(env);
  const row = await getMatchPrediction(matchId);
  const rows = row ? [row] : [];
  const selfTestDate = selfTestDateFromKickoff(row?.match.kickoffTime);
  const selfTestSport = row?.match.sport ?? "football";
  const slateThinking = buildDecisionSlateThinking({ rows, date: selfTestDate, sport: selfTestSport, limit: 6 });
  const workingMemory = buildDecisionWorkingMemory({ rows, date: selfTestDate, sport: selfTestSport, slateThinking, limit: 24 });
  const reflection = buildDecisionReflection({ rows, date: selfTestDate, sport: selfTestSport, slateThinking, workingMemory, limit: 6 });
  const rehearsal = buildDecisionRehearsal({ rows, date: selfTestDate, sport: selfTestSport, slateThinking, workingMemory, reflection, limit: 4 });
  const evidenceGraph = buildDecisionEvidenceGraph({ rows, date: selfTestDate, sport: selfTestSport, slateThinking, limit: 6 });
  const thinkingIntrospection = buildDecisionThinkingIntrospection({
    date: selfTestDate,
    sport: selfTestSport,
    slateThinking,
    workingMemory,
    reflection,
    rehearsal,
    evidenceGraph
  });
  const notRunEnhancement: DecisionEnhancementResult = {
    requested: false,
    provider: "deterministic",
    status: "not-requested",
    decision: row?.prediction.decision ?? {
      engineVersion: DECISION_ENGINE_VERSION,
      verdict: "insufficient-data",
      action: "avoid",
      confidence: "low",
      risk: "high",
      decisionScore: 0,
      recommendedSelection: null,
      summary: "Self-test could not load the requested match.",
      health: "fragile",
      calibration: {
        reliabilityScore: 0,
        health: "fragile",
        action: "abstain",
        detail: "The requested fixture could not be loaded."
      },
      agentStages: [],
      contradictionChecks: [],
      scenarioMatrix: [],
      caseMemory: {
        status: "no-memory",
        configured: false,
        sampleSize: 0,
        similarCases: [],
        actionMix: {
          consider: 0,
          monitor: 0,
          avoid: 0
        },
        averageSimilarity: null,
        averageReliabilityScore: null,
        averageDecisionScore: null,
        adjustment: "none",
        summary: "Case memory cannot run because the requested fixture was not found.",
        notes: ["A valid fixture is required before comparing against stored decisions."]
      },
      beliefState: {
        status: "ready",
        grade: "fragile",
        generatedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        ttlMinutes: 0,
        baseModelProbability: null,
        marketImpliedProbability: null,
        believedProbability: null,
        probabilityEdge: null,
        expectedValue: null,
        confidenceInterval: {
          low: null,
          high: null,
          method: "unavailable",
          confidenceLevel: null,
          sampleSize: null,
          source: null,
          detail: "Empirical interval unavailable because the requested fixture was not found."
        },
        uncertaintyScore: 100,
        evidenceBalance: {
          supports: 0,
          opposes: 1,
          uncertain: 0
        },
        signals: [
          {
            id: "fixture-missing-belief",
            label: "Fixture missing",
            direction: "opposes",
            probabilityImpact: -1,
            confidence: "low",
            source: "self-test",
            detail: "No model, market, context, memory, or committee belief can run without a valid fixture."
          }
        ],
        invalidationTriggers: ["Rerun with a valid fixture ID."],
        summary: "Belief is fragile: no fixture was loaded, so no probability belief can be trusted."
      },
      deliberation: {
        primaryThesis: "No decision thesis can be formed because the requested fixture was not found.",
        dissentingThesis: "The engine may work for a valid fixture, so this result only covers the missing fixture path.",
        synthesis: "Fragile decision: abstain until a valid fixture and market snapshot are available.",
        hypotheses: [
          {
            id: "fixture-required",
            label: "Fixture required",
            status: "rejected",
            confidence: "low",
            detail: "The self-test could not load the requested match.",
            support: [],
            challenge: ["Fixture data is missing."],
            decisionImpact: "The engine must avoid because no market, model, or context evidence can be evaluated."
          }
        ],
        watchItems: [
          {
            id: "valid-fixture",
            label: "Valid fixture",
            priority: "high",
            signalType: "data-quality",
            whyItMatters: "A valid fixture is required before model probabilities, odds, context, and guardrails can run.",
            actionIfConfirmed: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        decisionIfMissingDataTurnsBad: "Remain avoid until fixture data exists.",
        decisionIfMarketMoves: "No market movement can be evaluated without fixture and odds data."
      },
      committee: {
        status: "ready",
        consensus: "unanimous",
        recommendedAction: "avoid",
        voteCounts: {
          consider: 0,
          monitor: 0,
          avoid: 1
        },
        members: [
          {
            id: "fixture-required-arbiter",
            role: "final-arbiter",
            label: "Final arbiter",
            stance: "abstain",
            vote: "avoid",
            confidence: "low",
            risk: "high",
            thesis: "The committee cannot form a valid decision without fixture data.",
            evidence: [],
            objections: ["Fixture data is missing."],
            requiredChecks: ["Rerun the self-test with a valid fixture ID."]
          }
        ],
        finalRationale: "Decision committee recommends avoid because the fixture could not be loaded.",
        unresolvedDisagreements: [],
        guardrailNotes: ["A valid fixture is required before model, market, context, memory, and risk roles can vote."]
      },
      monitoringPlan: {
        status: "expired",
        priority: "critical",
        nextReviewAt: new Date().toISOString(),
        reviewCadenceMinutes: 0,
        summary: "Monitoring is expired because no fixture was loaded; rerun with a valid fixture before any model or market watch can start.",
        tasks: [
          {
            id: "load-valid-fixture",
            label: "Load valid fixture",
            priority: "critical",
            dueAt: new Date().toISOString(),
            source: "provider",
            trigger: "The decision engine cannot monitor odds, news, or live events without a valid fixture.",
            action: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        stopConditions: ["Stop because the current belief has expired.", "Stop while fixture data is missing."],
        escalationRules: ["If the fixture provider still cannot return this match, keep the decision avoided and inspect provider coverage."]
      },
      actionability: {
        status: "blocked",
        posture: "avoid-recommendation",
        score: 0,
        summary: "Actionability is 0/100: block a public recommendation because no fixture, model, market, or context evidence was loaded.",
        gates: [
          {
            id: "fixture-required",
            label: "Fixture required",
            status: "fail",
            score: 0,
            weight: 1,
            detail: "The decision engine cannot audit actionability without a valid fixture.",
            requiredAction: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        blockers: ["Fixture required: the requested fixture was not found."],
        warnings: [],
        requiredBeforeAction: ["Rerun the self-test with a match ID returned by the fixture provider."],
        responsibleUse: [
          "Treat the output as statistical analysis, not certainty.",
          "Do not use this audit as staking, bankroll, or financial advice.",
          "Avoid acting when fixture, market, or provider evidence is missing."
        ]
      },
      reviewLoop: {
        status: "blocked",
        initialAction: "avoid",
        recommendedAction: "avoid",
        confidenceShift: "lower",
        riskShift: "raise",
        scoreDelta: -100,
        summary: "Review loop blocks the recommendation because the requested fixture was not loaded.",
        steps: [
          {
            id: "fixture-required-review",
            role: "final-reviewer",
            verdict: "block",
            confidence: "low",
            summary: "No thesis, red-team critique, data-gap review, or repair loop can run without fixture evidence.",
            evidence: ["The requested fixture was not found."],
            requiredChange: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        repairsApplied: [],
        unresolvedIssues: ["Fixture data is missing."],
        releaseCriteria: ["A valid fixture, market snapshot, and model output must load before the review loop can clear a decision."]
      },
      researchBrief: {
        status: "blocked",
        headline: "Self-test fixture is blocked from a public recommendation.",
        executiveSummary: "No fixture, market, model, or context evidence loaded, so the research brief blocks the recommendation.",
        modelThesis: "No model thesis can be formed until a valid fixture is loaded.",
        marketThesis: "No market thesis can be formed until odds and fixture evidence are available.",
        riskThesis: "Risk is high because every downstream decision gate depends on missing fixture evidence.",
        dataGaps: ["Valid fixture", "Market snapshot", "Model output"],
        requiredChecks: ["Rerun the self-test with a match ID returned by the fixture provider."],
        evidenceTrail: ["fixture-required: The requested fixture was not found."],
        analystPosture: "Block public recommendation until a valid fixture and market snapshot are loaded.",
        decisionClock: "Expired immediately; rerun after loading a valid fixture."
      },
      notebook: {
        status: "blocked",
        summary: "Notebook is blocked because the requested fixture did not load.",
        assumptions: [
          {
            id: "fixture-must-load",
            label: "Fixture must load",
            priority: "critical",
            status: "blocked",
            source: "operator",
            detail: "No fixture, market, model, or context evidence is available.",
            action: "Rerun the self-test with a match ID returned by the fixture provider.",
            dueAt: new Date().toISOString()
          }
        ],
        falsifiers: [
          {
            id: "missing-fixture-falsifier",
            label: "Fixture missing",
            priority: "critical",
            status: "blocked",
            source: "operator",
            detail: "The requested fixture was not found, so every recommendation thesis is invalid.",
            action: "Keep the recommendation blocked until a valid fixture is loaded.",
            dueAt: new Date().toISOString()
          }
        ],
        refreshTriggers: [
          {
            id: "load-valid-fixture",
            label: "Load valid fixture",
            priority: "critical",
            status: "open",
            source: "operator",
            detail: "A valid fixture is required before model, market, and risk checks can run.",
            action: "Rerun with a match ID returned by the fixture provider.",
            dueAt: new Date().toISOString()
          }
        ],
        operatorChecklist: [
          {
            id: "operator-valid-fixture",
            label: "Valid fixture",
            priority: "critical",
            status: "blocked",
            source: "operator",
            detail: "Rerun the self-test with a match ID returned by the fixture provider.",
            action: "Load a valid fixture and rerun the decision engine.",
            dueAt: new Date().toISOString()
          }
        ],
        auditTrail: [
          "Notebook opened for a missing self-test fixture.",
          "Fixture lookup failed before model, market, context, or risk evidence could be evaluated."
        ],
        nextReviewAt: new Date().toISOString()
      },
      probabilityTrace: {
        status: "blocked",
        summary: "Probability trace is blocked because no fixture, market, model, or priced candidate loaded.",
        selection: null,
        marketId: null,
        basePriorProbability: null,
        modelProbability: null,
        posteriorProbability: null,
        posteriorEdge: null,
        posteriorExpectedValue: null,
        disagreement: null,
        confidenceBand: {
          low: null,
          high: null
        },
        clampRange: {
          min: 0.02,
          max: 0.98
        },
        steps: [
          {
            id: "fixture-missing",
            kind: "posterior",
            label: "No probability trace",
            status: "skipped",
            priorProbability: null,
            posteriorProbability: null,
            probabilityDelta: null,
            logOddsDelta: 0,
            weight: 0,
            confidence: "low",
            detail: "A valid fixture, model probability, no-vig market probability, and odds are required before evidence fusion can run."
          }
        ],
        conflicts: ["Fixture data is missing.", "Market snapshot is missing.", "Model output is missing."],
        safeguards: [
          "Do not infer posterior probability without a priced candidate.",
          "Rerun with a valid fixture and market snapshot before trusting any recommendation."
        ]
      },
      attribution: {
        status: "blocked",
        summary: "Attribution is blocked because no fixture, market, model, or evidence drivers loaded.",
        decisiveFactor: "Fixture data is missing",
        netProbabilityMovement: null,
        modelMarketGap: null,
        valueScore: 0,
        riskScore: 100,
        positiveDrivers: [],
        negativeDrivers: [
          {
            id: "fixture-missing",
            category: "data",
            label: "Fixture data is missing",
            direction: "negative",
            impactScore: 100,
            probabilityImpact: null,
            detail: "A valid fixture is required before model probabilities, odds, context, and guardrails can produce attribution."
          }
        ],
        neutralDrivers: [],
        missingDataDrag: [
          {
            id: "missing-fixture",
            category: "data",
            label: "Valid fixture",
            direction: "negative",
            impactScore: 100,
            probabilityImpact: null,
            detail: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        explanation: "The final action is constrained by missing fixture data; no public recommendation can be attributed yet."
      },
      uncertainty: {
        status: "high-risk",
        score: 100,
        method: "weighted-evidence-risk-index-v1",
        statistical: false,
        summary: "Diagnostic uncertainty risk is high at 100/100 because no fixture, model, market, or context evidence loaded.",
        primaryUncertainty: "Fixture data is missing",
        confidencePenalty: 0.28,
        components: [
          {
            id: "fixture-missing",
            category: "data",
            label: "Fixture data is missing",
            level: "high",
            score: 100,
            weight: 1,
            contribution: 100,
            detail: "A valid fixture is required before the engine can decompose model, market, context, price, timing, memory, or robustness uncertainty.",
            mitigation: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        mitigations: ["Rerun the self-test with a match ID returned by the fixture provider."],
        decisionImpact: "Downgrade or block public trust until fixture data is loaded."
      },
      decisionBoundary: {
        status: "blocked",
        summary: "Decision boundary is blocked because no fixture, model, market, odds, or context evidence loaded.",
        nearestFlip: "Fixture data is missing: no measurable margin past the boundary.",
        flipMargin: null,
        metrics: [
          {
            id: "fixture-missing",
            kind: "probability-floor",
            label: "Fixture and market floor",
            current: null,
            threshold: null,
            margin: null,
            status: "breached",
            detail: "A valid fixture, model probability, no-vig market probability, and quoted odds are required before boundary math can run."
          }
        ],
        requiredToStayConsider: [
          "Load a valid fixture.",
          "Fetch bookmaker odds and model probabilities.",
          "Clear the data-quality, probability, edge, EV, and uncertainty boundaries before showing value."
        ],
        flipTriggers: ["Fixture data is missing.", "Market snapshot is missing.", "Model output is missing."],
        nextAction: "Load a valid fixture, fetch odds, and rerun the decision engine."
      },
      aiProtocol: {
        status: "blocked",
        mode: "deterministic-public-audit",
        objective: "Decide whether a missing fixture can produce a responsible value candidate.",
        summary: "AI protocol is blocked because no fixture, model, market, odds, or provider evidence loaded.",
        questions: [
          {
            id: "fixture-required",
            prompt: "Can the agent evaluate a fixture?",
            status: "blocked",
            answer: "No valid fixture was loaded, so no value, risk, or market thesis can be audited.",
            evidenceIds: ["fixture-missing"],
            followUp: "Load a valid fixture, fetch odds, and rerun the decision engine."
          }
        ],
        checks: [
          {
            id: "fixture-audit",
            label: "Fixture audit",
            status: "fail",
            detail: "The decision engine cannot run without a fixture.",
            evidenceIds: ["fixture-missing"]
          }
        ],
        evidenceRefs: [
          {
            id: "fixture-missing",
            label: "Fixture missing",
            source: "fixture-provider",
            claim: "No fixture was loaded for the requested self-test match."
          }
        ],
        toolRequests: [
          {
            id: "load-fixture",
            label: "Load valid fixture",
            priority: "critical",
            status: "missing",
            provider: "Fixture provider",
            reason: "A valid fixture is required before model, market, context, risk, and AI review can run.",
            unlocks: "Allows the decision engine to build probabilities, odds intelligence, data coverage, boundaries, and AI review evidence."
          }
        ],
        guardrails: [
          "Do not infer a decision without a fixture.",
          "Do not invent odds, teams, lineups, news, or model outputs.",
          "Return public audit notes only, not hidden chain-of-thought."
        ],
        reviewerInstructions: "Block the review until a valid fixture and market snapshot are supplied."
      },
      reasoningGraph: {
        status: "blocked",
        summary: "Reasoning graph is blocked because no fixture, model, market, odds, or provider evidence loaded.",
        entryNodeId: "objective",
        decisionNodeId: "final-action",
        nodes: [
          {
            id: "objective",
            type: "objective",
            label: "Decision objective",
            status: "neutral",
            strength: 100,
            detail: "Evaluate whether the requested fixture can produce a responsible value candidate.",
            evidenceIds: []
          },
          {
            id: "fixture-missing",
            type: "data",
            label: "Fixture missing",
            status: "blocking",
            strength: 0,
            detail: "No valid fixture was loaded for the requested decision.",
            evidenceIds: ["fixture-missing"]
          },
          {
            id: "final-action",
            type: "action",
            label: "Final action: avoid",
            status: "blocking",
            strength: 0,
            detail: "Avoid because fixture, market, model, and provider evidence are missing.",
            evidenceIds: ["fixture-missing"]
          }
        ],
        edges: [
          {
            id: "objective-requires-fixture",
            from: "objective",
            to: "fixture-missing",
            relation: "requires",
            weight: 1,
            detail: "A fixture is required before any model, market, risk, or AI-review decision can run."
          },
          {
            id: "fixture-blocks-action",
            from: "fixture-missing",
            to: "final-action",
            relation: "blocks",
            weight: 1,
            detail: "Missing fixture data blocks public recommendation."
          }
        ],
        strongestPath: [],
        blockingPath: ["objective", "fixture-missing", "final-action"],
        unresolvedNodes: []
      },
      toolOrchestration: {
        status: "blocked",
        summary: "Tool orchestration is blocked because the first task, loading a valid fixture, has not completed.",
        readinessScore: 0,
        nextTaskId: "fixtures-today",
        tasks: [
          {
            id: "fixtures-today",
            category: "fixtures",
            label: "Load today's fixture",
            priority: "critical",
            status: "blocked",
            provider: "Fixture provider",
            dependsOn: [],
            freshnessMinutes: 30,
            reason: "No valid fixture was loaded for the requested self-test match.",
            unlocks: "Allows model probability, market odds, context, persistence, and AI review to run.",
            decisionImpact: "Without a fixture, the decision must remain avoid."
          }
        ],
        executionOrder: ["fixtures-today"],
        blockingTasks: ["fixtures-today"],
        readyTasks: [],
        staleAfterMinutes: null
      },
      toolExecution: {
        status: "blocked",
        mode: "deterministic-local-audit",
        generatedAt: new Date().toISOString(),
        summary: "Tool execution audit is blocked because no fixture task could execute.",
        totalTasks: 1,
        executedTasks: 0,
        blockedTasks: 1,
        waitingTasks: 0,
        skippedTasks: 0,
        attempts: [
          {
            id: "attempt-fixtures-today",
            taskId: "fixtures-today",
            label: "Load today's fixture",
            category: "fixtures",
            status: "blocked",
            provider: "Fixture provider",
            priority: "critical",
            observedRecords: 0,
            outputSignals: ["fixture", "kickoff", "teams", "league"],
            startedAt: new Date().toISOString(),
            completedAt: null,
            detail: "Load today's fixture is blocked: no valid fixture was loaded for the requested self-test match.",
            decisionDelta: "No decision delta was applied because the task did not execute.",
            nextAction: "Load a valid fixture, fetch odds, and rerun the decision engine."
          }
        ],
        nextRun: "Load today's fixture: Load a valid fixture, fetch odds, and rerun the decision engine.",
        publicLog: ["Load today's fixture: blocked; no valid fixture was loaded for the requested self-test match."]
      },
      controlPolicy: {
        status: "blocked",
        visibility: "internal-only",
        automationMode: "blocked",
        publishAllowed: false,
        persistAllowed: false,
        aiReviewRequired: false,
        rerunRequired: true,
        safeToDisplay: false,
        primaryBlockerId: "fixture-required",
        summary: "Control policy blocks public display because no valid fixture was loaded.",
        primaryDirective: "Block public display and load a valid fixture first.",
        nextBestAction: "Load a valid fixture, fetch odds, and rerun the decision engine.",
        gates: [
          {
            id: "fixture-required",
            label: "Fixture required",
            source: "data",
            status: "block",
            detail: "No fixture, model, market, context, or tool output is available.",
            requiredAction: "Load a valid fixture, fetch odds, and rerun the decision engine."
          }
        ],
        allowedActions: ["load fixture", "rerun self-test"],
        forbiddenActions: ["publish as value candidate", "show as actionable", "invent missing data"],
        releaseCriteria: ["Load a valid fixture.", "Fetch bookmaker odds and model probabilities.", "Rerun the decision engine."]
      },
      oddsIntelligence: {
        status: "no-value",
        totalMarkets: 0,
        totalSelections: 0,
        positiveEdgeSelections: 0,
        positiveExpectedValueSelections: 0,
        actionableSelections: 0,
        averageBookmakerMargin: null,
        bestSelection: null,
        bestActionableSelection: null,
        bestWatchlistSelection: null,
        topCandidates: [],
        marketAudits: [],
        avoidReasons: ["No fixture or market snapshot was loaded."],
        watchlistReasons: [],
        summary: "Odds intelligence cannot run without fixture odds and model probabilities."
      },
      marketMovement: {
        status: "no-market",
        summary: "Market movement cannot be evaluated because no fixture, odds, or model probability loaded.",
        selection: null,
        marketId: null,
        currentOdds: null,
        fairOdds: null,
        breakEvenProbability: null,
        noVigImpliedProbability: null,
        currentEdge: null,
        currentExpectedValue: null,
        oddsBuffer: null,
        maxShorteningBeforeNoValue: null,
        targetClosingLineValue: null,
        scenarios: [
          {
            id: "no-market",
            label: "No priced candidate",
            odds: null,
            modelProbability: null,
            noVigImpliedProbability: null,
            edge: null,
            expectedValue: null,
            actionAfterMove: "avoid",
            detail: "Wait for a valid fixture and market snapshot before evaluating price movement."
          }
        ],
        alerts: ["No priced candidate is available."],
        nextAction: "Load a valid fixture, fetch odds, and rerun value-edge ranking."
      },
      dataCoverage: {
        status: "insufficient",
        score: 0,
        providerBackedSignals: 0,
        computedSignals: 0,
        mockSignals: 0,
        missingSignals: 1,
        staleSignals: 0,
        totalSignals: 1,
        summary: "Data coverage is 0/100 because no fixture, market, model, or provider evidence loaded.",
        signals: [
          {
            id: "fixture-required",
            category: "fixtures",
            label: "Fixture for the day",
            status: "missing",
            source: "fixture-provider",
            freshness: "missing",
            weight: 1,
            detail: "Rerun the self-test with a match ID returned by the fixture provider.",
            requiredForProduction: true
          }
        ],
        requiredBeforeTrust: ["Fixture for the day: Rerun the self-test with a match ID returned by the fixture provider."]
      },
      historicalDiscipline: {
        status: "not-attached",
        attached: false,
        source: null,
        seasons: null,
        fixtures: 0,
        oddsRows: 0,
        bookmakerMarkets: 0,
        diagnosticScore: 0,
        benchmarkVerdict: null,
        trustEffect: "none",
        cappedByMarketPrior: false,
        summary: "No 10-year public historical evidence is attached to this self-test fallback.",
        instruction: "Load a valid fixture before attaching public historical discipline evidence.",
        requiredBeforePromotion: ["Rerun the self-test with a valid fixture ID."],
        proofUrls: ["/api/sports/decision/training/public-historical-training-evidence"]
      },
      robustness: {
        status: "fragile",
        score: 0,
        survivalRate: 0,
        worstCase: {
          id: "fixture-missing",
          label: "Fixture missing",
          status: "breaks",
          probabilityShift: -1,
          edgeAfterShock: null,
          expectedValueAfterShock: null,
          actionAfterShock: "avoid",
          detail: "No robustness stress test can run without fixture, market, and model evidence.",
          repair: "Rerun the self-test with a match ID returned by the fixture provider."
        },
        summary: "Robustness is 0/100: no stress test survives because the fixture was not loaded.",
        cases: [
          {
            id: "fixture-missing",
            label: "Fixture missing",
            status: "breaks",
            probabilityShift: -1,
            edgeAfterShock: null,
            expectedValueAfterShock: null,
            actionAfterShock: "avoid",
            detail: "No robustness stress test can run without fixture, market, and model evidence.",
            repair: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        hedgeSuggestions: [],
        requiredRechecks: ["Rerun the self-test with a match ID returned by the fixture provider."]
      },
      evaluationPlan: {
        status: "no-action",
        settlementMarket: null,
        settlementSelection: null,
        modelProbability: null,
        noVigMarketProbability: null,
        breakEvenProbability: null,
        quotedOdds: null,
        valueEdge: null,
        expectedValue: null,
        targetClosingLineValue: null,
        summary: "Evaluation plan cannot be registered until a fixture and market snapshot are loaded.",
        successCriteria: ["A valid fixture loads and the engine produces a measurable decision."],
        failureCriteria: ["The self-test remains pointed at a missing fixture."],
        learningQuestions: ["Why did fixture lookup fail before the decision engine ran?"],
        requiredOutcomeSignals: [
          {
            id: "fixture-required",
            label: "Valid fixture",
            status: "required",
            source: "operator",
            detail: "Rerun the self-test with a match ID returned by the fixture provider."
          }
        ],
        postMatchActions: ["No post-match learning action is available until the fixture loads."]
      },
      abstentionRules: [
        {
          id: "fixture-missing",
          label: "Fixture required",
          triggered: true,
          detail: "The decision engine cannot run without a fixture."
        }
      ],
      factors: [],
      sensitivityChecks: [],
      publicReasoningSteps: [],
      evidence: [],
      risks: [],
      avoidReasons: ["Match not found."],
      saferAlternatives: [],
      missingSignals: [],
      nextChecks: [],
      llmEnhanced: false
    }
  };

  const enhancement = row && enhance
    ? await runDecisionEnhancementWithOpenAI({
        match: row.match,
        prediction: row.prediction,
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.OPENAI_DECISION_MODEL
      })
    : notRunEnhancement;

  const persistence = row && persist
    ? await persistDecisionRun({ match: row.match, prediction: row.prediction, decision: enhancement.decision })
    : {
        requested: false,
        status: "skipped" as const,
        configured: readiness.supabase.configured,
        table: "op_decision_runs" as const,
        reason: "Persistence self-test was not requested."
      };

  const checks: DecisionEngineSelfTest["checks"] = [
    {
      id: "fixture-loaded",
      label: "Fixture loaded",
      status: row ? "passed" : "failed",
      detail: row ? `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}` : `No match found for ${matchId}.`
    },
    {
      id: "decision-built",
      label: "Decision report built",
      status: row?.prediction.decision.factors.length ? "passed" : "failed",
      detail: row
        ? `${row.prediction.decision.verdict} with score ${row.prediction.decision.decisionScore}.`
        : "The decision report could not be created."
    },
    {
      id: "evidence-quality",
      label: "Evidence and missing signals",
      status: row?.prediction.decision.evidence.length && row.prediction.decision.missingSignals.length ? "passed" : "warning",
      detail: row
        ? `${row.prediction.decision.evidence.length} evidence items; ${row.prediction.decision.missingSignals.length} missing signals.`
        : "No evidence was generated."
    },
    {
      id: "ai-evidence-graph",
      label: "AI evidence graph",
      status: evidenceGraph.totals.nodes ? "passed" : "failed",
      detail: `${evidenceGraph.status}; ${evidenceGraph.totals.nodes} nodes, ${evidenceGraph.totals.edges} edges, graph ${evidenceGraph.graphHash}.`
    },
    {
      id: "ai-thinking-introspection",
      label: "AI thinking introspection",
      status: thinkingIntrospection.totals.layers ? (thinkingIntrospection.status === "ready-shadow" ? "passed" : "warning") : "failed",
      detail: `${thinkingIntrospection.status}; ${thinkingIntrospection.totals.layers} layers, focus ${thinkingIntrospection.focus.layer ?? "none"}, receipt ${thinkingIntrospection.introspectionHash}.`
    },
    {
      id: "ai-proof-control-locks",
      label: "AI proof control locks",
      status:
        evidenceGraph.controls.canPersist === false &&
        evidenceGraph.controls.canPublish === false &&
        evidenceGraph.controls.canTrain === false &&
        evidenceGraph.controls.canRaiseTrust === false &&
        evidenceGraph.controls.canUpgradePublicAction === false &&
        thinkingIntrospection.controls.canPersist === false &&
        thinkingIntrospection.controls.canPublish === false &&
        thinkingIntrospection.controls.canTrain === false &&
        thinkingIntrospection.controls.canRaiseTrust === false &&
        thinkingIntrospection.controls.canUpgradePublicAction === false &&
        thinkingIntrospection.controls.canUseHiddenChainOfThought === false
          ? "passed"
          : "failed",
      detail: "Evidence graph and thinking introspection are read-only receipts with persist, publish, train, trust-raise, public-action upgrade, and hidden-chain access locked."
    },
    {
      id: "openai-enhancement",
      label: "OpenAI enhancement",
      status: enhance ? (enhancement.status === "enhanced" ? "passed" : "warning") : "skipped",
      detail: enhance ? enhancement.reason ?? enhancement.status : "Enhancement was not requested."
    },
    {
      id: "supabase-persistence",
      label: "Supabase persistence",
      status: persist ? (persistence.status === "stored" ? "passed" : "warning") : "skipped",
      detail: persistence.reason ?? (persistence.id ? `Stored decision run ${persistence.id}.` : persistence.status)
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    health: selfTestHealth(checks),
    matchId,
    checks,
    aiProofs: {
      evidenceGraph: {
        status: evidenceGraph.status,
        graphHash: evidenceGraph.graphHash,
        nodes: evidenceGraph.totals.nodes,
        edges: evidenceGraph.totals.edges,
        activePath: evidenceGraph.activePath,
        proofUrls: evidenceGraph.proofUrls,
        controls: evidenceGraph.controls
      },
      thinkingIntrospection: {
        status: thinkingIntrospection.status,
        introspectionHash: thinkingIntrospection.introspectionHash,
        layers: thinkingIntrospection.totals.layers,
        pass: thinkingIntrospection.totals.pass,
        watch: thinkingIntrospection.totals.watch,
        block: thinkingIntrospection.totals.block,
        focus: thinkingIntrospection.focus,
        proofUrls: thinkingIntrospection.proofUrls,
        controls: thinkingIntrospection.controls
      }
    },
    enhancement,
    persistence,
    readiness
  };
}
