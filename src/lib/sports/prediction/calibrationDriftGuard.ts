import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { CalibrationDriftMetricSummary, CalibrationDriftReceipt, Sport } from "@/lib/sports/types";
import {
  computeDecisionCalibrationMetrics,
  type DecisionRunRow,
  type OutcomeRow,
  type ProbabilityCalibrationBucket
} from "./decisionCalibration";
import type { ActiveCalibrationPromotion } from "./decisionCalibrationPromotion";
import { strictChronologicalSplitIndex } from "./probabilityTemperatureScaling";

const MINIMUM_SETTLED_SIZE = 30 as const;
const MONITORING_WINDOW_SIZE = 100 as const;
const MAXIMUM_PROMOTION_AGE_DAYS = 45 as const;
const MAXIMUM_OUTCOME_AGE_DAYS = 7 as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const THRESHOLDS = {
  maximumBrierDelta: 0.05 as const,
  maximumLogLossDelta: 0.12 as const,
  maximumCalibrationError: 0.1 as const,
  maximumRecentBrierDelta: 0.07 as const,
  maximumRecentVsEarlierBrierDelta: 0.06 as const,
  maximumProbabilityPopulationStabilityIndex: 0.25 as const
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricSummary(metrics: ReturnType<typeof computeDecisionCalibrationMetrics>): CalibrationDriftMetricSummary {
  return {
    sampleSize: metrics.settledSize,
    windowStart: metrics.windowStart,
    windowEnd: metrics.windowEnd,
    brierScore: metrics.brierScore,
    logLoss: metrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError,
    brierSkillScore: metrics.brierSkillScore,
    roiYield: metrics.roiYield
  };
}

function emptySummary(): CalibrationDriftMetricSummary {
  return {
    sampleSize: 0,
    windowStart: null,
    windowEnd: null,
    brierScore: null,
    logLoss: null,
    expectedCalibrationError: null,
    brierSkillScore: null,
    roiYield: null
  };
}

function monitoringWindowStart(promotion: ActiveCalibrationPromotion): string {
  return promotion.candidate.windowEnd ?? promotion.approvedAt;
}

function baselineSummary(promotion: ActiveCalibrationPromotion): CalibrationDriftMetricSummary | null {
  const metrics = promotion.candidate.metrics;
  const brierScore = metrics.brierScore;
  const logLoss = metrics.logLoss;
  const expectedCalibrationError = metrics.expectedCalibrationError;
  const brierSkillScore = metrics.brierSkillScore;
  const roiYield = metrics.roiYield;
  const bucketSample = promotion.candidate.probabilityBuckets.reduce((sum, bucket) => sum + bucket.settledSize, 0);
  if (
    promotion.candidate.settledSize < MINIMUM_SETTLED_SIZE || bucketSample !== promotion.candidate.settledSize ||
    !finite(brierScore) || brierScore < 0 || brierScore > 1 ||
    !finite(logLoss) || logLoss < 0 ||
    !finite(expectedCalibrationError) || expectedCalibrationError < 0 || expectedCalibrationError > 1 ||
    !finite(brierSkillScore) || !finite(roiYield)
  ) return null;
  return {
    sampleSize: promotion.candidate.settledSize,
    windowStart: promotion.candidate.windowStart ?? null,
    windowEnd: promotion.candidate.windowEnd ?? promotion.approvedAt,
    brierScore,
    logLoss,
    expectedCalibrationError,
    brierSkillScore,
    roiYield
  };
}

function canonicalDistribution(buckets: readonly ProbabilityCalibrationBucket[]): number[] | null {
  const counts = Array.from({ length: 10 }, () => 0);
  let total = 0;
  for (const bucket of buckets) {
    const index = Math.round(bucket.lowerBound * 10);
    if (index < 0 || index > 9 || Math.abs(bucket.upperBound - bucket.lowerBound - 0.1) > 0.000001 || bucket.settledSize < 0) return null;
    counts[index] += bucket.settledSize;
    total += bucket.settledSize;
  }
  if (!total) return null;
  return counts.map((count) => count / total);
}

function populationStabilityIndex(
  baselineBuckets: readonly ProbabilityCalibrationBucket[],
  currentBuckets: readonly ProbabilityCalibrationBucket[]
): number | null {
  const baseline = canonicalDistribution(baselineBuckets);
  const current = canonicalDistribution(currentBuckets);
  if (!baseline || !current) return null;
  const epsilon = 0.0001;
  return round(baseline.reduce((sum, baselineShare, index) => {
    const currentShare = current[index]!;
    const resolvedBaseline = Math.max(epsilon, baselineShare);
    const resolvedCurrent = Math.max(epsilon, currentShare);
    return sum + (resolvedCurrent - resolvedBaseline) * Math.log(resolvedCurrent / resolvedBaseline);
  }, 0));
}

function exactOutOfSampleRows({
  promotion,
  outcomes,
  decisionRuns,
  now
}: {
  promotion: ActiveCalibrationPromotion;
  outcomes: readonly OutcomeRow[];
  decisionRuns: readonly DecisionRunRow[];
  now: Date;
}): { outcomes: OutcomeRow[]; decisionRuns: DecisionRunRow[] } {
  const monitoringStart = Date.parse(monitoringWindowStart(promotion));
  const runById = new Map(decisionRuns.map((run) => [run.id, run]));
  const deduplicated = new Map<string, OutcomeRow>();
  for (const outcome of outcomes) {
    const run = outcome.decision_run_id ? runById.get(outcome.decision_run_id) : null;
    const settledAt = outcome.settled_at ? Date.parse(outcome.settled_at) : Number.NaN;
    if (
      outcome.sport !== promotion.sport || outcome.result !== "won" && outcome.result !== "lost" ||
      !finite(outcome.model_probability) || outcome.model_probability < 0 || outcome.model_probability > 1 ||
      !run || run.model_key !== promotion.modelKey || run.engine_version !== promotion.engineVersion ||
      !Number.isFinite(settledAt) || settledAt <= monitoringStart || settledAt > now.getTime()
    ) continue;
    deduplicated.set(outcome.id, outcome);
  }
  const resolvedOutcomes = [...deduplicated.values()]
    .sort((left, right) => Date.parse(left.settled_at!) - Date.parse(right.settled_at!))
    .slice(-MONITORING_WINDOW_SIZE);
  const runIds = new Set(resolvedOutcomes.map((outcome) => outcome.decision_run_id));
  return { outcomes: resolvedOutcomes, decisionRuns: decisionRuns.filter((run) => runIds.has(run.id)) };
}

function metricsFor(outcomes: OutcomeRow[], decisionRuns: DecisionRunRow[], sport: Sport) {
  return computeDecisionCalibrationMetrics({ outcomes, decisionRuns, sport });
}

export function buildCalibrationDriftReceipt({
  promotion,
  outcomes,
  decisionRuns,
  now = new Date()
}: {
  promotion: ActiveCalibrationPromotion;
  outcomes: readonly OutcomeRow[];
  decisionRuns: readonly DecisionRunRow[];
  now?: Date;
}): CalibrationDriftReceipt {
  const asOf = now.toISOString();
  const baseline = baselineSummary(promotion);
  const approvedAt = Date.parse(promotion.approvedAt);
  const windowStart = monitoringWindowStart(promotion);
  const windowStartAt = Date.parse(windowStart);
  const base = {
    version: "live-calibration-drift-v1" as const,
    sport: promotion.sport,
    modelKey: promotion.modelKey,
    engineVersion: promotion.engineVersion,
    promotionId: promotion.id,
    candidateId: promotion.candidateId,
    promotionApprovedAt: promotion.approvedAt,
    monitoringWindowStart: windowStart,
    asOf,
    minimumSettledSize: MINIMUM_SETTLED_SIZE,
    monitoringWindowSize: MONITORING_WINDOW_SIZE,
    maximumPromotionAgeDays: MAXIMUM_PROMOTION_AGE_DAYS,
    maximumOutcomeAgeDays: MAXIMUM_OUTCOME_AGE_DAYS,
    thresholds: THRESHOLDS
  };
  if (
    !baseline || !Number.isFinite(approvedAt) || approvedAt > now.getTime() ||
    !Number.isFinite(windowStartAt) || windowStartAt > approvedAt || windowStartAt > now.getTime()
  ) {
    return {
      ...base,
      status: "failed",
      eligibleForLive: false,
      baseline: baseline ?? emptySummary(),
      current: emptySummary(),
      earlier: emptySummary(),
      recent: emptySummary(),
      deltas: { brierScore: null, logLoss: null, expectedCalibrationError: null, recentBrierFromBaseline: null, recentBrierFromEarlier: null, probabilityPopulationStabilityIndex: null },
      latestOutcomeAt: null,
      blockers: ["The promoted calibration baseline, candidate window, or approval chronology is invalid."],
      notes: []
    };
  }
  const resolved = exactOutOfSampleRows({ promotion, outcomes, decisionRuns, now });
  const currentMetrics = metricsFor(resolved.outcomes, resolved.decisionRuns, promotion.sport);
  const latestOutcomeAt = resolved.outcomes.at(-1)?.settled_at ?? null;
  const promotionAgeDays = (now.getTime() - approvedAt) / DAY_MS;
  const outcomeAgeDays = latestOutcomeAt ? (now.getTime() - Date.parse(latestOutcomeAt)) / DAY_MS : Number.POSITIVE_INFINITY;
  const splitRows = resolved.outcomes.map((outcome) => ({ kickoffAt: outcome.settled_at!, outcome }));
  const splitIndex = resolved.outcomes.length >= MINIMUM_SETTLED_SIZE
    ? strictChronologicalSplitIndex(splitRows, Math.floor(splitRows.length / 2), { minimumLeft: 15, minimumRight: 15 })
    : 0;
  const earlierOutcomes = splitIndex > 0 ? resolved.outcomes.slice(0, splitIndex) : [];
  const recentOutcomes = splitIndex > 0 ? resolved.outcomes.slice(splitIndex) : [];
  const earlierRunIds = new Set(earlierOutcomes.map((outcome) => outcome.decision_run_id));
  const recentRunIds = new Set(recentOutcomes.map((outcome) => outcome.decision_run_id));
  const earlierMetrics = metricsFor(earlierOutcomes, resolved.decisionRuns.filter((run) => earlierRunIds.has(run.id)), promotion.sport);
  const recentMetrics = metricsFor(recentOutcomes, resolved.decisionRuns.filter((run) => recentRunIds.has(run.id)), promotion.sport);
  const psi = populationStabilityIndex(promotion.candidate.probabilityBuckets, currentMetrics.probabilityBuckets);
  const deltas = {
    brierScore: baseline.brierScore === null || currentMetrics.brierScore === null ? null : round(currentMetrics.brierScore - baseline.brierScore),
    logLoss: baseline.logLoss === null || currentMetrics.logLoss === null ? null : round(currentMetrics.logLoss - baseline.logLoss),
    expectedCalibrationError: baseline.expectedCalibrationError === null || currentMetrics.expectedCalibrationError === null
      ? null
      : round(currentMetrics.expectedCalibrationError - baseline.expectedCalibrationError),
    recentBrierFromBaseline: baseline.brierScore === null || recentMetrics.brierScore === null ? null : round(recentMetrics.brierScore - baseline.brierScore),
    recentBrierFromEarlier: earlierMetrics.brierScore === null || recentMetrics.brierScore === null ? null : round(recentMetrics.brierScore - earlierMetrics.brierScore),
    probabilityPopulationStabilityIndex: psi
  };
  const blockers = [
    promotionAgeDays > MAXIMUM_PROMOTION_AGE_DAYS ? `Promotion age ${round(promotionAgeDays, 2)} days exceeds ${MAXIMUM_PROMOTION_AGE_DAYS}.` : "",
    resolved.outcomes.length < MINIMUM_SETTLED_SIZE ? `${resolved.outcomes.length}/${MINIMUM_SETTLED_SIZE} exact out-of-sample outcomes are available.` : "",
    outcomeAgeDays > MAXIMUM_OUTCOME_AGE_DAYS ? `Latest exact outcome is ${Number.isFinite(outcomeAgeDays) ? `${round(outcomeAgeDays, 2)} days` : "unavailable"}; maximum is ${MAXIMUM_OUTCOME_AGE_DAYS}.` : "",
    resolved.outcomes.length >= MINIMUM_SETTLED_SIZE && splitIndex === 0 ? "Out-of-sample outcomes have no strict earlier/recent settlement boundary." : "",
    deltas.brierScore === null || deltas.brierScore > THRESHOLDS.maximumBrierDelta ? `Aggregate Brier delta ${deltas.brierScore ?? "unavailable"} exceeds ${THRESHOLDS.maximumBrierDelta}.` : "",
    deltas.logLoss === null || deltas.logLoss > THRESHOLDS.maximumLogLossDelta ? `Aggregate log-loss delta ${deltas.logLoss ?? "unavailable"} exceeds ${THRESHOLDS.maximumLogLossDelta}.` : "",
    currentMetrics.expectedCalibrationError === null || currentMetrics.expectedCalibrationError > THRESHOLDS.maximumCalibrationError
      ? `Current expected calibration error ${currentMetrics.expectedCalibrationError ?? "unavailable"} exceeds ${THRESHOLDS.maximumCalibrationError}.`
      : "",
    deltas.recentBrierFromBaseline === null || deltas.recentBrierFromBaseline > THRESHOLDS.maximumRecentBrierDelta
      ? `Recent Brier delta from baseline ${deltas.recentBrierFromBaseline ?? "unavailable"} exceeds ${THRESHOLDS.maximumRecentBrierDelta}.`
      : "",
    deltas.recentBrierFromEarlier === null || deltas.recentBrierFromEarlier > THRESHOLDS.maximumRecentVsEarlierBrierDelta
      ? `Recent Brier deterioration ${deltas.recentBrierFromEarlier ?? "unavailable"} exceeds ${THRESHOLDS.maximumRecentVsEarlierBrierDelta}.`
      : "",
    psi === null || psi > THRESHOLDS.maximumProbabilityPopulationStabilityIndex
      ? `Probability population stability index ${psi ?? "unavailable"} exceeds ${THRESHOLDS.maximumProbabilityPopulationStabilityIndex}.`
      : ""
  ].filter(Boolean);
  const status: CalibrationDriftReceipt["status"] =
    promotionAgeDays > MAXIMUM_PROMOTION_AGE_DAYS || outcomeAgeDays > MAXIMUM_OUTCOME_AGE_DAYS
      ? "stale"
      : resolved.outcomes.length < MINIMUM_SETTLED_SIZE
        ? "warming"
        : blockers.length
          ? "drifted"
          : "pass";
  return {
    ...base,
    status,
    eligibleForLive: status === "pass",
    baseline,
    current: metricSummary(currentMetrics),
    earlier: metricSummary(earlierMetrics),
    recent: metricSummary(recentMetrics),
    deltas,
    latestOutcomeAt,
    blockers,
    notes: [
      "Only immutable won/lost outcomes settled after the candidate calibration window for the exact sport, model key, and engine version enter this receipt.",
      "ROI is reported for operator context but does not independently block because short-window return variance is high."
    ]
  };
}

export async function readCalibrationDriftReceipt(
  promotion: ActiveCalibrationPromotion,
  now = new Date()
): Promise<CalibrationDriftReceipt> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return buildFailedReceipt(promotion, now, `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`);
  }
  const client = getSupabaseServerClient();
  if (!client) return buildFailedReceipt(promotion, now, "Supabase client could not be created.");
  const outcomesResult = await client
    .from("op_prediction_outcomes")
    .select("id,decision_run_id,fixture_external_id,sport,model_probability,implied_probability,value_edge,odds,closing_odds,result,settled_at,created_at")
    .eq("sport", promotion.sport)
    .neq("result", "pending")
    .gt("settled_at", monitoringWindowStart(promotion))
    .lte("settled_at", now.toISOString())
    .order("settled_at", { ascending: false })
    .limit(500);
  if (outcomesResult.error) return buildFailedReceipt(promotion, now, outcomesResult.error.message);
  const outcomes = (outcomesResult.data ?? []) as OutcomeRow[];
  const runIds = [...new Set(outcomes.map((row) => row.decision_run_id).filter((id): id is string => Boolean(id)))];
  if (!runIds.length) return buildCalibrationDriftReceipt({ promotion, outcomes, decisionRuns: [], now });
  const runsResult = await client.from("op_decision_runs").select("id,confidence,health,engine_version,model_key").in("id", runIds);
  if (runsResult.error) return buildFailedReceipt(promotion, now, runsResult.error.message);
  return buildCalibrationDriftReceipt({ promotion, outcomes, decisionRuns: (runsResult.data ?? []) as DecisionRunRow[], now });
}

function buildFailedReceipt(promotion: ActiveCalibrationPromotion, now: Date, reason: string): CalibrationDriftReceipt {
  const baseline = baselineSummary(promotion) ?? emptySummary();
  return {
    version: "live-calibration-drift-v1",
    status: "failed",
    eligibleForLive: false,
    sport: promotion.sport,
    modelKey: promotion.modelKey,
    engineVersion: promotion.engineVersion,
    promotionId: promotion.id,
    candidateId: promotion.candidateId,
    promotionApprovedAt: promotion.approvedAt,
    monitoringWindowStart: monitoringWindowStart(promotion),
    asOf: now.toISOString(),
    minimumSettledSize: MINIMUM_SETTLED_SIZE,
    monitoringWindowSize: MONITORING_WINDOW_SIZE,
    maximumPromotionAgeDays: MAXIMUM_PROMOTION_AGE_DAYS,
    maximumOutcomeAgeDays: MAXIMUM_OUTCOME_AGE_DAYS,
    baseline,
    current: emptySummary(),
    earlier: emptySummary(),
    recent: emptySummary(),
    deltas: { brierScore: null, logLoss: null, expectedCalibrationError: null, recentBrierFromBaseline: null, recentBrierFromEarlier: null, probabilityPopulationStabilityIndex: null },
    thresholds: THRESHOLDS,
    latestOutcomeAt: null,
    blockers: [reason],
    notes: []
  };
}
