import { describe, expect, it } from "vitest";

import {
  applyEconomicSelectionPolicy,
  buildEconomicSelectionComparison,
  learnEconomicSelectionPolicy
} from "@/lib/sports/training/economicSelectionPolicy";

function results(confidence: "low" | "medium" | "high", returns: number[]) {
  return returns.map((unitReturn, index) => ({
    id: `${confidence}-${index}`,
    pick: { confidence, unitReturn, edge: 0.08 }
  }));
}

describe("training-only economic selection policy", () => {
  it("admits an economically robust medium band while rejecting a losing high-confidence band", () => {
    const policy = learnEconomicSelectionPolicy([
      ...results("medium", Array.from({ length: 30 }, () => 0.2)),
      ...results("high", Array.from({ length: 30 }, () => -0.1))
    ]);

    expect(policy.status).toBe("active");
    expect(policy.allowedConfidenceBands).toEqual(["medium"]);
    expect(policy.bands.find((band) => band.confidence === "medium")).toMatchObject({
      eligible: true,
      reason: "eligible-positive-lower-bound",
      sampleSize: 30
    });
    expect(policy.bands.find((band) => band.confidence === "high")).toMatchObject({
      eligible: false,
      reason: "non-positive-yield"
    });
  });

  it("abstains when a positive-looking band is too small", () => {
    const policy = learnEconomicSelectionPolicy(results("medium", Array.from({ length: 29 }, () => 0.3)));

    expect(policy.status).toBe("abstain");
    expect(policy.allowedConfidenceBands).toEqual([]);
    expect(policy.bands.find((band) => band.confidence === "medium")?.reason).toBe("below-minimum-sample");
  });

  it("abstains when sampling uncertainty crosses break-even despite positive observed yield", () => {
    const returns = [...Array.from({ length: 17 }, () => 1), ...Array.from({ length: 13 }, () => -1)];
    const policy = learnEconomicSelectionPolicy(results("high", returns));
    const high = policy.bands.find((band) => band.confidence === "high");

    expect(high?.yield).toBeGreaterThan(0);
    expect(high?.yieldLowerBound).toBeLessThan(0);
    expect(high?.reason).toBe("lower-bound-not-positive");
    expect(policy.status).toBe("abstain");
  });

  it("applies the learned band gate unchanged and preserves probability rows while removing picks", () => {
    const policy = learnEconomicSelectionPolicy(results("medium", Array.from({ length: 30 }, () => 0.2)));
    const holdout = [
      { id: "medium", probability: 0.6, pick: { confidence: "medium" as const, unitReturn: 0.8, edge: 0.07 } },
      { id: "high", probability: 0.7, pick: { confidence: "high" as const, unitReturn: -1, edge: 0.12 } }
    ];

    const selected = applyEconomicSelectionPolicy(holdout, policy);

    expect(selected[0]).toEqual(holdout[0]);
    expect(selected[1]).toEqual({ ...holdout[1], pick: null });
    expect(selected.map((row) => row.probability)).toEqual([0.6, 0.7]);
    expect(buildEconomicSelectionComparison(holdout, selected)).toEqual({
      baseline: { pickCount: 2, roiUnits: -0.2, yield: -0.1 },
      selected: { pickCount: 1, roiUnits: 0.8, yield: 0.8 },
      picksRemoved: 1
    });
  });

  it("never admits low confidence because the production baseline excludes it", () => {
    const policy = learnEconomicSelectionPolicy(results("low", Array.from({ length: 60 }, () => 0.5)));

    expect(policy.status).toBe("abstain");
    expect(policy.bands.find((band) => band.confidence === "low")?.reason).toBe("baseline-excluded");
  });
});
