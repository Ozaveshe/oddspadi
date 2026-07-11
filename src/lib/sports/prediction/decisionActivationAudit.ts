import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { DecisionEngineReadiness, ReadinessStatus } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionActivationStatus = "ready" | "partial" | "blocked";
export type DecisionActivationGateStatus = "pass" | "watch" | "block";
export type DecisionActivationGateCategory = "project" | "database" | "providers" | "ai" | "learning" | "automation" | "deployment";
export type DecisionActivationGatePriority = "critical" | "high" | "medium" | "low";

export type DecisionActivationGate = {
  id: string;
  category: DecisionActivationGateCategory;
  priority: DecisionActivationGatePriority;
  status: DecisionActivationGateStatus;
  score: number;
  label: string;
  detail: string;
  requiredEvidence: string;
  nextAction: string;
  command: string | null;
  verifyUrl: string;
  missingEnv: string[];
  unlocks: string[];
};

export type DecisionActivationAudit = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionActivationStatus;
  score: number;
  summary: string;
  gates: DecisionActivationGate[];
  nextGate: DecisionActivationGate | null;
  passCount: number;
  watchCount: number;
  blockCount: number;
  missingEnv: string[];
  capabilities: {
    deterministicCore: boolean;
    liveProviderRuntime: boolean;
    supabaseMemory: boolean;
    historicalTraining: boolean;
    oddsIntelligence: boolean;
    openAiCritique: boolean;
    safeAutopilotRun: boolean;
    publishableSlate: boolean;
    persistableBrainTrace: boolean;
  };
  evidenceContract: {
    expectedSupabaseProjectRef: string;
    expectedSupabaseTables: string[];
    requiredBeforeWriteMode: string[];
    forbiddenUntilVerified: string[];
  };
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function gateStatusFromReadiness(status: ReadinessStatus): DecisionActivationGateStatus {
  if (status === "ready") return "pass";
  if (status === "blocked") return "block";
  return "watch";
}

function scoreFromGate(status: DecisionActivationGateStatus, score?: number): number {
  if (typeof score === "number") return clampScore(score);
  if (status === "pass") return 100;
  if (status === "watch") return 50;
  return 0;
}

function envConfigured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function gate(input: Omit<DecisionActivationGate, "score"> & { score?: number }): DecisionActivationGate {
  return { ...input, score: scoreFromGate(input.status, input.score) };
}

function gateRank(gateItem: DecisionActivationGate): number {
  const statusRank = { block: 3, watch: 2, pass: 1 }[gateItem.status];
  const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[gateItem.priority];
  return statusRank * 10 + priorityRank;
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function makeGateCommand(path: string): string {
  return decisionCurlCommand(path);
}

function providerGate(readiness: DecisionEngineReadiness, dataIntake: DecisionDataIntakeQueue): DecisionActivationGate {
  const status: DecisionActivationGateStatus = readiness.dataProviders.liveRuntimeBacked
    ? "pass"
    : readiness.dataProviders.configuredGroups > 0
      ? "watch"
      : "block";
  return gate({
    id: "live-provider-runtime",
    category: "providers",
    priority: "critical",
    status,
    score: readiness.dataProviders.liveRuntimeSignalCoverage,
    label: "Live sports provider runtime",
    detail: readiness.dataProviders.detail,
    requiredEvidence: "Fixtures, form, live scores, events, injuries, lineups, news, weather, and odds must expose provider metadata instead of mock data.",
    nextAction: readiness.dataProviders.nextProviderActions[0] ?? "Configure live provider keys and rerun provider readiness.",
    command: makeGateCommand(`/api/sports/decision/data-intake?date=${encodeURIComponent(dataIntake.date)}&sport=${encodeURIComponent(dataIntake.sport)}`),
    verifyUrl: "/api/sports/decision/data-intake",
    missingEnv: unique(readiness.dataProviders.groups.flatMap((group) => group.missingEnvKeys)),
    unlocks: ["real fixtures", "live data quality", "context adjustments", "provider-backed model features"]
  });
}

function oddsGate(readiness: DecisionEngineReadiness, dataIntake: DecisionDataIntakeQueue): DecisionActivationGate {
  const oddsItem = dataIntake.items.find((item) => item.category === "odds");
  const oddsReady = readiness.dataProviders.oddsApiConfigured && readiness.dataProviders.sportsApiConfigured;
  return gate({
    id: "odds-intelligence-runtime",
    category: "providers",
    priority: "critical",
    status: oddsReady ? "pass" : readiness.dataProviders.oddsApiConfigured ? "watch" : "block",
    score: oddsReady ? 100 : readiness.dataProviders.oddsApiConfigured ? 55 : 0,
    label: "Bookmaker odds intelligence",
    detail:
      oddsItem?.decisionImpact ??
      "Live odds are required before the value engine can compare no-vig market probability, model probability, EV, and closing-line value.",
    requiredEvidence: "Provider-backed odds snapshots include bookmaker, market, selection, decimal price, observed timestamp, and no-vig margin removal.",
    nextAction: oddsItem?.missingEnv.length ? `Set ${oddsItem.missingEnv.join(", ")}.` : oddsItem?.expectedEvidence ?? "Run odds provider dry-run.",
    command: oddsItem && commandIsSafe(oddsItem.command) ? oddsItem.command : makeGateCommand("/api/sports/decision/data-intake"),
    verifyUrl: oddsItem?.verifyUrl ?? "/api/sports/decision/data-intake",
    missingEnv: oddsItem?.missingEnv ?? ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    unlocks: ["no-vig probability", "value edge", "expected value", "closing-line value"]
  });
}

export function buildDecisionActivationAudit({
  date,
  sport,
  readiness,
  dataIntake,
  governance,
  autopilot,
  traceLedger,
  env = process.env
}: {
  date: string;
  sport: Sport;
  readiness: DecisionEngineReadiness;
  dataIntake: DecisionDataIntakeQueue;
  governance: DecisionModelGovernance;
  autopilot: DecisionAutopilot;
  traceLedger: DecisionTraceLedger;
  env?: EnvMap;
}): DecisionActivationAudit {
  const schemaReady = readiness.supabase.schema.status === "ready";
  const mcpProjectRef = env.ODDSPADI_SUPABASE_MCP_PROJECT_REF?.trim() || null;
  const mcpProjectScoped = mcpProjectRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const netlifyConfigured = envConfigured(env, "NEXT_PUBLIC_SITE_URL") || envConfigured(env, "URL") || envConfigured(env, "DEPLOY_URL");
  const safeAutopilotActions = autopilot.actions.filter((action) => action.safeToRun && commandIsSafe(action.command)).length;

  const gates: DecisionActivationGate[] = [
    gate({
      id: "supabase-project-target",
      category: "project",
      priority: "critical",
      status: readiness.supabase.preflight.targetMatchesExpected ? "pass" : "block",
      label: "OddsPadi Supabase project target",
      detail: readiness.supabase.preflight.checks.find((check) => check.id === "project-ref")?.detail ?? readiness.supabase.preflight.summary,
      requiredEvidence: `SUPABASE_PROJECT_REF, SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_URL all point at ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      nextAction: readiness.supabase.preflight.targetMatchesExpected
        ? "Keep using the OddsPadi project ref for local, Netlify, and provider-sync environments."
        : `Set the Supabase env values to ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      command: makeGateCommand("/api/sports/decision/status"),
      verifyUrl: "/api/sports/decision/status",
      missingEnv: readiness.supabase.missingEnv,
      unlocks: ["project isolation", "safe schema verification"]
    }),
    gate({
      id: "mcp-project-isolation",
      category: "project",
      priority: "critical",
      status: schemaReady || mcpProjectScoped ? "pass" : "block",
      score: schemaReady ? 100 : mcpProjectScoped ? 75 : 0,
      label: "Supabase MCP project isolation",
      detail:
        schemaReady || mcpProjectScoped
          ? `Live schema tooling is scoped to the OddsPadi project ${ODDSPADI_SUPABASE_PROJECT_REF}.`
          : "Repo-local MCP project proof is missing. Do not run live schema mutations through a global Supabase MCP connection until it is scoped to OddsPadi.",
      requiredEvidence:
        "A repo-local/project-scoped Supabase MCP session lists the OddsPadi op_ tables or ODDSPADI_SUPABASE_MCP_PROJECT_REF matches the OddsPadi project.",
      nextAction: `Authenticate or configure an OddsPadi-specific Supabase MCP target before applying migrations; expected project ref ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      command: makeGateCommand("/api/sports/decision/status"),
      verifyUrl: "/api/sports/decision/status",
      missingEnv: mcpProjectScoped ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"],
      unlocks: ["safe live schema inspection", "safe migration review", "wrong-project protection"]
    }),
    gate({
      id: "supabase-schema",
      category: "database",
      priority: "critical",
      status: gateStatusFromReadiness(readiness.supabase.schema.status),
      score: Math.round((readiness.supabase.schema.verifiedTableCount / Math.max(1, readiness.supabase.schema.expectedTableCount)) * 100),
      label: "Decision memory schema",
      detail: readiness.supabase.schema.detail,
      requiredEvidence: `All ${readiness.supabase.schema.expectedTableCount} op_ tables verify in the OddsPadi project.`,
      nextAction:
        readiness.supabase.schema.status === "ready"
          ? "Run a dry-run persist self-test before allowing write mode."
          : "Apply the local Supabase migrations to the OddsPadi project after MCP target proof is clean.",
      command: makeGateCommand("/api/sports/decision/status"),
      verifyUrl: "/api/sports/decision/status",
      missingEnv: readiness.supabase.preflight.missingEnv,
      unlocks: ["decision memory", "outcome tracking", "calibration", "historical training"]
    }),
    gate({
      id: "decision-memory-writes",
      category: "database",
      priority: "critical",
      status: readiness.supabase.configured && schemaReady ? "pass" : "block",
      score: readiness.supabase.configured && schemaReady ? 100 : readiness.supabase.preflight.serverClientConfigured ? 35 : 0,
      label: "Decision memory write mode",
      detail: readiness.supabase.detail,
      requiredEvidence: "A self-test can persist to op_decision_runs with model_snapshot.brain and then read it back for memory calibration.",
      nextAction: readiness.supabase.preflight.serverClientConfigured
        ? "Refresh the service-role key and verify op_decision_runs access."
        : "Set SUPABASE_SERVICE_ROLE_KEY for the OddsPadi project in local and Netlify server env.",
      command: makeGateCommand("/api/sports/decision/self-test?matchId=epl-001&persist=1"),
      verifyUrl: "/api/sports/decision/self-test?matchId=epl-001&persist=1",
      missingEnv: readiness.supabase.preflight.serverClientConfigured ? [] : ["SUPABASE_SERVICE_ROLE_KEY"],
      unlocks: ["case memory", "brain replay", "settlement learning", "calibration curves"]
    }),
    providerGate(readiness, dataIntake),
    oddsGate(readiness, dataIntake),
    gate({
      id: "historical-training-corpus",
      category: "learning",
      priority: "critical",
      status: governance.status === "approved" ? "pass" : "block",
      score: governance.trustScore,
      label: "Historical training and governance",
      detail: governance.summary,
      requiredEvidence: "Enough real fixtures, odds snapshots, feature snapshots, target labels, completed backtests, and drift checks pass governance.",
      nextAction: governance.nextActions[0] ?? "Backfill the 10-year corpus and rerun model governance.",
      command: makeGateCommand("/api/sports/decision/model-governance"),
      verifyUrl: "/api/sports/decision/model-governance",
      missingEnv: governance.trainingCorpus.configured ? [] : ["SUPABASE_SERVICE_ROLE_KEY"],
      unlocks: ["learned guardrails", "threshold tuning", "feature drift checks", "backtest-informed weights"]
    }),
    gate({
      id: "openai-review",
      category: "ai",
      priority: "high",
      status: readiness.openAi.configured ? "pass" : "block",
      label: "Guarded OpenAI critique",
      detail: readiness.openAi.detail,
      requiredEvidence: "OPENAI_API_KEY is configured and AI critique routes return cited reviews without upgrading deterministic decisions.",
      nextAction: readiness.openAi.configured ? "Run council and research reviews with review=1." : "Set OPENAI_API_KEY and keep OPENAI_DECISION_MODEL pinned.",
      command: makeGateCommand("/api/sports/decision/research-agent?review=1"),
      verifyUrl: "/api/sports/decision/research-agent?review=1",
      missingEnv: readiness.openAi.configured ? [] : ["OPENAI_API_KEY"],
      unlocks: ["adversarial review", "unsupported-claim detection", "operator-ready analysis notes"]
    }),
    gate({
      id: "brain-trace-persistence-payload",
      category: "automation",
      priority: "high",
      status: traceLedger.persistence.payloadReady && traceLedger.persistence.includesBrainTrace ? "pass" : "block",
      label: "Brain trace persistence payload",
      detail: traceLedger.summary,
      requiredEvidence: "Trace ledger exposes a stable input hash and op_decision_runs payload includes model_snapshot.brain.",
      nextAction: traceLedger.nextReplayStep?.expectedEvidence ?? "Rebuild trace ledger until payload hash and brain trace are present.",
      command: traceLedger.nextReplayStep?.command ?? makeGateCommand("/api/sports/decision/trace-ledger"),
      verifyUrl: traceLedger.nextReplayStep?.verifyUrl ?? "/api/sports/decision/trace-ledger",
      missingEnv: traceLedger.missingEnv,
      unlocks: ["audit replay", "decision memory", "post-match learning"]
    }),
    gate({
      id: "autopilot-safe-actions",
      category: "automation",
      priority: "high",
      status: autopilot.canRunNow ? "pass" : safeAutopilotActions > 0 ? "watch" : "block",
      score: autopilot.canRunNow ? 100 : safeAutopilotActions > 0 ? 55 : 0,
      label: "Safe autopilot action loop",
      detail: autopilot.summary,
      requiredEvidence: "Autopilot next action is read-only or dryRun=1, has no missing env, and has a verification URL.",
      nextAction: autopilot.nextAction?.rationale ?? "Clear blocked actions before allowing autopilot to run.",
      command: autopilot.nextAction?.command ?? makeGateCommand("/api/sports/decision/autopilot"),
      verifyUrl: autopilot.nextAction?.verifyUrl ?? "/api/sports/decision/autopilot",
      missingEnv: unique(autopilot.actions.flatMap((action) => action.missingEnv)),
      unlocks: ["bounded self-run", "repair loops", "verification loops"]
    }),
    gate({
      id: "netlify-runtime-env",
      category: "deployment",
      priority: "medium",
      status: netlifyConfigured ? "watch" : "block",
      score: netlifyConfigured ? 60 : 0,
      label: "Netlify runtime environment",
      detail: netlifyConfigured
        ? "A site/deploy URL is configured, but production provider, Supabase, and OpenAI env still need route-level proof."
        : "No Netlify/public site URL is configured in this runtime, so production callback and verification URLs remain local-only.",
      requiredEvidence: "Netlify env contains Supabase, provider, admin-token, OpenAI, and public URL values, then production status/self-test routes pass.",
      nextAction: "Set production Netlify env after local status is clean, then smoke /api/sports/decision/status on the deployed URL.",
      command: makeGateCommand("/api/sports/decision/status"),
      verifyUrl: "/api/sports/decision/status",
      missingEnv: netlifyConfigured ? [] : ["NEXT_PUBLIC_SITE_URL"],
      unlocks: ["production smoke tests", "provider webhooks", "scheduled ingestion"]
    })
  ].sort((a, b) => gateRank(b) - gateRank(a) || a.id.localeCompare(b.id));

  const passCount = gates.filter((item) => item.status === "pass").length;
  const watchCount = gates.filter((item) => item.status === "watch").length;
  const blockCount = gates.filter((item) => item.status === "block").length;
  const score = clampScore(gates.reduce((sum, item) => sum + item.score, 0) / Math.max(1, gates.length));
  const nextGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? null;
  const status: DecisionActivationStatus = blockCount ? "blocked" : watchCount ? "partial" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    score,
    summary:
      status === "ready"
        ? "Activation gates are ready for live, provider-backed decision learning."
        : status === "partial"
          ? `Activation is partially ready with ${watchCount} gate(s) still watching live evidence.`
          : `Activation is blocked by ${blockCount} gate(s); do not enable write-mode learning or live publishing yet.`,
    gates,
    nextGate,
    passCount,
    watchCount,
    blockCount,
    missingEnv: unique(gates.flatMap((item) => item.missingEnv)),
    capabilities: {
      deterministicCore: readiness.deterministicCore.status === "ready",
      liveProviderRuntime: readiness.dataProviders.liveRuntimeBacked,
      supabaseMemory: readiness.supabase.configured && schemaReady,
      historicalTraining: governance.status === "approved",
      oddsIntelligence: readiness.dataProviders.oddsApiConfigured && readiness.dataProviders.sportsApiConfigured,
      openAiCritique: readiness.openAi.configured,
      safeAutopilotRun: autopilot.canRunNow,
      publishableSlate: autopilot.canPublish,
      persistableBrainTrace: traceLedger.persistence.payloadReady && traceLedger.persistence.includesBrainTrace && readiness.supabase.configured && schemaReady
    },
    evidenceContract: {
      expectedSupabaseProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      expectedSupabaseTables: readiness.supabase.preflight.expectedTables,
      requiredBeforeWriteMode: [
        "Project ref and URL match OddsPadi.",
        "Supabase MCP or runtime schema verification proves the op_ tables in the OddsPadi project.",
        "Provider data replaces mock fixtures, odds, injuries, lineups, news, weather, and live events.",
        "Trace payload includes model_snapshot.brain before persistence.",
        "Historical backtests and outcome labels pass governance before learned weights influence live picks."
      ],
      forbiddenUntilVerified: [
        "Do not apply migrations through a global Supabase MCP target.",
        "Do not persist mock-backed recommendations into the production memory loop.",
        "Do not let OpenAI critique upgrade a deterministic avoid/watch decision.",
        "Do not publish value picks when governance or invalidation gates are blocked."
      ]
    }
  };
}
