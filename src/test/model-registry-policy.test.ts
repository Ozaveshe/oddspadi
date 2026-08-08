import { describe, expect, it } from "vitest";
import { mayPublish, mayShadow, transition, type ModelRecord } from "@/lib/model/registry";
import { estimateUncertainty, type UncertaintySource } from "@/lib/model/uncertainty";
import { decidePolicy, DEFAULT_POLICY, type PolicyInput } from "@/lib/model/decisionPolicy";

function record(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    modelId: "m-1",
    state: "candidate",
    datasetVersionId: "ds_abc",
    featureSetVersion: "features.v9",
    hyperparameters: {},
    calibrationMethod: "isotonic",
    decisionPolicyVersion: "policy.v1",
    evaluation: null,
    approvedAt: null,
    approvedBy: null,
    rollbackTargetId: null,
    history: [],
    ...overrides
  };
}

const AT = "2026-08-08T12:00:00.000Z";
const REASON = "Gates evaluated on the August holdout.";

describe("registry paths", () => {
  it("walks candidate → shadow → approved with evidence", () => {
    const shadowed = transition(record(), { to: "shadow", at: AT, reason: REASON });
    expect(shadowed.ok).toBe(true);
    const approved = transition((shadowed as { record: ModelRecord }).record, {
      to: "approved",
      at: AT,
      reason: REASON,
      gatesPassed: true,
      approvedBy: "analyst-a"
    });
    expect(approved.ok).toBe(true);
    expect((approved as { record: ModelRecord }).record.approvedBy).toBe("analyst-a");
    expect((approved as { record: ModelRecord }).record.history).toHaveLength(2);
  });

  it("refuses candidate → approved, however good the evidence", () => {
    // An invalid path, not an invalid state: shadow is where a candidate earns
    // its live comparison.
    const result = transition(record(), { to: "approved", at: AT, reason: REASON, gatesPassed: true, approvedBy: "a" });
    expect(result.ok).toBe(false);
    expect((result as { refusal: string }).refusal).toContain("not a path");
  });

  it("refuses approval without a gate run — unevaluated is not unobjected", () => {
    const result = transition(record({ state: "shadow" }), { to: "approved", at: AT, reason: REASON, approvedBy: "a" });
    expect(result.ok).toBe(false);
    expect((result as { refusal: string }).refusal).toContain("absence of objection");
  });

  it("refuses recovery from degraded without fresh gates", () => {
    // "It seems fine again" is the evidence-free judgement the gate replaces.
    const result = transition(record({ state: "degraded" }), { to: "approved", at: AT, reason: REASON, approvedBy: "a" });
    expect(result.ok).toBe(false);
  });

  it("refuses a rollback onto a target that was never approved", () => {
    const result = transition(record({ state: "degraded" }), {
      to: "rolled_back",
      at: AT,
      reason: REASON,
      rollbackTarget: { modelId: "m-0", wasApproved: false }
    });
    expect(result.ok).toBe(false);
    expect((result as { refusal: string }).refusal).toContain("promote it by accident");
  });

  it("makes retired terminal", () => {
    const result = transition(record({ state: "retired" }), { to: "shadow", at: AT, reason: REASON });
    expect(result.ok).toBe(false);
    expect((result as { refusal: string }).refusal).toContain("terminal");
  });

  it("requires a stated reason on every transition", () => {
    const result = transition(record(), { to: "shadow", at: AT, reason: "ok" });
    expect(result.ok).toBe(false);
  });

  it("lets only an approved model publish, and a degraded one still shadow", () => {
    expect(mayPublish(record({ state: "approved" }))).toBe(true);
    expect(mayPublish(record({ state: "degraded" }))).toBe(false);
    expect(mayPublish(record({ state: "shadow" }))).toBe(false);
    // A degraded model abstains publicly but keeps producing comparisons.
    expect(mayShadow(record({ state: "degraded" }))).toBe(true);
  });
});

describe("uncertainty synthesis", () => {
  const sources: UncertaintySource[] = [
    { id: "ensemble_dispersion", width: 0.03, detail: "models disagree" },
    { id: "lineup_uncertainty", width: 0.04, detail: "lineup unconfirmed" },
    { id: "data_missingness", width: 0.0, detail: "nothing missing" }
  ];

  it("combines widths by root-sum-square, not plain addition", () => {
    const estimate = estimateUncertainty(0.5, sources);
    expect(estimate.totalWidth).toBeCloseTo(Math.sqrt(0.03 ** 2 + 0.04 ** 2), 6);
    // A plain sum (0.07) would punish naming a third doubt; RSS does not.
    expect(estimate.totalWidth).toBeLessThan(0.07);
  });

  it("stakes on the conservative bound", () => {
    const estimate = estimateUncertainty(0.5, sources);
    expect(estimate.conservativeProbability).toBeCloseTo(0.5 - estimate.totalWidth, 6);
    expect(estimate.interval.low).toBe(estimate.conservativeProbability);
  });

  it("names the widest sources first", () => {
    const estimate = estimateUncertainty(0.5, sources);
    expect(estimate.mainSources[0]?.id).toBe("lineup_uncertainty");
    // Zero-width sources are not doubts and do not appear.
    expect(estimate.mainSources.some((source) => source.id === "data_missingness")).toBe(false);
  });

  it("never reaches zero or one", () => {
    const estimate = estimateUncertainty(0.001, [{ id: "bootstrap", width: 0.5, detail: "wild" }]);
    expect(estimate.conservativeProbability).toBeGreaterThan(0);
    expect(estimate.interval.high).toBeLessThan(1);
  });
});

describe("the decision policy", () => {
  function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
    return {
      uncertainty: estimateUncertainty(0.5, [{ id: "ensemble_dispersion", width: 0.02, detail: "spread" }]),
      marketProbability: 0.42,
      decimalOdds: 2.3,
      oddsAreFresh: true,
      sourceDepth: 3,
      dataReadiness: 0.8,
      calibrationSupported: true,
      minutesToKickoff: 120,
      ...overrides
    };
  }

  it("picks when the conservative bound clears the market", () => {
    const result = decidePolicy(input());
    expect(result.decision).toBe("pick");
    expect(result.conservativeEdge).toBeCloseTo(0.48 - 0.42, 6);
  });

  it("stakes on the conservative bound, not the point estimate", () => {
    // Point 0.50 vs market 0.47 looks like a lean; the conservative 0.44 says
    // otherwise. Optimism does not publish.
    const wide = estimateUncertainty(0.5, [{ id: "lineup_uncertainty", width: 0.06, detail: "no lineup" }]);
    const result = decidePolicy(input({ uncertainty: wide, marketProbability: 0.47 }));
    expect(result.decision).toBe("pass");
  });

  it("routes every unread input to unavailable, never to pass", () => {
    const fields: Array<keyof PolicyInput> = [
      "uncertainty",
      "marketProbability",
      "decimalOdds",
      "oddsAreFresh",
      "dataReadiness",
      "calibrationSupported"
    ];
    for (const field of fields) {
      const result = decidePolicy(input({ [field]: null } as Partial<PolicyInput>));
      expect(result.decision, `${String(field)} null must be unavailable`).toBe("unavailable");
      expect(result.decision).not.toBe("pass");
    }
  });

  it("withholds on a stale price rather than passing on it", () => {
    const result = decidePolicy(input({ oddsAreFresh: false }));
    expect(result.decision).toBe("withheld");
    expect(result.reason).toContain("freshness");
  });

  it("withholds without calibration support however strong the edge", () => {
    const result = decidePolicy(input({ calibrationSupported: false, marketProbability: 0.3 }));
    expect(result.decision).toBe("withheld");
    expect(result.reason).toContain("guess wearing a decimal");
  });

  it("withholds outside the publishable odds band", () => {
    // The longshot ceiling: measured 25%-hit-rate argmax longshots are why.
    expect(decidePolicy(input({ decimalOdds: 8.5, marketProbability: 0.1 })).decision).toBe("withheld");
    expect(decidePolicy(input({ decimalOdds: 1.05 })).decision).toBe("withheld");
  });

  it("withholds on thin readiness", () => {
    expect(decidePolicy(input({ dataReadiness: 0.3 })).decision).toBe("withheld");
  });

  it("grades lean, watch and pass by the conservative edge", () => {
    expect(decidePolicy(input({ marketProbability: 0.455 })).decision).toBe("lean");
    expect(decidePolicy(input({ marketProbability: 0.472 })).decision).toBe("watch");
    expect(decidePolicy(input({ marketProbability: 0.55 })).decision).toBe("pass");
  });

  it("keeps pass a completed analysis with the numbers that produced it", () => {
    const result = decidePolicy(input({ marketProbability: 0.55 }));
    expect(result.reason).toContain("beats our conservative");
    expect(result.conservativeEdge).toBeLessThan(0);
  });

  it("exposes its thresholds rather than burying them", () => {
    expect(DEFAULT_POLICY.maxOdds).toBe(6.0);
    expect(DEFAULT_POLICY.pickEdge).toBeGreaterThan(DEFAULT_POLICY.leanEdge);
  });
});
