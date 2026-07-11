import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionMvpRequirementAudit } from "@/lib/sports/prediction/decisionMvpRequirementAudit";
import type { DecisionNetlifyDeployment } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import type { Match, Prediction, Sport } from "@/lib/sports/types";
import type { TenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type EnvMap = Record<string, string | undefined>;

export type DecisionActivationRunbookStatus =
  | "ready-to-run"
  | "waiting-on-secrets"
  | "waiting-on-supabase"
  | "waiting-on-providers"
  | "waiting-on-training"
  | "blocked";

export type DecisionActivationRunbookPhaseId =
  | "supabase-project-proof"
  | "environment-secrets"
  | "schema-verification"
  | "provider-dry-run"
  | "openai-review"
  | "local-build-smoke"
  | "netlify-env"
  | "production-smoke"
  | "training-corpus"
  | "write-mode-approval";

export type DecisionActivationRunbookPhaseStatus = "ready" | "waiting" | "blocked" | "done";
export type DecisionActivationRunbookPhaseCategory = "supabase" | "env" | "provider" | "ai" | "netlify" | "training" | "safety";
export type DecisionActivationRunbookPriority = "critical" | "high" | "medium" | "low";

export type DecisionActivationRunbookPhase = {
  id: DecisionActivationRunbookPhaseId;
  label: string;
  status: DecisionActivationRunbookPhaseStatus;
  category: DecisionActivationRunbookPhaseCategory;
  priority: DecisionActivationRunbookPriority;
  reason: string;
  requiredEvidence: string;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  missingEnv: string[];
  unlocks: string[];
  forbiddenUntilDone: string[];
};

export type DecisionActivationRunbookCommand = {
  phaseId: DecisionActivationRunbookPhaseId;
  label: string;
  command: string;
  verifyUrl: string | null;
  expectedEvidence: string;
};

export type DecisionActivationRunbook = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionActivationRunbookStatus;
  mode: "supervised-activation-runbook";
  runbookHash: string;
  summary: string;
  counts: Record<DecisionActivationRunbookPhaseStatus, number>;
  phases: DecisionActivationRunbookPhase[];
  nextPhase: DecisionActivationRunbookPhase | null;
  commands: DecisionActivationRunbookCommand[];
  locks: {
    persist: { locked: true; reason: string };
    publish: { locked: true; reason: string };
    train: { locked: true; reason: string };
    writeBackfill: { locked: true; reason: string };
  };
  operatorChecklist: string[];
  netlifyEnvKeys: string[];
  supabaseExpectedRef: string;
  providerEnvKeys: string[];
  proofUrls: string[];
};

const READ_ONLY_LOCAL_STATUS_COMMAND = decisionCurlCommand("/api/sports/decision/status");
const READ_ONLY_CORPUS_COMMAND = decisionCurlCommand("/api/sports/decision/training/corpus-plan");

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: string[], limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function isEnvRequirement(value: string): boolean {
  return /^[A-Z0-9_]+( or [A-Z0-9_]+)?$/.test(value);
}

export function isSafeActivationCommand(command: string | null): boolean {
  if (!command) return false;
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (
    lower.includes("deploy --prod") ||
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("supabase_service_role_key") ||
    lower.includes("service_role")
  ) {
    return false;
  }
  if (trimmed === "npm run build" || trimmed === "npx netlify status" || trimmed === "npx netlify env:list") return true;
  if (lower.startsWith("curl.exe -ss")) return true;
  if ((lower.startsWith("curl.exe -x post") || lower.startsWith("curl.exe -xpost")) && lower.includes("dryrun=1")) return true;
  return false;
}

function phase(input: Omit<DecisionActivationRunbookPhase, "safeToRun">): DecisionActivationRunbookPhase {
  return {
    ...input,
    missingEnv: unique(input.missingEnv),
    safeToRun: input.status === "ready" && input.missingEnv.length === 0 && isSafeActivationCommand(input.command)
  };
}

function countPhases(phases: DecisionActivationRunbookPhase[]): Record<DecisionActivationRunbookPhaseStatus, number> {
  return {
    ready: phases.filter((item) => item.status === "ready").length,
    waiting: phases.filter((item) => item.status === "waiting").length,
    blocked: phases.filter((item) => item.status === "blocked").length,
    done: phases.filter((item) => item.status === "done").length
  };
}

function providerEnvKeys(corpusPlan: TenYearFootballCorpusBackfillPlan): string[] {
  return unique(
    corpusPlan.requiredEnvKeys.filter((key) => !["ODDSPADI_ADMIN_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].includes(key))
  );
}

function productionStatusCommand(netlifyDeployment: DecisionNetlifyDeployment): string | null {
  if (!netlifyDeployment.site.productionUrl) return null;
  return `curl.exe -sS "${netlifyDeployment.site.productionUrl}/api/sports/decision/status"`;
}

function phaseStatusForSupabaseProof(supabaseBootstrap: DecisionSupabaseBootstrap): DecisionActivationRunbookPhaseStatus {
  if (!supabaseBootstrap.project.targetMatchesExpected) return "blocked";
  if (supabaseBootstrap.mcp.scopedProofPasses) return "done";
  return "waiting";
}

function phaseStatusForSchema(supabaseBootstrap: DecisionSupabaseBootstrap): DecisionActivationRunbookPhaseStatus {
  if (!supabaseBootstrap.project.targetMatchesExpected) return "blocked";
  if (supabaseBootstrap.schema.verifiedTableCount === supabaseBootstrap.schema.expectedTableCount) return "done";
  return "waiting";
}

function phaseStatusForProviderDryRun({
  supabaseBootstrap,
  corpusPlan
}: {
  supabaseBootstrap: DecisionSupabaseBootstrap;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
}): DecisionActivationRunbookPhaseStatus {
  if (!supabaseBootstrap.project.targetMatchesExpected || corpusPlan.blockers.length > 0) return "blocked";
  if (corpusPlan.canRunFirstCommand) return "ready";
  return "waiting";
}

function phaseStatusForOpenAI(agentRuntime: DecisionAgentRuntime, env: EnvMap): DecisionActivationRunbookPhaseStatus {
  if (agentRuntime.permissions.canAskOpenAI) return "ready";
  if (!boolEnv(env, "OPENAI_API_KEY")) return "waiting";
  return "waiting";
}

function phaseStatusForProductionSmoke(netlifyDeployment: DecisionNetlifyDeployment): DecisionActivationRunbookPhaseStatus {
  if (netlifyDeployment.safety.canSmokeProduction && netlifyDeployment.env.missingProduction.length === 0) return "ready";
  return "waiting";
}

function phaseStatusForTraining({
  supabaseBootstrap,
  training
}: {
  supabaseBootstrap: DecisionSupabaseBootstrap;
  training: TrainingDataSnapshot;
}): DecisionActivationRunbookPhaseStatus {
  if (!supabaseBootstrap.project.targetMatchesExpected || training.status === "failed") return "blocked";
  if (training.readiness.readyForTraining) return "done";
  return "waiting";
}

function buildStatus(phases: DecisionActivationRunbookPhase[]): DecisionActivationRunbookStatus {
  const byId = new Map(phases.map((item) => [item.id, item]));
  if (byId.get("supabase-project-proof")?.status === "blocked" || byId.get("schema-verification")?.status === "blocked") return "blocked";
  if (byId.get("environment-secrets")?.status === "waiting") return "waiting-on-secrets";
  if (byId.get("supabase-project-proof")?.status === "waiting" || byId.get("schema-verification")?.status === "waiting") return "waiting-on-supabase";
  if (byId.get("provider-dry-run")?.status === "waiting") return "waiting-on-providers";
  if (byId.get("training-corpus")?.status === "waiting") return "waiting-on-training";
  if (phases.some((item) => item.status === "ready" && item.safeToRun)) return "ready-to-run";
  return "blocked";
}

function selectNextPhase(phases: DecisionActivationRunbookPhase[]): DecisionActivationRunbookPhase | null {
  return (
    phases.find((item) => item.status === "ready" && item.safeToRun) ??
    phases.find((item) => item.status === "waiting") ??
    phases.find((item) => item.status === "blocked") ??
    null
  );
}

function buildSummary(status: DecisionActivationRunbookStatus, counts: Record<DecisionActivationRunbookPhaseStatus, number>): string {
  const base = `${counts.ready} ready, ${counts.waiting} waiting, ${counts.blocked} blocked, ${counts.done} done.`;
  if (status === "ready-to-run") return `Activation runbook has a supervised safe command ready: ${base}`;
  if (status === "waiting-on-secrets") return `Activation runbook is waiting on environment secrets before live activation: ${base}`;
  if (status === "waiting-on-supabase") return `Activation runbook is waiting on OddsPadi Supabase project proof and schema verification: ${base}`;
  if (status === "waiting-on-providers") return `Activation runbook is waiting on provider dry-run readiness: ${base}`;
  if (status === "waiting-on-training") return `Activation runbook is waiting on real training corpus proof: ${base}`;
  return `Activation runbook is blocked until critical project or schema proof is fixed: ${base}`;
}

export function buildDecisionActivationRunbook({
  rows,
  date,
  sport,
  mvpAudit,
  readiness,
  supabaseBootstrap,
  netlifyDeployment,
  agentRuntime,
  corpusPlan,
  training,
  env = process.env
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  mvpAudit: DecisionMvpRequirementAudit;
  readiness: DecisionEngineReadiness;
  supabaseBootstrap: DecisionSupabaseBootstrap;
  netlifyDeployment: DecisionNetlifyDeployment;
  agentRuntime: DecisionAgentRuntime;
  corpusPlan: TenYearFootballCorpusBackfillPlan;
  training: TrainingDataSnapshot;
  env?: EnvMap;
}): DecisionActivationRunbook {
  const openAiMissing = boolEnv(env, "OPENAI_API_KEY") || agentRuntime.permissions.canAskOpenAI ? [] : ["OPENAI_API_KEY"];
  const secretMissing = unique([
    ...supabaseBootstrap.env.missingBeforeWriteMode.filter(isEnvRequirement),
    ...netlifyDeployment.env.missingProduction,
    ...corpusPlan.missingEnvKeys.filter(isEnvRequirement),
    ...openAiMissing
  ]);
  const expectedSchemaEvidence = `${supabaseBootstrap.schema.verifiedTableCount}/${supabaseBootstrap.schema.expectedTableCount} expected op_ table(s) verified.`;
  const phases = [
    phase({
      id: "supabase-project-proof",
      label: "Prove OddsPadi Supabase project",
      status: phaseStatusForSupabaseProof(supabaseBootstrap),
      category: "supabase",
      priority: "critical",
      reason: supabaseBootstrap.mcp.scopedProofPasses
        ? `MCP proof is scoped to ${supabaseBootstrap.project.expectedRef}.`
        : `Do not use generic Supabase tooling until the MCP session proves ${supabaseBootstrap.project.expectedRef}.`,
      requiredEvidence: `A project-scoped MCP/CLI proof against ${supabaseBootstrap.project.expectedRef}, not AfroTools or LATMtools.`,
      command: READ_ONLY_LOCAL_STATUS_COMMAND,
      verifyUrl: "/api/sports/decision/status",
      missingEnv: supabaseBootstrap.mcp.scopedProofPasses ? [] : ["ODDSPADI_SUPABASE_MCP_PROJECT_REF"],
      unlocks: ["schema-verification", "provider-dry-run", "write-mode-approval"],
      forbiddenUntilDone: ["live SQL execution", "migration application", "write-mode provider imports"]
    }),
    phase({
      id: "environment-secrets",
      label: "Set server and provider secrets",
      status: secretMissing.length ? "waiting" : "done",
      category: "env",
      priority: "critical",
      reason: secretMissing.length ? `Missing ${secretMissing.join(", ")}.` : "Required local and production activation keys are present.",
      requiredEvidence: "Local and Netlify env keys exist without exposing secret values in source control.",
      command: "npx netlify env:list",
      verifyUrl: "/api/sports/decision/netlify-readiness",
      missingEnv: secretMissing,
      unlocks: ["provider-dry-run", "openai-review", "production-smoke"],
      forbiddenUntilDone: ["production deployment", "scheduled provider backfills", "AI review automation"]
    }),
    phase({
      id: "schema-verification",
      label: "Verify expected op_ schema",
      status: phaseStatusForSchema(supabaseBootstrap),
      category: "supabase",
      priority: "critical",
      reason: expectedSchemaEvidence,
      requiredEvidence: `All ${supabaseBootstrap.schema.expectedTableCount} OddsPadi op_ tables are reachable by the server client.`,
      command: READ_ONLY_LOCAL_STATUS_COMMAND,
      verifyUrl: "/api/sports/decision/status",
      missingEnv: supabaseBootstrap.schema.verifiedTableCount === supabaseBootstrap.schema.expectedTableCount ? [] : ["verified op_ schema"],
      unlocks: ["training-corpus", "write-mode-approval"],
      forbiddenUntilDone: ["decision persistence", "training writes", "dryRun=0 imports"]
    }),
    phase({
      id: "provider-dry-run",
      label: "Run first provider dry-run",
      status: phaseStatusForProviderDryRun({ supabaseBootstrap, corpusPlan }),
      category: "provider",
      priority: "high",
      reason: corpusPlan.firstCommandPurpose,
      requiredEvidence: "Dry-run provider response returns normalized counts, zero writes, and reviewed quota impact.",
      command: corpusPlan.canRunFirstCommand ? corpusPlan.firstCommand : null,
      verifyUrl: "/api/sports/decision/training/corpus-plan",
      missingEnv: corpusPlan.canRunFirstCommand ? [] : corpusPlan.missingEnvKeys,
      unlocks: ["training-corpus", "data-layer proof"],
      forbiddenUntilDone: ["dryRun=0", "scheduled imports", "model training from provider rows"]
    }),
    phase({
      id: "openai-review",
      label: "Enable guarded OpenAI review",
      status: phaseStatusForOpenAI(agentRuntime, env),
      category: "ai",
      priority: "medium",
      reason: agentRuntime.permissions.canAskOpenAI
        ? "Runtime allows evidence-bound OpenAI review."
        : "OpenAI review remains held by missing env or proof gates.",
      requiredEvidence: "OPENAI_API_KEY is configured and AI handoff, citation validator, firewall, and no-upgrade guardrails pass.",
      command: agentRuntime.permissions.canAskOpenAI ? agentRuntime.nextCommand?.command ?? null : null,
      verifyUrl: "/api/sports/decision/ai-orchestrator",
      missingEnv: openAiMissing,
      unlocks: ["ai critique", "same-or-safer review"],
      forbiddenUntilDone: ["AI text persistence", "AI upgrades", "uncited AI claims"]
    }),
    phase({
      id: "local-build-smoke",
      label: "Run local production build",
      status: "ready",
      category: "netlify",
      priority: "high",
      reason: "The local build is the cheapest proof before deploy or env changes.",
      requiredEvidence: "Next build completes and lists decision routes without type or compile errors.",
      command: "npm run build",
      verifyUrl: null,
      missingEnv: [],
      unlocks: ["netlify deployment smoke"],
      forbiddenUntilDone: ["production deploy"]
    }),
    phase({
      id: "netlify-env",
      label: "Verify Netlify env keys",
      status: netlifyDeployment.env.missingProduction.length ? "waiting" : "done",
      category: "netlify",
      priority: "high",
      reason: netlifyDeployment.env.missingProduction.length
        ? `Netlify production env is missing ${netlifyDeployment.env.missingProduction.join(", ")}.`
        : "Netlify production env has the minimum key set.",
      requiredEvidence: "Netlify env list shows required key names without revealing values.",
      command: "npx netlify env:list",
      verifyUrl: "/api/sports/decision/netlify-readiness",
      missingEnv: netlifyDeployment.env.missingProduction,
      unlocks: ["production-smoke"],
      forbiddenUntilDone: ["production deploy", "production scheduled functions"]
    }),
    phase({
      id: "production-smoke",
      label: "Smoke production routes",
      status: phaseStatusForProductionSmoke(netlifyDeployment),
      category: "netlify",
      priority: "medium",
      reason: netlifyDeployment.site.productionUrl
        ? `Production smoke target is ${netlifyDeployment.site.productionUrl}.`
        : "Production URL is not configured yet.",
      requiredEvidence: "Production status, audit, runtime, Supabase bootstrap, and dashboard routes respond with the expected locked state.",
      command: productionStatusCommand(netlifyDeployment),
      verifyUrl: "/api/sports/decision/netlify-readiness",
      missingEnv: netlifyDeployment.site.productionUrl ? netlifyDeployment.env.missingProduction : ["NEXT_PUBLIC_SITE_URL"],
      unlocks: ["public route confidence"],
      forbiddenUntilDone: ["public pick publishing", "scheduled write-mode jobs"]
    }),
    phase({
      id: "training-corpus",
      label: "Build real training corpus",
      status: phaseStatusForTraining({ supabaseBootstrap, training }),
      category: "training",
      priority: "critical",
      reason: training.readiness.detail,
      requiredEvidence: `${training.readiness.minimumRecommendedFixtures} real finished fixtures, real odds snapshots, feature snapshots, labels, and a completed backtest.`,
      command: READ_ONLY_CORPUS_COMMAND,
      verifyUrl: "/api/sports/decision/training",
      missingEnv: training.readiness.readyForTraining ? [] : corpusPlan.missingEnvKeys,
      unlocks: ["model-governance training", "backtest calibration"],
      forbiddenUntilDone: ["learned threshold activation", "model retraining claims", "demo-seed training"]
    }),
    phase({
      id: "write-mode-approval",
      label: "Approve write mode manually",
      status: "blocked",
      category: "safety",
      priority: "critical",
      reason: "Persist, publish, train, and write-backfill are intentionally hard locked until every proof gate is complete.",
      requiredEvidence: "Human approval after Supabase proof, schema proof, provider dry-runs, local build, production smoke, and real backtest evidence.",
      command: null,
      verifyUrl: "/api/sports/decision/activation-runbook",
      missingEnv: [],
      unlocks: ["persist", "publish", "train", "writeBackfill"],
      forbiddenUntilDone: ["persist=1", "dryRun=0", "netlify deploy --prod", "scheduled backfill writes"]
    })
  ];
  const counts = countPhases(phases);
  const status = buildStatus(phases);
  const nextPhase = selectNextPhase(phases);
  const commands = phases
    .filter((item) => item.command && item.safeToRun)
    .map((item) => ({
      phaseId: item.id,
      label: item.label,
      command: item.command as string,
      verifyUrl: item.verifyUrl,
      expectedEvidence: item.requiredEvidence
    }));
  const proofUrls = unique([
    "/api/sports/decision/activation-runbook",
    "/api/sports/decision/mvp-audit",
    "/api/sports/decision/supabase-bootstrap",
    "/api/sports/decision/netlify-readiness",
    "/api/sports/decision/agent-runtime",
    "/api/sports/decision/training/corpus-plan",
    "/api/sports/decision/training",
    "/predictions/decision-engine",
    ...mvpAudit.proofUrls
  ]);
  const runbookHash = stableHash({
    date,
    sport,
    rows: rows.length,
    readiness: readiness.runtimeMode,
    mvp: [mvpAudit.status, mvpAudit.auditHash],
    supabase: [supabaseBootstrap.status, supabaseBootstrap.project.expectedRef, supabaseBootstrap.mcp.scopedProofPasses],
    netlify: [netlifyDeployment.status, netlifyDeployment.env.missingProduction],
    runtime: [agentRuntime.status, agentRuntime.mode],
    corpus: [corpusPlan.status, corpusPlan.canRunFirstCommand],
    training: [training.status, training.readiness.readyForTraining],
    phases: phases.map((item) => [item.id, item.status, item.safeToRun, item.missingEnv])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "supervised-activation-runbook",
    runbookHash,
    summary: buildSummary(status, counts),
    counts,
    phases,
    nextPhase,
    commands,
    locks: {
      persist: {
        locked: true,
        reason: "Decision persistence requires OddsPadi Supabase proof, schema verification, and manual write-mode approval."
      },
      publish: {
        locked: true,
        reason: "Public picks require provider-backed data, production smoke proof, authority approval, and responsible-control review."
      },
      train: {
        locked: true,
        reason: "Training requires a real 10-year corpus, target labels, completed backtests, and governance approval."
      },
      writeBackfill: {
        locked: true,
        reason: "Provider backfill writes require reviewed dry-run counts and explicit dryRun=0 approval."
      }
    },
    operatorChecklist: [
      `Configure a project-scoped Supabase MCP/CLI session for ${supabaseBootstrap.project.expectedRef}.`,
      "Set local server secrets in .env.local and production secrets in Netlify env variables only.",
      "Verify the expected op_ schema against the OddsPadi project before any write-mode import.",
      "Run the first provider dry-run and review normalized counts, raw payload shape, and quota impact.",
      "Run npm run build, then smoke local and production read-only routes.",
      "Keep persist, publish, train, and dryRun=0 locked until this runbook reports every proof gate done."
    ],
    netlifyEnvKeys: netlifyDeployment.env.missingProduction,
    supabaseExpectedRef: supabaseBootstrap.project.expectedRef,
    providerEnvKeys: providerEnvKeys(corpusPlan),
    proofUrls
  };
}
