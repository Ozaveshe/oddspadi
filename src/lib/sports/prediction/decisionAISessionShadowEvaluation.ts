import type { CalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import type { DecisionAISession } from "@/lib/sports/prediction/decisionAISession";
import type { DecisionLearningQueue, DecisionLearningTask } from "@/lib/sports/prediction/decisionLearningQueue";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { inspectRuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionAISessionShadowEvaluationStatus = "ready-shadow" | "waiting" | "blocked";
export type DecisionAISessionShadowEvaluationGateStatus = "pass" | "watch" | "block";

export type DecisionAISessionShadowEvaluationGate = {
  id: "session-review" | "outcome-ticket" | "calibration" | "historical-backtest" | "real-corpus" | "learning-permission";
  label: string;
  status: DecisionAISessionShadowEvaluationGateStatus;
  score: number;
  reason: string;
  requiredEvidence: string[];
};

export type DecisionAISessionShadowEvaluationCommand = {
  id: string;
  label: string;
  command: string | null;
  verifyUrl: string;
  status: DecisionAISessionShadowEvaluationGateStatus;
  expectedEvidence: string;
};

export type DecisionAISessionShadowEvaluation = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-session-shadow-evaluation";
  status: DecisionAISessionShadowEvaluationStatus;
  evaluationHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    action: DecisionAction;
    trustCeiling: DecisionAISession["metareasoning"]["trustCeiling"];
    reviewStatus: DecisionAISession["latestRun"]["status"];
  };
  scorecard: {
    learningReadinessScore: number;
    sessionEvidenceDebt: number;
    sessionContradictions: number;
    evidencePacketItems: number;
    outcomesTracked: number;
    settledOutcomes: number;
    pendingOutcomes: number;
    calibrationSampleSize: number;
    brierScore: number | null;
    backtestRuns: number;
    backtestSampleSize: number;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
  };
  gates: DecisionAISessionShadowEvaluationGate[];
  nextEvaluationTask: DecisionLearningTask | null;
  shadowGradePlan: {
    settlementMarket: string | null;
    selection: string | null;
    modelProbability: number | null;
    impliedProbability: number | null;
    valueEdge: number | null;
    successCriteria: string[];
    failureCriteria: string[];
  };
  commands: DecisionAISessionShadowEvaluationCommand[];
  controls: {
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canOpenOutcome: false;
    canApplyLearnedGuardrails: false;
  };
  proofUrls: string[];
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

function compact(value: string, maxLength = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gateStatusFromScore(score: number): DecisionAISessionShadowEvaluationGateStatus {
  if (score >= 72) return "pass";
  if (score >= 38) return "watch";
  return "block";
}

function taskById(queue: DecisionLearningQueue, id: string): DecisionLearningTask | null {
  return queue.tasks.find((task) => task.id === id) ?? null;
}

function taskGateStatus(task: DecisionLearningTask | null, waitingScore = 45): { status: DecisionAISessionShadowEvaluationGateStatus; score: number } {
  if (!task) return { status: "block", score: 0 };
  if (task.status === "ready") return { status: "watch", score: waitingScore };
  if (task.status === "waiting") return { status: "watch", score: Math.max(30, waitingScore - 12) };
  return { status: "block", score: 12 };
}

function sessionReviewGate(session: DecisionAISession): DecisionAISessionShadowEvaluationGate {
  const score =
    session.latestRun.status === "reviewed"
      ? 82
      : session.latestRun.status === "not-configured" || session.latestRun.status === "not-requested"
        ? 34
        : 12;
  return {
    id: "session-review",
    label: "Session review",
    status: gateStatusFromScore(score),
    score,
    reason:
      session.latestRun.status === "reviewed"
        ? `Top-level session review completed with verdict ${session.review?.reviewVerdict ?? "unknown"}.`
        : session.latestRun.reason ?? "Top-level session review has not produced a live reviewed result yet.",
    requiredEvidence: unique([
      session.latestRun.status === "reviewed" ? null : "Configure OpenAI and rerun the top-level session review.",
      ...session.metareasoning.requiredEvidence.slice(0, 4)
    ])
  };
}

function outcomeGate(queue: DecisionLearningQueue): DecisionAISessionShadowEvaluationGate {
  const task = taskById(queue, "open-outcome-ticket");
  const base = taskGateStatus(task, queue.feedbackState.pendingOutcomes > 0 || queue.feedbackState.settledOutcomes > 0 ? 64 : 42);
  return {
    id: "outcome-ticket",
    label: "Outcome ticket",
    status: base.status,
    score: base.score,
    reason:
      queue.feedbackState.outcomesTracked > 0
        ? `${queue.feedbackState.outcomesTracked} outcome record(s) exist, with ${queue.feedbackState.pendingOutcomes} pending and ${queue.feedbackState.settledOutcomes} settled.`
        : task?.detail ?? "No outcome ticket exists for the active session yet.",
    requiredEvidence: unique([task?.expectedEvidence, ...(task?.missingEnv.map((key) => `Configure ${key}.`) ?? [])])
  };
}

function calibrationGate(calibration: CalibrationSnapshot, queue: DecisionLearningQueue): DecisionAISessionShadowEvaluationGate {
  const sampleSize = calibration.latestRun?.sampleSize ?? calibration.currentMetrics?.sampleSize ?? 0;
  const settledSize = calibration.latestRun?.settledSize ?? calibration.currentMetrics?.settledSize ?? queue.feedbackState.settledOutcomes;
  const score = calibration.status === "ready" && sampleSize >= 30 ? 82 : settledSize > 0 ? 46 : calibration.status === "failed" ? 10 : 24;
  const task = taskById(queue, "run-calibration");
  return {
    id: "calibration",
    label: "Calibration",
    status: gateStatusFromScore(score),
    score,
    reason:
      calibration.status === "ready"
        ? `Calibration has sample ${sampleSize}, settled ${settledSize}, and Brier ${calibration.latestRun?.brierScore ?? calibration.currentMetrics?.brierScore ?? "n/a"}.`
        : calibration.reason ?? task?.detail ?? "Calibration is not available yet.",
    requiredEvidence: unique([sampleSize >= 30 ? null : "Collect at least 30 settled outcomes before trusting calibration.", task?.expectedEvidence])
  };
}

function backtestGate(training: TrainingDataSnapshot, queue: DecisionLearningQueue): DecisionAISessionShadowEvaluationGate {
  const sampleSize = training.latestBacktest?.sampleSize ?? 0;
  const runtimeBacktest = inspectRuntimeBacktestEvidence(training.sport, training.latestBacktest);
  const score = runtimeBacktest.exactRuntimeParity && sampleSize >= 1000 ? 86 : runtimeBacktest.completed ? 38 : training.status === "ready" ? 24 : 10;
  const task = taskById(queue, `run-${training.sport}-backtest`);
  return {
    id: "historical-backtest",
    label: "Historical backtest",
    status: gateStatusFromScore(score),
    score,
    reason: training.latestBacktest
      ? `Latest backtest ${training.latestBacktest.id} has sample ${sampleSize}, pick count ${training.latestBacktest.pickCount}, Brier ${training.latestBacktest.brierScore ?? "n/a"}, and compatibility ${runtimeBacktest.compatibility}.`
      : training.reason ?? training.readiness.detail,
    requiredEvidence: unique([
      runtimeBacktest.exactRuntimeParity && sampleSize >= 1000
        ? null
        : "Run a production-scale chronological backtest through the current runtime entrypoint.",
      task?.expectedEvidence
    ])
  };
}

function realCorpusGate(training: TrainingDataSnapshot, queue: DecisionLearningQueue): DecisionAISessionShadowEvaluationGate {
  const fixtureRatio = training.readiness.minimumRecommendedFixtures
    ? training.counts.realFinishedFixtures / training.readiness.minimumRecommendedFixtures
    : 0;
  const score = clamp(fixtureRatio * 70 + (training.counts.realOddsSnapshots > 0 ? 22 : 0), 0, 100);
  const task = taskById(queue, "backfill-real-corpus");
  return {
    id: "real-corpus",
    label: "Real corpus",
    status: gateStatusFromScore(score),
    score: round(score),
    reason: `${training.counts.realFinishedFixtures}/${training.readiness.minimumRecommendedFixtures} real finished fixtures and ${training.counts.realOddsSnapshots} real odds snapshots are available.`,
    requiredEvidence: unique([
      training.counts.realFinishedFixtures >= training.readiness.minimumRecommendedFixtures ? null : "Backfill real finished fixtures for the 10-year corpus.",
      training.counts.realOddsSnapshots > 0 ? null : "Backfill real odds snapshots and closing prices.",
      task?.expectedEvidence
    ])
  };
}

function learningPermissionGate(session: DecisionAISession, gates: DecisionAISessionShadowEvaluationGate[]): DecisionAISessionShadowEvaluationGate {
  const hardBlocks = gates.filter((gate) => gate.status === "block").length;
  const score = session.controls.canTrain ? 78 : hardBlocks ? 8 : 36;
  return {
    id: "learning-permission",
    label: "Learning permission",
    status: gateStatusFromScore(score),
    score,
    reason: session.controls.canTrain
      ? "The session would permit training, but writes still remain disabled in this evaluator."
      : `Training remains locked; ${hardBlocks} shadow-evaluation gate(s) are blocking.`,
    requiredEvidence: unique([
      session.controls.canTrain ? null : "Clear session, outcome, calibration, backtest, and real-corpus gates before learned guardrails can change live behavior."
    ])
  };
}

function learningReadinessScore(gates: DecisionAISessionShadowEvaluationGate[], session: DecisionAISession): number {
  const average = gates.length ? gates.reduce((sum, gate) => sum + gate.score, 0) / gates.length : 0;
  const debtPenalty = Math.min(24, session.metareasoning.evidenceDebt * 0.18);
  const contradictionPenalty = Math.min(18, session.metareasoning.contradictionCount * 3);
  const actionPenalty = session.activeDecision.sessionAction === "avoid" ? 10 : session.activeDecision.sessionAction === "monitor" ? 4 : 0;
  return round(clamp(average - debtPenalty - contradictionPenalty - actionPenalty, 0, 100));
}

function statusFor(gates: DecisionAISessionShadowEvaluationGate[], score: number, session: DecisionAISession): DecisionAISessionShadowEvaluationStatus {
  if (session.activeDecision.sessionAction === "avoid" || gates.some((gate) => gate.status === "block") || score < 35) return "blocked";
  if (gates.some((gate) => gate.status === "watch") || score < 75) return "waiting";
  return "ready-shadow";
}

function commandForTask(task: DecisionLearningTask | null, fallback: DecisionAISessionShadowEvaluationCommand): DecisionAISessionShadowEvaluationCommand {
  if (!task) return fallback;
  return {
    id: task.id,
    label: task.title,
    command: task.command,
    verifyUrl: task.verifyUrl,
    status: task.status === "ready" ? "watch" : task.status === "waiting" ? "watch" : "block",
    expectedEvidence: task.expectedEvidence
  };
}

function buildCommands(session: DecisionAISession, queue: DecisionLearningQueue): DecisionAISessionShadowEvaluationCommand[] {
  return [
    {
      id: "inspect-session",
      label: "Inspect AI session",
      command: decisionCurlCommand(`/api/sports/decision/ai-decision-session?date=${encodeURIComponent(session.date)}&sport=${encodeURIComponent(session.sport)}&run=1`),
      verifyUrl: "/api/sports/decision/ai-decision-session",
      status: "watch",
      expectedEvidence: "Session review returns a latestRun status, review verdict, evidence packet count, and no-write controls."
    },
    commandForTask(taskById(queue, "open-outcome-ticket"), {
      id: "open-outcome-ticket",
      label: "Open outcome ticket",
      command: null,
      verifyUrl: "/api/sports/decision/memory",
      status: "block",
      expectedEvidence: "A pending outcome ticket exists for the active decision."
    }),
    commandForTask(taskById(queue, "run-calibration"), {
      id: "run-calibration",
      label: "Run calibration",
      command: null,
      verifyUrl: "/api/sports/decision/calibration",
      status: "block",
      expectedEvidence: "Calibration metrics are available for the current sport."
    }),
    commandForTask(taskById(queue, `run-${session.sport}-backtest`), {
      id: `run-${session.sport}-backtest`,
      label: "Run real-data backtest",
      command: null,
      verifyUrl: "/api/sports/decision/training",
      status: "block",
      expectedEvidence: "A real-data backtest exists for the current sport."
    })
  ];
}

function shadowGradePlan(session: DecisionAISession): DecisionAISessionShadowEvaluation["shadowGradePlan"] {
  const marketEvidence = session.evidencePacket.find((item) => item.id === "trace-market-edge");
  return {
    settlementMarket: session.activeDecision.matchId ? "active-session-selection" : null,
    selection: session.activeDecision.match,
    modelProbability: null,
    impliedProbability: null,
    valueEdge: null,
    successCriteria: unique([
      "The picked outcome settles as won, lost, push, or void.",
      "Closing-line value is recorded when closing odds are available.",
      "Brier score can be computed when model probability is recorded.",
      marketEvidence?.detail
    ]),
    failureCriteria: unique([
      "Outcome remains pending after the match window.",
      "Closing odds are missing for a priced recommendation.",
      "The session was published or trained while any gate was blocked.",
      session.metareasoning.strongestObjection
    ])
  };
}

export function buildDecisionAISessionShadowEvaluation({
  session,
  learningQueue,
  calibration,
  training,
  now = new Date()
}: {
  session: DecisionAISession;
  learningQueue: DecisionLearningQueue;
  calibration: CalibrationSnapshot;
  training: TrainingDataSnapshot;
  now?: Date;
}): DecisionAISessionShadowEvaluation {
  const firstGates = [
    sessionReviewGate(session),
    outcomeGate(learningQueue),
    calibrationGate(calibration, learningQueue),
    backtestGate(training, learningQueue),
    realCorpusGate(training, learningQueue)
  ];
  const gates = [...firstGates, learningPermissionGate(session, firstGates)];
  const score = learningReadinessScore(gates, session);
  const status = statusFor(gates, score, session);
  const commands = buildCommands(session, learningQueue);
  const activeDecision = {
    matchId: session.activeDecision.matchId,
    match: session.activeDecision.match,
    action: session.activeDecision.sessionAction,
    trustCeiling: session.metareasoning.trustCeiling,
    reviewStatus: session.latestRun.status
  };
  const evaluationHash = stableHash({
    session: session.sessionHash,
    status,
    score,
    gates: gates.map((gate) => [gate.id, gate.status, gate.score]),
    feedback: learningQueue.feedbackState,
    training: training.counts
  });

  return {
    generatedAt: now.toISOString(),
    date: session.date,
    sport: session.sport,
    mode: "ai-session-shadow-evaluation",
    status,
    evaluationHash,
    summary:
      status === "ready-shadow"
        ? "AI session shadow evaluation is ready to grade future outcomes without enabling writes or learned guardrails."
        : status === "waiting"
          ? "AI session shadow evaluation is waiting for more outcome, calibration, or backtest evidence."
          : "AI session shadow evaluation is blocked; do not learn from or publish this session until proof gates clear.",
    activeDecision,
    scorecard: {
      learningReadinessScore: score,
      sessionEvidenceDebt: session.metareasoning.evidenceDebt,
      sessionContradictions: session.metareasoning.contradictionCount,
      evidencePacketItems: session.evidencePacket.length,
      outcomesTracked: learningQueue.feedbackState.outcomesTracked,
      settledOutcomes: learningQueue.feedbackState.settledOutcomes,
      pendingOutcomes: learningQueue.feedbackState.pendingOutcomes,
      calibrationSampleSize: calibration.latestRun?.sampleSize ?? calibration.currentMetrics?.sampleSize ?? 0,
      brierScore: calibration.latestRun?.brierScore ?? calibration.currentMetrics?.brierScore ?? null,
      backtestRuns: training.counts.backtestRuns,
      backtestSampleSize: training.latestBacktest?.sampleSize ?? 0,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots
    },
    gates,
    nextEvaluationTask: learningQueue.nextTask,
    shadowGradePlan: shadowGradePlan(session),
    commands,
    controls: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canOpenOutcome: false,
      canApplyLearnedGuardrails: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/ai-session-evaluation",
        "/api/sports/decision/ai-decision-session",
        "/api/sports/decision/learning-queue",
        "/api/sports/decision/outcomes",
        "/api/sports/decision/calibration",
        "/api/sports/decision/training",
        ...session.proofUrls
      ],
      18
    )
  };
}
