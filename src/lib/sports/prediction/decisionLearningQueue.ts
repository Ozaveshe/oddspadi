import { hasConfiguredEnv } from "@/lib/env";
import type { CalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionLearningQueueStatus = "ready" | "blocked" | "waiting";
export type DecisionLearningTaskStatus = "ready" | "blocked" | "waiting";
export type DecisionLearningTaskCategory = "persist-decision" | "settle-outcome" | "run-calibration" | "run-backtest" | "backfill-corpus" | "read-memory";
export type DecisionLearningTaskPriority = "critical" | "high" | "medium" | "low";

export type DecisionLearningTask = {
  id: string;
  category: DecisionLearningTaskCategory;
  priority: DecisionLearningTaskPriority;
  status: DecisionLearningTaskStatus;
  title: string;
  detail: string;
  command: string;
  verifyUrl: string;
  missingEnv: string[];
  expectedEvidence: string;
  learningImpact: string;
  affectedMatches: number;
};

export type DecisionLearningQueue = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionLearningQueueStatus;
  summary: string;
  tasks: DecisionLearningTask[];
  nextTask: DecisionLearningTask | null;
  readyTasks: number;
  blockedTasks: number;
  waitingTasks: number;
  feedbackState: {
    memoryStatus: DecisionMemorySnapshot["status"];
    outcomesTracked: number;
    settledOutcomes: number;
    pendingOutcomes: number;
    calibrationStatus: CalibrationSnapshot["status"];
    calibrationSampleSize: number;
    trainingStatus: TrainingDataSnapshot["status"];
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    latestBacktest: string | null;
  };
  learningQuestions: string[];
};

type EnvMap = Record<string, string | undefined>;

function envConfigured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function missingEnv(env: EnvMap, keys: string[]): string[] {
  return keys.filter((key) => !envConfigured(env, key));
}

function supabaseMissing(readiness: DecisionEngineReadiness | null, env: EnvMap): string[] {
  const missing = missingEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!readiness) return missing;
  if (readiness.supabase.status === "ready") return missing;
  return Array.from(new Set([...missing, "SUPABASE_SERVICE_ROLE_KEY"]));
}

function taskStatus(requiredEnv: string[], wait: boolean): DecisionLearningTaskStatus {
  if (requiredEnv.length) return "blocked";
  return wait ? "waiting" : "ready";
}

function command(method: "GET" | "POST", url: string, requiresAdmin = false, body?: string): string {
  const header = requiresAdmin ? ' -H "x-oddspadi-admin-token: <ODDSPADI_ADMIN_TOKEN>"' : "";
  const bodyPart = body ? ` -H "content-type: application/json" --data '${body}'` : "";
  return method === "POST" ? `curl.exe -sS -X POST${header}${bodyPart} "${decisionApiUrl(url)}"` : `curl.exe -sS "${decisionApiUrl(url)}"`;
}

function candidateRows(rows: DecisionRow[]): DecisionRow[] {
  return rows
    .filter((row) => row.prediction.decision.evaluationPlan.status !== "no-action")
    .slice()
    .sort((a, b) => b.prediction.decision.decisionScore - a.prediction.decision.decisionScore);
}

function outcomeBody(row: DecisionRow): string {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  return JSON.stringify({
    fixtureExternalId: row.match.id,
    sport: row.match.sport,
    market: bestPick.hasValue ? bestPick.marketId : decision.evaluationPlan.settlementMarket,
    selection: bestPick.hasValue ? bestPick.selectionId : decision.recommendedSelection ?? "no-selection",
    modelProbability: bestPick.hasValue ? bestPick.modelProbability : decision.evaluationPlan.modelProbability,
    impliedProbability: bestPick.hasValue ? bestPick.noVigImpliedProbability : decision.evaluationPlan.breakEvenProbability,
    valueEdge: bestPick.hasValue ? bestPick.edge : null,
    odds: bestPick.hasValue ? bestPick.odds : null,
    result: "pending",
    source: "operator"
  });
}

function sortTasks(tasks: DecisionLearningTask[]): DecisionLearningTask[] {
  const priorityRank: Record<DecisionLearningTaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<DecisionLearningTaskStatus, number> = { ready: 3, waiting: 2, blocked: 1 };
  return tasks
    .slice()
    .sort((a, b) => {
      const priority = priorityRank[b.priority] - priorityRank[a.priority];
      if (priority !== 0) return priority;
      const status = statusRank[b.status] - statusRank[a.status];
      if (status !== 0) return status;
      return b.affectedMatches - a.affectedMatches;
    });
}

export function buildDecisionLearningQueue({
  rows,
  date,
  sport,
  memory,
  calibration,
  training,
  readiness = null,
  env = process.env
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  memory: DecisionMemorySnapshot;
  calibration: CalibrationSnapshot;
  training: TrainingDataSnapshot;
  readiness?: DecisionEngineReadiness | null;
  env?: EnvMap;
}): DecisionLearningQueue {
  const candidates = candidateRows(rows);
  const topCandidate = candidates[0] ?? rows[0] ?? null;
  const supabaseEnv = supabaseMissing(readiness, env);
  const adminEnv = missingEnv(env, ["ODDSPADI_ADMIN_TOKEN"]);
  const apiFootballEnv = missingEnv(env, ["API_FOOTBALL_KEY"]);
  const oddsEnv = missingEnv(env, ["THE_ODDS_API_KEY"]);
  const tasks: DecisionLearningTask[] = [];

  tasks.push({
    id: "read-decision-memory",
    category: "read-memory",
    priority: memory.status === "failed" ? "critical" : memory.status === "not-configured" ? "high" : "low",
    status: taskStatus(supabaseEnv, memory.status === "ready"),
    title: "Read decision memory",
    detail: memory.reason ?? memory.learningLoop.detail,
    command: command("GET", "/api/sports/decision/memory"),
    verifyUrl: "/api/sports/decision/memory",
    missingEnv: supabaseEnv,
    expectedEvidence: "Decision memory returns recent runs, learning-loop counts, and replayable brain traces.",
    learningImpact: "Unlocks case-memory comparison and prevents the engine from repeating weak historical patterns.",
    affectedMatches: rows.length
  });

  if (topCandidate) {
    tasks.push({
      id: "persist-current-candidate",
      category: "persist-decision",
      priority: topCandidate.prediction.decision.controlPolicy.persistAllowed ? "high" : "medium",
      status: taskStatus(supabaseEnv, !topCandidate.prediction.decision.controlPolicy.persistAllowed),
      title: "Persist current decision candidate",
      detail: `Store ${topCandidate.match.homeTeam.name} vs ${topCandidate.match.awayTeam.name} so future decisions can compare reliability and replay the brain trace.`,
      command: command("GET", `/api/sports/decision/${encodeURIComponent(topCandidate.match.id)}?persist=1`),
      verifyUrl: "/api/sports/decision/memory",
      missingEnv: supabaseEnv,
      expectedEvidence: "Memory run count increases and the stored run includes model snapshot, brain trace, odds edge, and control policy.",
      learningImpact: "Creates the case-memory row that later calibration and similar-case scoring can learn from.",
      affectedMatches: 1
    });

    tasks.push({
      id: "open-outcome-ticket",
      category: "settle-outcome",
      priority: "high",
      status: taskStatus([...adminEnv, ...supabaseEnv], false),
      title: "Open pending outcome ticket",
      detail: `Create a pending outcome record for ${topCandidate.match.homeTeam.name} vs ${topCandidate.match.awayTeam.name}, then settle it after the result and closing odds are known.`,
      command: command("POST", "/api/sports/decision/outcomes", true, outcomeBody(topCandidate)),
      verifyUrl: "/api/sports/decision/memory",
      missingEnv: [...adminEnv, ...supabaseEnv],
      expectedEvidence: "Learning loop pending outcome count increases, then settled count increases after result entry.",
      learningImpact: "Turns a prediction into measurable calibration, ROI, Brier score, and closing-line value evidence.",
      affectedMatches: 1
    });
  }

  tasks.push({
    id: "run-calibration",
    category: "run-calibration",
    priority: memory.learningLoop.readyForCalibration ? "critical" : "medium",
    status: taskStatus([...adminEnv, ...supabaseEnv], !memory.learningLoop.readyForCalibration),
    title: "Run calibration update",
    detail: memory.learningLoop.readyForCalibration
      ? "Enough settled outcomes are available to refresh measured calibration."
      : memory.learningLoop.detail,
    command: command("POST", `/api/sports/decision/calibration?sport=${encodeURIComponent(sport)}`, true),
    verifyUrl: "/api/sports/decision/calibration",
    missingEnv: [...adminEnv, ...supabaseEnv],
    expectedEvidence: "Calibration endpoint stores a run with sample size, settled size, Brier score, ROI, CLV, and confidence/health buckets.",
    learningImpact: "Updates reliability scoring so future decisions can discount weak confidence bands or fragile health states.",
    affectedMatches: memory.learningLoop.settledOutcomes
  });

  tasks.push({
    id: `run-${sport}-backtest`,
    category: "run-backtest",
    priority: training.readiness.readyForTraining ? "critical" : "medium",
    status: taskStatus([...adminEnv, ...supabaseEnv], !training.readiness.readyForTraining),
    title: `Run real-data ${sport} backtest`,
    detail: training.readiness.detail,
    command: command("POST", `/api/sports/decision/training?sport=${encodeURIComponent(sport)}&minSample=30&limit=5000`, true),
    verifyUrl: "/api/sports/decision/training",
    missingEnv: [...adminEnv, ...supabaseEnv],
    expectedEvidence: "Training endpoint stores a real-data backtest with learned thresholds, Brier score, yield, and closing-line value.",
    learningImpact: "Allows the live decision engine to activate learned minimum-edge and weighting guardrails.",
    affectedMatches: training.counts.realFinishedFixtures
  });

  tasks.push({
    id: "backfill-real-corpus",
    category: "backfill-corpus",
    priority: training.readiness.readyForTraining ? "low" : "critical",
    status: taskStatus([...adminEnv, ...apiFootballEnv, ...oddsEnv], false),
    title: "Backfill real training corpus",
    detail: `Real corpus has ${training.counts.realFinishedFixtures}/${training.readiness.minimumRecommendedFixtures} finished fixtures and ${training.counts.realOddsSnapshots} odds snapshots.`,
    command: command(
      "POST",
      "/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeContext=1&maxJobs=1&dryRun=1",
      true
    ),
    verifyUrl: "/api/sports/decision/training/corpus-plan",
    missingEnv: [...adminEnv, ...apiFootballEnv, ...oddsEnv],
    expectedEvidence: "Dry-run returns normalized fixture/context counts before any write-mode import is attempted.",
    learningImpact: "Builds the 10-year real-data base needed for model training, backtests, calibration, and market-edge validation.",
    affectedMatches: Math.max(0, training.readiness.minimumRecommendedFixtures - training.counts.realFinishedFixtures)
  });

  const sortedTasks = sortTasks(tasks);
  const readyTasks = sortedTasks.filter((task) => task.status === "ready").length;
  const blockedTasks = sortedTasks.filter((task) => task.status === "blocked").length;
  const waitingTasks = sortedTasks.filter((task) => task.status === "waiting").length;
  const nextTask = sortedTasks.find((task) => task.status === "ready") ?? sortedTasks.find((task) => task.status === "blocked") ?? sortedTasks[0] ?? null;
  const status: DecisionLearningQueue["status"] = readyTasks ? "ready" : blockedTasks ? "blocked" : "waiting";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "ready"
        ? `Learning queue has ${readyTasks} ready feedback task(s); start with ${nextTask?.title ?? "the top task"}.`
        : status === "blocked"
          ? `Learning queue is blocked on ${blockedTasks} feedback task(s), mostly configuration and provider proof.`
          : "Learning queue is waiting for outcomes, training volume, or calibration readiness.",
    tasks: sortedTasks,
    nextTask,
    readyTasks,
    blockedTasks,
    waitingTasks,
    feedbackState: {
      memoryStatus: memory.status,
      outcomesTracked: memory.learningLoop.outcomesTracked,
      settledOutcomes: memory.learningLoop.settledOutcomes,
      pendingOutcomes: memory.learningLoop.pendingOutcomes,
      calibrationStatus: calibration.status,
      calibrationSampleSize: calibration.latestRun?.sampleSize ?? calibration.currentMetrics?.sampleSize ?? 0,
      trainingStatus: training.status,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots,
      latestBacktest: training.latestBacktest?.id ?? null
    },
    learningQuestions: [
      "Did the stored prediction beat the closing line?",
      "Did the model probability calibrate against the settled result?",
      "Which confidence or health bucket should be discounted next?",
      "Which missing provider signal most often caused avoid or monitor outcomes?",
      "Can the latest real-data backtest safely activate learned thresholds?"
    ]
  };
}
