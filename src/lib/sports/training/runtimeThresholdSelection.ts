export type RuntimeThreshold = {
  minEdge: number;
  minModelProbability: number;
};

export type RuntimeThresholdMetrics = {
  sampleSize: number;
  pickCount: number;
  yield: number | null;
  closingLineValue: number | null;
  unitReturns: number[];
};

export type RuntimeThresholdCandidate = RuntimeThreshold & {
  tuning: Omit<RuntimeThresholdMetrics, "unitReturns">;
  score: number | null;
  lowerYieldBound: number | null;
  blockers: string[];
};

export type RuntimeThresholdSelection = {
  version: "nested-chronological-economics-v2";
  status: "selected" | "insufficient-evidence" | "no-profitable-candidate" | "validation-failed";
  baseline: RuntimeThreshold;
  applied: RuntimeThreshold;
  tuningSampleSize: number;
  validationSampleSize: number;
  minimumTuningPicks: number;
  minimumValidationPicks: number;
  selectedCandidate: RuntimeThresholdCandidate | null;
  validation: Omit<RuntimeThresholdMetrics, "unitReturns"> | null;
  validationLowerYieldBound: number | null;
  candidates: RuntimeThresholdCandidate[];
  reason: string;
};

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lowerYieldBound(unitReturns: number[]): number | null {
  if (unitReturns.length < 2) return null;
  const mean = unitReturns.reduce((sum, value) => sum + value, 0) / unitReturns.length;
  const variance = unitReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (unitReturns.length - 1);
  return round(mean - 1.645 * Math.sqrt(variance / unitReturns.length));
}

function publicMetrics(metrics: RuntimeThresholdMetrics): Omit<RuntimeThresholdMetrics, "unitReturns"> {
  return {
    sampleSize: metrics.sampleSize,
    pickCount: metrics.pickCount,
    yield: round(metrics.yield),
    closingLineValue: round(metrics.closingLineValue)
  };
}

function uniqueThresholds(
  edges: number[],
  probabilities: number[]
): RuntimeThreshold[] {
  const rows = edges.flatMap((minEdge) => probabilities.map((minModelProbability) => ({ minEdge, minModelProbability })));
  return [...new Map(rows.map((row) => [`${row.minEdge.toFixed(6)}:${row.minModelProbability.toFixed(6)}`, row])).values()];
}

/**
 * Chooses a coarse betting threshold on an early training window, confirms it
 * once on a later training-validation window, and never observes the outer
 * holdout. Failed confirmation retains the baseline for honest diagnosis.
 */
export function selectNestedRuntimeThreshold({
  baseline,
  tuningSampleSize,
  validationSampleSize,
  edgeCandidates,
  probabilityCandidates,
  evaluateTuning,
  evaluateValidation
}: {
  baseline: RuntimeThreshold;
  tuningSampleSize: number;
  validationSampleSize: number;
  edgeCandidates: number[];
  probabilityCandidates: number[];
  evaluateTuning: (threshold: RuntimeThreshold) => RuntimeThresholdMetrics;
  evaluateValidation: (threshold: RuntimeThreshold) => RuntimeThresholdMetrics;
}): RuntimeThresholdSelection {
  const minimumTuningPicks = Math.max(30, Math.ceil(tuningSampleSize * 0.02));
  const minimumValidationPicks = Math.max(20, Math.ceil(validationSampleSize * 0.01));
  const minimumNestedSample = 500;

  if (tuningSampleSize < minimumNestedSample || validationSampleSize < 100) {
    return {
      version: "nested-chronological-economics-v2",
      status: "insufficient-evidence",
      baseline,
      applied: baseline,
      tuningSampleSize,
      validationSampleSize,
      minimumTuningPicks,
      minimumValidationPicks,
      selectedCandidate: null,
      validation: null,
      validationLowerYieldBound: null,
      candidates: [],
      reason: "Nested threshold selection needs at least 500 tuning fixtures and 100 chronological validation fixtures."
    };
  }

  const candidates = uniqueThresholds(
    [baseline.minEdge, ...edgeCandidates],
    [baseline.minModelProbability, ...probabilityCandidates]
  ).map((threshold): RuntimeThresholdCandidate => {
    const metrics = evaluateTuning(threshold);
    const lowerBound = lowerYieldBound(metrics.unitReturns);
    const blockers = [
      metrics.pickCount < minimumTuningPicks ? `${metrics.pickCount}/${minimumTuningPicks} tuning picks` : null,
      metrics.yield === null || metrics.yield <= 0 ? "tuning yield is not positive" : null,
      lowerBound === null || lowerBound <= 0 ? "one-sided 95% tuning yield bound is not positive" : null,
      metrics.closingLineValue !== null && metrics.closingLineValue < 0 ? "tuning closing-line value is negative" : null
    ].filter((value): value is string => Boolean(value));
    const evidenceWeight = metrics.pickCount / (metrics.pickCount + 25);
    const score = blockers.length || metrics.yield === null
      ? null
      : round(
          metrics.yield * evidenceWeight +
          (metrics.closingLineValue ?? 0) * 0.2 +
          (lowerBound ?? metrics.yield) * 0.25
        );
    return {
      ...threshold,
      tuning: publicMetrics(metrics),
      score,
      lowerYieldBound: lowerBound,
      blockers
    };
  }).sort((left, right) =>
    (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY) ||
    right.tuning.pickCount - left.tuning.pickCount ||
    left.minEdge - right.minEdge ||
    left.minModelProbability - right.minModelProbability
  );

  const selectedCandidate = candidates.find((candidate) => candidate.score !== null) ?? null;
  if (!selectedCandidate) {
    return {
      version: "nested-chronological-economics-v2",
      status: "no-profitable-candidate",
      baseline,
      applied: baseline,
      tuningSampleSize,
      validationSampleSize,
      minimumTuningPicks,
      minimumValidationPicks,
      selectedCandidate: null,
      validation: null,
      validationLowerYieldBound: null,
      candidates,
      reason: "No coarse threshold produced enough tuning picks with a positive one-sided 95% yield bound and non-negative observed closing-line value."
    };
  }

  const validationMetrics = evaluateValidation(selectedCandidate);
  const validation = publicMetrics(validationMetrics);
  const validationLowerYieldBound = lowerYieldBound(validationMetrics.unitReturns);
  const validationPasses =
    validationMetrics.pickCount >= minimumValidationPicks &&
    validationMetrics.yield !== null &&
    validationMetrics.yield > 0 &&
    validationLowerYieldBound !== null &&
    validationLowerYieldBound > 0 &&
    (validationMetrics.closingLineValue === null || validationMetrics.closingLineValue >= 0);
  if (!validationPasses) {
    return {
      version: "nested-chronological-economics-v2",
      status: "validation-failed",
      baseline,
      applied: baseline,
      tuningSampleSize,
      validationSampleSize,
      minimumTuningPicks,
      minimumValidationPicks,
      selectedCandidate,
      validation,
      validationLowerYieldBound,
      candidates,
      reason: `The top tuning threshold failed chronological confirmation: ${validation.pickCount}/${minimumValidationPicks} picks, yield ${validation.yield ?? "n/a"}, one-sided 95% lower bound ${validationLowerYieldBound ?? "n/a"}, CLV ${validation.closingLineValue ?? "n/a"}.`
    };
  }

  const applied = {
    minEdge: selectedCandidate.minEdge,
    minModelProbability: selectedCandidate.minModelProbability
  };
  return {
    version: "nested-chronological-economics-v2",
    status: "selected",
    baseline,
    applied,
    tuningSampleSize,
    validationSampleSize,
    minimumTuningPicks,
    minimumValidationPicks,
    selectedCandidate,
    validation,
    validationLowerYieldBound,
    candidates,
    reason: `Selected edge ${applied.minEdge} and model probability ${applied.minModelProbability} on tuning data, then confirmed a positive one-sided 95% yield bound on the later training-validation window.`
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validThreshold(value: unknown): value is RuntimeThreshold {
  const row = record(value);
  return typeof row.minEdge === "number" && Number.isFinite(row.minEdge) && row.minEdge >= 0 && row.minEdge <= 1 &&
    typeof row.minModelProbability === "number" && Number.isFinite(row.minModelProbability) &&
    row.minModelProbability >= 0 && row.minModelProbability <= 1;
}

function sameThreshold(left: RuntimeThreshold, right: RuntimeThreshold): boolean {
  return left.minEdge === right.minEdge && left.minModelProbability === right.minModelProbability;
}

/** Validates the persisted receipt before learned thresholds can influence live decisions. */
export function isGovernedRuntimeThresholdSelection(value: unknown): value is RuntimeThresholdSelection {
  const row = record(value);
  if (
    row.version !== "nested-chronological-economics-v2" ||
    !["selected", "insufficient-evidence", "no-profitable-candidate", "validation-failed"].includes(String(row.status)) ||
    !validThreshold(row.baseline) ||
    !validThreshold(row.applied) ||
    !Number.isInteger(row.tuningSampleSize) || Number(row.tuningSampleSize) < 0 ||
    !Number.isInteger(row.validationSampleSize) || Number(row.validationSampleSize) < 0 ||
    !Number.isInteger(row.minimumTuningPicks) || Number(row.minimumTuningPicks) < 30 ||
    !Number.isInteger(row.minimumValidationPicks) || Number(row.minimumValidationPicks) < 20 ||
    !Array.isArray(row.candidates) ||
    typeof row.reason !== "string" || !row.reason
  ) return false;

  if (row.status === "selected") {
    const selected = record(row.selectedCandidate);
    const validation = record(row.validation);
    return validThreshold(selected) &&
      sameThreshold(row.applied, selected) &&
      row.applied.minEdge >= row.baseline.minEdge &&
      row.applied.minModelProbability >= row.baseline.minModelProbability &&
      typeof validation.pickCount === "number" && validation.pickCount >= Number(row.minimumValidationPicks) &&
      typeof validation.yield === "number" && validation.yield > 0 &&
      typeof row.validationLowerYieldBound === "number" && row.validationLowerYieldBound > 0 &&
      (validation.closingLineValue === null || (typeof validation.closingLineValue === "number" && validation.closingLineValue >= 0));
  }

  return sameThreshold(row.applied, row.baseline);
}
