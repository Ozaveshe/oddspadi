import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import type { DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionInvalidationJob, DecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import type { DecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { DecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionAutopilotStatus = "ready" | "supervised" | "blocked" | "waiting";
export type DecisionAutopilotMode = "read-only" | "dry-run" | "write-gated" | "off";
export type DecisionAutopilotPhase = "observe" | "reason" | "challenge" | "act" | "verify" | "learn";
export type DecisionAutopilotActionStatus = "ready" | "waiting" | "blocked";
export type DecisionAutopilotActionPriority = "critical" | "high" | "medium" | "low";

export type DecisionAutopilotAction = {
  id: string;
  phase: DecisionAutopilotPhase;
  source: string;
  priority: DecisionAutopilotActionPriority;
  status: DecisionAutopilotActionStatus;
  label: string;
  rationale: string;
  command: string | null;
  verifyUrl: string;
  missingEnv: string[];
  expectedEvidence: string;
  riskIfSkipped: string;
  safeToRun: boolean;
  canAutoRun: boolean;
};

export type DecisionAutopilotLedgerItem = {
  phase: DecisionAutopilotPhase;
  status: DecisionAutopilotActionStatus;
  observation: string;
  decision: string;
  evidence: string;
};

export type DecisionAutopilot = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAutopilotStatus;
  mode: DecisionAutopilotMode;
  summary: string;
  activeMatch: string | null;
  activeMatchId: string | null;
  nextAction: DecisionAutopilotAction | null;
  canRunNow: boolean;
  canPublish: boolean;
  canPersist: boolean;
  actions: DecisionAutopilotAction[];
  ledger: DecisionAutopilotLedgerItem[];
  guardrails: string[];
  state: {
    councilStatus: DecisionAICouncil["status"];
    councilFinalAction: DecisionAICouncil["finalAction"];
    invalidationStatus: DecisionInvalidationMonitor["status"];
    governanceStatus: DecisionModelGovernance["status"];
    sandboxStatus: DecisionActionSandbox["status"];
    learningStatus: DecisionLearningQueue["status"];
    operatingStatus: DecisionOperatingCycle["status"];
    readyActions: number;
    blockedActions: number;
    waitingActions: number;
  };
};

function envConfigured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function priorityRank(priority: DecisionAutopilotActionPriority): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[priority];
}

function statusRank(status: DecisionAutopilotActionStatus): number {
  return { ready: 3, blocked: 2, waiting: 1 }[status];
}

function isSafeCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function commandMode(command: string | null, safeToRun: boolean): DecisionAutopilotMode {
  if (!command) return "off";
  const lower = command.toLowerCase();
  if (!safeToRun) return "write-gated";
  return lower.includes("-x post") || lower.includes("-xpost") ? "dry-run" : "read-only";
}

function actionSort(a: DecisionAutopilotAction, b: DecisionAutopilotAction): number {
  return statusRank(b.status) - statusRank(a.status) || priorityRank(b.priority) - priorityRank(a.priority) || a.id.localeCompare(b.id);
}

function actionFromInvalidation(job: DecisionInvalidationJob | null): DecisionAutopilotAction | null {
  if (!job) return null;
  const safeToRun = isSafeCommand(job.command);
  return {
    id: `invalidation-${job.id}`,
    phase: job.kind === "persist-outcome" ? "learn" : job.kind === "governance-check" ? "challenge" : "observe",
    source: `invalidation-monitor:${job.kind}`,
    priority: job.priority,
    status: job.status,
    label: job.kind.replaceAll("-", " "),
    rationale: job.reason,
    command: job.command,
    verifyUrl: job.verifyUrl,
    missingEnv: job.missingEnv,
    expectedEvidence: job.expectedEvidence,
    riskIfSkipped: job.riskIfIgnored,
    safeToRun,
    canAutoRun: job.status === "ready" && safeToRun && !job.missingEnv.length
  };
}

function actionFromGovernance(governance: DecisionModelGovernance): DecisionAutopilotAction | null {
  if (governance.status === "approved") return null;
  const missingEnv = governance.trainingCorpus.configured && governance.trainingCorpus.status !== "failed" ? [] : ["SUPABASE_SERVICE_ROLE_KEY"];
  const command = decisionCurlCommand("/api/sports/decision/model-governance");
  return {
    id: "governance-hard-gate",
    phase: "challenge",
    source: "model-governance",
    priority: governance.status === "blocked" ? "critical" : "high",
    status: missingEnv.length ? "blocked" : "ready",
    label: "Model governance gate",
    rationale: governance.nextActions[0] ?? governance.summary,
    command,
    verifyUrl: "/api/sports/decision/model-governance",
    missingEnv,
    expectedEvidence: "Governance status reaches approved or clearly documents the remaining real-data, target-label, drift, and runtime blockers.",
    riskIfSkipped: "The engine could let learned guardrails influence live decisions before the corpus, targets, and drift checks are trustworthy.",
    safeToRun: true,
    canAutoRun: !missingEnv.length
  };
}

function actionFromCouncil(council: DecisionAICouncil, env: EnvMap): DecisionAutopilotAction | null {
  if (!council.activeCandidate) return null;
  if (council.reviewStatus === "reviewed") return null;
  const missingEnv = envConfigured(env, "OPENAI_API_KEY") ? [] : ["OPENAI_API_KEY"];
  const command = decisionCurlCommand("/api/sports/decision/ai-council?review=1");
  return {
    id: "ai-council-review",
    phase: "challenge",
    source: "ai-council",
    priority: council.finalAction === "consider" ? "high" : "medium",
    status: missingEnv.length ? "blocked" : "ready",
    label: "Guarded AI council review",
    rationale: `Council final action is ${council.finalAction}; run the no-upgrade AI critique before trusting the slate posture.`,
    command,
    verifyUrl: "/api/sports/decision/ai-council?review=1",
    missingEnv,
    expectedEvidence: "AI council review returns reviewed, downgrade, abstain, needs-data, or a clean not-configured/provider status.",
    riskIfSkipped: "The slate misses a final adversarial review of unsupported claims, missing evidence, and risky upgrades.",
    safeToRun: true,
    canAutoRun: !missingEnv.length
  };
}

function actionFromSandbox(sandbox: DecisionActionSandbox): DecisionAutopilotAction | null {
  if (!sandbox.primaryCommand && sandbox.status !== "blocked") return null;
  const safeToRun = isSafeCommand(sandbox.primaryCommand);
  return {
    id: "sandbox-primary-command",
    phase: "act",
    source: "action-sandbox",
    priority: sandbox.status === "ready" ? "high" : "medium",
    status: sandbox.status === "ready" ? "ready" : sandbox.status === "waiting" ? "waiting" : "blocked",
    label: sandbox.target.title,
    rationale: sandbox.safetyVerdict.reason,
    command: sandbox.primaryCommand,
    verifyUrl: sandbox.postRunVerification.verifyUrl,
    missingEnv: sandbox.blockedBy,
    expectedEvidence: sandbox.postRunVerification.expectedStateChange,
    riskIfSkipped: "The supervisor queue will not move to the next proof state.",
    safeToRun,
    canAutoRun: sandbox.canExecutePrimary && safeToRun
  };
}

function actionFromLearning(learning: DecisionLearningQueue): DecisionAutopilotAction | null {
  const task = learning.nextTask;
  if (!task) return null;
  const safeToRun = isSafeCommand(task.command);
  return {
    id: `learning-${task.id}`,
    phase: "learn",
    source: `learning-queue:${task.category}`,
    priority: task.priority,
    status: task.status,
    label: task.title,
    rationale: task.detail,
    command: task.command,
    verifyUrl: task.verifyUrl,
    missingEnv: task.missingEnv,
    expectedEvidence: task.expectedEvidence,
    riskIfSkipped: task.learningImpact,
    safeToRun,
    canAutoRun: task.status === "ready" && safeToRun && !task.missingEnv.length
  };
}

function phaseFromOperatingStage(stageId: DecisionOperatingCycle["nextTransition"]["stageId"]): DecisionAutopilotPhase {
  if (stageId === "diagnose") return "challenge";
  if (stageId === "decide") return "reason";
  return stageId;
}

function actionFromOperatingCycle(cycle: DecisionOperatingCycle): DecisionAutopilotAction | null {
  const transition = cycle.nextTransition;
  const safeToRun = isSafeCommand(transition.command);
  return {
    id: `operating-${transition.stageId}`,
    phase: phaseFromOperatingStage(transition.stageId),
    source: "operating-cycle",
    priority: transition.status === "blocked" ? "critical" : transition.status === "active" ? "high" : "medium",
    status: transition.status === "blocked" ? "blocked" : transition.status === "waiting" ? "waiting" : "ready",
    label: transition.label,
    rationale: transition.action,
    command: transition.command,
    verifyUrl: transition.verifyUrl,
    missingEnv: transition.blockedBy,
    expectedEvidence: transition.expectedEvidence,
    riskIfSkipped: "The observe-diagnose-decide-act-verify-learn loop remains stuck on the same transition.",
    safeToRun,
    canAutoRun: transition.canRunNow && safeToRun && !transition.blockedBy.length
  };
}

function buildLedger({
  council,
  invalidationMonitor,
  governance,
  actionSandbox,
  learningQueue,
  operatingCycle,
  nextAction
}: {
  council: DecisionAICouncil;
  invalidationMonitor: DecisionInvalidationMonitor;
  governance: DecisionModelGovernance;
  actionSandbox: DecisionActionSandbox;
  learningQueue: DecisionLearningQueue;
  operatingCycle: DecisionOperatingCycle;
  nextAction: DecisionAutopilotAction | null;
}): DecisionAutopilotLedgerItem[] {
  return [
    {
      phase: "observe",
      status: invalidationMonitor.status === "clear" ? "ready" : invalidationMonitor.status === "blocked" ? "blocked" : "waiting",
      observation: invalidationMonitor.summary,
      decision: invalidationMonitor.nextJob ? `Track ${invalidationMonitor.nextJob.kind.replaceAll("-", " ")} first.` : "No stale signal owns the slate.",
      evidence: `${invalidationMonitor.expiredBeliefs} expired belief(s), ${invalidationMonitor.priceAlerts} price alert(s), ${invalidationMonitor.dataBlocks} data block(s).`
    },
    {
      phase: "reason",
      status: council.status === "ready" ? "ready" : council.status === "blocked" ? "blocked" : "waiting",
      observation: council.summary,
      decision: `Council action stays ${council.finalAction}; publish allowed is ${council.canPublishSlate ? "yes" : "no"}.`,
      evidence: `${council.voteCounts.consider}/${council.voteCounts.monitor}/${council.voteCounts.avoid} council votes.`
    },
    {
      phase: "challenge",
      status: governance.status === "approved" ? "ready" : "blocked",
      observation: governance.summary,
      decision: governance.learnedGuardrailsAllowed ? "Learned guardrails may affect live decisions." : "Keep learned guardrails in shadow mode.",
      evidence: `${governance.failingChecks} failing and ${governance.warningChecks} warning governance check(s).`
    },
    {
      phase: "act",
      status: actionSandbox.status === "ready" ? "ready" : actionSandbox.status === "waiting" ? "waiting" : "blocked",
      observation: actionSandbox.summary,
      decision: actionSandbox.canExecutePrimary ? "Primary command can run inside sandbox." : "Primary command is blocked or supervised.",
      evidence: actionSandbox.safetyVerdict.reason
    },
    {
      phase: "verify",
      status: operatingCycle.nextTransition.status === "blocked" ? "blocked" : operatingCycle.nextTransition.status === "waiting" ? "waiting" : "ready",
      observation: operatingCycle.summary,
      decision: `Verify through ${operatingCycle.nextTransition.verifyUrl}.`,
      evidence: operatingCycle.nextTransition.expectedEvidence
    },
    {
      phase: "learn",
      status: learningQueue.status === "ready" ? "ready" : learningQueue.status === "blocked" ? "blocked" : "waiting",
      observation: learningQueue.summary,
      decision: learningQueue.nextTask ? `Learning task: ${learningQueue.nextTask.title}.` : "No learning task is queued.",
      evidence: nextAction ? `Autopilot next action is ${nextAction.label}.` : "Autopilot has no next action."
    }
  ];
}

function autopilotStatus({
  actions,
  governance,
  invalidationMonitor,
  nextAction
}: {
  actions: DecisionAutopilotAction[];
  governance: DecisionModelGovernance;
  invalidationMonitor: DecisionInvalidationMonitor;
  nextAction: DecisionAutopilotAction | null;
}): DecisionAutopilotStatus {
  if (!nextAction) return "waiting";
  if (governance.status === "blocked" || invalidationMonitor.status === "blocked" || actions.some((action) => action.priority === "critical" && action.status === "blocked")) {
    return "blocked";
  }
  if (nextAction.canAutoRun) return "ready";
  if (nextAction.status === "ready" || nextAction.status === "blocked") return "supervised";
  return "waiting";
}

export function buildDecisionAutopilot({
  date,
  sport,
  council,
  invalidationMonitor,
  governance,
  actionSandbox,
  learningQueue,
  operatingCycle,
  env = process.env,
  limit = 8
}: {
  date: string;
  sport: Sport;
  council: DecisionAICouncil;
  invalidationMonitor: DecisionInvalidationMonitor;
  governance: DecisionModelGovernance;
  actionSandbox: DecisionActionSandbox;
  learningQueue: DecisionLearningQueue;
  operatingCycle: DecisionOperatingCycle;
  env?: EnvMap;
  limit?: number;
}): DecisionAutopilot {
  const actions = [
    actionFromGovernance(governance),
    actionFromInvalidation(invalidationMonitor.nextJob),
    actionFromCouncil(council, env),
    actionFromSandbox(actionSandbox),
    actionFromLearning(learningQueue),
    actionFromOperatingCycle(operatingCycle)
  ]
    .filter((action): action is DecisionAutopilotAction => Boolean(action))
    .sort(actionSort)
    .slice(0, limit);
  const nextAction = actions[0] ?? null;
  const status = autopilotStatus({ actions, governance, invalidationMonitor, nextAction });
  const mode = commandMode(nextAction?.command ?? null, Boolean(nextAction?.safeToRun));
  const readyActions = actions.filter((action) => action.status === "ready").length;
  const blockedActions = actions.filter((action) => action.status === "blocked").length;
  const waitingActions = actions.filter((action) => action.status === "waiting").length;
  const canPublish =
    council.canPublishSlate &&
    governance.status === "approved" &&
    invalidationMonitor.status === "clear" &&
    actionSandbox.safetyVerdict.writeBlocked === false &&
    operatingCycle.state.canPublish;
  const canPersist = operatingCycle.state.canPersist && learningQueue.status !== "blocked";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode,
    summary:
      status === "ready"
        ? `Autopilot can run ${nextAction?.label ?? "the next proof"} in ${mode} mode.`
        : status === "supervised"
          ? `Autopilot needs supervised review before ${nextAction?.label ?? "the next proof"}.`
          : status === "blocked"
            ? `Autopilot is blocked by ${nextAction?.missingEnv[0] ?? nextAction?.label ?? "governance or provider evidence"}.`
            : "Autopilot is waiting for a queued proof action.",
    activeMatch: operatingCycle.state.activeMatch,
    activeMatchId: operatingCycle.state.activeMatchId,
    nextAction,
    canRunNow: Boolean(nextAction?.canAutoRun),
    canPublish,
    canPersist,
    actions,
    ledger: buildLedger({ council, invalidationMonitor, governance, actionSandbox, learningQueue, operatingCycle, nextAction }),
    guardrails: unique([
      "Never publish a pick from stale beliefs, expired monitoring, or mock-heavy data.",
      "Never let AI text upgrade a deterministic monitor or avoid action.",
      "Only run read-only or dry-run commands automatically.",
      "Require Supabase service credentials and schema verification before persistence or training writes.",
      "Require provider-backed odds, fixture, lineup, injury, and context evidence before learned guardrails affect live decisions.",
      "Always verify the selected command through the returned verification URL."
    ]),
    state: {
      councilStatus: council.status,
      councilFinalAction: council.finalAction,
      invalidationStatus: invalidationMonitor.status,
      governanceStatus: governance.status,
      sandboxStatus: actionSandbox.status,
      learningStatus: learningQueue.status,
      operatingStatus: operatingCycle.status,
      readyActions,
      blockedActions,
      waitingActions
    }
  };
}
