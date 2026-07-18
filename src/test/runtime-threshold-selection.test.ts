import { describe, expect, it } from "vitest";

import {
  isGovernedRuntimeThresholdSelection,
  selectNestedRuntimeThreshold,
  type RuntimeThreshold,
  type RuntimeThresholdMetrics
} from "@/lib/sports/training/runtimeThresholdSelection";

function metrics(sampleSize: number, pickCount: number, unitReturn: number, clv = 0.01): RuntimeThresholdMetrics {
  return {
    sampleSize,
    pickCount,
    yield: pickCount ? unitReturn : null,
    closingLineValue: pickCount ? clv : null,
    unitReturns: Array.from({ length: pickCount }, () => unitReturn)
  };
}

describe("nested runtime threshold selection", () => {
  const baseline: RuntimeThreshold = { minEdge: 0.04, minModelProbability: 0.4 };

  it("applies a profitable tuning threshold only after later chronological validation", () => {
    const selection = selectNestedRuntimeThreshold({
      baseline,
      tuningSampleSize: 1_000,
      validationSampleSize: 250,
      edgeCandidates: [0.05, 0.06],
      probabilityCandidates: [0.5],
      evaluateTuning: (threshold) => threshold.minEdge === 0.06
        ? metrics(1_000, 40, 0.12, 0.02)
        : metrics(1_000, 60, 0.03, 0.005),
      evaluateValidation: (threshold) => threshold.minEdge === 0.06
        ? metrics(250, 24, 0.05, 0.01)
        : metrics(250, 20, -0.02, -0.01)
    });

    expect(selection.status).toBe("selected");
    expect(selection.applied).toEqual({ minEdge: 0.06, minModelProbability: 0.4 });
    expect(selection.validation).toMatchObject({ pickCount: 24, yield: 0.05 });
    expect(selection.validationLowerYieldBound).toBe(0.05);
    expect(isGovernedRuntimeThresholdSelection(selection)).toBe(true);
  });

  it("retains the baseline when the tuning winner fails the later validation window", () => {
    const selection = selectNestedRuntimeThreshold({
      baseline,
      tuningSampleSize: 1_000,
      validationSampleSize: 250,
      edgeCandidates: [0.06],
      probabilityCandidates: [0.5],
      evaluateTuning: () => metrics(1_000, 50, 0.1, 0.02),
      evaluateValidation: () => metrics(250, 12, -0.08, -0.01)
    });

    expect(selection.status).toBe("validation-failed");
    expect(selection.applied).toEqual(baseline);
    expect(isGovernedRuntimeThresholdSelection(selection)).toBe(true);
  });

  it("does not optimize on tiny training partitions", () => {
    const selection = selectNestedRuntimeThreshold({
      baseline,
      tuningSampleSize: 20,
      validationSampleSize: 5,
      edgeCandidates: [0.06],
      probabilityCandidates: [0.5],
      evaluateTuning: () => metrics(20, 20, 1),
      evaluateValidation: () => metrics(5, 5, 1)
    });

    expect(selection.status).toBe("insufficient-evidence");
    expect(selection.candidates).toEqual([]);
    expect(selection.applied).toEqual(baseline);
    expect(isGovernedRuntimeThresholdSelection(selection)).toBe(true);
  });

  it("rejects a positive point estimate when the uncertainty bound still crosses zero", () => {
    const noisyReturns = Array.from({ length: 50 }, (_, index) => index < 26 ? 1 : -1);
    const selection = selectNestedRuntimeThreshold({
      baseline,
      tuningSampleSize: 1_000,
      validationSampleSize: 250,
      edgeCandidates: [0.06],
      probabilityCandidates: [0.5],
      evaluateTuning: () => ({
        sampleSize: 1_000,
        pickCount: noisyReturns.length,
        yield: 0.04,
        closingLineValue: 0.01,
        unitReturns: noisyReturns
      }),
      evaluateValidation: () => metrics(250, 20, 0.1)
    });

    expect(selection.status).toBe("no-profitable-candidate");
    expect(selection.candidates[0]?.blockers).toContain("one-sided 95% tuning yield bound is not positive");
  });

  it("rejects forged selected receipts", () => {
    expect(isGovernedRuntimeThresholdSelection({
      version: "nested-chronological-economics-v2",
      status: "selected",
      baseline,
      applied: { minEdge: 0.06, minModelProbability: 0.5 },
      tuningSampleSize: 1_000,
      validationSampleSize: 250,
      minimumTuningPicks: 30,
      minimumValidationPicks: 20,
      selectedCandidate: { minEdge: 0.06, minModelProbability: 0.5 },
      validation: { sampleSize: 250, pickCount: 20, yield: 0.01, closingLineValue: 0.01 },
      validationLowerYieldBound: -0.02,
      candidates: [],
      reason: "forged"
    })).toBe(false);
  });
});
