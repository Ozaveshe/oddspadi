import { hasConfiguredEnv } from "@/lib/env";
import type {
  DecisionMonitoringPriority,
  DecisionSupervisorQueue,
  DecisionSupervisorQueueItem,
  DecisionSupervisorQueueItemStatus,
  DecisionSupervisorRunbook,
  DecisionSupervisorRunbookMode,
  DecisionSupervisorRunbookPreflight,
  DecisionSupervisorRunbookPreflightCheck,
  DecisionSupervisorRunbookStep,
  DecisionSupervisorRunbookStepStatus,
  Match,
  Prediction,
  Sport
} from "@/lib/sports/types";
import { decisionApiUrl, decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type EnvMap = Record<string, string | undefined>;

function priorityWeight(priority: DecisionMonitoringPriority): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusWeight(status: DecisionSupervisorQueueItemStatus): number {
  if (status === "blocked") return 4;
  if (status === "needs-rerun") return 3;
  if (status === "waiting") return 2;
  return 1;
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

function requirementSatisfied(requirement: string, env: EnvMap): boolean {
  const alternatives = requirementAlternatives(requirement);
  return alternatives.length === 0 || alternatives.some((key) => envConfigured(env, key));
}

function isWriteOnlyRequirement(requirement: string): boolean {
  return /\bfor writes?\b/i.test(requirement);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function queueStatusFromControl(status: Prediction["decision"]["controlPolicy"]["status"]): DecisionSupervisorQueueItemStatus {
  if (status === "blocked") return "blocked";
  if (status === "needs-rerun") return "needs-rerun";
  if (status === "monitor-only") return "waiting";
  return "ready";
}

function queuePriorityFromControl(status: Prediction["decision"]["controlPolicy"]["status"]): DecisionMonitoringPriority {
  if (status === "blocked") return "critical";
  if (status === "needs-rerun") return "high";
  if (status === "monitor-only") return "medium";
  return "low";
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function supervisorItemBase(row: DecisionRow) {
  const { match, prediction } = row;
  return {
    matchId: match.id,
    match: matchLabel(match),
    sport: match.sport,
    league: match.league.name,
    country: match.league.country,
    kickoffTime: match.kickoffTime,
    controlStatus: prediction.decision.controlPolicy.status,
    visibility: prediction.decision.controlPolicy.visibility,
    publishAllowed: prediction.decision.controlPolicy.publishAllowed,
    readinessScore: prediction.decision.toolOrchestration.readinessScore,
    blockedTasks: prediction.decision.toolExecution.blockedTasks
  };
}

function buildItemsForRow(row: DecisionRow): DecisionSupervisorQueueItem[] {
  const { prediction } = row;
  const decision = prediction.decision;
  const base = supervisorItemBase(row);
  const items: DecisionSupervisorQueueItem[] = [];
  const primaryGate = decision.controlPolicy.gates.find((gate) => gate.id === decision.controlPolicy.primaryBlockerId);

  if (decision.controlPolicy.status === "publishable") {
    items.push({
      ...base,
      id: `${base.matchId}:publish-candidate`,
      type: "publish-candidate",
      priority: "high",
      status: "ready",
      source: "control-policy",
      label: "Publishable value candidate",
      action: decision.controlPolicy.primaryDirective,
      detail: decision.summary,
      evidencePath: "decision.controlPolicy"
    });
  } else {
    items.push({
      ...base,
      id: `${base.matchId}:control:${decision.controlPolicy.primaryBlockerId ?? "watch"}`,
      type: "control-gate",
      priority: queuePriorityFromControl(decision.controlPolicy.status),
      status: queueStatusFromControl(decision.controlPolicy.status),
      source: primaryGate ? `control:${primaryGate.source}` : "control-policy",
      label: primaryGate?.label ?? "Control policy",
      action: decision.controlPolicy.nextBestAction,
      detail: primaryGate?.detail ?? decision.controlPolicy.summary,
      evidencePath: "decision.controlPolicy"
    });
  }

  const nextTask = decision.toolOrchestration.tasks.find((task) => task.id === decision.toolOrchestration.nextTaskId);
  if (nextTask && (decision.toolOrchestration.status !== "ready" || decision.toolExecution.status !== "complete")) {
    items.push({
      ...base,
      id: `${base.matchId}:tool:${nextTask.id}`,
      type: "tool-task",
      priority: nextTask.priority,
      status: nextTask.status === "waiting" ? "waiting" : nextTask.status === "ready" || nextTask.status === "complete" ? "ready" : "blocked",
      source: nextTask.provider,
      label: nextTask.label,
      action: nextTask.reason,
      detail: nextTask.decisionImpact,
      evidencePath: `decision.toolOrchestration.tasks.${nextTask.id}`
    });
  }

  if (decision.controlPolicy.aiReviewRequired) {
    const reviewTask = decision.toolOrchestration.tasks.find((task) => task.id === "openai-review");
    items.push({
      ...base,
      id: `${base.matchId}:ai-review`,
      type: "ai-review",
      priority: reviewTask?.priority ?? "medium",
      status: reviewTask?.status === "blocked" ? "blocked" : "waiting",
      source: reviewTask?.provider ?? "OpenAI Responses API",
      label: "Guarded AI review",
      action: reviewTask?.reason ?? "Run the guarded AI reviewer after deterministic gates are ready.",
      detail: decision.aiProtocol.reviewerInstructions,
      evidencePath: "decision.aiProtocol"
    });
  }

  if (decision.monitoringPlan.status === "active" || decision.monitoringPlan.status === "watching") {
    const task = decision.monitoringPlan.tasks[0];
    if (task) {
      items.push({
        ...base,
        id: `${base.matchId}:monitoring:${task.id}`,
        type: "monitoring",
        priority: task.priority,
        status: "waiting",
        source: String(task.source),
        label: task.label,
        action: task.action,
        detail: task.trigger,
        evidencePath: "decision.monitoringPlan"
      });
    }
  }

  return items;
}

function urlEncode(value: string): string {
  return encodeURIComponent(value);
}

function commandFor(method: "GET" | "POST", url: string, requiresAdminToken: boolean): string {
  const header = requiresAdminToken ? ' -H "x-oddspadi-admin-token: <ODDSPADI_ADMIN_TOKEN>"' : "";
  const targetUrl = url.startsWith("/") ? decisionApiUrl(url) : url;
  return method === "POST" ? `curl.exe -sS -X POST${header} "${targetUrl}"` : `curl.exe -sS${header} "${targetUrl}"`;
}

function runbookStep({
  id,
  label,
  status,
  method,
  url,
  requiresAdminToken,
  requiredEnv,
  detail,
  expectedResult
}: Omit<DecisionSupervisorRunbookStep, "command">): DecisionSupervisorRunbookStep {
  return {
    id,
    label,
    status,
    method,
    url,
    requiresAdminToken,
    requiredEnv,
    detail,
    expectedResult,
    command: commandFor(method, url, requiresAdminToken)
  };
}

function chooseRunbookTarget(items: DecisionSupervisorQueueItem[]): DecisionSupervisorQueueItem | null {
  const first = items[0] ?? null;
  if (!first) return null;
  if (first.type === "control-gate" && first.label.toLowerCase().includes("tool")) {
    return items.find((item) => item.matchId === first.matchId && item.type === "tool-task") ?? items.find((item) => item.type === "tool-task") ?? first;
  }
  return first;
}

function stepForToolTask(item: DecisionSupervisorQueueItem, date: string): DecisionSupervisorRunbookStep {
  const lower = `${item.id} ${item.label} ${item.action}`.toLowerCase();
  if (lower.includes("odds")) {
    const url =
      `/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=${urlEncode(
        `${date}T12:00:00Z`
      )}&dryRun=1`;
    return runbookStep({
      id: "dry-run-odds-sync",
      label: "Dry-run historical odds sync",
      status: "requires-config",
      method: "POST",
      url,
      requiresAdminToken: true,
      requiredEnv: ["ODDSPADI_ADMIN_TOKEN", "THE_ODDS_API_KEY or ODDS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY for writes"],
      detail: "Validates odds-provider access and normalized h2h odds mapping without storing rows.",
      expectedResult: "Returns dry-run counts for odds snapshots and normalized selections."
    });
  }
  if (lower.includes("lineup") || lower.includes("injur") || lower.includes("suspension") || lower.includes("context") || lower.includes("weather")) {
    const url =
      "/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=2025-08-01&includeEvents=1&includeContext=1&includeNews=1&dryRun=1";
    return runbookStep({
      id: "dry-run-context-sync",
      label: "Dry-run football context sync",
      status: "requires-config",
      method: "POST",
      url,
      requiresAdminToken: true,
      requiredEnv: ["ODDSPADI_ADMIN_TOKEN", "API_FOOTBALL_KEY or APISPORTS_KEY", "NEWS_API_KEY for news", "WEATHER_API_KEY for weather"],
      detail: "Validates fixture context, standings, injuries, suspensions, lineups, events, news, and weather normalization.",
      expectedResult: "Returns dry-run counts for context rows before any storage is attempted."
    });
  }
  if (lower.includes("live")) {
    const url = `/api/sports/live-scores?date=${urlEncode(date)}&sport=${urlEncode(item.sport)}`;
    return runbookStep({
      id: "read-live-state",
      label: "Read live scores and events",
      status: "ready",
      method: "GET",
      url,
      requiresAdminToken: false,
      requiredEnv: ["API_FOOTBALL_KEY or APISPORTS_KEY for provider-backed live data"],
      detail: "Checks current live-score route and provider fallback behavior.",
      expectedResult: "Returns live, finished, or scheduled matches with any available score/event context."
    });
  }
  if (lower.includes("training")) {
    return runbookStep({
      id: "read-training-readiness",
      label: "Read training corpus readiness",
      status: "ready",
      method: "GET",
      url: "/api/sports/decision/training",
      requiresAdminToken: false,
      requiredEnv: ["SUPABASE_SERVICE_ROLE_KEY for live corpus reads"],
      detail: "Checks whether the historical corpus and latest backtest are available.",
      expectedResult: "Returns fixture, odds, event, context, feature, and backtest counts."
    });
  }
  if (lower.includes("memory")) {
    return runbookStep({
      id: "read-decision-memory",
      label: "Read decision memory",
      status: "ready",
      method: "GET",
      url: "/api/sports/decision/memory",
      requiresAdminToken: false,
      requiredEnv: ["SUPABASE_SERVICE_ROLE_KEY for live memory reads"],
      detail: "Checks stored decision runs and calibration readiness.",
      expectedResult: "Returns recent decision-memory runs and learning-loop status."
    });
  }
  const url = "/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeContext=1&maxJobs=1&dryRun=1";
  return runbookStep({
    id: "dry-run-football-backfill",
    label: "Dry-run football history backfill",
    status: "requires-config",
    method: "POST",
    url,
    requiresAdminToken: true,
    requiredEnv: ["ODDSPADI_ADMIN_TOKEN", "API_FOOTBALL_KEY or APISPORTS_KEY", "SUPABASE_SERVICE_ROLE_KEY for writes"],
    detail: "Validates the first capped historical fixture/context backfill job without storing rows.",
    expectedResult: "Returns dry-run backfill job counts for fixtures, teams, features, and optional context."
  });
}

function stepForItem(item: DecisionSupervisorQueueItem, date: string): DecisionSupervisorRunbookStep {
  if (item.type === "tool-task") return stepForToolTask(item, date);
  if (item.type === "ai-review") {
    return runbookStep({
      id: "run-guarded-ai-review",
      label: "Run guarded AI review",
      status: "requires-config",
      method: "GET",
      url: `/api/sports/decision/${urlEncode(item.matchId)}?agent=1`,
      requiresAdminToken: false,
      requiredEnv: ["OPENAI_API_KEY"],
      detail: "Runs the structured no-upgrade AI reviewer against the selected match.",
      expectedResult: "Returns aiAgent.status reviewed, provider-error, invalid-response, or not-configured."
    });
  }
  if (item.type === "publish-candidate") {
    return runbookStep({
      id: "review-and-persist-candidate",
      label: "Review and persist candidate",
      status: "requires-config",
      method: "GET",
      url: `/api/sports/decision/${urlEncode(item.matchId)}?agent=1&persist=1`,
      requiresAdminToken: false,
      requiredEnv: ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"],
      detail: "Runs guarded AI review and persists the final decision if Supabase writes are configured.",
      expectedResult: "Returns a final decision with aiAgent audit and persistence status."
    });
  }
  if (item.type === "monitoring") {
    return runbookStep({
      id: "read-match-decision",
      label: "Read match decision",
      status: "ready",
      method: "GET",
      url: `/api/sports/decision/${urlEncode(item.matchId)}`,
      requiresAdminToken: false,
      requiredEnv: [],
      detail: "Refreshes the deterministic decision for the monitored match.",
      expectedResult: "Returns the latest deterministic decision report."
    });
  }
  return runbookStep({
    id: "inspect-control-gate",
    label: "Inspect control gate",
    status: "ready",
    method: "GET",
    url: `/api/sports/decision/${urlEncode(item.matchId)}`,
    requiresAdminToken: false,
    requiredEnv: [],
    detail: "Reads the full decision so the primary control blocker can be inspected before action.",
    expectedResult: "Returns decision.controlPolicy with the current gate states."
  });
}

function buildNoTargetPreflight(): DecisionSupervisorRunbookPreflight {
  return {
    status: "warning",
    canRunPrimaryCommand: false,
    missingEnv: [],
    warnings: ["No supervisor item is available yet."],
    checks: [
      {
        id: "queue-target",
        label: "Queue target",
        status: "warn",
        detail: "No primary supervisor item exists for this slate.",
        requiredAction: "Refresh the queue after fixtures or provider data arrive."
      }
    ],
    summary: "No primary command can run until the supervisor queue has a target."
  };
}

function buildRunbookPreflight({
  primaryStep,
  mode,
  env
}: {
  primaryStep: DecisionSupervisorRunbookStep;
  mode: DecisionSupervisorRunbookMode;
  env: EnvMap;
}): DecisionSupervisorRunbookPreflight {
  const missingCritical = primaryStep.requiredEnv.filter((requirement) => {
    if (requirementSatisfied(requirement, env)) return false;
    return !(mode === "dry-run" && isWriteOnlyRequirement(requirement));
  });
  const missingDeferred = primaryStep.requiredEnv.filter(
    (requirement) => !requirementSatisfied(requirement, env) && mode === "dry-run" && isWriteOnlyRequirement(requirement)
  );
  const missingEnv = uniqueValues([...missingCritical, ...missingDeferred]);
  const checks: DecisionSupervisorRunbookPreflightCheck[] = [];

  checks.push({
    id: "required-env",
    label: "Required environment",
    status: missingCritical.length ? "fail" : missingDeferred.length ? "warn" : "pass",
    detail: missingCritical.length
      ? `Missing required env: ${missingCritical.join(", ")}.`
      : missingDeferred.length
        ? `Dry-run can start, but later writes still need: ${missingDeferred.join(", ")}.`
        : "All env requirements for the primary command are present.",
    requiredAction: missingCritical.length
      ? `Set ${missingCritical.join(", ")} in local/Netlify env before running the command.`
      : missingDeferred.length
        ? `Set ${missingDeferred.join(", ")} before switching from dry-run to writes.`
        : null
  });

  checks.push({
    id: "admin-token",
    label: "Admin token",
    status: primaryStep.requiresAdminToken && !envConfigured(env, "ODDSPADI_ADMIN_TOKEN") ? "fail" : "pass",
    detail: primaryStep.requiresAdminToken
      ? "This command requires the x-oddspadi-admin-token header."
      : "This command does not require an admin header.",
    requiredAction:
      primaryStep.requiresAdminToken && !envConfigured(env, "ODDSPADI_ADMIN_TOKEN")
        ? "Set ODDSPADI_ADMIN_TOKEN and pass the matching x-oddspadi-admin-token header."
        : null
  });

  const isDryRunCommand = primaryStep.url.includes("dryRun=1") || primaryStep.method === "GET";
  checks.push({
    id: "write-safety",
    label: "Write safety",
    status: isDryRunCommand ? (mode === "write-gated" ? "warn" : "pass") : "fail",
    detail: isDryRunCommand
      ? mode === "write-gated"
        ? "The command is write-gated and needs operator review before use."
        : "The primary command is read-only or explicitly dry-run."
      : "The primary command can mutate state without dryRun=1.",
    requiredAction: isDryRunCommand
      ? mode === "write-gated"
        ? "Review the candidate and persistence target before running."
        : null
      : "Change the command to a read-only or dry-run endpoint first."
  });

  checks.push({
    id: "localhost-target",
    label: "Local target",
    status: primaryStep.command.includes(decisionSiteOrigin()) ? "pass" : "warn",
    detail: primaryStep.command.includes(decisionSiteOrigin())
      ? "The command targets the active local OddsPadi server."
      : "The command does not point at the expected local OddsPadi server.",
    requiredAction: primaryStep.command.includes(decisionSiteOrigin())
      ? null
      : `Run the command against ${decisionSiteOrigin()} while developing locally.`
  });

  const warnings = [
    ...missingDeferred.map((requirement) => `Deferred write env missing: ${requirement}.`),
    ...(mode === "write-gated" ? ["Primary command is write-gated and needs operator review."] : [])
  ];
  const status: DecisionSupervisorRunbookPreflight["status"] = checks.some((check) => check.status === "fail")
    ? "blocked"
    : checks.some((check) => check.status === "warn")
      ? "warning"
      : "ready";
  const canRunPrimaryCommand = status !== "blocked" && primaryStep.status !== "manual-review";

  return {
    status,
    canRunPrimaryCommand,
    missingEnv,
    warnings,
    checks,
    summary:
      status === "ready"
        ? "Preflight passed; the primary command can run."
        : status === "warning"
          ? "Preflight has warnings; review them before running the primary command."
          : `Preflight blocked; set required config before running: ${missingCritical.join(", ")}.`
  };
}

function buildRunbook(items: DecisionSupervisorQueueItem[], date: string, env: EnvMap): DecisionSupervisorRunbook {
  const target = chooseRunbookTarget(items);
  if (!target) {
    return {
      generatedAt: new Date().toISOString(),
      status: "waiting",
      mode: "read-only",
      targetItemId: null,
      title: "No supervisor action queued",
      summary: "No queue item is currently available for a runbook.",
      primaryCommand: null,
      preflight: buildNoTargetPreflight(),
      steps: [],
      safetyChecks: ["Keep monitoring readiness and rerun the queue when new matches or provider data arrive."],
      expectedStateChange: "No state change.",
      abortConditions: ["Do not run write-gated endpoints without an explicit admin token and dry-run proof."]
    };
  }
  const primaryStep = stepForItem(target, date);
  const verifyStep = runbookStep({
    id: "verify-supervisor-queue",
    label: "Verify supervisor queue after action",
    status: "ready",
    method: "GET",
    url: `/api/sports/decision/supervisor?date=${urlEncode(date)}&sport=${urlEncode(target.sport)}`,
    requiresAdminToken: false,
    requiredEnv: [],
    detail: "Rebuilds the queue to confirm whether the top blocker moved or cleared.",
    expectedResult: "Returns a queue with updated nextItem, blocked counts, and runbook target."
  });
  const mode: DecisionSupervisorRunbookMode = primaryStep.requiresAdminToken ? "dry-run" : target.type === "publish-candidate" ? "write-gated" : "read-only";
  const preflight = buildRunbookPreflight({ primaryStep, mode, env });
  const runbookStatus: DecisionSupervisorRunbook["status"] =
    preflight.status === "blocked" ? "blocked" : target.status === "waiting" ? "waiting" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    status: runbookStatus,
    mode,
    targetItemId: target.id,
    title: `${target.label} for ${target.match}`,
    summary:
      runbookStatus === "ready"
        ? `Runbook is ready for ${target.match}: ${primaryStep.label}.`
        : runbookStatus === "waiting"
          ? `Runbook is waiting for ${target.match}: ${target.action}`
          : preflight.summary,
    primaryCommand: primaryStep.command,
    preflight,
    steps: [primaryStep, verifyStep],
    safetyChecks: [
      "Start with dry-run or read-only endpoints.",
      "Do not pass dryRun=0 until provider quotas, Supabase credentials, and normalized counts are reviewed.",
      "Do not publish a value candidate unless controlPolicy.publishAllowed is true.",
      "Do not invent provider data when a route returns not-configured."
    ],
    expectedStateChange:
      target.type === "tool-task"
        ? "Provider or corpus readiness should move the target task toward executed/ready after configuration and rerun."
        : target.type === "ai-review"
          ? "AI-review status should move from required/skipped to reviewed after OpenAI is configured."
          : "Supervisor queue should move to the next blocker or candidate after rerun.",
    abortConditions: [
      "Abort if required env keys are missing.",
      "Abort if provider dry-run returns provider-error or invalid-request.",
      "Abort if the queue still points to the same blocker after a claimed successful write."
    ]
  };
}

export function buildDecisionSupervisorQueue({
  rows,
  date,
  sport,
  limit = 12,
  env = process.env
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
  env?: EnvMap;
}): DecisionSupervisorQueue {
  const allItems = rows.flatMap(buildItemsForRow);
  const items = allItems
    .slice()
    .sort((a, b) => {
      const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const statusDiff = statusWeight(b.status) - statusWeight(a.status);
      if (statusDiff !== 0) return statusDiff;
      return new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime();
    })
    .slice(0, limit);
  const publishable = rows.filter((row) => row.prediction.decision.controlPolicy.status === "publishable").length;
  const monitorOnly = rows.filter((row) => row.prediction.decision.controlPolicy.status === "monitor-only").length;
  const needsRerun = rows.filter((row) => row.prediction.decision.controlPolicy.status === "needs-rerun").length;
  const blocked = rows.filter((row) => row.prediction.decision.controlPolicy.status === "blocked").length;
  const aiReviewRequired = rows.filter((row) => row.prediction.decision.controlPolicy.aiReviewRequired).length;
  const toolBlocked = rows.filter((row) => row.prediction.decision.toolExecution.status === "blocked").length;
  const status: DecisionSupervisorQueue["status"] = blocked || toolBlocked ? "blocked" : needsRerun || monitorOnly || aiReviewRequired ? "active" : "clear";
  const nextItem = items[0] ?? null;
  const runbook = buildRunbook(items, date, env);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    totalMatches: rows.length,
    publishable,
    monitorOnly,
    needsRerun,
    blocked,
    aiReviewRequired,
    toolBlocked,
    nextItem,
    runbook,
    items,
    summary:
      status === "clear"
        ? `Supervisor queue is clear: ${publishable}/${rows.length} match(es) are publishable and no blocker owns the slate.`
        : status === "active"
          ? `Supervisor queue is active: ${needsRerun} rerun, ${monitorOnly} monitor-only, and ${aiReviewRequired} AI-review task(s) remain.`
          : `Supervisor queue is blocked: ${blocked} match(es) blocked and ${toolBlocked} match(es) have blocked tool execution; next item ${
              nextItem?.label ?? "none"
            }.`
  };
}
