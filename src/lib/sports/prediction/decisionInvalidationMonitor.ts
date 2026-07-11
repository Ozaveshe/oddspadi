import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionDataIntakeItem, DecisionDataIntakeQueue, DecisionDataIntakePriority } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type EnvMap = Record<string, string | undefined>;

export type DecisionInvalidationMonitorStatus = "clear" | "watching" | "urgent" | "blocked";
export type DecisionInvalidationJobStatus = "ready" | "waiting" | "blocked";
export type DecisionInvalidationJobPriority = "critical" | "high" | "medium" | "low";
export type DecisionInvalidationJobKind =
  | "rerun-decision"
  | "refresh-odds"
  | "refresh-context"
  | "refresh-live-state"
  | "persist-outcome"
  | "governance-check"
  | "data-intake";

export type DecisionInvalidationJob = {
  id: string;
  kind: DecisionInvalidationJobKind;
  priority: DecisionInvalidationJobPriority;
  status: DecisionInvalidationJobStatus;
  matchId: string | null;
  match: string;
  reason: string;
  trigger: string;
  dueAt: string;
  command: string;
  verifyUrl: string;
  missingEnv: string[];
  expectedEvidence: string;
  riskIfIgnored: string;
};

export type DecisionInvalidationWatchItem = {
  matchId: string;
  match: string;
  action: Prediction["decision"]["action"];
  beliefExpiresAt: string;
  snapshotExpiresAt: string;
  nextReviewAt: string;
  monitoringStatus: Prediction["decision"]["monitoringPlan"]["status"];
  monitoringPriority: Prediction["decision"]["monitoringPlan"]["priority"];
  marketMovementStatus: Prediction["decision"]["marketMovement"]["status"];
  dataCoverageStatus: Prediction["decision"]["dataCoverage"]["status"];
  reason: string;
};

export type DecisionInvalidationMonitor = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionInvalidationMonitorStatus;
  summary: string;
  serviceMode: "read-only";
  cadenceMinutes: number;
  jobs: DecisionInvalidationJob[];
  nextJob: DecisionInvalidationJob | null;
  readyJobs: number;
  waitingJobs: number;
  blockedJobs: number;
  expiredBeliefs: number;
  priceAlerts: number;
  dataBlocks: number;
  liveBlocks: number;
  governanceBlocks: number;
  watchlist: DecisionInvalidationWatchItem[];
};

function localUrl(path: string): string {
  return decisionApiUrl(path);
}

function getCommand(path: string): string {
  return `curl.exe -sS "${localUrl(path)}"`;
}

function postCommand(path: string): string {
  return `curl.exe -sS -X POST -H "x-oddspadi-admin-token: <ODDSPADI_ADMIN_TOKEN>" "${localUrl(path)}"`;
}

function oddsSyncPath(date: string): string {
  return `/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=${encodeURIComponent(`${date}T12:00:00Z`)}&dryRun=1`;
}

function contextSyncPath(date: string): string {
  return `/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=${encodeURIComponent(date)}&includeContext=1&includeNews=1&dryRun=1`;
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function configured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function missingAny(env: EnvMap, keys: string[]): string[] {
  return keys.some((key) => configured(env, key)) ? [] : keys;
}

function missingAll(env: EnvMap, keys: string[]): string[] {
  return keys.filter((key) => !configured(env, key));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parsedTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function addMinutes(value: string, minutes: number): string {
  const parsed = parsedTime(value);
  const base = parsed > 0 ? parsed : Date.now();
  return new Date(base + minutes * 60000).toISOString();
}

function earliestIso(values: string[]): string {
  return values
    .filter((value) => parsedTime(value) > 0)
    .sort((a, b) => parsedTime(a) - parsedTime(b))[0] ?? new Date().toISOString();
}

function priorityRank(priority: DecisionInvalidationJobPriority): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[priority];
}

function dataPriority(priority: DecisionDataIntakePriority): DecisionInvalidationJobPriority {
  return priority;
}

function kindRank(kind: DecisionInvalidationJobKind): number {
  return {
    "governance-check": 8,
    "rerun-decision": 7,
    "refresh-odds": 6,
    "refresh-live-state": 5,
    "refresh-context": 4,
    "data-intake": 3,
    "persist-outcome": 2
  }[kind];
}

function statusFor({ dueAt, missingEnv, now }: { dueAt: string; missingEnv: string[]; now: Date }): DecisionInvalidationJobStatus {
  if (missingEnv.length) return "blocked";
  return parsedTime(dueAt) <= now.getTime() ? "ready" : "waiting";
}

function jobSort(a: DecisionInvalidationJob, b: DecisionInvalidationJob): number {
  const statusRank: Record<DecisionInvalidationJobStatus, number> = { ready: 3, blocked: 2, waiting: 1 };
  return (
    statusRank[b.status] - statusRank[a.status] ||
    priorityRank(b.priority) - priorityRank(a.priority) ||
    kindRank(b.kind) - kindRank(a.kind) ||
    parsedTime(a.dueAt) - parsedTime(b.dueAt) ||
    a.kind.localeCompare(b.kind)
  );
}

function visibleJobs(allJobs: DecisionInvalidationJob[], limit: number): DecisionInvalidationJob[] {
  const pinned = [
    ...allJobs.filter((job) => job.kind === "governance-check").slice(0, 1),
    ...allJobs.filter((job) => job.kind === "data-intake" && job.status === "blocked").slice(0, 3),
    ...allJobs.filter((job) => job.kind === "data-intake" && job.status === "ready").slice(0, 2),
    ...allJobs.filter((job) => job.kind === "refresh-odds").slice(0, 2),
    ...allJobs.filter((job) => job.kind === "refresh-live-state").slice(0, 2),
    ...allJobs.filter((job) => job.kind === "rerun-decision").slice(0, 4)
  ];
  return Array.from(new Map([...pinned, ...allJobs].map((job) => [job.id, job])).values()).slice(0, limit).sort(jobSort);
}

function snapshotExpiresAt(row: DecisionRow): string {
  return addMinutes(row.prediction.generatedAt, row.prediction.decision.beliefState.ttlMinutes);
}

function beliefExpired(row: DecisionRow, now: Date): boolean {
  return (
    parsedTime(row.prediction.decision.beliefState.expiresAt) <= now.getTime() ||
    parsedTime(snapshotExpiresAt(row)) <= now.getTime() ||
    row.prediction.decision.monitoringPlan.status === "expired"
  );
}

function marketMissingEnv(env: EnvMap): string[] {
  return unique([...missingAll(env, ["ODDSPADI_ADMIN_TOKEN"]), ...missingAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"])]);
}

function contextMissingEnv(env: EnvMap): string[] {
  return unique([
    ...missingAll(env, ["ODDSPADI_ADMIN_TOKEN"]),
    ...missingAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"])
  ]);
}

function liveMissingEnv(env: EnvMap): string[] {
  return missingAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY", "LIVE_SCORES_API_KEY"]);
}

function governanceMissingEnv(governance: DecisionModelGovernance | null): string[] {
  if (!governance) return [];
  if (governance.trainingCorpus.configured && governance.trainingCorpus.status !== "failed") return [];
  return ["SUPABASE_SERVICE_ROLE_KEY"];
}

function rerunJob(row: DecisionRow, now: Date): DecisionInvalidationJob | null {
  const decision = row.prediction.decision;
  const expired = beliefExpired(row, now);
  const dueReview = parsedTime(decision.monitoringPlan.nextReviewAt) <= now.getTime();
  if (!expired && !dueReview && decision.controlPolicy.status !== "needs-rerun") return null;

  const dueAt = earliestIso([decision.beliefState.expiresAt, snapshotExpiresAt(row), decision.monitoringPlan.nextReviewAt]);
  return {
    id: `rerun-${row.match.id}`,
    kind: "rerun-decision",
    priority: expired || decision.monitoringPlan.priority === "critical" ? "critical" : decision.monitoringPlan.priority,
    status: "ready",
    matchId: row.match.id,
    match: matchLabel(row.match),
    reason: expired ? "Belief snapshot expired." : "Monitoring review is due.",
    trigger: decision.monitoringPlan.summary,
    dueAt,
    command: getCommand(`/api/sports/decision/${encodeURIComponent(row.match.id)}`),
    verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`,
    missingEnv: [],
    expectedEvidence: "A fresh decision report with updated belief expiry, control policy, odds edge, and monitoring plan.",
    riskIfIgnored: "A stale expected-value edge may stay visible after the market, team news, or live state has invalidated it."
  };
}

function priceJob(row: DecisionRow, date: string, env: EnvMap, now: Date): DecisionInvalidationJob | null {
  const movement = row.prediction.decision.marketMovement;
  const monitoring = row.prediction.decision.monitoringPlan;
  const oddsTask = monitoring.tasks.find((task) => task.id === "odds-refresh");
  const shouldRefresh =
    movement.status === "fragile" || movement.status === "sensitive" || movement.alerts.length > 0 || (oddsTask && parsedTime(oddsTask.dueAt) <= now.getTime());
  if (!shouldRefresh) return null;

  const missingEnv = marketMissingEnv(env);
  const dueAt = oddsTask?.dueAt ?? monitoring.nextReviewAt;
  return {
    id: `odds-${row.match.id}`,
    kind: "refresh-odds",
    priority: movement.status === "fragile" ? "critical" : movement.status === "sensitive" ? "high" : oddsTask?.priority ?? "medium",
    status: statusFor({ dueAt, missingEnv, now }),
    matchId: row.match.id,
    match: matchLabel(row.match),
    reason: movement.nextAction,
    trigger: movement.alerts[0] ?? oddsTask?.trigger ?? movement.summary,
    dueAt,
    command: postCommand(oddsSyncPath(date)),
    verifyUrl: "/api/sports/decision/training",
    missingEnv,
    expectedEvidence: "Provider-backed odds snapshots with bookmaker, market, selection, price, no-vig probability, edge, and timestamp.",
    riskIfIgnored: "The model may rank a side as positive EV after bookmaker movement has erased the value."
  };
}

function contextJob(row: DecisionRow, date: string, env: EnvMap, now: Date): DecisionInvalidationJob | null {
  const decision = row.prediction.decision;
  const contextTask = decision.monitoringPlan.tasks.find((task) =>
    ["provider", "team-news", "lineups", "weather", "training"].includes(task.source)
  );
  if (!decision.dataCoverage.requiredBeforeTrust.length && !contextTask) return null;

  const missingEnv = contextMissingEnv(env);
  const dueAt = contextTask?.dueAt ?? decision.monitoringPlan.nextReviewAt;
  return {
    id: `context-${row.match.id}`,
    kind: "refresh-context",
    priority: decision.dataCoverage.status === "insufficient" ? "critical" : contextTask?.priority ?? "high",
    status: statusFor({ dueAt, missingEnv, now }),
    matchId: row.match.id,
    match: matchLabel(row.match),
    reason: decision.dataCoverage.requiredBeforeTrust[0] ?? contextTask?.action ?? "Refresh context before trusting this decision.",
    trigger: contextTask?.trigger ?? decision.dataCoverage.summary,
    dueAt,
    command: postCommand(contextSyncPath(date)),
    verifyUrl: "/api/sports/decision/training",
    missingEnv,
    expectedEvidence: "Provider-backed injuries, suspensions, lineups, standings, news, weather, and fixture context tied to the slate.",
    riskIfIgnored: "The agent may treat missing lineups, injuries, suspensions, news, or weather as neutral when they should change the action."
  };
}

function liveJob(row: DecisionRow, date: string, sport: Sport, env: EnvMap, now: Date): DecisionInvalidationJob | null {
  const decision = row.prediction.decision;
  const liveSignal = decision.dataCoverage.signals.find((signal) => signal.category === "live-scores");
  const liveTask = decision.monitoringPlan.tasks.find((task) => task.id === "live-event-feed");
  const needsLiveRefresh =
    row.match.status === "live" ||
    liveTask !== undefined ||
    (liveSignal !== undefined && ["mock", "missing", "stale"].includes(liveSignal.status));
  if (!needsLiveRefresh) return null;

  const missingEnv = liveMissingEnv(env);
  const dueAt = liveTask?.dueAt ?? decision.monitoringPlan.nextReviewAt;
  return {
    id: `live-${row.match.id}`,
    kind: "refresh-live-state",
    priority: row.match.status === "live" ? "critical" : liveTask?.priority ?? "high",
    status: statusFor({ dueAt, missingEnv, now }),
    matchId: row.match.id,
    match: matchLabel(row.match),
    reason: liveTask?.action ?? "Refresh live score and event state before keeping the decision visible.",
    trigger: liveTask?.trigger ?? liveSignal?.detail ?? "Live score/event freshness can invalidate pre-match probability.",
    dueAt,
    command: getCommand(`/api/sports/live-scores?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`),
    verifyUrl: `/api/sports/live-scores?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
    missingEnv,
    expectedEvidence: "Current score, clock, status, and event feed metadata for in-play fixtures.",
    riskIfIgnored: "A pre-match probability can remain visible during a red card, injury, substitution, score change, or tempo shift."
  };
}

function settlementJob(row: DecisionRow, now: Date): DecisionInvalidationJob | null {
  if (row.match.status !== "finished") return null;
  const dueAt = row.prediction.decision.evaluationPlan.requiredOutcomeSignals.some((signal) => signal.status === "required")
    ? row.match.kickoffTime
    : row.prediction.decision.monitoringPlan.nextReviewAt;

  return {
    id: `settlement-${row.match.id}`,
    kind: "persist-outcome",
    priority: "high",
    status: statusFor({ dueAt, missingEnv: [], now }),
    matchId: row.match.id,
    match: matchLabel(row.match),
    reason: row.prediction.decision.evaluationPlan.postMatchActions[0] ?? "Persist settled outcome and closing-line evidence.",
    trigger: row.prediction.decision.evaluationPlan.summary,
    dueAt,
    command: getCommand(`/api/sports/decision/outcomes?fixtureExternalId=${encodeURIComponent(row.match.id)}`),
    verifyUrl: `/api/sports/decision/outcomes?fixtureExternalId=${encodeURIComponent(row.match.id)}`,
    missingEnv: [],
    expectedEvidence: "Settled result, closing odds, closing-line value, prediction result, and learning labels.",
    riskIfIgnored: "The training loop cannot learn from this decision or audit whether the value thesis beat the closing market."
  };
}

function dataIntakeJob(item: DecisionDataIntakeItem, now: Date): DecisionInvalidationJob {
  const dueAt = new Date(now.getTime()).toISOString();
  const status: DecisionInvalidationJobStatus =
    item.status === "blocked" ? "blocked" : item.status === "needs-provider" ? "ready" : "waiting";

  return {
    id: item.id,
    kind: "data-intake",
    priority: dataPriority(item.priority),
    status,
    matchId: null,
    match: `${item.affectedMatches} affected match${item.affectedMatches === 1 ? "" : "es"}`,
    reason: item.decisionImpact,
    trigger: item.exampleMatches[0] ?? item.label,
    dueAt,
    command: item.command,
    verifyUrl: item.verifyUrl,
    missingEnv: item.missingEnv,
    expectedEvidence: item.expectedEvidence,
    riskIfIgnored: `The slate continues to rely on ${item.mockSignals + item.missingSignals + item.staleSignals} weak ${item.label.toLowerCase()} signal(s).`
  };
}

function governanceJob(governance: DecisionModelGovernance | null, now: Date): DecisionInvalidationJob | null {
  if (!governance || governance.status === "approved") return null;
  const firstAction = governance.nextActions[0] ?? "Rerun model governance after real-data and runtime gaps are resolved.";
  const missingEnv = governanceMissingEnv(governance);
  const dueAt = new Date(now.getTime()).toISOString();

  return {
    id: "model-governance",
    kind: "governance-check",
    priority: governance.status === "blocked" ? "critical" : "high",
    status: statusFor({ dueAt, missingEnv, now }),
    matchId: null,
    match: "Slate governance",
    reason: firstAction,
    trigger: governance.summary,
    dueAt,
    command: getCommand("/api/sports/decision/model-governance"),
    verifyUrl: "/api/sports/decision/model-governance",
    missingEnv,
    expectedEvidence: "Governance passes corpus volume, real odds, feature snapshots, target labels, backtests, runtime storage, and drift checks.",
    riskIfIgnored: "Learned weights or guardrails could influence live picks before the historical corpus and drift evidence are trustworthy."
  };
}

function watchItem(row: DecisionRow): DecisionInvalidationWatchItem {
  const decision = row.prediction.decision;
  const snapshotExpiry = snapshotExpiresAt(row);
  return {
    matchId: row.match.id,
    match: matchLabel(row.match),
    action: decision.action,
    beliefExpiresAt: decision.beliefState.expiresAt,
    snapshotExpiresAt: snapshotExpiry,
    nextReviewAt: decision.monitoringPlan.nextReviewAt,
    monitoringStatus: decision.monitoringPlan.status,
    monitoringPriority: decision.monitoringPlan.priority,
    marketMovementStatus: decision.marketMovement.status,
    dataCoverageStatus: decision.dataCoverage.status,
    reason: decision.monitoringPlan.tasks[0]?.trigger ?? decision.beliefState.summary
  };
}

export function buildDecisionInvalidationMonitor({
  rows,
  date,
  sport,
  dataIntake = null,
  governance = null,
  env = process.env,
  now = new Date(),
  limit = 12
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  dataIntake?: DecisionDataIntakeQueue | null;
  governance?: DecisionModelGovernance | null;
  env?: EnvMap;
  now?: Date;
  limit?: number;
}): DecisionInvalidationMonitor {
  const rowJobs = rows.flatMap((row) =>
    [rerunJob(row, now), priceJob(row, date, env, now), contextJob(row, date, env, now), liveJob(row, date, sport, env, now), settlementJob(row, now)].filter(
      (job): job is DecisionInvalidationJob => Boolean(job)
    )
  );
  const dataJobs = dataIntake?.items.map((item) => dataIntakeJob(item, now)) ?? [];
  const governanceJobs = [governanceJob(governance, now)].filter((job): job is DecisionInvalidationJob => Boolean(job));
  const allJobs = Array.from(new Map([...rowJobs, ...dataJobs, ...governanceJobs].map((job) => [job.id, job])).values())
    .sort(jobSort)
  const jobs = visibleJobs(allJobs, limit);

  const readyJobs = allJobs.filter((job) => job.status === "ready").length;
  const waitingJobs = allJobs.filter((job) => job.status === "waiting").length;
  const blockedJobs = allJobs.filter((job) => job.status === "blocked").length;
  const expiredBeliefs = rows.filter((row) => beliefExpired(row, now)).length;
  const priceAlerts = rows.filter((row) => row.prediction.decision.marketMovement.status === "fragile" || row.prediction.decision.marketMovement.alerts.length > 0).length;
  const dataBlocks = rows.filter((row) => row.prediction.decision.dataCoverage.requiredBeforeTrust.length > 0).length + (dataIntake?.blockedItems ?? 0);
  const liveBlocks = rows.filter((row) => row.match.status === "live").length + jobs.filter((job) => job.kind === "refresh-live-state" && job.status === "blocked").length;
  const governanceBlocks = governance && governance.status !== "approved" ? governance.failingChecks + governance.warningChecks : 0;
  const status: DecisionInvalidationMonitorStatus =
    governance?.status === "blocked" || allJobs.some((job) => job.priority === "critical" && job.status === "blocked")
      ? "blocked"
      : readyJobs || expiredBeliefs || allJobs.some((job) => job.priority === "critical" && job.status === "ready")
        ? "urgent"
        : allJobs.length
          ? "watching"
          : "clear";

  const nextJob = allJobs.find((job) => job.status === "ready") ?? allJobs.find((job) => job.status === "blocked") ?? allJobs[0] ?? null;
  const cadenceMinutes = Math.min(
    ...rows.map((row) => row.prediction.decision.monitoringPlan.reviewCadenceMinutes).filter((value) => value > 0),
    30
  );

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    summary:
      status === "blocked"
        ? `Invalidation monitor is blocked: ${blockedJobs} job(s) need configuration or governance repair before the slate can trust learned/live edges.`
        : status === "urgent"
          ? `Invalidation monitor has ${readyJobs} ready job(s), ${expiredBeliefs} expired belief snapshot(s), and ${priceAlerts} price alert(s).`
          : status === "watching"
            ? `Invalidation monitor is watching ${jobs.length} job(s); next proof is ${nextJob?.kind.replaceAll("-", " ") ?? "none"}.`
            : "Invalidation monitor is clear; no stale beliefs, price alerts, or provider refresh jobs are due.",
    serviceMode: "read-only",
    cadenceMinutes: Number.isFinite(cadenceMinutes) ? cadenceMinutes : 30,
    jobs,
    nextJob,
    readyJobs,
    waitingJobs,
    blockedJobs,
    expiredBeliefs,
    priceAlerts,
    dataBlocks,
    liveBlocks,
    governanceBlocks,
    watchlist: rows
      .filter(
        (row) =>
          beliefExpired(row, now) ||
          row.prediction.decision.monitoringPlan.status !== "active" ||
          row.prediction.decision.marketMovement.status !== "resilient" ||
          row.prediction.decision.dataCoverage.requiredBeforeTrust.length > 0
      )
      .slice(0, 8)
      .map(watchItem)
  };
}
