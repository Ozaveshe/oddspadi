import type { DecisionLearningProfile, Sport } from "@/lib/sports/types";
import { getTrainingDataSnapshot, type StoredBacktestRun, type TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { readActiveCalibrationPromotion, type ActiveCalibrationPromotion } from "./decisionCalibrationPromotion";
import { historicalModelCompatibility, isDecisionModelSport } from "./modelIdentity";
import { inspectRuntimeBacktestEvidence, type RuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";

function numberFromWeight(weights: Record<string, unknown>, key: string): number | null {
  const value = weights[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function learnedValue(backtest: StoredBacktestRun | null, key: string): number | null {
  return backtest ? numberFromWeight(backtest.learnedWeights, key) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calibrationBuckets(backtest: StoredBacktestRun | null): NonNullable<DecisionLearningProfile["calibrationBuckets"]> {
  return (backtest?.calibrationBuckets ?? []).flatMap((value) => {
    const row = record(value);
    const minProbability = finiteNumber(row.minProbability);
    const maxProbability = finiteNumber(row.maxProbability);
    const sampleSize = finiteNumber(row.sampleSize);
    const averageProbability = finiteNumber(row.averageProbability);
    const observedRate = finiteNumber(row.observedRate);
    const calibrationError = finiteNumber(row.calibrationError);
    if (
      minProbability === null ||
      maxProbability === null ||
      sampleSize === null ||
      averageProbability === null ||
      observedRate === null ||
      calibrationError === null ||
      sampleSize <= 0 ||
      minProbability < 0 ||
      maxProbability > 1 ||
      maxProbability <= minProbability ||
      averageProbability < 0 ||
      averageProbability > 1 ||
      observedRate < 0 ||
      observedRate > 1
    ) {
      return [];
    }
    return [{ minProbability, maxProbability, sampleSize, averageProbability, observedRate, calibrationError }];
  }).sort((left, right) => left.minProbability - right.minProbability);
}

function calibrationBucketsFromPromotion(promotion: ActiveCalibrationPromotion | null): NonNullable<DecisionLearningProfile["calibrationBuckets"]> {
  return (promotion?.candidate.probabilityBuckets ?? []).flatMap((bucket) => {
    const averageProbability = bucket.averageProbability;
    const observedRate = bucket.winRate;
    const calibrationError = bucket.calibrationGap;
    if (
      averageProbability === null ||
      observedRate === null ||
      calibrationError === null ||
      bucket.sampleSize <= 0 ||
      bucket.lowerBound < 0 ||
      bucket.upperBound > 1 ||
      bucket.upperBound <= bucket.lowerBound
    ) {
      return [];
    }
    return [
      {
        minProbability: bucket.lowerBound,
        maxProbability: bucket.upperBound,
        sampleSize: bucket.sampleSize,
        averageProbability,
        observedRate,
        calibrationError
      }
    ];
  });
}

function hasExplicitLivePromotion(backtest: StoredBacktestRun | null): boolean {
  const promotion = record(backtest?.config?.promotion);
  const approvedAt = typeof promotion.approvedAt === "string" ? Date.parse(promotion.approvedAt) : Number.NaN;
  return promotion.status === "approved" && promotion.scope === "live-guardrails" && Number.isFinite(approvedAt);
}

function footballLearningProvenanceBlocker(backtest: StoredBacktestRun): string | null {
  const provenance = record(backtest.config?.learnedWeightsProvenance);
  if (provenance.source !== "training-window") {
    return "learned weights lack training-window-only provenance";
  }

  const sampleSize = finiteNumber(provenance.sampleSize);
  if (sampleSize === null || sampleSize <= 0 || sampleSize !== backtest.trainSize) {
    return "learned-weight provenance does not cover the complete training window";
  }

  const windowStart = typeof provenance.windowStart === "string" ? Date.parse(provenance.windowStart) : Number.NaN;
  const windowEnd = typeof provenance.windowEnd === "string" ? Date.parse(provenance.windowEnd) : Number.NaN;
  const holdoutWindowStart =
    typeof provenance.holdoutWindowStart === "string" ? Date.parse(provenance.holdoutWindowStart) : Number.NaN;
  if (
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    !Number.isFinite(holdoutWindowStart) ||
    windowStart > windowEnd ||
    windowEnd >= holdoutWindowStart
  ) {
    return "learned-weight chronology does not prove a strictly earlier training window";
  }
  return null;
}

function liveMetricBlockers(
  snapshot: TrainingDataSnapshot,
  backtest: StoredBacktestRun | null,
  evidence: RuntimeBacktestEvidence
): string[] {
  if (!backtest) return ["no completed backtest"];
  const blockers: string[] = [];
  if (!isDecisionModelSport(snapshot.sport)) {
    blockers.push(`sport ${snapshot.sport} has no governed runtime model identity`);
  } else {
    const compatibility = historicalModelCompatibility({
      sport: snapshot.sport,
      evidenceModelKey: backtest.modelKey,
      config: backtest.config
    });
    if (compatibility === "benchmark-only") blockers.push("backtest evaluates a benchmark model, not the live runtime model");
    if (compatibility === "unverified-runtime-key") blockers.push("backtest uses the runtime model key without a matching execution and feature-contract receipt");
    if (compatibility === "incompatible") blockers.push("backtest model identity is incompatible with the live runtime model");
  }
  if (backtest.status !== "completed") blockers.push("backtest is not completed");
  if (backtest.sampleSize < snapshot.readiness.minimumRecommendedFixtures) blockers.push("sample is below the minimum recommendation");
  if (backtest.brierScore === null || backtest.logLoss === null) blockers.push("proper scoring metrics are missing");
  if (backtest.calibrationError === null || !backtest.calibrationBuckets.length || backtest.calibrationError > 0.08) {
    blockers.push("calibration has not passed the live threshold");
  }
  if (backtest.yield === null || backtest.yield <= 0) blockers.push("holdout yield is not positive");
  if (backtest.closingLineValue === null || backtest.closingLineValue <= 0) blockers.push("closing-line value is not positive");
  if (snapshot.sport === "football") {
    const provenanceBlocker = footballLearningProvenanceBlocker(backtest);
    if (provenanceBlocker) blockers.push(provenanceBlocker);
    if (evidence.compatibility === "exact-runtime-parity" && !evidence.playerEvidenceReady) {
      const observed = evidence.playerFormCoverage === null ? "unverified" : `${(evidence.playerFormCoverage * 100).toFixed(1)}%`;
      const required = `${((evidence.minimumPlayerFormCoverage ?? 0) * 100).toFixed(0)}%`;
      blockers.push(`player-form coverage is ${observed}; ${required} of chronology-safe fixtures is required`);
    }
  }
  if (Object.keys(backtest.learnedWeights).length < 3) blockers.push("learned-weight payload is incomplete");
  return blockers;
}

function profileReason({
  snapshot,
  backtest,
  active,
  demoOnly,
  promotionApproved,
  metricBlockers,
  durablePromotionRequired
}: {
  snapshot: TrainingDataSnapshot;
  backtest: StoredBacktestRun | null;
  active: boolean;
  demoOnly: boolean;
  promotionApproved: boolean;
  metricBlockers: string[];
  durablePromotionRequired: boolean;
}): string {
  if (snapshot.status === "not-configured") return snapshot.reason ?? "Supabase training reads are not configured.";
  if (snapshot.status === "failed") return snapshot.reason ?? "Training profile could not be read.";
  if (!backtest) return "No historical backtest is stored yet, so live decisions use conservative default guardrails.";
  if (demoOnly) return "Latest backtest includes demo-seed data, so it is displayed for smoke testing but not applied to live decisions.";
  if (!snapshot.readiness.readyForTraining) return snapshot.readiness.detail;
  if (!promotionApproved) {
    return durablePromotionRequired
      ? "Latest real-data backtest is available for shadow comparison only; live guardrails require an active model-bound calibration promotion."
      : "Latest real-data backtest is available for shadow comparison only; live guardrails require an explicit operator-approved promotion.";
  }
  if (metricBlockers.length) return `Latest real-data backtest remains shadow-only: ${metricBlockers.join("; ")}.`;
  if (!active) return "Latest backtest is present but not authorized to tune live decisions.";
  return "Latest real-data backtest has explicit live promotion and passed validation gates for value-edge and data-quality guardrails.";
}

export function buildDecisionLearningProfileFromSnapshot(
  snapshot: TrainingDataSnapshot,
  {
    activePromotion = null,
    requireDurablePromotion = false
  }: {
    activePromotion?: ActiveCalibrationPromotion | null;
    requireDurablePromotion?: boolean;
  } = {}
): DecisionLearningProfile {
  const backtest = snapshot.latestBacktest;
  const runtimeEvidence = inspectRuntimeBacktestEvidence(snapshot.sport, backtest);
  const promotionMatchesBacktest = Boolean(
    activePromotion && backtest && activePromotion.modelKey === backtest.modelKey && activePromotion.engineVersion === backtest.engineVersion
  );
  const promotedCalibrationBuckets = promotionMatchesBacktest ? calibrationBucketsFromPromotion(activePromotion) : [];
  const promotedBucketSample = promotedCalibrationBuckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0);
  const resolvedCalibrationBuckets =
    promotionMatchesBacktest && promotedBucketSample >= snapshot.readiness.minimumRecommendedFixtures
      ? promotedCalibrationBuckets
      : calibrationBuckets(backtest);
  const demoOnly = Boolean(backtest?.dataSource.includes("demo")) || snapshot.counts.realFinishedFixtures === 0;
  const promotionApproved = requireDurablePromotion ? promotionMatchesBacktest : promotionMatchesBacktest || hasExplicitLivePromotion(backtest);
  const metricBlockers = liveMetricBlockers(snapshot, backtest, runtimeEvidence);
  const shadowReady = snapshot.status === "ready" && Boolean(backtest) && snapshot.readiness.readyForTraining && !demoOnly;
  const active = shadowReady && promotionApproved && metricBlockers.length === 0;
  const status: DecisionLearningProfile["status"] =
    snapshot.status === "not-configured"
      ? "not-configured"
      : snapshot.status === "failed"
        ? "failed"
        : active
          ? "active"
          : shadowReady
            ? "shadow-only"
          : demoOnly && backtest
            ? "demo-only"
            : "untrained";

  return {
    status,
    source: activePromotion?.candidate.source ?? backtest?.dataSource ?? null,
    active,
    modelKey: backtest?.modelKey ?? activePromotion?.modelKey ?? null,
    engineVersion: backtest?.engineVersion ?? activePromotion?.engineVersion ?? null,
    modelCompatibility: runtimeEvidence.compatibility,
    calibrationPromotion: promotionMatchesBacktest && activePromotion
      ? { id: activePromotion.id, candidateId: activePromotion.candidateId, approvedAt: activePromotion.approvedAt, expiresAt: activePromotion.expiresAt }
      : null,
    sampleSize: backtest?.sampleSize ?? 0,
    testSize: backtest?.testSize ?? 0,
    realFinishedFixtures: snapshot.counts.realFinishedFixtures,
    minimumRecommendedFixtures: snapshot.readiness.minimumRecommendedFixtures,
    minimumEdge: learnedValue(backtest, "minimumEdge"),
    valueEdgeWeight: learnedValue(backtest, "valueEdgeWeight"),
    dataQualityWeight: learnedValue(backtest, "dataQualityWeight"),
    marketAdjustmentWeight: learnedValue(backtest, "marketAdjustmentWeight"),
    homeAdvantageElo: learnedValue(backtest, "homeAdvantageElo"),
    brierScore: backtest?.brierScore ?? null,
    logLoss: backtest?.logLoss ?? null,
    calibrationError: backtest?.calibrationError ?? null,
    yield: backtest?.yield ?? null,
    closingLineValue: backtest?.closingLineValue ?? null,
    playerFormFixtures: runtimeEvidence.playerFormFixtures,
    playerFormCoverage: runtimeEvidence.playerFormCoverage,
    playerFormTrainingCoverage: runtimeEvidence.playerFormTrainingCoverage,
    playerFormHoldoutCoverage: runtimeEvidence.playerFormHoldoutCoverage,
    minimumPlayerFormCoverage: runtimeEvidence.minimumPlayerFormCoverage,
    calibrationBuckets: resolvedCalibrationBuckets,
    generatedAt: snapshot.generatedAt,
    reason: profileReason({ snapshot, backtest, active, demoOnly, promotionApproved, metricBlockers, durablePromotionRequired: requireDurablePromotion }),
    notes: [
      ...(backtest?.notes ?? []),
      ...(shadowReady && !active ? ["Learned weights are available to the read-only shadow comparator but are disabled in live pick selection."] : []),
      ...(promotionMatchesBacktest && promotedBucketSample < snapshot.readiness.minimumRecommendedFixtures
        ? ["The approved live calibration cohort is retained as evidence; the larger historical curve remains active until the live cohort reaches the configured bucket sample floor."]
        : [])
    ]
  };
}

export async function getDecisionLearningProfile(sport: Sport = "football"): Promise<DecisionLearningProfile> {
  const [snapshot, promotionResult] = await Promise.all([getTrainingDataSnapshot(sport), readActiveCalibrationPromotion(sport)]);
  return buildDecisionLearningProfileFromSnapshot(snapshot, {
    activePromotion: promotionResult.status === "found" ? promotionResult.promotion : null,
    requireDurablePromotion: true
  });
}
