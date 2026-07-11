import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";

type EnvMap = Record<string, string | undefined>;

export type DecisionNetlifyDeploymentStatus = "ready-smoke" | "needs-env" | "needs-site-url" | "needs-config" | "blocked";
export type DecisionNetlifyDeploymentCheckStatus = "pass" | "watch" | "block";
export type DecisionNetlifyDeploymentCommandKind = "local-build" | "netlify-cli" | "production-smoke";

export type DecisionNetlifyDeploymentCheck = {
  id: string;
  status: DecisionNetlifyDeploymentCheckStatus;
  label: string;
  detail: string;
  nextAction: string;
};

export type DecisionNetlifyDeploymentCommand = {
  id: string;
  kind: DecisionNetlifyDeploymentCommandKind;
  label: string;
  command: string;
  safeToRun: boolean;
  expectedEvidence: string;
  missingEnv: string[];
};

export type DecisionNetlifyDeployment = {
  generatedAt: string;
  status: DecisionNetlifyDeploymentStatus;
  mode: "netlify-deployment-readiness";
  deploymentHash: string;
  summary: string;
  config: {
    filePresent: boolean;
    buildCommand: string | null;
    publishDirectory: string | null;
    nodeVersion: string | null;
    nextRuntimeExpected: boolean;
    headersConfigured: boolean;
  };
  site: {
    productionUrl: string | null;
    urlSource: "NEXT_PUBLIC_SITE_URL" | "URL" | "DEPLOY_URL" | null;
    expectedDomain: "https://oddspadi.com";
  };
  env: {
    requiredForProduction: string[];
    requiredForAIReview: string[];
    requiredForProviderBackfill: string[];
    configured: string[];
    missingProduction: string[];
    missingAIReview: string[];
    missingProviderBackfill: string[];
  };
  checks: DecisionNetlifyDeploymentCheck[];
  commands: DecisionNetlifyDeploymentCommand[];
  nextCommand: DecisionNetlifyDeploymentCommand | null;
  routeSmokePlan: {
    localRoutes: string[];
    productionRoutes: string[];
  };
  safety: {
    canDeploy: boolean;
    canDeployPreview: boolean;
    canDeployProduction: boolean;
    canSmokeProduction: boolean;
    canEnableScheduledBackfill: false;
    canPublishPicks: false;
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

function readNetlifyToml(workspaceRoot: string): string | null {
  try {
    return readFileSync(join(workspaceRoot, "netlify.toml"), "utf8");
  } catch {
    return null;
  }
}

function extractTomlString(text: string | null, key: string): string | null {
  if (!text) return null;
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? null;
}

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function firstSiteUrl(env: EnvMap): { value: string | null; source: DecisionNetlifyDeployment["site"]["urlSource"] } {
  if (env.NEXT_PUBLIC_SITE_URL?.trim()) return { value: env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, ""), source: "NEXT_PUBLIC_SITE_URL" };
  if (env.URL?.trim()) return { value: env.URL.trim().replace(/\/$/, ""), source: "URL" };
  if (env.DEPLOY_URL?.trim()) return { value: env.DEPLOY_URL.trim().replace(/\/$/, ""), source: "DEPLOY_URL" };
  return { value: null, source: null };
}

function missingAll(env: EnvMap, keys: string[]): string[] {
  return keys.filter((key) => !boolEnv(env, key));
}

function missingAny(env: EnvMap, keys: string[], label: string): string[] {
  return keys.some((key) => boolEnv(env, key)) ? [] : [label];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function check(input: DecisionNetlifyDeploymentCheck): DecisionNetlifyDeploymentCheck {
  return input;
}

function command(input: DecisionNetlifyDeploymentCommand): DecisionNetlifyDeploymentCommand {
  const lower = input.command.toLowerCase();
  const unsafe = lower.includes("deploy --prod") || lower.includes("dryrun=0") || lower.includes("persist=1");
  return {
    ...input,
    safeToRun: input.safeToRun && !unsafe
  };
}

function statusFor({
  configOk,
  productionMissing,
  hasSiteUrl,
  runtimeBlocked,
  bootstrapBlocked
}: {
  configOk: boolean;
  productionMissing: number;
  hasSiteUrl: boolean;
  runtimeBlocked: boolean;
  bootstrapBlocked: boolean;
}): DecisionNetlifyDeploymentStatus {
  if (!configOk) return "needs-config";
  if (bootstrapBlocked) return "blocked";
  if (productionMissing > 0) return "needs-env";
  if (!hasSiteUrl) return "needs-site-url";
  if (runtimeBlocked) return "needs-env";
  return "ready-smoke";
}

function summaryFor(status: DecisionNetlifyDeploymentStatus): string {
  if (status === "ready-smoke") return "Netlify deployment readiness can run local build and production route smokes.";
  if (status === "needs-site-url") return "Netlify build config is present, but production URL proof is missing.";
  if (status === "needs-env") return "Netlify readiness is waiting for production environment variables and runtime proof.";
  if (status === "needs-config") return "Netlify readiness is missing or rejecting required build configuration.";
  return "Netlify readiness is blocked by project bootstrap or deployment safety gates.";
}

export function buildDecisionNetlifyDeployment({
  readiness,
  runtime = null,
  supabaseBootstrap = null,
  env = process.env,
  workspaceRoot = process.cwd()
}: {
  readiness: DecisionEngineReadiness;
  runtime?: DecisionAgentRuntime | null;
  supabaseBootstrap?: DecisionSupabaseBootstrap | null;
  env?: EnvMap;
  workspaceRoot?: string;
}): DecisionNetlifyDeployment {
  const text = readNetlifyToml(workspaceRoot);
  const filePresent = Boolean(text) || existsSync(join(workspaceRoot, "netlify.toml"));
  const buildCommand = extractTomlString(text, "command");
  const publishDirectory = extractTomlString(text, "publish");
  const nodeVersion = extractTomlString(text, "NODE_VERSION");
  const headersConfigured = Boolean(text?.includes("[[headers]]"));
  const autonomousSchedulerPresent =
    existsSync(join(workspaceRoot, "netlify", "functions", "decision-cycle-sweep.ts")) &&
    existsSync(join(workspaceRoot, "netlify", "functions", "decision-cycle-worker-background.ts")) &&
    existsSync(join(workspaceRoot, "netlify", "functions", "football-settlement-sweep.ts")) &&
    existsSync(join(workspaceRoot, "netlify", "functions", "football-settlement-worker-background.ts"));
  const configOk = filePresent && buildCommand === "npm run build" && publishDirectory === ".next" && Boolean(nodeVersion);
  const siteUrl = firstSiteUrl(env);
  const productionRequired = [
    "NEXT_PUBLIC_SITE_URL",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ODDSPADI_ADMIN_TOKEN"
  ];
  const aiRequired = ["OPENAI_API_KEY"];
  const providerBackfillRequired = ["ODDSPADI_ADMIN_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"];
  const missingProduction = unique([
    ...missingAll(env, productionRequired),
    ...missingAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"], "API_FOOTBALL_KEY or APISPORTS_KEY"),
    ...missingAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"], "THE_ODDS_API_KEY or ODDS_API_KEY")
  ]);
  const missingAIReview = missingAll(env, aiRequired);
  const missingProviderBackfill = unique([
    ...missingAll(env, providerBackfillRequired),
    ...missingAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"], "API_FOOTBALL_KEY or APISPORTS_KEY"),
    ...missingAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"], "THE_ODDS_API_KEY or ODDS_API_KEY")
  ]);
  const configured = productionRequired.filter((key) => boolEnv(env, key));
  const runtimeBlocked = runtime ? runtime.status === "blocked" || runtime.locks.some((item) => item.id === "supabase-writes" && item.locked) : true;
  const bootstrapBlocked = supabaseBootstrap ? supabaseBootstrap.status === "blocked-wrong-target" : !readiness.supabase.preflight.targetMatchesExpected;
  const status = statusFor({
    configOk,
    productionMissing: missingProduction.length,
    hasSiteUrl: Boolean(siteUrl.value),
    runtimeBlocked,
    bootstrapBlocked
  });
  const localRoutes = [
    "/api/sports/decision/status",
    "/api/sports/decision/activation-runbook",
    "/api/sports/decision/mvp-audit",
    "/api/sports/decision/supabase-bootstrap",
    "/api/sports/decision/agent-runtime",
    "/api/sports/decision/autonomous-cycle",
    "/api/sports/decision/autonomous-settlement",
    "/api/sports/decision/training/corpus-plan",
    "/predictions/decision-engine"
  ];
  const productionRoutes = siteUrl.value ? localRoutes.map((route) => `${siteUrl.value}${route}`) : [];
  const canDeployPreview = configOk;
  const canDeployProduction =
    configOk &&
    missingProduction.length === 0 &&
    Boolean(siteUrl.value) &&
    Boolean(runtime && (runtime.status === "live-ready" || runtime.status === "ready-readonly")) &&
    Boolean(supabaseBootstrap && supabaseBootstrap.status === "ready-dry-run");
  const checks = [
    check({
      id: "netlify-toml",
      status: configOk ? "pass" : "block",
      label: "Netlify build config",
      detail: filePresent ? `Build command ${buildCommand ?? "missing"}, publish ${publishDirectory ?? "missing"}, Node ${nodeVersion ?? "missing"}.` : "netlify.toml is missing.",
      nextAction: configOk ? "Keep secrets out of netlify.toml and use Netlify env variables." : "Add netlify.toml with npm run build, .next publish, and NODE_VERSION."
    }),
    check({
      id: "next-runtime",
      status: buildCommand && publishDirectory === ".next" ? "pass" : "block",
      label: "Next.js runtime",
      detail: "Netlify detects Next.js and maps App Router/API routes through the Next runtime.",
      nextAction: "Run npm run build locally before deploy and smoke API routes after deploy."
    }),
    check({
      id: "production-env",
      status: missingProduction.length ? "block" : "pass",
      label: "Production environment",
      detail: missingProduction.length ? `Missing ${missingProduction.join(", ")}.` : "Production env has the minimum keys for provider, Supabase, admin, and public URL readiness.",
      nextAction: missingProduction.length ? "Set missing values in Netlify environment variables, not netlify.toml." : "Smoke production status and runtime routes."
    }),
    check({
      id: "site-url",
      status: siteUrl.value ? "pass" : "block",
      label: "Production URL",
      detail: siteUrl.value ? `Production URL comes from ${siteUrl.source}.` : "No production URL is configured in this runtime.",
      nextAction: siteUrl.value ? "Use this URL for deployed route smokes." : "Set NEXT_PUBLIC_SITE_URL to https://oddspadi.com after Netlify site is linked."
    }),
    check({
      id: "supabase-bootstrap",
      status: supabaseBootstrap?.status === "ready-dry-run" ? "pass" : supabaseBootstrap?.status?.startsWith("blocked") ? "block" : "watch",
      label: "Supabase activation",
      detail: supabaseBootstrap?.summary ?? readiness.supabase.detail,
      nextAction: "Clear Supabase bootstrap before enabling write-mode training or production persistence."
    }),
    check({
      id: "agent-runtime",
      status: runtime?.status === "live-ready" || runtime?.status === "ready-readonly" ? "pass" : runtime?.status === "blocked" ? "block" : "watch",
      label: "Agent runtime proof",
      detail: runtime?.summary ?? "Agent runtime was not attached to the deployment readiness check.",
      nextAction: "Run read-only proof routes before enabling production automation."
    }),
    check({
      id: "autonomous-scheduler",
      status: autonomousSchedulerPresent ? "pass" : "block",
      label: "Bounded autonomous scheduler",
      detail: autonomousSchedulerPresent
        ? "The scheduled sweep and background worker are present; authenticated execution remains bounded and idempotent."
        : "The autonomous decision sweep or background worker is missing.",
      nextAction: autonomousSchedulerPresent
        ? "Keep fixture and AI limits low, then inspect the first production cycle receipt."
        : "Add both Netlify decision-cycle functions before enabling production automation."
    })
  ];
  const commands = [
    command({
      id: "local-build",
      kind: "local-build",
      label: "Run local production build",
      command: "npm run build",
      safeToRun: true,
      expectedEvidence: "Next build succeeds and lists dynamic decision API routes.",
      missingEnv: []
    }),
    command({
      id: "netlify-status",
      kind: "netlify-cli",
      label: "Check Netlify CLI link",
      command: "npx netlify status",
      safeToRun: true,
      expectedEvidence: "Netlify CLI reports the authenticated account and linked site before any deploy command.",
      missingEnv: []
    }),
    command({
      id: "netlify-env-list",
      kind: "netlify-cli",
      label: "List Netlify env keys",
      command: "npx netlify env:list",
      safeToRun: true,
      expectedEvidence: "Netlify env list contains required key names without exposing secret values.",
      missingEnv: []
    }),
    command({
      id: "netlify-deploy-preview-dry-run",
      kind: "netlify-cli",
      label: "Create a deploy preview draft",
      command: "npx netlify deploy --build",
      safeToRun: canDeployPreview,
      expectedEvidence: "Netlify creates a non-production deploy draft/preview URL after the local production build succeeds.",
      missingEnv: configOk ? [] : ["valid netlify.toml"]
    }),
    command({
      id: "production-status-smoke",
      kind: "production-smoke",
      label: "Smoke production status route",
      command: siteUrl.value ? `curl.exe -sS "${siteUrl.value}/api/sports/decision/status"` : "curl.exe -sS \"<NETLIFY_URL>/api/sports/decision/status\"",
      safeToRun: Boolean(siteUrl.value),
      expectedEvidence: "Production status reports OddsPadi project target, provider readiness, OpenAI readiness, and schema state.",
      missingEnv: siteUrl.value ? [] : ["NEXT_PUBLIC_SITE_URL"]
    }),
    command({
      id: "production-runtime-smoke",
      kind: "production-smoke",
      label: "Smoke production agent runtime",
      command: siteUrl.value ? `curl.exe -sS "${siteUrl.value}/api/sports/decision/agent-runtime"` : "curl.exe -sS \"<NETLIFY_URL>/api/sports/decision/agent-runtime\"",
      safeToRun: Boolean(siteUrl.value),
      expectedEvidence: "Production agent runtime returns phases, commands, locks, and no-persist/no-publish/no-train permissions.",
      missingEnv: siteUrl.value ? [] : ["NEXT_PUBLIC_SITE_URL"]
    })
  ];
  const nextCommand = commands.find((item) => item.safeToRun && !item.missingEnv.length) ?? commands[0] ?? null;
  const deploymentHash = stableHash({
    status,
    filePresent,
    buildCommand,
    publishDirectory,
    nodeVersion,
    siteUrl,
    missingProduction,
    missingAIReview,
    missingProviderBackfill,
    autonomousSchedulerPresent,
    runtime: runtime?.status,
    bootstrap: supabaseBootstrap?.status
  });

  return {
    generatedAt: new Date().toISOString(),
    status,
    mode: "netlify-deployment-readiness",
    deploymentHash,
    summary: summaryFor(status),
    config: {
      filePresent,
      buildCommand,
      publishDirectory,
      nodeVersion,
      nextRuntimeExpected: true,
      headersConfigured
    },
    site: {
      productionUrl: siteUrl.value,
      urlSource: siteUrl.source,
      expectedDomain: "https://oddspadi.com"
    },
    env: {
      requiredForProduction: productionRequired,
      requiredForAIReview: aiRequired,
      requiredForProviderBackfill: providerBackfillRequired,
      configured,
      missingProduction,
      missingAIReview,
      missingProviderBackfill
    },
    checks,
    commands,
    nextCommand,
    routeSmokePlan: {
      localRoutes,
      productionRoutes
    },
    safety: {
      canDeploy: canDeployPreview,
      canDeployPreview,
      canDeployProduction,
      canSmokeProduction: Boolean(siteUrl.value),
      canEnableScheduledBackfill: false,
      canPublishPicks: false,
      forbiddenActions: [
        "Do not commit provider, OpenAI, Supabase service-role, or admin-token secrets to netlify.toml.",
        canDeployProduction
          ? "Production deploy is still operator-controlled; run production smoke routes immediately after deploy."
          : "Do not run netlify deploy --prod until local build, production env-list, site URL, Supabase bootstrap, and runtime proof are clean.",
        "Do not enable scheduled provider backfills until Supabase bootstrap and dry-run counts are reviewed.",
        "Do not publish picks from production until agent runtime, authority, and activation gates are ready.",
        "Do not use production smoke success as proof that write-mode training is enabled."
      ]
    }
  };
}
