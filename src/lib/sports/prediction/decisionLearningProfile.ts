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

function economicSelectionPolicy(backtest: StoredBacktestRun | null): {
  status: "active" | "abstain" | null;
  allowedConfidenceBands: NonNullable<DecisionLearningProfile["allowedConfidenceBands"]> | null;
} {
  const policy = record(backtest?.config?.selectionPolicy);
  const validContract =
    policy.version === "economic-confidence-bands-v1" &&
    policy.source === "chronological-training-window";
  const status = validContract && (policy.status === "active" || policy.status === "abstain") ? policy.status : null;
  const allowedConfidenceBands = Array.isArray(policy.allowedConfidenceBands)
    ? policy.allowedConfidenceBands.filter(
        (value): value is "medium" | "high" => value === "medium" || value === "high"
      )
    : null;
  return { status, allowedConfidenceBands: validContract ? allowedConfidenceBands : null };
}

function probabilityTemperaturePolicy(
  backtest: StoredBacktestRun | null
): NonNullable<DecisionLearningProfile["probabilityTemperaturePolicy"]> | null {
  if (!backtest) return null;
  const policy = record(backtest.config?.probabilityCalibrationPolicy);
  const baseline = record(policy.baselineValidation);
  const calibrated = record(policy.calibratedValidation);
  const status = policy.status === "active" || policy.status === "identity" ? policy.status : null;
  const temperature = finiteNumber(policy.temperature);
  const fitSampleSize = finiteNumber(policy.fitSampleSize);
  const validationSampleSize = finiteNumber(policy.validationSampleSize);
  const fitWindowStart = typeof policy.fitWindowStart === "string" ? policy.fitWindowStart : null;
  const fitWindowEnd = typeof policy.fitWindowEnd === "string" ? policy.fitWindowEnd : null;
  const validationWindowStart = typeof policy.validationWindowStart === "string" ? policy.validationWindowStart : null;
  const validationWindowEnd = typeof policy.validationWindowEnd === "string" ? policy.validationWindowEnd : null;
  const holdoutWindowStart = typeof policy.holdoutWindowStart === "string" ? policy.holdoutWindowStart : null;
  const baselineBrier = finiteNumber(baseline.brierScore);
  const baselineLogLoss = finiteNumber(baseline.logLoss);
  const calibratedBrier = finiteNumber(calibrated.brierScore);
  const calibratedLogLoss = finiteNumber(calibrated.logLoss);
  const reason = policy.reason;
  const validReason =
    reason === "validated-proper-score-improvement" ||
    reason === "insufficient-training-sample" ||
    reason === "invalid-chronology" ||
    reason === "identity-won-fit" ||
    reason === "validation-did-not-improve";
  const validContract =
    policy.version === "temperature-scaling-v1" &&
    policy.source === "chronological-training-window" &&
    status !== null &&
    temperature !== null && temperature >= 0.5 && temperature <= 3 &&
    fitSampleSize !== null && fitSampleSize >= 0 && Number.isInteger(fitSampleSize) &&
    validationSampleSize !== null && validationSampleSize >= 0 && Number.isInteger(validationSampleSize) &&
    fitSampleSize + validationSampleSize === backtest.trainSize &&
    validReason;
  if (!validContract) return null;

  const chronologyValid = Boolean(
    fitWindowStart && fitWindowEnd && validationWindowStart && validationWindowEnd && holdoutWindowStart &&
    Number.isFinite(Date.parse(fitWindowStart)) &&
    Date.parse(fitWindowStart) <= Date.parse(fitWindowEnd) &&
    Date.parse(fitWindowEnd) < Date.parse(validationWindowStart) &&
    Date.parse(validationWindowStart) <= Date.parse(validationWindowEnd) &&
    Date.parse(validationWindowEnd) < Date.parse(holdoutWindowStart)
  );
  const metricsValid =
    fitSampleSize >= 40 && validationSampleSize >= 20 &&
    finiteNumber(baseline.sampleSize) === validationSampleSize &&
    finiteNumber(calibrated.sampleSize) === validationSampleSize &&
    baselineBrier !== null && calibratedBrier !== null && baselineLogLoss !== null && calibratedLogLoss !== null;
  if (!chronologyValid || !metricsValid) return null;

  if (status === "active") {
    const improvementValid =
      baselineLogLoss! - calibratedLogLoss! >= 0.0005 - 0.000001 &&
      calibratedBrier! - baselineBrier! <= 0.00025 + 0.000001;
    if (!improvementValid || Math.abs(temperature - 1) < 0.000001 || reason !== "validated-proper-score-improvement") return null;
  } else if (
    Math.abs(temperature - 1) >= 0.000001 ||
    (reason !== "identity-won-fit" && reason !== "validation-did-not-improve")
  ) {
    return null;
  }

  return {
    version: "temperature-scaling-v1",
    source: "chronological-training-window",
    status,
    temperature,
    fitSampleSize,
    validationSampleSize,
    fitWindowStart,
    fitWindowEnd,
    validationWindowStart,
    validationWindowEnd,
    holdoutWindowStart,
    baselineValidation: {
      sampleSize: finiteNumber(baseline.sampleSize) ?? 0,
      brierScore: baselineBrier,
      logLoss: baselineLogLoss
    },
    calibratedValidation: {
      sampleSize: finiteNumber(calibrated.sampleSize) ?? 0,
      brierScore: calibratedBrier,
      logLoss: calibratedLogLoss
    },
    reason: reason as NonNullable<DecisionLearningProfile["probabilityTemperaturePolicy"]>["reason"]
  };
}

function marketPriorScalingPolicy(
  backtest: StoredBacktestRun | null,
  temperaturePolicy: NonNullable<DecisionLearningProfile["probabilityTemperaturePolicy"]> | null
): NonNullable<DecisionLearningProfile["marketPriorScalingPolicy"]> | null {
  if (!backtest || !temperaturePolicy) return null;
  const policy = record(backtest.config?.marketPriorScalingPolicy);
  const baselineFit = record(policy.baselineFit);
  const candidateFit = record(policy.candidateFit);
  const baselineValidation = record(policy.baselineValidation);
  const candidateValidation = record(policy.candidateValidation);
  const status = policy.status === "active" || policy.status === "identity" ? policy.status : null;
  const weightScale = finiteNumber(policy.weightScale);
  const candidateWeightScale = finiteNumber(policy.candidateWeightScale);
  const fitSampleSize = finiteNumber(policy.fitSampleSize);
  const validationSampleSize = finiteNumber(policy.validationSampleSize);
  const fitWindowStart = typeof policy.fitWindowStart === "string" ? policy.fitWindowStart : null;
  const fitWindowEnd = typeof policy.fitWindowEnd === "string" ? policy.fitWindowEnd : null;
  const validationWindowStart = typeof policy.validationWindowStart === "string" ? policy.validationWindowStart : null;
  const validationWindowEnd = typeof policy.validationWindowEnd === "string" ? policy.validationWindowEnd : null;
  const holdoutWindowStart = typeof policy.holdoutWindowStart === "string" ? policy.holdoutWindowStart : null;
  const reason = policy.reason;
  const validReason =
    reason === "validated-proper-score-improvement" ||
    reason === "insufficient-priced-sample" ||
    reason === "invalid-chronology" ||
    reason === "identity-won-fit" ||
    reason === "validation-did-not-improve";
  const contractValid =
    policy.version === "market-prior-scaling-v1" &&
    policy.source === "chronological-priced-training-window" &&
    status !== null &&
    weightScale !== null && weightScale >= 0 && weightScale <= 3 &&
    candidateWeightScale !== null && candidateWeightScale >= 0 && candidateWeightScale <= 3 &&
    fitSampleSize !== null && Number.isInteger(fitSampleSize) && fitSampleSize >= 20 &&
    validationSampleSize !== null && Number.isInteger(validationSampleSize) && validationSampleSize >= 20 &&
    fitSampleSize + validationSampleSize <= temperaturePolicy.validationSampleSize &&
    validReason;
  if (!contractValid) return null;

  const timestamps = [fitWindowStart, fitWindowEnd, validationWindowStart, validationWindowEnd, holdoutWindowStart];
  const chronologyValid = timestamps.every((value) => value && Number.isFinite(Date.parse(value))) &&
    Date.parse(fitWindowStart!) >= Date.parse(temperaturePolicy.validationWindowStart!) &&
    Date.parse(fitWindowStart!) <= Date.parse(fitWindowEnd!) &&
    Date.parse(fitWindowEnd!) < Date.parse(validationWindowStart!) &&
    Date.parse(validationWindowStart!) <= Date.parse(validationWindowEnd!) &&
    Date.parse(validationWindowEnd!) <= Date.parse(temperaturePolicy.validationWindowEnd!) &&
    Date.parse(validationWindowEnd!) < Date.parse(holdoutWindowStart!) &&
    holdoutWindowStart === temperaturePolicy.holdoutWindowStart;
  if (!chronologyValid) return null;

  const scoreSummary = (value: Record<string, unknown>, expectedSampleSize: number) => {
    const sampleSize = finiteNumber(value.sampleSize);
    const brierScore = finiteNumber(value.brierScore);
    const logLoss = finiteNumber(value.logLoss);
    return sampleSize === expectedSampleSize && brierScore !== null && brierScore >= 0 && logLoss !== null && logLoss >= 0
      ? { sampleSize, brierScore, logLoss }
      : null;
  };
  const resolvedBaselineFit = scoreSummary(baselineFit, fitSampleSize!);
  const resolvedCandidateFit = scoreSummary(candidateFit, fitSampleSize!);
  const resolvedBaselineValidation = scoreSummary(baselineValidation, validationSampleSize!);
  const resolvedCandidateValidation = scoreSummary(candidateValidation, validationSampleSize!);
  if (!resolvedBaselineFit || !resolvedCandidateFit || !resolvedBaselineValidation || !resolvedCandidateValidation) return null;
  if (resolvedCandidateFit.logLoss > resolvedBaselineFit.logLoss + 0.000001) return null;

  const candidateImproved =
    resolvedBaselineValidation.logLoss - resolvedCandidateValidation.logLoss >= 0.0005 - 0.000001 &&
    resolvedCandidateValidation.brierScore - resolvedBaselineValidation.brierScore <= 0.00025 + 0.000001;
  if (status === "active") {
    if (
      !candidateImproved ||
      Math.abs(weightScale! - candidateWeightScale!) > 0.000001 ||
      Math.abs(weightScale! - 1) < 0.000001 ||
      reason !== "validated-proper-score-improvement"
    ) return null;
  } else if (
    Math.abs(weightScale! - 1) >= 0.000001 ||
    (reason !== "identity-won-fit" && reason !== "validation-did-not-improve") ||
    (reason === "identity-won-fit" && Math.abs(candidateWeightScale! - 1) >= 0.000001) ||
    (reason === "validation-did-not-improve" && (Math.abs(candidateWeightScale! - 1) < 0.000001 || candidateImproved))
  ) {
    return null;
  }

  return {
    version: "market-prior-scaling-v1",
    source: "chronological-priced-training-window",
    status,
    weightScale: weightScale!,
    candidateWeightScale: candidateWeightScale!,
    fitSampleSize: fitSampleSize!,
    validationSampleSize: validationSampleSize!,
    fitWindowStart,
    fitWindowEnd,
    validationWindowStart,
    validationWindowEnd,
    holdoutWindowStart,
    baselineFit: resolvedBaselineFit,
    candidateFit: resolvedCandidateFit,
    baselineValidation: resolvedBaselineValidation,
    candidateValidation: resolvedCandidateValidation,
    reason: reason as NonNullable<DecisionLearningProfile["marketPriorScalingPolicy"]>["reason"]
  };
}

function empiricalValueGuardPolicy(
  backtest: StoredBacktestRun | null,
  marketPolicy: NonNullable<DecisionLearningProfile["marketPriorScalingPolicy"]> | null
): NonNullable<DecisionLearningProfile["empiricalValueGuardPolicy"]> | null {
  if (!backtest || !marketPolicy) return null;
  const policy = record(backtest.config?.empiricalValueGuardPolicy);
  const status = policy.status === "active" || policy.status === "abstain" ? policy.status : null;
  const confidenceLevel = finiteNumber(policy.confidenceLevel);
  const minimumBucketSample = finiteNumber(policy.minimumBucketSample);
  const sampleSize = finiteNumber(policy.sampleSize);
  const windowStart = typeof policy.windowStart === "string" ? policy.windowStart : null;
  const windowEnd = typeof policy.windowEnd === "string" ? policy.windowEnd : null;
  const holdoutWindowStart = typeof policy.holdoutWindowStart === "string" ? policy.holdoutWindowStart : null;
  const reason = policy.reason;
  const selectionCount = backtest.sport === "football" ? 3 : backtest.sport === "basketball" || backtest.sport === "tennis" ? 2 : 0;
  const contractValid =
    policy.version === "empirical-value-guard-v1" &&
    policy.source === "chronological-final-posterior-training-window" &&
    status !== null &&
    confidenceLevel === 0.95 &&
    minimumBucketSample !== null && Number.isInteger(minimumBucketSample) && minimumBucketSample >= 30 &&
    sampleSize !== null && Number.isInteger(sampleSize) && sampleSize === marketPolicy.validationSampleSize * selectionCount &&
    (reason === "eligible-probability-buckets" || reason === "insufficient-bucket-sample");
  if (!contractValid) return null;

  const chronologyValid = Boolean(
    windowStart && windowEnd && holdoutWindowStart && marketPolicy.validationWindowStart && marketPolicy.validationWindowEnd &&
    Number.isFinite(Date.parse(windowStart)) &&
    Date.parse(windowStart) >= Date.parse(marketPolicy.validationWindowStart) &&
    Date.parse(windowStart) <= Date.parse(windowEnd) &&
    Date.parse(windowEnd) <= Date.parse(marketPolicy.validationWindowEnd) &&
    Date.parse(windowEnd) < Date.parse(holdoutWindowStart) &&
    holdoutWindowStart === marketPolicy.holdoutWindowStart
  );
  if (!chronologyValid || !Array.isArray(policy.buckets)) return null;

  const z = 1.6448536269514722;
  const wilsonFloor = (observedRate: number, count: number) => {
    const zSquared = z * z;
    const denominator = 1 + zSquared / count;
    const center = (observedRate + zSquared / (2 * count)) / denominator;
    const margin = z * Math.sqrt((observedRate * (1 - observedRate)) / count + zSquared / (4 * count * count)) / denominator;
    return Math.max(0, center - margin);
  };
  const buckets = policy.buckets.flatMap((value) => {
    const bucket = record(value);
    const minProbability = finiteNumber(bucket.minProbability);
    const maxProbability = finiteNumber(bucket.maxProbability);
    const bucketSampleSize = finiteNumber(bucket.sampleSize);
    const averageProbability = finiteNumber(bucket.averageProbability);
    const observedRate = finiteNumber(bucket.observedRate);
    const probabilityFloor = bucket.probabilityFloor === null ? null : finiteNumber(bucket.probabilityFloor);
    const eligible = bucket.eligible === true;
    const valid =
      minProbability !== null && minProbability >= 0 &&
      maxProbability !== null && maxProbability <= 1 && maxProbability > minProbability &&
      Math.abs(maxProbability - minProbability - 0.1) <= 0.000001 &&
      Math.abs(minProbability * 10 - Math.round(minProbability * 10)) <= 0.000001 &&
      bucketSampleSize !== null && Number.isInteger(bucketSampleSize) && bucketSampleSize > 0 &&
      averageProbability !== null && averageProbability >= minProbability && averageProbability <= maxProbability &&
      observedRate !== null && observedRate >= 0 && observedRate <= 1 &&
      Math.abs(observedRate * bucketSampleSize - Math.round(observedRate * bucketSampleSize)) <= 0.0001 &&
      eligible === (bucketSampleSize >= minimumBucketSample!) &&
      (eligible
        ? probabilityFloor !== null && Math.abs(probabilityFloor - wilsonFloor(observedRate, bucketSampleSize)) <= 0.000002
        : probabilityFloor === null);
    return valid ? [{ minProbability, maxProbability, sampleSize: bucketSampleSize, averageProbability, observedRate, probabilityFloor, eligible }] : [];
  }).sort((left, right) => left.minProbability - right.minProbability);
  if (buckets.length !== policy.buckets.length || !buckets.length) return null;
  if (buckets.some((bucket, index) => index > 0 && bucket.minProbability < buckets[index - 1]!.maxProbability)) return null;
  if (buckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0) !== sampleSize) return null;
  const eligibleBuckets = buckets.filter((bucket) => bucket.eligible);
  if (
    (status === "active" && (!eligibleBuckets.length || reason !== "eligible-probability-buckets")) ||
    (status === "abstain" && (eligibleBuckets.length > 0 || reason !== "insufficient-bucket-sample"))
  ) return null;

  return {
    version: "empirical-value-guard-v1",
    source: "chronological-final-posterior-training-window",
    status,
    confidenceLevel: 0.95,
    minimumBucketSample: minimumBucketSample!,
    sampleSize: sampleSize!,
    windowStart,
    windowEnd,
    holdoutWindowStart,
    buckets,
    reason: reason as NonNullable<DecisionLearningProfile["empiricalValueGuardPolicy"]>["reason"]
  };
}

function empiricalValueGuardComparison(
  backtest: StoredBacktestRun | null,
  policy: NonNullable<DecisionLearningProfile["empiricalValueGuardPolicy"]> | null
): NonNullable<DecisionLearningProfile["empiricalValueGuardComparison"]> | null {
  if (!backtest || !policy) return null;
  const comparison = record(backtest.config?.empiricalValueGuardComparison);
  const baseline = record(comparison.baseline);
  const selected = record(comparison.selected);
  const picksRemoved = finiteNumber(comparison.picksRemoved);
  const metrics = (value: Record<string, unknown>) => {
    const pickCount = finiteNumber(value.pickCount);
    const roiUnits = finiteNumber(value.roiUnits);
    const yieldValue = value.yield === null ? null : finiteNumber(value.yield);
    const expectedYield = pickCount && roiUnits !== null
      ? Math.round((roiUnits / pickCount) * 1_000_000) / 1_000_000
      : null;
    const valid =
      pickCount !== null && Number.isInteger(pickCount) && pickCount >= 0 && pickCount <= backtest.testSize &&
      roiUnits !== null &&
      (pickCount === 0
        ? roiUnits === 0 && value.yield === null
        : yieldValue !== null && Math.abs(yieldValue - expectedYield!) <= 0.000001);
    return valid ? { pickCount, roiUnits, yield: yieldValue } : null;
  };
  const resolvedBaseline = metrics(baseline);
  const resolvedSelected = metrics(selected);
  if (
    !resolvedBaseline || !resolvedSelected ||
    picksRemoved === null || !Number.isInteger(picksRemoved) ||
    resolvedSelected.pickCount > resolvedBaseline.pickCount ||
    picksRemoved !== resolvedBaseline.pickCount - resolvedSelected.pickCount ||
    (policy.status === "abstain" && resolvedSelected.pickCount !== 0)
  ) return null;
  return { baseline: resolvedBaseline, selected: resolvedSelected, picksRemoved };
}

type MarketPriorReplayReceipt = {
  valid: boolean;
  status: "applied" | "no-priced-market" | null;
  adjustedFixtures: number | null;
  coverage: number | null;
  averageWeight: number | null;
};

function marketPriorReplayReceipt(backtest: StoredBacktestRun | null): MarketPriorReplayReceipt {
  if (!backtest) return { valid: false, status: null, adjustedFixtures: null, coverage: null, averageWeight: null };
  const evidence = record(backtest.config?.marketPriorEvidence);
  const comparison = record(evidence.probabilityComparison);
  const baseline = record(comparison.baseline);
  const posterior = record(comparison.calibrated);
  const contract = record(backtest.config?.featureContract);
  const optionalCoverage = record(contract.optionalCoverage);
  const status = evidence.status === "applied" || evidence.status === "no-priced-market" ? evidence.status : null;
  const evaluatedFixtures = finiteNumber(evidence.evaluatedFixtures);
  const adjustedFixtures = finiteNumber(evidence.adjustedFixtures);
  const adjustedSelections = finiteNumber(evidence.adjustedSelections);
  const coverage = finiteNumber(evidence.coverage);
  const averageWeight = finiteNumber(evidence.averageWeight);
  const averageBookmakerMargin = evidence.averageBookmakerMargin === null
    ? null
    : finiteNumber(evidence.averageBookmakerMargin);
  const completeOddsFixtures = finiteNumber(optionalCoverage.completeOddsFixtures);
  const baselineSampleSize = finiteNumber(baseline.sampleSize);
  const posteriorSampleSize = finiteNumber(posterior.sampleSize);
  const baselineBrier = finiteNumber(baseline.brierScore);
  const baselineLogLoss = finiteNumber(baseline.logLoss);
  const posteriorBrier = finiteNumber(posterior.brierScore);
  const posteriorLogLoss = finiteNumber(posterior.logLoss);
  const brierDelta = finiteNumber(comparison.brierDelta);
  const logLossDelta = finiteNumber(comparison.logLossDelta);
  const expectedCoverage = adjustedFixtures !== null && evaluatedFixtures && evaluatedFixtures > 0
    ? adjustedFixtures / evaluatedFixtures
    : 0;
  const countsValid =
    evaluatedFixtures === backtest.testSize &&
    adjustedFixtures !== null && Number.isInteger(adjustedFixtures) && adjustedFixtures >= 0 && adjustedFixtures <= evaluatedFixtures &&
    adjustedSelections !== null && Number.isInteger(adjustedSelections) &&
    adjustedSelections >= adjustedFixtures * 2 && adjustedSelections <= adjustedFixtures * 3;
  const statusValid =
    (status === "applied" && adjustedFixtures !== null && adjustedFixtures > 0) ||
    (status === "no-priced-market" && adjustedFixtures === 0);
  const weightValid = adjustedFixtures === 0
    ? evidence.averageWeight === null && evidence.averageBookmakerMargin === null
    : averageWeight !== null && averageWeight >= 0 && averageWeight <= 0.9 && averageBookmakerMargin !== null;
  const comparisonValid =
    baselineSampleSize === backtest.testSize &&
    posteriorSampleSize === backtest.testSize &&
    baselineBrier !== null && baselineBrier >= 0 &&
    baselineLogLoss !== null && baselineLogLoss >= 0 &&
    posteriorBrier !== null && posteriorBrier >= 0 &&
    posteriorLogLoss !== null && posteriorLogLoss >= 0 &&
    brierDelta !== null && Math.abs(brierDelta - (posteriorBrier - baselineBrier)) <= 0.000002 &&
    logLossDelta !== null && Math.abs(logLossDelta - (posteriorLogLoss - baselineLogLoss)) <= 0.000002;
  const valid =
    evidence.version === "runtime-market-prior-parity-v1" &&
    status !== null &&
    countsValid &&
    statusValid &&
    coverage !== null && coverage >= 0 && coverage <= 1 && Math.abs(coverage - expectedCoverage) <= 0.000001 &&
    weightValid &&
    comparisonValid &&
    !(completeOddsFixtures !== null && completeOddsFixtures > 0 && adjustedFixtures === 0);

  return {
    valid,
    status: valid ? status : null,
    adjustedFixtures: valid ? adjustedFixtures : null,
    coverage: valid ? coverage : null,
    averageWeight: valid ? averageWeight : null
  };
}

function footballLearningProvenanceBlocker(backtest: StoredBacktestRun): string | null {
  const provenance = record(backtest.config?.learnedWeightsProvenance);
  if (provenance.source !== "training-window" && provenance.source !== "training-validation-window") {
    return "learned weights lack training-window-only provenance";
  }

  const sampleSize = finiteNumber(provenance.sampleSize);
  const expectedSampleSize = provenance.source === "training-validation-window"
    ? marketPriorScalingPolicy(backtest, probabilityTemperaturePolicy(backtest))?.validationSampleSize ??
      probabilityTemperaturePolicy(backtest)?.validationSampleSize ?? null
    : backtest.trainSize;
  if (sampleSize === null || sampleSize <= 0 || expectedSampleSize === null || sampleSize !== expectedSampleSize) {
    return provenance.source === "training-validation-window"
      ? "learned-weight provenance does not cover the complete prospective training-validation window"
      : "learned-weight provenance does not cover the complete training window";
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
  if (!evidence.realDataOnly) blockers.push("backtest source is not verified as real-only runtime evidence");
  if (backtest.sampleSize < snapshot.readiness.minimumRecommendedFixtures) blockers.push("sample is below the minimum recommendation");
  if (backtest.brierScore === null || backtest.logLoss === null) blockers.push("proper scoring metrics are missing");
  if (backtest.calibrationError === null || !backtest.calibrationBuckets.length || backtest.calibrationError > 0.08) {
    blockers.push("calibration has not passed the live threshold");
  }
  if (backtest.yield === null || backtest.yield <= 0) blockers.push("holdout yield is not positive");
  if (backtest.closingLineValue === null || backtest.closingLineValue <= 0) blockers.push("closing-line value is not positive");
  if (evidence.compatibility === "exact-runtime-parity") {
    const calibrationPolicy = probabilityTemperaturePolicy(backtest);
    if (!calibrationPolicy) {
      blockers.push("runtime replay lacks a valid training-only probability calibration policy");
    }
    if (!marketPriorScalingPolicy(backtest, calibrationPolicy)) {
      blockers.push("runtime replay lacks a valid training-only market-prior scaling policy");
    }
    const valueGuardPolicy = empiricalValueGuardPolicy(backtest, marketPriorScalingPolicy(backtest, calibrationPolicy));
    if (!valueGuardPolicy) {
      blockers.push("runtime replay lacks a valid training-only empirical value guard policy");
    } else if (valueGuardPolicy.status === "abstain") {
      blockers.push("training-only empirical value guard policy abstains");
    }
    if (!empiricalValueGuardComparison(backtest, valueGuardPolicy)) {
      blockers.push("runtime replay lacks a valid empirical value guard holdout comparison");
    }
    if (!marketPriorReplayReceipt(backtest).valid) {
      blockers.push("runtime replay lacks a valid pre-match market-prior parity receipt");
    }
    const policy = economicSelectionPolicy(backtest);
    if (policy.status === null || policy.allowedConfidenceBands === null) {
      blockers.push("runtime replay lacks a training-only economic selection policy");
    } else if (policy.status === "abstain" || policy.allowedConfidenceBands.length === 0) {
      blockers.push("training-only economic selection policy abstains");
    }
  }
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
  const demoOnly = Boolean(backtest?.dataSource?.includes("demo")) || snapshot.counts.realFinishedFixtures === 0;
  const promotionApproved = requireDurablePromotion ? promotionMatchesBacktest : promotionMatchesBacktest || hasExplicitLivePromotion(backtest);
  const metricBlockers = liveMetricBlockers(snapshot, backtest, runtimeEvidence);
  const selectionPolicy = economicSelectionPolicy(backtest);
  const temperaturePolicy = probabilityTemperaturePolicy(backtest);
  const scalingPolicy = marketPriorScalingPolicy(backtest, temperaturePolicy);
  const valueGuardPolicy = empiricalValueGuardPolicy(backtest, scalingPolicy);
  const valueGuardComparison = empiricalValueGuardComparison(backtest, valueGuardPolicy);
  const marketPriorReceipt = marketPriorReplayReceipt(backtest);
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
    economicSelectionPolicyStatus: selectionPolicy.status,
    allowedConfidenceBands: selectionPolicy.allowedConfidenceBands,
    probabilityTemperaturePolicy: temperaturePolicy,
    marketPriorScalingPolicy: scalingPolicy,
    empiricalValueGuardPolicy: valueGuardPolicy,
    empiricalValueGuardComparison: valueGuardComparison,
    marketPriorReplayStatus: marketPriorReceipt.status,
    marketPriorReplayAdjustedFixtures: marketPriorReceipt.adjustedFixtures,
    marketPriorReplayCoverage: marketPriorReceipt.coverage,
    marketPriorReplayAverageWeight: marketPriorReceipt.averageWeight,
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
