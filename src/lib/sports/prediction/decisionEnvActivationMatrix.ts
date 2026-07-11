import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionLaunchCommander } from "@/lib/sports/prediction/decisionLaunchCommander";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";

type EnvMap = Record<string, string | undefined>;

export type DecisionEnvActivationMatrixStatus = "ready" | "waiting" | "blocked";
export type DecisionEnvActivationMatrixRowStatus = "configured" | "missing" | "invalid" | "needs-proof" | "optional";
export type DecisionEnvActivationMatrixCategory = "supabase" | "mcp" | "admin" | "provider" | "openai" | "netlify";
export type DecisionEnvActivationMatrixDestination = "local" | "netlify" | "local-and-netlify" | "mcp-session";
export type DecisionEnvActivationMatrixExposure = "public" | "server-secret" | "server-config" | "mcp-proof";

export type DecisionEnvActivationMatrixRow = {
  id: string;
  category: DecisionEnvActivationMatrixCategory;
  label: string;
  keys: string[];
  destination: DecisionEnvActivationMatrixDestination;
  exposure: DecisionEnvActivationMatrixExposure;
  requiredFor: string[];
  status: DecisionEnvActivationMatrixRowStatus;
  configured: boolean;
  secret: boolean;
  proofUrl: string;
  nextAction: string;
  warnings: string[];
};

export type DecisionEnvActivationMatrix = {
  mode: "env-activation-matrix";
  generatedAt: string;
  status: DecisionEnvActivationMatrixStatus;
  matrixHash: string;
  summary: string;
  totals: {
    rows: number;
    configured: number;
    missing: number;
    invalid: number;
    needsProof: number;
    optional: number;
    localRows: number;
    netlifyRows: number;
    secretRows: number;
  };
  rows: DecisionEnvActivationMatrixRow[];
  nextRow: DecisionEnvActivationMatrixRow | null;
  controls: {
    canInspectReadOnly: true;
    canWriteSecrets: false;
    canPrintSecrets: false;
    canRunProviderDryRun: boolean;
    canRunOpenAIReview: boolean;
    canUseSupabaseWrites: false;
    canDeployProduction: false;
    canTrainModels: false;
    canPublishPicks: false;
  };
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function present(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function row(
  env: EnvMap,
  input: Omit<DecisionEnvActivationMatrixRow, "configured" | "secret"> & {
    secret?: boolean;
  }
): DecisionEnvActivationMatrixRow {
  const configured = present(env, input.keys);
  return {
    ...input,
    configured,
    secret: input.secret ?? input.exposure === "server-secret",
    warnings: unique(input.warnings)
  };
}

function totalsFor(rows: DecisionEnvActivationMatrixRow[]): DecisionEnvActivationMatrix["totals"] {
  return {
    rows: rows.length,
    configured: rows.filter((item) => item.status === "configured").length,
    missing: rows.filter((item) => item.status === "missing").length,
    invalid: rows.filter((item) => item.status === "invalid").length,
    needsProof: rows.filter((item) => item.status === "needs-proof").length,
    optional: rows.filter((item) => item.status === "optional").length,
    localRows: rows.filter((item) => item.destination === "local" || item.destination === "local-and-netlify").length,
    netlifyRows: rows.filter((item) => item.destination === "netlify" || item.destination === "local-and-netlify").length,
    secretRows: rows.filter((item) => item.secret).length
  };
}

function matrixStatus(rows: DecisionEnvActivationMatrixRow[]): DecisionEnvActivationMatrixStatus {
  if (rows.some((item) => item.status === "invalid")) return "blocked";
  if (rows.some((item) => item.status === "missing" || item.status === "needs-proof")) return "waiting";
  return "ready";
}

function summaryFor(status: DecisionEnvActivationMatrixStatus, nextRow: DecisionEnvActivationMatrixRow | null): string {
  if (status === "blocked") return `Environment activation is blocked by ${nextRow?.label ?? "an invalid key or target"}.`;
  if (status === "waiting") return `Environment activation is waiting on ${nextRow?.label ?? "missing configuration"}.`;
  return "Environment activation has all required key names present; proof routes still own write, train, and publish locks.";
}

function rowRank(status: DecisionEnvActivationMatrixRowStatus): number {
  if (status === "invalid") return 5;
  if (status === "missing") return 4;
  if (status === "needs-proof") return 3;
  if (status === "optional") return 2;
  return 1;
}

function sortRows(rows: DecisionEnvActivationMatrixRow[]): DecisionEnvActivationMatrixRow[] {
  return rows.slice().sort((a, b) => {
    const status = rowRank(b.status) - rowRank(a.status);
    if (status !== 0) return status;
    return a.id.localeCompare(b.id);
  });
}

export function buildDecisionEnvActivationMatrix({
  supabaseProofBinder,
  trainingCorpusProof,
  aiReviewReadiness,
  launchCommander,
  env = process.env,
  now = new Date()
}: {
  supabaseProofBinder: DecisionSupabaseProofBinder;
  trainingCorpusProof: TrainingCorpusProof;
  aiReviewReadiness: DecisionAIReviewReadiness;
  launchCommander: DecisionLaunchCommander;
  env?: EnvMap;
  now?: Date;
}): DecisionEnvActivationMatrix {
  const serviceKeyInvalid = supabaseProofBinder.observed.credentialStatus === "invalid";
  const mcpProofReady = supabaseProofBinder.observed.mcpProofRef === supabaseProofBinder.expected.projectRef;
  const schemaVerified = supabaseProofBinder.observed.verifiedTableCount === supabaseProofBinder.expected.tableCount;
  const rows = sortRows([
    row(env, {
      id: "supabase-project-ref",
      category: "supabase",
      label: "OddsPadi Supabase project ref",
      keys: ["SUPABASE_PROJECT_REF"],
      destination: "local-and-netlify",
      exposure: "server-config",
      requiredFor: ["project isolation", "server client", "Netlify production runtime"],
      status: supabaseProofBinder.observed.configuredRef === supabaseProofBinder.expected.projectRef ? "configured" : "missing",
      proofUrl: "/api/sports/decision/supabase-proof-binder",
      nextAction: `Set SUPABASE_PROJECT_REF to ${supabaseProofBinder.expected.projectRef} in local and Netlify env.`,
      warnings: []
    }),
    row(env, {
      id: "supabase-url",
      category: "supabase",
      label: "Supabase server URL",
      keys: ["SUPABASE_URL"],
      destination: "local-and-netlify",
      exposure: "server-config",
      requiredFor: ["server client", "schema proof", "provider storage"],
      status: supabaseProofBinder.observed.urlRef === supabaseProofBinder.expected.projectRef ? "configured" : "missing",
      proofUrl: "/api/sports/decision/status",
      nextAction: `Set SUPABASE_URL to ${supabaseProofBinder.expected.projectUrl}.`,
      warnings: []
    }),
    row(env, {
      id: "supabase-public-url",
      category: "supabase",
      label: "Supabase public URL",
      keys: ["NEXT_PUBLIC_SUPABASE_URL"],
      destination: "local-and-netlify",
      exposure: "public",
      requiredFor: ["future client reads", "public runtime config"],
      status: present(env, ["NEXT_PUBLIC_SUPABASE_URL"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/supabase-project-isolation",
      nextAction: `Set NEXT_PUBLIC_SUPABASE_URL to ${supabaseProofBinder.expected.projectUrl}.`,
      warnings: ["Public URL is safe to expose; do not pair it with service-role keys in client code."]
    }),
    row(env, {
      id: "supabase-publishable-key",
      category: "supabase",
      label: "Supabase publishable key",
      keys: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      destination: "local-and-netlify",
      exposure: "public",
      requiredFor: ["future client reads"],
      status: present(env, ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/supabase-project-isolation",
      nextAction: "Set the OddsPadi publishable key in local and Netlify env.",
      warnings: ["Publishable keys are client-visible; they do not grant server write permission."]
    }),
    row(env, {
      id: "supabase-service-key",
      category: "supabase",
      label: "Supabase service role key",
      keys: ["SUPABASE_SERVICE_ROLE_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["schema proof", "decision memory", "provider writes after approval", "training storage"],
      status: serviceKeyInvalid ? "invalid" : present(env, ["SUPABASE_SERVICE_ROLE_KEY"]) ? (schemaVerified ? "configured" : "needs-proof") : "missing",
      proofUrl: "/api/sports/decision/status",
      nextAction: serviceKeyInvalid ? "Replace the service-role/secret key with one from the OddsPadi Supabase project and restart." : "Set SUPABASE_SERVICE_ROLE_KEY server-side only.",
      warnings: ["Never expose this key through NEXT_PUBLIC env or frontend bundles."]
    }),
    row(env, {
      id: "supabase-mcp-proof",
      category: "mcp",
      label: "Supabase MCP project proof",
      keys: ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"],
      destination: "mcp-session",
      exposure: "mcp-proof",
      requiredFor: ["safe schema work", "migration approval", "project-scoped live inspection"],
      status: mcpProofReady ? "configured" : "needs-proof",
      proofUrl: "/api/sports/decision/supabase-proof-binder",
      nextAction: `Set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${supabaseProofBinder.expected.projectRef} only after MCP list_tables proves the OddsPadi op_ schema.`,
      warnings: ["Do not use AfroTools or LATMtools project refs for OddsPadi work."]
    }),
    row(env, {
      id: "admin-token",
      category: "admin",
      label: "OddsPadi admin token",
      keys: ["ODDSPADI_ADMIN_TOKEN"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["admin-gated dry-runs", "future approved writes", "outcome settlement"],
      status: present(env, ["ODDSPADI_ADMIN_TOKEN"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/launch-commander",
      nextAction: "Set ODDSPADI_ADMIN_TOKEN locally and in Netlify env; pass it only as x-oddspadi-admin-token for admin routes.",
      warnings: ["Do not put this token in public URLs or client env."]
    }),
    row(env, {
      id: "football-provider",
      category: "provider",
      label: "Football data provider key",
      keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["fixtures", "historical results", "standings", "events", "lineups", "football corpus dry-runs"],
      status: present(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/training/corpus-proof",
      nextAction: "Set API_FOOTBALL_KEY or APISPORTS_KEY before football provider dry-runs.",
      warnings: []
    }),
    row(env, {
      id: "basketball-provider",
      category: "provider",
      label: "Basketball data provider key",
      keys: ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["basketball games", "pace/efficiency context", "basketball corpus dry-runs"],
      status: present(env, ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/training/corpus-proof?sport=basketball",
      nextAction: "Set API_BASKETBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY before basketball dry-runs.",
      warnings: []
    }),
    row(env, {
      id: "tennis-provider",
      category: "provider",
      label: "Tennis data provider key",
      keys: ["API_TENNIS_KEY", "SPORTS_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["tennis matches", "surface/player context", "tennis corpus dry-runs"],
      status: present(env, ["API_TENNIS_KEY", "SPORTS_API_KEY"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/training/corpus-proof?sport=tennis",
      nextAction: "Set API_TENNIS_KEY or SPORTS_API_KEY before tennis dry-runs.",
      warnings: []
    }),
    row(env, {
      id: "odds-provider",
      category: "provider",
      label: "Odds provider key",
      keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["bookmaker odds", "no-vig probability", "value edge", "CLV/backtests"],
      status: present(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/data-gap-resolver",
      nextAction: "Set THE_ODDS_API_KEY or ODDS_API_KEY before odds dry-runs.",
      warnings: []
    }),
    row(env, {
      id: "news-provider",
      category: "provider",
      label: "News provider key",
      keys: ["NEWS_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["injury/news context", "AI review evidence", "tennis player news"],
      status: present(env, ["NEWS_API_KEY"]) ? "configured" : "optional",
      proofUrl: "/api/sports/decision/data-gap-resolver",
      nextAction: "Set NEWS_API_KEY before relying on news/injury signals.",
      warnings: ["Optional for deterministic math, but important before trusting injury/news adjustments."]
    }),
    row(env, {
      id: "weather-provider",
      category: "provider",
      label: "Weather provider key",
      keys: ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["football weather context"],
      status: present(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]) ? "configured" : "optional",
      proofUrl: "/api/sports/decision/data-gap-resolver",
      nextAction: "Set WEATHER_API_KEY or OPENWEATHER_API_KEY before weather-adjusted football decisions.",
      warnings: ["Weather is relevant only where fixtures and venues make it meaningful."]
    }),
    row(env, {
      id: "openai-key",
      category: "openai",
      label: "OpenAI API key",
      keys: ["OPENAI_API_KEY"],
      destination: "local-and-netlify",
      exposure: "server-secret",
      requiredFor: ["guarded AI review", "executive critique", "same-or-safer model audit"],
      status: aiReviewReadiness.openAiConfigured ? "configured" : "missing",
      proofUrl: "/api/sports/decision/ai-review-readiness",
      nextAction: "Create or reuse OPENAI_API_KEY through the secure OpenAI Platform flow before live AI review.",
      warnings: ["Do not paste or print this key in logs or source files."]
    }),
    row(env, {
      id: "openai-model",
      category: "openai",
      label: "OpenAI decision model",
      keys: ["OPENAI_DECISION_MODEL"],
      destination: "local-and-netlify",
      exposure: "server-config",
      requiredFor: ["stable AI review model selection"],
      status: present(env, ["OPENAI_DECISION_MODEL"]) ? "configured" : "optional",
      proofUrl: "/api/sports/decision/ai-review-readiness",
      nextAction: "Set OPENAI_DECISION_MODEL when you want to override the default reviewer model.",
      warnings: []
    }),
    row(env, {
      id: "site-url",
      category: "netlify",
      label: "Production site URL",
      keys: ["NEXT_PUBLIC_SITE_URL"],
      destination: "local-and-netlify",
      exposure: "public",
      requiredFor: ["Netlify route smoke", "absolute API links", "production proof"],
      status: present(env, ["NEXT_PUBLIC_SITE_URL"]) ? "configured" : "missing",
      proofUrl: "/api/sports/decision/netlify-readiness",
      nextAction: "Set NEXT_PUBLIC_SITE_URL to the production Netlify URL before production smokes.",
      warnings: ["Public URL is safe to expose."]
    })
  ]);
  const totals = totalsFor(rows);
  const status = matrixStatus(rows);
  const nextRow = rows.find((item) => item.status === "invalid" || item.status === "missing" || item.status === "needs-proof") ?? null;
  const matrixHash = stableHash({
    status,
    rows: rows.map((item) => [item.id, item.status, item.configured, item.destination, item.exposure]),
    commander: launchCommander.status,
    corpus: trainingCorpusProof.status,
    ai: aiReviewReadiness.status,
    supabase: supabaseProofBinder.status
  });

  return {
    mode: "env-activation-matrix",
    generatedAt: now.toISOString(),
    status,
    matrixHash,
    summary: summaryFor(status, nextRow),
    totals,
    rows,
    nextRow,
    controls: {
      canInspectReadOnly: true,
      canWriteSecrets: false,
      canPrintSecrets: false,
      canRunProviderDryRun: launchCommander.controls.canRunProviderDryRun,
      canRunOpenAIReview: aiReviewReadiness.controls.canRunLiveReview,
      canUseSupabaseWrites: false,
      canDeployProduction: false,
      canTrainModels: false,
      canPublishPicks: false
    },
    proofUrls: unique([
      "/api/sports/decision/env-activation-matrix",
      "/api/sports/decision/launch-commander",
      ...launchCommander.proofUrls,
      ...supabaseProofBinder.proofUrls,
      ...trainingCorpusProof.proofUrls,
      ...aiReviewReadiness.proofUrls
    ]),
    locks: [
      "This matrix can inspect key presence only; it cannot create, print, or write secrets.",
      "Server secrets must stay out of NEXT_PUBLIC env and frontend bundles.",
      "Netlify env values must be set in Netlify environment variables, not netlify.toml.",
      "Provider writes, Supabase writes, model training, public picks, and public-action upgrades stay locked until proof routes pass."
    ]
  };
}
