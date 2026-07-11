import { hasConfiguredEnv } from "@/lib/env";
import { buildDecisionAgentLoop, type DecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionBrainSlate, type DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionOperatingCycle, type DecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionRepairPlan, type DecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification, type DecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionSelfAudit, type DecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupervisorQueue, DecisionSupervisorRunbookStep, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionActionSandboxStatus = "ready" | "blocked" | "waiting";
export type DecisionActionSandboxStepStatus = "will-run" | "blocked" | "manual-review" | "verify-only";

export type DecisionActionSandboxStep = {
  id: string;
  label: string;
  status: DecisionActionSandboxStepStatus;
  command: string;
  method: "GET" | "POST";
  url: string;
  dryRunSafe: boolean;
  requiresAdminToken: boolean;
  missingEnv: string[];
  expectedResult: string;
  abortCondition: string | null;
};

export type DecisionActionSandbox = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionActionSandboxStatus;
  summary: string;
  target: {
    itemId: string | null;
    title: string;
    mode: DecisionSupervisorQueue["runbook"]["mode"];
    runbookStatus: DecisionSupervisorQueue["runbook"]["status"];
    operatingStage: DecisionOperatingCycle["activeStageId"];
  };
  canExecutePrimary: boolean;
  primaryCommand: string | null;
  blockedBy: string[];
  safetyVerdict: {
    dryRunOnly: boolean;
    writeBlocked: boolean;
    adminRequired: boolean;
    localTarget: boolean;
    reason: string;
  };
  steps: DecisionActionSandboxStep[];
  postRunVerification: {
    verifyUrl: string;
    expectedStateChange: string;
    proofRequired: string[];
  };
};

type EnvMap = Record<string, string | undefined>;

function compact(values: string[], fallback: string, limit = 6): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length && !fallback) return [];
  return (cleaned.length ? cleaned : [fallback]).slice(0, limit);
}

function envConfigured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function requirementAlternatives(requirement: string): string[] {
  return requirement
    .replace(/\s+for\s+.+$/i, "")
    .split(/\s+or\s+/i)
    .map((key) => key.trim())
    .filter(Boolean);
}

function missingRequirement(requirement: string, env: EnvMap): boolean {
  const alternatives = requirementAlternatives(requirement);
  return alternatives.length > 0 && !alternatives.some((key) => envConfigured(env, key));
}

function isWriteOnlyRequirement(requirement: string): boolean {
  return /\bfor writes?\b/i.test(requirement);
}

function missingEnvForStep(step: DecisionSupervisorRunbookStep, mode: DecisionSupervisorQueue["runbook"]["mode"], env: EnvMap): string[] {
  return step.requiredEnv.filter((requirement) => {
    if (!missingRequirement(requirement, env)) return false;
    return !(mode === "dry-run" && isWriteOnlyRequirement(requirement));
  });
}

function stepIsDryRunSafe(step: DecisionSupervisorRunbookStep): boolean {
  return step.method === "GET" || step.url.includes("dryRun=1");
}

function sandboxStep(
  step: DecisionSupervisorRunbookStep,
  mode: DecisionSupervisorQueue["runbook"]["mode"],
  env: EnvMap,
  primaryStepId: string | null
): DecisionActionSandboxStep {
  const missingEnv = missingEnvForStep(step, mode, env);
  const dryRunSafe = stepIsDryRunSafe(step);
  const isPrimary = step.id === primaryStepId;
  const status: DecisionActionSandboxStepStatus = missingEnv.length
    ? "blocked"
    : step.status === "manual-review"
      ? "manual-review"
      : isPrimary
        ? "will-run"
        : "verify-only";

  return {
    id: step.id,
    label: step.label,
    status,
    command: step.command,
    method: step.method,
    url: step.url,
    dryRunSafe,
    requiresAdminToken: step.requiresAdminToken,
    missingEnv,
    expectedResult: step.expectedResult,
    abortCondition: !dryRunSafe ? "Abort because the command is not read-only or dryRun=1." : missingEnv.length ? `Abort until ${missingEnv.join(", ")} is configured.` : null
  };
}

function safetyReason({
  runbook,
  steps,
  blockedBy
}: {
  runbook: DecisionSupervisorQueue["runbook"];
  steps: DecisionActionSandboxStep[];
  blockedBy: string[];
}): string {
  if (blockedBy.length) return `Sandbox blocked until ${blockedBy.join(", ")} is configured.`;
  if (steps.some((step) => !step.dryRunSafe)) return "Sandbox blocks non-dry-run writes until a dry-run proof exists.";
  if (runbook.mode === "write-gated") return "Sandbox requires operator review because the runbook is write-gated.";
  if (runbook.status === "waiting") return "Sandbox is waiting for external/provider state before execution.";
  return "Sandbox is safe to run because the primary command is read-only or dry-run and preflight has no blocking failures.";
}

export function buildDecisionActionSandbox({
  rows,
  date,
  sport,
  readiness = null,
  env = process.env,
  brainSlate,
  supervisorQueue,
  agentLoop,
  selfAudit,
  repairPlan,
  repairVerification,
  operatingCycle
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  env?: EnvMap;
  brainSlate?: DecisionBrainSlate;
  supervisorQueue?: DecisionSupervisorQueue;
  agentLoop?: DecisionAgentLoop;
  selfAudit?: DecisionSelfAudit;
  repairPlan?: DecisionRepairPlan;
  repairVerification?: DecisionRepairVerification;
  operatingCycle?: DecisionOperatingCycle;
}): DecisionActionSandbox {
  const slate = brainSlate ?? buildDecisionBrainSlate({ rows, date, sport, limit: 6 });
  const queue = supervisorQueue ?? buildDecisionSupervisorQueue({ rows, date, sport, limit: 8, env });
  const loop = agentLoop ?? buildDecisionAgentLoop({ rows, date, sport, limit: 6, brainSlate: slate, supervisorQueue: queue, env });
  const audit = selfAudit ?? buildDecisionSelfAudit({ rows, date, sport, agentLoop: loop });
  const plan = repairPlan ?? buildDecisionRepairPlan({ rows, date, sport, agentLoop: loop, selfAudit: audit });
  const verification = repairVerification ?? buildDecisionRepairVerification({ repairPlan: plan, selfAudit: audit, readiness });
  const cycle =
    operatingCycle ??
    buildDecisionOperatingCycle({
      rows,
      date,
      sport,
      readiness,
      brainSlate: slate,
      supervisorQueue: queue,
      agentLoop: loop,
      selfAudit: audit,
      repairPlan: plan,
      repairVerification: verification
    });
  const runbook = queue.runbook;
  const primaryStep = runbook.steps[0] ?? null;
  const steps = runbook.steps.map((step) => sandboxStep(step, runbook.mode, env, primaryStep?.id ?? null));
  const blockedBy = compact(
    [
      ...runbook.preflight.missingEnv,
      ...steps.flatMap((step) => step.missingEnv),
      ...(runbook.preflight.canRunPrimaryCommand ? [] : runbook.preflight.checks.filter((check) => check.status === "fail").map((check) => check.requiredAction ?? check.detail)),
      ...(!runbook.primaryCommand ? ["No primary command is available."] : [])
    ],
    "",
    8
  );
  const writeBlocked = runbook.mode === "write-gated" || steps.some((step) => !step.dryRunSafe);
  const canExecutePrimary = Boolean(runbook.primaryCommand && runbook.preflight.canRunPrimaryCommand && !blockedBy.length && !writeBlocked);
  const status: DecisionActionSandboxStatus = canExecutePrimary ? "ready" : runbook.status === "waiting" ? "waiting" : "blocked";
  const verifyStep = runbook.steps.find((step) => step.id.includes("verify")) ?? runbook.steps.at(-1) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "ready"
        ? `Action sandbox is ready to run ${primaryStep?.label ?? "the primary command"}.`
        : status === "waiting"
          ? `Action sandbox is waiting on ${runbook.title}.`
          : `Action sandbox is blocked before running ${runbook.title}.`,
    target: {
      itemId: runbook.targetItemId,
      title: runbook.title,
      mode: runbook.mode,
      runbookStatus: runbook.status,
      operatingStage: cycle.activeStageId
    },
    canExecutePrimary,
    primaryCommand: canExecutePrimary ? runbook.primaryCommand : null,
    blockedBy,
    safetyVerdict: {
      dryRunOnly: runbook.mode === "dry-run",
      writeBlocked,
      adminRequired: Boolean(primaryStep?.requiresAdminToken),
      localTarget: Boolean(runbook.primaryCommand?.includes(decisionSiteOrigin())),
      reason: safetyReason({ runbook, steps, blockedBy })
    },
    steps,
    postRunVerification: {
      verifyUrl: verifyStep?.url ?? cycle.nextTransition.verifyUrl,
      expectedStateChange: runbook.expectedStateChange,
      proofRequired: compact(
        [
          runbook.expectedStateChange,
          verification.nextVerification?.proof ?? "",
          readiness ? `Supabase ${readiness.supabase.status}; providers ${readiness.dataProviders.status}.` : "",
          verifyStep?.expectedResult ?? ""
        ],
        "Rerun the supervisor, self-audit, and repair-verification endpoints after the action."
      )
    }
  };
}
