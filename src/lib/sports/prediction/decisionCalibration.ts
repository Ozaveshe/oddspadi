import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import { DECISION_ENGINE_VERSION } from "./decisionEngine";
import { storeCalibrationCandidate, type CalibrationCandidateWriteResult } from "./decisionCalibrationPromotion";
import { isDecisionModelSport, runtimeModelKey } from "./modelIdentity";

type OutcomeResult = "pending" | "won" | "lost" | "push" | "void";

export type OutcomeRow = {
  id: string;
  decision_run_id: string | null;
  fixture_external_id: string;
  sport: string;
  market?: string;
  selection?: string;
  model_probability: number | null;
  implied_probability: number | null;
  value_edge: number | null;
  odds: number | null;
  closing_odds: number | null;
  result: OutcomeResult;
  settled_at: string | null;
  created_at: string;
};

export type DecisionRunRow = {
  id: string;
  confidence: "low" | "medium" | "high";
  health: "stable" | "review" | "fragile" | null;
  engine_version: string;
  model_key: string | null;
};

export type CalibrationBucket = {
  sampleSize: number;
  settledSize: number;
  winRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  averageProbability: number | null;
  calibrationGap: number | null;
  winRateInterval: { lower: number; upper: number } | null;
  roiUnits: number;
};

export type ProbabilityCalibrationBucket = CalibrationBucket & {
  id: string;
  lowerBound: number;
  upperBound: number;
};

export type CalibrationPromotionReadiness = {
  status: "waiting-sample" | "waiting-quality" | "ready-shadow-review";
  minimumSettledSize: 30;
  eligibleForShadowReview: boolean;
  canInfluenceLive: false;
  blockers: string[];
};

export type DecisionCalibrationMetrics = {
  sport: string;
  modelKey: string | null;
  engineVersion: string;
  windowStart: string | null;
  windowEnd: string | null;
  sampleSize: number;
  settledSize: number;
  winRate: number | null;
  winRateInterval: { lower: number; upper: number } | null;
  brierScore: number | null;
  brierSkillScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  maximumCalibrationError: number | null;
  averageEdge: number | null;
  averageClosingLineValue: number | null;
  closingLineSampleSize: number;
  closingLineCoverage: number | null;
  roiUnits: number;
  roiYield: number | null;
  probabilityBuckets: ProbabilityCalibrationBucket[];
  promotionReadiness: CalibrationPromotionReadiness;
  calibrationByConfidence: Record<string, CalibrationBucket>;
  calibrationByHealth: Record<string, CalibrationBucket>;
  notes: string[];
};

export type CalibrationSnapshot = {
  generatedAt: string;
  status: "ready" | "not-configured" | "failed";
  configured: boolean;
  latestRun: (DecisionCalibrationMetrics & { id: string; createdAt: string }) | null;
  currentMetrics: DecisionCalibrationMetrics | null;
  reason?: string;
};

export type CalibrationRunResult = {
  status: "stored" | "not-configured" | "failed";
  configured: boolean;
  id?: string;
  ids?: string[];
  metrics?: DecisionCalibrationMetrics;
  candidates?: CalibrationCandidateWriteResult[];
  reason?: string;
};

export type DecisionCalibrationCohort = {
  modelKey: string;
  engineVersion: string;
  outcomes: OutcomeRow[];
  decisionRuns: DecisionRunRow[];
  metrics: DecisionCalibrationMetrics;
};

function roundMetric(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isSettledForAccuracy(row: OutcomeRow): boolean {
  return row.result === "won" || row.result === "lost";
}

function hasValidModelProbability(row: OutcomeRow): row is OutcomeRow & { model_probability: number } {
  return typeof row.model_probability === "number" && row.model_probability >= 0 && row.model_probability <= 1;
}

function unitReturn(row: OutcomeRow): number {
  if (row.result === "won") return typeof row.odds === "number" && row.odds > 1 ? row.odds - 1 : 0;
  if (row.result === "lost") return -1;
  return 0;
}

function brier(row: OutcomeRow): number | null {
  if (!isSettledForAccuracy(row) || !hasValidModelProbability(row)) return null;
  const actual = row.result === "won" ? 1 : 0;
  return (row.model_probability - actual) ** 2;
}

function boundedProbability(value: number): number {
  return Math.max(1e-6, Math.min(1 - 1e-6, value));
}

function logarithmicLoss(row: OutcomeRow): number | null {
  if (!isSettledForAccuracy(row) || !hasValidModelProbability(row)) return null;
  const probability = boundedProbability(row.model_probability);
  return row.result === "won" ? -Math.log(probability) : -Math.log(1 - probability);
}

function closingLineValue(row: OutcomeRow): number | null {
  if (typeof row.odds !== "number" || row.odds <= 1 || typeof row.closing_odds !== "number" || row.closing_odds <= 1) return null;
  return row.odds / row.closing_odds - 1;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function wilsonInterval(wins: number, sampleSize: number, z = 1.96): { lower: number; upper: number } | null {
  if (!sampleSize) return null;
  const observed = wins / sampleSize;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (observed + zSquared / (2 * sampleSize)) / denominator;
  const spread =
    (z * Math.sqrt((observed * (1 - observed)) / sampleSize + zSquared / (4 * sampleSize ** 2))) / denominator;
  return {
    lower: roundMetric(Math.max(0, center - spread), 6) ?? 0,
    upper: roundMetric(Math.min(1, center + spread), 6) ?? 1
  };
}

function bucketMetrics(rows: OutcomeRow[]): CalibrationBucket {
  const settledRows = rows.filter(
    (row): row is OutcomeRow & { model_probability: number } => isSettledForAccuracy(row) && hasValidModelProbability(row)
  );
  const brierScores = rows.map(brier).filter((value): value is number => value !== null);
  const logLosses = rows.map(logarithmicLoss).filter((value): value is number => value !== null);
  const probabilities = settledRows
    .map((row) => row.model_probability)
    .filter((value): value is number => typeof value === "number" && value >= 0 && value <= 1);
  const wins = settledRows.filter((row) => row.result === "won").length;
  const winRate = settledRows.length ? wins / settledRows.length : null;
  const averageProbability = average(probabilities);

  return {
    sampleSize: rows.length,
    settledSize: settledRows.length,
    winRate: roundMetric(winRate, 6),
    brierScore: roundMetric(average(brierScores), 6),
    logLoss: roundMetric(average(logLosses), 6),
    averageProbability: roundMetric(averageProbability, 6),
    calibrationGap: roundMetric(winRate === null || averageProbability === null ? null : Math.abs(averageProbability - winRate), 6),
    winRateInterval: wilsonInterval(wins, settledRows.length),
    roiUnits: roundMetric(rows.reduce((sum, row) => sum + unitReturn(row), 0), 6) ?? 0
  };
}

function buildProbabilityBuckets(rows: OutcomeRow[], bucketCount = 10): ProbabilityCalibrationBucket[] {
  const settled = rows.filter((row): row is OutcomeRow & { model_probability: number } => isSettledForAccuracy(row) && hasValidModelProbability(row));
  return Array.from({ length: bucketCount }, (_, index) => {
    const lowerBound = index / bucketCount;
    const upperBound = (index + 1) / bucketCount;
    const bucketRows = settled.filter((row) => {
      const probability = row.model_probability as number;
      return probability >= lowerBound && (index === bucketCount - 1 ? probability <= upperBound : probability < upperBound);
    });
    return {
      id: `p${String(Math.round(lowerBound * 100)).padStart(2, "0")}-${String(Math.round(upperBound * 100)).padStart(2, "0")}`,
      lowerBound,
      upperBound,
      ...bucketMetrics(bucketRows)
    };
  }).filter((bucket) => bucket.settledSize > 0);
}

function expectedCalibrationError(buckets: ProbabilityCalibrationBucket[]): number | null {
  const scoredSize = buckets.reduce((sum, bucket) => sum + bucket.settledSize, 0);
  if (!scoredSize || !buckets.length) return null;
  return buckets.reduce((sum, bucket) => sum + (bucket.settledSize / scoredSize) * (bucket.calibrationGap ?? 0), 0);
}

function brierSkillScore(brierScore: number | null, wins: number, settledSize: number): number | null {
  if (brierScore === null || !settledSize) return null;
  const baseRate = wins / settledSize;
  const referenceBrier = baseRate * (1 - baseRate);
  if (referenceBrier <= 0) return null;
  return 1 - brierScore / referenceBrier;
}

function promotionReadiness({
  settledSize,
  brierScore,
  brierSkill,
  logLoss,
  calibrationError,
  closingLineCoverage,
  averageClosingLineValue
}: {
  settledSize: number;
  brierScore: number | null;
  brierSkill: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  closingLineCoverage: number | null;
  averageClosingLineValue: number | null;
}): CalibrationPromotionReadiness {
  const blockers = [
    settledSize < 30 ? `${settledSize}/30 settled outcomes have valid model probabilities.` : "",
    brierScore === null ? "Brier score unavailable." : brierScore > 0.25 ? `Brier score ${brierScore} exceeds 0.25.` : "",
    brierSkill === null ? "Brier skill versus base rate unavailable." : brierSkill <= 0 ? `Brier skill ${brierSkill} does not beat the base rate.` : "",
    logLoss === null ? "Log loss unavailable." : logLoss > Math.log(2) ? `Log loss ${logLoss} is worse than an uninformed 0.5 forecast.` : "",
    calibrationError === null ? "Expected calibration error unavailable." : calibrationError > 0.1 ? `Expected calibration error ${calibrationError} exceeds 0.10.` : "",
    closingLineCoverage === null || closingLineCoverage < 0.8
      ? `Closing-line coverage ${closingLineCoverage === null ? "unavailable" : closingLineCoverage} is below 0.80.`
      : "",
    averageClosingLineValue === null ? "Average closing-line value unavailable." : averageClosingLineValue <= 0 ? `Average CLV ${averageClosingLineValue} is not positive.` : ""
  ].filter(Boolean);
  const status: CalibrationPromotionReadiness["status"] = settledSize < 30
    ? "waiting-sample"
    : blockers.length
      ? "waiting-quality"
      : "ready-shadow-review";
  return {
    status,
    minimumSettledSize: 30,
    eligibleForShadowReview: status === "ready-shadow-review",
    canInfluenceLive: false,
    blockers
  };
}

const CALIBRATION_DIAGNOSTICS_KEY = "__diagnostics_v1";

type CalibrationDiagnosticsEnvelopeV1 = {
  version: 1;
  winRateInterval: DecisionCalibrationMetrics["winRateInterval"];
  brierSkillScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  maximumCalibrationError: number | null;
  closingLineSampleSize: number;
  closingLineCoverage: number | null;
  roiYield: number | null;
  probabilityBuckets: ProbabilityCalibrationBucket[];
  promotionReadiness: CalibrationPromotionReadiness;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function storedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStoredBucket(value: unknown): CalibrationBucket {
  const row = objectRecord(value);
  const interval = objectRecord(row.winRateInterval);
  const intervalLower = storedNumber(interval.lower);
  const intervalUpper = storedNumber(interval.upper);
  return {
    sampleSize: Math.max(0, Math.trunc(storedNumber(row.sampleSize) ?? 0)),
    settledSize: Math.max(0, Math.trunc(storedNumber(row.settledSize) ?? 0)),
    winRate: storedNumber(row.winRate),
    brierScore: storedNumber(row.brierScore),
    logLoss: storedNumber(row.logLoss),
    averageProbability: storedNumber(row.averageProbability),
    calibrationGap: storedNumber(row.calibrationGap),
    winRateInterval: intervalLower === null || intervalUpper === null ? null : { lower: intervalLower, upper: intervalUpper },
    roiUnits: storedNumber(row.roiUnits) ?? 0
  };
}

function storedBuckets(value: unknown): Record<string, CalibrationBucket> {
  return Object.fromEntries(
    Object.entries(objectRecord(value))
      .filter(([key]) => key !== CALIBRATION_DIAGNOSTICS_KEY)
      .map(([key, bucket]) => [key, normalizeStoredBucket(bucket)])
  );
}

function diagnosticsEnvelope(metrics: DecisionCalibrationMetrics): CalibrationDiagnosticsEnvelopeV1 {
  return {
    version: 1,
    winRateInterval: metrics.winRateInterval,
    brierSkillScore: metrics.brierSkillScore,
    logLoss: metrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError,
    maximumCalibrationError: metrics.maximumCalibrationError,
    closingLineSampleSize: metrics.closingLineSampleSize,
    closingLineCoverage: metrics.closingLineCoverage,
    roiYield: metrics.roiYield,
    probabilityBuckets: metrics.probabilityBuckets,
    promotionReadiness: metrics.promotionReadiness
  };
}

function readDiagnosticsEnvelope(value: unknown, base: {
  settledSize: number;
  brierScore: number | null;
  averageClosingLineValue: number | null;
}): CalibrationDiagnosticsEnvelopeV1 {
  const envelope = objectRecord(objectRecord(value)[CALIBRATION_DIAGNOSTICS_KEY]);
  const winInterval = objectRecord(envelope.winRateInterval);
  const intervalLower = storedNumber(winInterval.lower);
  const intervalUpper = storedNumber(winInterval.upper);
  const probabilityBuckets = Array.isArray(envelope.probabilityBuckets)
    ? envelope.probabilityBuckets.map((item) => {
        const row = objectRecord(item);
        return {
          id: typeof row.id === "string" ? row.id : "unknown",
          lowerBound: storedNumber(row.lowerBound) ?? 0,
          upperBound: storedNumber(row.upperBound) ?? 1,
          ...normalizeStoredBucket(row)
        };
      })
    : [];
  const brierSkill = storedNumber(envelope.brierSkillScore);
  const logLoss = storedNumber(envelope.logLoss);
  const calibrationError = storedNumber(envelope.expectedCalibrationError);
  const closingLineCoverage = storedNumber(envelope.closingLineCoverage);
  const readinessRecord = objectRecord(envelope.promotionReadiness);
  const storedStatus = readinessRecord.status;
  const fallbackReadiness = promotionReadiness({
    settledSize: base.settledSize,
    brierScore: base.brierScore,
    brierSkill,
    logLoss,
    calibrationError,
    closingLineCoverage,
    averageClosingLineValue: base.averageClosingLineValue
  });
  const storedReadiness: CalibrationPromotionReadiness =
    storedStatus === "waiting-sample" || storedStatus === "waiting-quality" || storedStatus === "ready-shadow-review"
      ? {
          status: storedStatus,
          minimumSettledSize: 30,
          eligibleForShadowReview: readinessRecord.eligibleForShadowReview === true,
          canInfluenceLive: false,
          blockers: Array.isArray(readinessRecord.blockers)
            ? readinessRecord.blockers.filter((item): item is string => typeof item === "string")
            : fallbackReadiness.blockers
        }
      : fallbackReadiness;
  return {
    version: 1,
    winRateInterval: intervalLower === null || intervalUpper === null ? null : { lower: intervalLower, upper: intervalUpper },
    brierSkillScore: brierSkill,
    logLoss,
    expectedCalibrationError: calibrationError,
    maximumCalibrationError: storedNumber(envelope.maximumCalibrationError),
    closingLineSampleSize: Math.max(0, Math.trunc(storedNumber(envelope.closingLineSampleSize) ?? 0)),
    closingLineCoverage,
    roiYield: storedNumber(envelope.roiYield),
    probabilityBuckets,
    promotionReadiness: storedReadiness
  };
}

function groupByDecisionField(
  rows: OutcomeRow[],
  runById: Map<string, DecisionRunRow>,
  field: "confidence" | "health"
): Record<string, CalibrationBucket> {
  const groups = new Map<string, OutcomeRow[]>();
  for (const row of rows) {
    const run = row.decision_run_id ? runById.get(row.decision_run_id) : null;
    const key = (run?.[field] ?? "unknown") || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Object.fromEntries([...groups.entries()].map(([key, groupRows]) => [key, bucketMetrics(groupRows)]));
}

export function computeDecisionCalibrationMetrics({
  outcomes,
  decisionRuns,
  sport = "football"
}: {
  outcomes: OutcomeRow[];
  decisionRuns: DecisionRunRow[];
  sport?: string;
}): DecisionCalibrationMetrics {
  const runById = new Map(decisionRuns.map((run) => [run.id, run]));
  const settledRows = outcomes.filter(isSettledForAccuracy);
  const scoredRows = settledRows.filter(hasValidModelProbability);
  const brierScores = outcomes.map(brier).filter((value): value is number => value !== null);
  const logLosses = outcomes.map(logarithmicLoss).filter((value): value is number => value !== null);
  const edgeValues = outcomes.map((row) => row.value_edge).filter((value): value is number => typeof value === "number");
  const clvValues = outcomes.map(closingLineValue).filter((value): value is number => value !== null);
  const roiRows = outcomes.filter(
    (row) => row.result === "lost" || row.result === "push" || (row.result === "won" && typeof row.odds === "number" && row.odds > 1)
  );
  const dates = outcomes
    .map((row) => row.settled_at ?? row.created_at)
    .filter(Boolean)
    .sort();
  const engineVersion = decisionRuns.find((run) => run.engine_version)?.engine_version ?? DECISION_ENGINE_VERSION;
  const modelKey = decisionRuns.find((run) => run.model_key)?.model_key ?? null;
  const wins = settledRows.filter((row) => row.result === "won").length;
  const scoredWins = scoredRows.filter((row) => row.result === "won").length;
  const roundedBrier = roundMetric(average(brierScores), 6);
  const roundedLogLoss = roundMetric(average(logLosses), 6);
  const buckets = buildProbabilityBuckets(outcomes);
  const calibrationError = roundMetric(expectedCalibrationError(buckets), 6);
  const maximumCalibrationError = roundMetric(
    buckets.length ? Math.max(...buckets.map((bucket) => bucket.calibrationGap ?? 0)) : null,
    6
  );
  const brierSkill = roundMetric(brierSkillScore(roundedBrier, scoredWins, scoredRows.length), 6);
  const averageClv = roundMetric(average(clvValues), 6);
  const closingLineCoverage = roundMetric(outcomes.length ? clvValues.length / outcomes.length : null, 6);
  const roiUnits = roundMetric(outcomes.reduce((sum, row) => sum + unitReturn(row), 0), 6) ?? 0;
  const roiYield = roundMetric(roiRows.length ? roiUnits / roiRows.length : null, 6);
  const readiness = promotionReadiness({
    settledSize: scoredRows.length,
    brierScore: roundedBrier,
    brierSkill,
    logLoss: roundedLogLoss,
    calibrationError,
    closingLineCoverage,
    averageClosingLineValue: averageClv
  });
  const notes = [
    settledRows.length < 30 ? "Calibration sample is still thin; collect at least 30 settled win/loss outcomes before trusting rates." : "",
    brierScores.length !== settledRows.length
      ? "Some settled outcomes have missing or invalid model_probability values, so probability diagnostics use a smaller sample."
      : "",
    clvValues.length !== outcomes.length ? `Closing-line value covers ${clvValues.length}/${outcomes.length} settled outcome record(s).` : "",
    readiness.status !== "ready-shadow-review" ? `Shadow review is ${readiness.status}; ${readiness.blockers[0] ?? "quality gates remain."}` : ""
  ].filter(Boolean);

  return {
    sport,
    modelKey,
    engineVersion,
    windowStart: dates[0] ?? null,
    windowEnd: dates[dates.length - 1] ?? null,
    sampleSize: outcomes.length,
    settledSize: settledRows.length,
    winRate: roundMetric(settledRows.length ? wins / settledRows.length : null, 6),
    winRateInterval: wilsonInterval(wins, settledRows.length),
    brierScore: roundedBrier,
    brierSkillScore: brierSkill,
    logLoss: roundedLogLoss,
    expectedCalibrationError: calibrationError,
    maximumCalibrationError,
    averageEdge: roundMetric(average(edgeValues), 6),
    averageClosingLineValue: averageClv,
    closingLineSampleSize: clvValues.length,
    closingLineCoverage,
    roiUnits,
    roiYield,
    probabilityBuckets: buckets,
    promotionReadiness: readiness,
    calibrationByConfidence: groupByDecisionField(outcomes, runById, "confidence"),
    calibrationByHealth: groupByDecisionField(outcomes, runById, "health"),
    notes
  };
}

export function buildDecisionCalibrationCohorts({
  outcomes,
  decisionRuns,
  sport = "football"
}: {
  outcomes: OutcomeRow[];
  decisionRuns: DecisionRunRow[];
  sport?: string;
}): DecisionCalibrationCohort[] {
  const runsById = new Map(decisionRuns.map((run) => [run.id, run]));
  const groups = new Map<string, { modelKey: string; engineVersion: string; outcomes: OutcomeRow[]; runIds: Set<string> }>();

  for (const outcome of outcomes) {
    const run = outcome.decision_run_id ? runsById.get(outcome.decision_run_id) : null;
    if (!run?.model_key || !run.engine_version) continue;
    const key = `${run.model_key}\u0000${run.engine_version}`;
    const current = groups.get(key) ?? { modelKey: run.model_key, engineVersion: run.engine_version, outcomes: [], runIds: new Set<string>() };
    current.outcomes.push(outcome);
    current.runIds.add(run.id);
    groups.set(key, current);
  }

  const currentRuntimeModelKey = isDecisionModelSport(sport) ? runtimeModelKey(sport) : null;
  return Array.from(groups.values())
    .map((group) => {
      const cohortRuns = decisionRuns.filter((run) => group.runIds.has(run.id));
      return {
        modelKey: group.modelKey,
        engineVersion: group.engineVersion,
        outcomes: group.outcomes,
        decisionRuns: cohortRuns,
        metrics: computeDecisionCalibrationMetrics({ outcomes: group.outcomes, decisionRuns: cohortRuns, sport })
      };
    })
    .sort((left, right) => {
      const runtimePriority = Number(right.modelKey === currentRuntimeModelKey) - Number(left.modelKey === currentRuntimeModelKey);
      return runtimePriority || right.outcomes.length - left.outcomes.length || left.modelKey.localeCompare(right.modelKey);
    });
}

async function readCalibrationInputs(sport = "football") {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const outcomesResult = await client
    .from("op_prediction_outcomes")
    .select(
      "id, decision_run_id, fixture_external_id, sport, model_probability, implied_probability, value_edge, odds, closing_odds, result, settled_at, created_at"
    )
    .eq("sport", sport)
    .neq("result", "pending")
    .order("created_at", { ascending: true })
    .limit(5000);

  if (outcomesResult.error) return { error: outcomesResult.error.message };

  const outcomes = (outcomesResult.data ?? []) as OutcomeRow[];
  const runIds = Array.from(new Set(outcomes.map((row) => row.decision_run_id).filter((id): id is string => Boolean(id))));

  if (!runIds.length) return { outcomes, decisionRuns: [] as DecisionRunRow[] };

  const runsResult = await client
    .from("op_decision_runs")
    .select("id, confidence, health, engine_version, model_key")
    .in("id", runIds);

  if (runsResult.error) return { error: runsResult.error.message };
  return { outcomes, decisionRuns: (runsResult.data ?? []) as DecisionRunRow[] };
}

export async function buildCurrentCalibrationMetrics(sport = "football"): Promise<DecisionCalibrationMetrics | { error: string }> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { error: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }

  const inputs = await readCalibrationInputs(sport);
  if ("error" in inputs) return { error: inputs.error ?? "Unable to read calibration inputs." };
  const cohorts = buildDecisionCalibrationCohorts({ outcomes: inputs.outcomes, decisionRuns: inputs.decisionRuns, sport });
  if (!cohorts.length) return computeDecisionCalibrationMetrics({ outcomes: [], decisionRuns: [], sport });
  const primary = cohorts[0];
  return {
    ...primary.metrics,
    notes: [
      ...primary.metrics.notes,
      ...(cohorts.length > 1 ? [`${cohorts.length} model/version cohorts exist; this view reports the largest cohort only.`] : [])
    ]
  };
}

async function readLatestCalibrationRun(sport = "football"): Promise<CalibrationSnapshot["latestRun"] | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const { data, error } = await client
    .from("op_calibration_runs")
    .select(
      "id, sport, model_key, engine_version, window_start, window_end, sample_size, settled_size, win_rate, brier_score, average_edge, average_closing_line_value, roi_units, calibration_by_confidence, calibration_by_health, notes, created_at"
    )
    .eq("sport", sport)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return null;

  const diagnostics = readDiagnosticsEnvelope(data.calibration_by_confidence, {
    settledSize: data.settled_size,
    brierScore: data.brier_score,
    averageClosingLineValue: data.average_closing_line_value
  });

  return {
    id: data.id,
    createdAt: data.created_at,
    sport: data.sport,
    modelKey: data.model_key,
    engineVersion: data.engine_version,
    windowStart: data.window_start,
    windowEnd: data.window_end,
    sampleSize: data.sample_size,
    settledSize: data.settled_size,
    winRate: data.win_rate,
    winRateInterval: diagnostics.winRateInterval,
    brierScore: data.brier_score,
    brierSkillScore: diagnostics.brierSkillScore,
    logLoss: diagnostics.logLoss,
    expectedCalibrationError: diagnostics.expectedCalibrationError,
    maximumCalibrationError: diagnostics.maximumCalibrationError,
    averageEdge: data.average_edge,
    averageClosingLineValue: data.average_closing_line_value,
    closingLineSampleSize: diagnostics.closingLineSampleSize,
    closingLineCoverage: diagnostics.closingLineCoverage,
    roiUnits: data.roi_units,
    roiYield: diagnostics.roiYield,
    probabilityBuckets: diagnostics.probabilityBuckets,
    promotionReadiness: diagnostics.promotionReadiness,
    calibrationByConfidence: storedBuckets(data.calibration_by_confidence),
    calibrationByHealth: storedBuckets(data.calibration_by_health),
    notes: Array.isArray(data.notes) ? data.notes : []
  };
}

export async function getCalibrationSnapshot(sport = "football"): Promise<CalibrationSnapshot> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      generatedAt: new Date().toISOString(),
      status: "not-configured",
      configured: false,
      latestRun: null,
      currentMetrics: null,
      reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const [latestRun, currentMetrics] = await Promise.all([readLatestCalibrationRun(sport), buildCurrentCalibrationMetrics(sport)]);
  if (latestRun && "error" in latestRun) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      latestRun: null,
      currentMetrics: null,
      reason: latestRun.error
    };
  }
  if ("error" in currentMetrics) {
    return {
      generatedAt: new Date().toISOString(),
      status: "failed",
      configured: true,
      latestRun: latestRun ?? null,
      currentMetrics: null,
      reason: currentMetrics.error
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    configured: true,
    latestRun,
    currentMetrics
  };
}

export async function runAndStoreCalibration(sport = "football"): Promise<CalibrationRunResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      configured: false,
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", configured: true, reason: "Supabase client could not be created." };

  const inputs = await readCalibrationInputs(sport);
  if ("error" in inputs) return { status: "failed", configured: true, reason: inputs.error };
  const cohorts = buildDecisionCalibrationCohorts({ outcomes: inputs.outcomes, decisionRuns: inputs.decisionRuns, sport });
  const selectedCohorts = cohorts.length
    ? cohorts
    : [
        {
          modelKey: "",
          engineVersion: DECISION_ENGINE_VERSION,
          outcomes: [] as OutcomeRow[],
          decisionRuns: [] as DecisionRunRow[],
          metrics: computeDecisionCalibrationMetrics({ outcomes: [], decisionRuns: [], sport })
        }
      ];
  const storedRuns: Array<{ id: string; metrics: DecisionCalibrationMetrics }> = [];
  const candidates: CalibrationCandidateWriteResult[] = [];

  // Persist the primary/current-runtime cohort last because the public snapshot
  // reads the latest insert. This prevents a tiny legacy cohort from becoming
  // the apparent current calibration simply because it was inserted last.
  for (const cohort of [...selectedCohorts].reverse()) {
    const metrics = cohort.metrics;
    const { data, error } = await client
      .from("op_calibration_runs")
      .insert({
        sport: metrics.sport,
        model_key: metrics.modelKey,
        engine_version: metrics.engineVersion,
        window_start: metrics.windowStart,
        window_end: metrics.windowEnd,
        sample_size: metrics.sampleSize,
        settled_size: metrics.settledSize,
        win_rate: metrics.winRate,
        brier_score: metrics.brierScore,
        average_edge: metrics.averageEdge,
        average_closing_line_value: metrics.averageClosingLineValue,
        roi_units: metrics.roiUnits,
        calibration_by_confidence: {
          ...metrics.calibrationByConfidence,
          [CALIBRATION_DIAGNOSTICS_KEY]: diagnosticsEnvelope(metrics)
        },
        calibration_by_health: metrics.calibrationByHealth,
        notes: metrics.notes
      })
      .select("id")
      .single();
    if (error) return { status: "failed", configured: true, reason: error.message, candidates };

    const runId = typeof data?.id === "string" ? data.id : undefined;
    if (runId) storedRuns.push({ id: runId, metrics });
    if (metrics.modelKey && runId) {
      candidates.push(
        await storeCalibrationCandidate({
          metrics,
          calibrationRunId: runId,
          outcomeIds: cohort.outcomes.map((outcome) => outcome.id)
        })
      );
    }
  }

  const primary = storedRuns.at(-1);
  return {
    status: "stored",
    configured: true,
    id: primary?.id,
    ids: storedRuns.map((run) => run.id),
    metrics: primary?.metrics,
    candidates
  };
}
