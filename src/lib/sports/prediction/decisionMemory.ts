import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { DecisionBrain, DecisionBrainThinkingStep } from "@/lib/sports/prediction/decisionBrain";
import type {
  BestPickResult,
  ConfidenceLevel,
  DecisionAction,
  DecisionCaseMemoryBank,
  DecisionCaseMemoryRun,
  DecisionCommitteeConsensus,
  DecisionControlStatus,
  DecisionHealth,
  DecisionVerdict,
  OddsMarket,
  RiskLevel,
  Sport
} from "@/lib/sports/types";

export type DecisionMemoryStatus = "ready" | "not-configured" | "failed";
export type DecisionMemoryThinkingTraceStatus = "supportive" | "contested" | "unproven" | "blocked";
export type DecisionMemoryThinkingTraceOutcome = "supports" | "questions" | "needs-evidence" | "blocks";

export type DecisionMemoryConfidenceBudgetItem = {
  id: string;
  label: string;
  status: "adds-confidence" | "subtracts-confidence" | "neutral";
  score: number;
  weight: number;
  weightedScore: number;
  detail: string;
};

export type DecisionMemoryThinkingTrace = {
  status: DecisionMemoryThinkingTraceStatus;
  thesis: string;
  counterThesis: string;
  synthesis: string;
  beliefPressure: {
    supporting: number;
    questioning: number;
    needsEvidence: number;
    blocking: number;
    netScore: number;
  };
  confidenceBudget: {
    score: number;
    grade: "high" | "medium" | "low";
    items: DecisionMemoryConfidenceBudgetItem[];
  };
  falsifiers: string[];
  evidenceGaps: string[];
  nextEvidenceAction: string;
  auditTrail: Array<{
    step: string;
    outcome: DecisionMemoryThinkingTraceOutcome;
    evidence: string[];
  }>;
};

export type DecisionMemoryBrainTrace = {
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  country: string;
  generatedAt: string;
  engineVersion: string;
  status: DecisionControlStatus;
  action: DecisionAction;
  health: DecisionHealth;
  decisionScore: number;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  summary: string;
  belief: Pick<DecisionBrain["belief"], "grade" | "believedProbability" | "probabilityEdge" | "expectedValue" | "ttlMinutes" | "summary">;
  committee: Pick<DecisionBrain["committee"], "consensus" | "recommendedAction" | "finalRationale" | "voteCounts">;
  nextTool: DecisionBrain["nextTool"];
  nextBestAction: string;
  blockers: string[];
  thinkingSteps: DecisionBrainThinkingStep[];
  thinkingTrace?: DecisionMemoryThinkingTrace | null;
  publishAllowed: boolean;
  aiReviewRequired: boolean;
  rerunRequired: boolean;
};

export type DecisionMemoryRun = {
  id: string;
  fixtureExternalId: string;
  sport: Sport;
  engineVersion: string;
  modelKey: string | null;
  verdict: DecisionVerdict;
  action: DecisionAction;
  health: DecisionHealth;
  confidence: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  decisionScore: number;
  reliabilityScore: number | null;
  recommendedSelection: string | null;
  summary: string;
  createdAt: string;
  brainTrace?: DecisionMemoryBrainTrace | null;
};

export type DecisionMemorySummary = {
  totalRuns: number;
  consider: number;
  monitor: number;
  avoid: number;
  stable: number;
  review: number;
  fragile: number;
  averageDecisionScore: number | null;
  averageReliabilityScore: number | null;
  latestRunAt: string | null;
};

export type DecisionLearningLoop = {
  outcomesTracked: number;
  settledOutcomes: number;
  pendingOutcomes: number;
  calibrationRuns: number;
  latestCalibrationAt: string | null;
  readyForCalibration: boolean;
  detail: string;
};

export type DecisionMemorySnapshot = {
  generatedAt: string;
  status: DecisionMemoryStatus;
  configured: boolean;
  projectRef: string | null;
  summary: DecisionMemorySummary;
  learningLoop: DecisionLearningLoop;
  recentRuns: DecisionMemoryRun[];
  reason?: string;
};

type DbDecisionRun = {
  id: string;
  fixture_external_id: string;
  sport: Sport;
  engine_version: string;
  model_key: string | null;
  verdict: DecisionVerdict;
  action: DecisionAction;
  health: DecisionHealth | null;
  confidence: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  decision_score: number;
  recommended_selection: string | null;
  summary: string;
  calibration: { reliabilityScore?: unknown } | null;
  model_snapshot: unknown;
  created_at: string;
};

type DbDecisionCaseRun = DbDecisionRun & {
  model_snapshot: unknown;
};

type OutcomeStats = {
  total: number;
  settled: number;
  pending: number;
};

type CalibrationStats = {
  total: number;
  latest: string | null;
};

function emptySummary(): DecisionMemorySummary {
  return {
    totalRuns: 0,
    consider: 0,
    monitor: 0,
    avoid: 0,
    stable: 0,
    review: 0,
    fragile: 0,
    averageDecisionScore: null,
    averageReliabilityScore: null,
    latestRunAt: null
  };
}

function emptyLearningLoop(detail: string): DecisionLearningLoop {
  return {
    outcomesTracked: 0,
    settledOutcomes: 0,
    pendingOutcomes: 0,
    calibrationRuns: 0,
    latestCalibrationAt: null,
    readyForCalibration: false,
    detail
  };
}

function reliabilityFromCalibration(calibration: DbDecisionRun["calibration"]): number | null {
  const score = calibration?.reliabilityScore;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function confidenceValue(value: unknown): ConfidenceLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function riskValue(value: unknown): RiskLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "high";
}

function actionValue(value: unknown): DecisionAction {
  return value === "consider" || value === "monitor" || value === "avoid" ? value : "avoid";
}

function healthValue(value: unknown): DecisionHealth {
  return value === "stable" || value === "review" || value === "fragile" ? value : "review";
}

function controlStatusValue(value: unknown): DecisionControlStatus {
  return value === "publishable" || value === "monitor-only" || value === "needs-rerun" || value === "blocked" ? value : "blocked";
}

function committeeConsensusValue(value: unknown): DecisionCommitteeConsensus {
  return value === "unanimous" || value === "leaning" || value === "split" || value === "blocked" ? value : "blocked";
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
}

function thinkingStepStatusValue(value: unknown): DecisionBrainThinkingStep["status"] {
  return value === "complete" || value === "watch" || value === "blocked" ? value : "watch";
}

function thinkingStepsValue(value: unknown): DecisionBrainThinkingStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 8)
    .map((step) => ({
      id: stringValue(step.id, "stored-step"),
      label: stringValue(step.label, "Stored reasoning step"),
      status: thinkingStepStatusValue(step.status),
      detail: stringValue(step.detail, "No stored detail was available.")
    }));
}

function thinkingTraceStatusValue(value: unknown): DecisionMemoryThinkingTraceStatus {
  return value === "supportive" || value === "contested" || value === "unproven" || value === "blocked" ? value : "blocked";
}

function thinkingTraceOutcomeValue(value: unknown): DecisionMemoryThinkingTraceOutcome {
  return value === "supports" || value === "questions" || value === "needs-evidence" || value === "blocks" ? value : "questions";
}

function confidenceBudgetStatusValue(value: unknown): DecisionMemoryConfidenceBudgetItem["status"] {
  return value === "adds-confidence" || value === "subtracts-confidence" || value === "neutral" ? value : "neutral";
}

function confidenceBudgetGradeValue(value: unknown): DecisionMemoryThinkingTrace["confidenceBudget"]["grade"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function confidenceBudgetItemsValue(value: unknown): DecisionMemoryConfidenceBudgetItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 8)
    .map((item) => ({
      id: stringValue(item.id, "stored-budget-item"),
      label: stringValue(item.label, "Stored confidence item"),
      status: confidenceBudgetStatusValue(item.status),
      score: numberValue(item.score),
      weight: numberValue(item.weight),
      weightedScore: numberValue(item.weightedScore),
      detail: stringValue(item.detail, "No stored confidence detail was available.")
    }));
}

function thinkingTraceAuditTrailValue(value: unknown): DecisionMemoryThinkingTrace["auditTrail"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 8)
    .map((item) => ({
      step: stringValue(item.step, "Stored reasoning step"),
      outcome: thinkingTraceOutcomeValue(item.outcome),
      evidence: stringList(item.evidence)
    }));
}

function thinkingTraceFromSnapshot(snapshot: unknown): DecisionMemoryThinkingTrace | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.thinkingTrace)) return null;

  const trace = snapshot.thinkingTrace;
  const pressure = isRecord(trace.beliefPressure) ? trace.beliefPressure : {};
  const budget = isRecord(trace.confidenceBudget) ? trace.confidenceBudget : {};

  return {
    status: thinkingTraceStatusValue(trace.status),
    thesis: stringValue(trace.thesis, "No stored thesis was available."),
    counterThesis: stringValue(trace.counterThesis, "No stored counter-thesis was available."),
    synthesis: stringValue(trace.synthesis, "No stored synthesis was available."),
    beliefPressure: {
      supporting: numberValue(pressure.supporting),
      questioning: numberValue(pressure.questioning),
      needsEvidence: numberValue(pressure.needsEvidence),
      blocking: numberValue(pressure.blocking),
      netScore: numberValue(pressure.netScore)
    },
    confidenceBudget: {
      score: numberValue(budget.score),
      grade: confidenceBudgetGradeValue(budget.grade),
      items: confidenceBudgetItemsValue(budget.items)
    },
    falsifiers: stringList(trace.falsifiers),
    evidenceGaps: stringList(trace.evidenceGaps),
    nextEvidenceAction: stringValue(trace.nextEvidenceAction, "Re-run the decision engine with fresh evidence."),
    auditTrail: thinkingTraceAuditTrailValue(trace.auditTrail)
  };
}

function nextToolValue(value: unknown): DecisionMemoryBrainTrace["nextTool"] {
  if (!isRecord(value)) return null;
  return {
    id: stringValue(value.id, "stored-tool"),
    label: stringValue(value.label, "Stored tool task"),
    status: stringValue(value.status, "waiting") as DecisionMemoryBrainTrace["nextTool"] extends infer Tool
      ? Tool extends null
        ? never
        : Tool extends { status: infer Status }
          ? Status
          : never
      : never,
    provider: stringValue(value.provider, "stored"),
    reason: stringValue(value.reason, "No stored reason was available."),
    decisionImpact: stringValue(value.decisionImpact, "No stored decision impact was available.")
  };
}

export function decisionMemoryBrainTraceFromSnapshot(snapshot: unknown): DecisionMemoryBrainTrace | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.brain)) return null;

  const brain = snapshot.brain;
  const matchId = stringValue(brain.matchId);
  const match = stringValue(brain.match);
  if (!matchId || !match) return null;

  const belief = isRecord(brain.belief) ? brain.belief : {};
  const committee = isRecord(brain.committee) ? brain.committee : {};
  const voteCounts = isRecord(committee.voteCounts) ? committee.voteCounts : {};

  return {
    matchId,
    match,
    sport: stringValue(brain.sport, "football") as Sport,
    league: stringValue(brain.league, "Unknown league"),
    country: stringValue(brain.country, "Unknown country"),
    generatedAt: stringValue(brain.generatedAt, ""),
    engineVersion: stringValue(brain.engineVersion, ""),
    status: controlStatusValue(brain.status),
    action: actionValue(brain.action),
    health: healthValue(brain.health),
    decisionScore: numberValue(brain.decisionScore),
    confidence: confidenceValue(brain.confidence),
    risk: riskValue(brain.risk),
    summary: stringValue(brain.summary, "No stored brain summary was available."),
    belief: {
      grade: stringValue(belief.grade, "unknown"),
      believedProbability: nullableNumberValue(belief.believedProbability),
      probabilityEdge: nullableNumberValue(belief.probabilityEdge),
      expectedValue: nullableNumberValue(belief.expectedValue),
      ttlMinutes: numberValue(belief.ttlMinutes),
      summary: stringValue(belief.summary, "No stored belief summary was available.")
    },
    committee: {
      consensus: committeeConsensusValue(committee.consensus),
      recommendedAction: actionValue(committee.recommendedAction),
      finalRationale: stringValue(committee.finalRationale, "No stored committee rationale was available."),
      voteCounts: {
        consider: numberValue(voteCounts.consider),
        monitor: numberValue(voteCounts.monitor),
        avoid: numberValue(voteCounts.avoid)
      }
    },
    nextTool: nextToolValue(brain.nextTool),
    nextBestAction: stringValue(brain.nextBestAction, "Re-run the decision engine with fresh data."),
    blockers: stringList(brain.blockers),
    thinkingSteps: thinkingStepsValue(brain.thinkingSteps),
    thinkingTrace: thinkingTraceFromSnapshot(snapshot),
    publishAllowed: booleanValue(brain.publishAllowed),
    aiReviewRequired: booleanValue(brain.aiReviewRequired),
    rerunRequired: booleanValue(brain.rerunRequired)
  };
}

function parseBestPick(value: unknown): BestPickResult {
  if (!isRecord(value) || value.hasValue !== true) return { hasValue: false, label: "No clear value found" };

  return {
    hasValue: true,
    marketId: stringValue(value.marketId, "match_winner") as OddsMarket["id"],
    selectionId: stringValue(value.selectionId, "unknown"),
    label: stringValue(value.label, "Stored selection"),
    modelProbability: numberValue(value.modelProbability),
    rawImpliedProbability: numberValue(value.rawImpliedProbability),
    noVigImpliedProbability: numberValue(value.noVigImpliedProbability),
    impliedProbability: numberValue(value.impliedProbability),
    bookmakerMargin: numberValue(value.bookmakerMargin),
    edge: numberValue(value.edge),
    expectedValue: numberValue(value.expectedValue),
    expectedRoi: numberValue(value.expectedRoi),
    odds: numberValue(value.odds),
    confidence: confidenceValue(value.confidence),
    risk: riskValue(value.risk)
  };
}

function bestPickFromSnapshot(snapshot: unknown): BestPickResult {
  if (!isRecord(snapshot)) return { hasValue: false, label: "No clear value found" };
  return parseBestPick(snapshot.candidatePick ?? snapshot.bestPick);
}

function toMemoryRun(row: DbDecisionRun): DecisionMemoryRun {
  return {
    id: row.id,
    fixtureExternalId: row.fixture_external_id,
    sport: row.sport,
    engineVersion: row.engine_version,
    modelKey: row.model_key,
    verdict: row.verdict,
    action: row.action,
    health: row.health ?? "review",
    confidence: row.confidence,
    risk: row.risk,
    decisionScore: row.decision_score,
    reliabilityScore: reliabilityFromCalibration(row.calibration),
    recommendedSelection: row.recommended_selection,
    summary: row.summary,
    createdAt: row.created_at,
    brainTrace: decisionMemoryBrainTraceFromSnapshot(row.model_snapshot)
  };
}

function toCaseMemoryRun(row: DbDecisionCaseRun): DecisionCaseMemoryRun {
  return {
    id: row.id,
    fixtureExternalId: row.fixture_external_id,
    sport: row.sport,
    verdict: row.verdict,
    action: row.action,
    health: row.health ?? "review",
    confidence: row.confidence,
    risk: row.risk,
    decisionScore: row.decision_score,
    reliabilityScore: reliabilityFromCalibration(row.calibration),
    recommendedSelection: row.recommended_selection,
    bestPick: bestPickFromSnapshot(row.model_snapshot),
    modelKey: row.model_key,
    createdAt: row.created_at
  };
}

export function summarizeDecisionMemoryRuns(recentRuns: DecisionMemoryRun[]): DecisionMemorySummary {
  if (!recentRuns.length) return emptySummary();

  const reliabilityScores = recentRuns
    .map((run) => run.reliabilityScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

  return {
    totalRuns: recentRuns.length,
    consider: recentRuns.filter((run) => run.action === "consider").length,
    monitor: recentRuns.filter((run) => run.action === "monitor").length,
    avoid: recentRuns.filter((run) => run.action === "avoid").length,
    stable: recentRuns.filter((run) => run.health === "stable").length,
    review: recentRuns.filter((run) => run.health === "review").length,
    fragile: recentRuns.filter((run) => run.health === "fragile").length,
    averageDecisionScore: Math.round(recentRuns.reduce((sum, run) => sum + run.decisionScore, 0) / recentRuns.length),
    averageReliabilityScore: reliabilityScores.length
      ? Math.round(reliabilityScores.reduce((sum, score) => sum + score, 0) / reliabilityScores.length)
      : null,
    latestRunAt: recentRuns[0]?.createdAt ?? null
  };
}

function buildLearningLoop(outcomes: OutcomeStats, calibration: CalibrationStats): DecisionLearningLoop {
  const readyForCalibration = outcomes.settled >= 30;
  return {
    outcomesTracked: outcomes.total,
    settledOutcomes: outcomes.settled,
    pendingOutcomes: outcomes.pending,
    calibrationRuns: calibration.total,
    latestCalibrationAt: calibration.latest,
    readyForCalibration,
    detail: readyForCalibration
      ? "Enough settled outcomes exist to run a meaningful calibration pass."
      : "Store settled outcomes before trusting long-term calibration metrics; 30+ settled outcomes is the first useful threshold."
  };
}

export async function getDecisionMemorySnapshot({ limit = 12 }: { limit?: number } = {}): Promise<DecisionMemorySnapshot> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      generatedAt: new Date().toISOString(),
      status: "not-configured",
      configured: false,
      projectRef: runtime.projectRef,
      summary: emptySummary(),
      learningLoop: emptyLearningLoop(`Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`),
      recentRuns: [],
      reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      summary: emptySummary(),
      learningLoop: emptyLearningLoop("Supabase client could not be created."),
      recentRuns: [],
      reason: "Supabase client could not be created."
    };
  }

  const [runsResult, outcomesResult, calibrationResult] = await Promise.all([
    client
      .from("op_decision_runs")
      .select(
        "id, fixture_external_id, sport, engine_version, model_key, verdict, action, health, confidence, risk, decision_score, recommended_selection, summary, calibration, model_snapshot, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(50, limit))),
    client.from("op_prediction_outcomes").select("result", { count: "exact", head: false }),
    client.from("op_calibration_runs").select("created_at", { count: "exact", head: false }).order("created_at", { ascending: false }).limit(1)
  ]);

  if (runsResult.error) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      summary: emptySummary(),
      learningLoop: emptyLearningLoop(runsResult.error.message),
      recentRuns: [],
      reason: runsResult.error.message
    };
  }

  const outcomeRows = Array.isArray(outcomesResult.data) ? (outcomesResult.data as Array<{ result?: string }>) : [];
  const outcomeStats = outcomesResult.error
    ? { total: 0, settled: 0, pending: 0 }
    : {
        total: outcomesResult.count ?? outcomeRows.length,
        settled: outcomeRows.filter((row) => row.result && row.result !== "pending").length,
        pending: outcomeRows.filter((row) => row.result === "pending").length
      };

  const calibrationRows = Array.isArray(calibrationResult.data) ? (calibrationResult.data as Array<{ created_at?: string }>) : [];
  const calibrationStats = calibrationResult.error
    ? { total: 0, latest: null }
    : {
        total: calibrationResult.count ?? calibrationRows.length,
        latest: calibrationRows[0]?.created_at ?? null
      };

  const recentRuns = ((runsResult.data ?? []) as DbDecisionRun[]).map(toMemoryRun);

  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    configured: true,
    projectRef: runtime.projectRef,
    summary: summarizeDecisionMemoryRuns(recentRuns),
    learningLoop: buildLearningLoop(outcomeStats, calibrationStats),
    recentRuns
  };
}

export async function getDecisionCaseMemoryBank({
  sport = "football",
  limit = 40
}: {
  sport?: Sport;
  limit?: number;
} = {}): Promise<DecisionCaseMemoryBank> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      generatedAt: new Date().toISOString(),
      status: "not-configured",
      configured: false,
      projectRef: runtime.projectRef,
      runs: [],
      reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      runs: [],
      reason: "Supabase client could not be created."
    };
  }

  const result = await client
    .from("op_decision_runs")
    .select(
      "id, fixture_external_id, sport, engine_version, model_key, verdict, action, health, confidence, risk, decision_score, recommended_selection, summary, calibration, model_snapshot, created_at"
    )
    .eq("sport", sport)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (result.error) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      runs: [],
      reason: result.error.message
    };
  }

  const runs = ((result.data ?? []) as DbDecisionCaseRun[]).map(toCaseMemoryRun);

  return {
    generatedAt: new Date().toISOString(),
    status: runs.length ? "ready" : "no-memory",
    configured: true,
    projectRef: runtime.projectRef,
    runs,
    reason: runs.length ? undefined : "No stored decisions are available for case-memory comparison yet."
  };
}
