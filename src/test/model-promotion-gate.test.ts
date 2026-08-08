import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  evaluatePromotion,
  explainPromotion,
  type PromotionEvidence
} from "@/lib/model/promotionGate";

function evidence(overrides: Partial<PromotionEvidence> = {}): PromotionEvidence {
  return {
    leakageClean: true,
    reproducible: true,
    candidateBrier: 0.2105,
    championBrier: 0.2160,
    candidateLogLoss: 0.6120,
    championLogLoss: 0.6190,
    candidateEce: 0.031,
    holdoutSample: 2292,
    segmentDeltas: [
      { segment: "football", delta: -0.004, sample: 1800 },
      { segment: "basketball", delta: 0.001, sample: 400 }
    ],
    clvMean: 0.012,
    clvCovered: 900,
    clvEligible: 2000,
    latencyP95Ms: 1400,
    operationalRegressions: 0,
    ...overrides
  };
}

function verdictFor(result: ReturnType<typeof evaluatePromotion>, gate: string) {
  return result.gates.find((entry) => entry.gate === gate)?.verdict;
}

describe("a candidate that earns promotion", () => {
  it("passes every gate", () => {
    const result = evaluatePromotion(evidence());
    expect(result.promotable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(explainPromotion(result)).toContain("all 10 gates pass");
  });

  it("promotes on non-inferiority rather than a strict win", () => {
    // A model that ties on Brier while being simpler, faster or better
    // calibrated is a legitimate promotion; demanding a strict win selects for
    // overfitting to the holdout.
    const tied = evaluatePromotion(evidence({ candidateBrier: 0.216, championBrier: 0.216 }));
    expect(verdictFor(tied, "brier")).toBe("pass");
  });
});

describe("an unevaluable gate never passes", () => {
  it("blocks when the leakage audit did not run", () => {
    // The most expensive failure in a promotion pipeline is a gate that cannot
    // be evaluated returning "no objection".
    const result = evaluatePromotion(evidence({ leakageClean: null }));
    expect(verdictFor(result, "leakage")).toBe("unknown");
    expect(result.promotable).toBe(false);
  });

  it("blocks on every missing measurement independently", () => {
    const missing: Array<keyof PromotionEvidence> = [
      "leakageClean",
      "reproducible",
      "holdoutSample",
      "candidateEce",
      "segmentDeltas",
      "latencyP95Ms",
      "operationalRegressions"
    ];
    for (const field of missing) {
      const result = evaluatePromotion(evidence({ [field]: null } as Partial<PromotionEvidence>));
      expect(result.promotable, `${String(field)} missing must block`).toBe(false);
    }
  });

  it("says a gate was not evaluable rather than that it failed", () => {
    const result = evaluatePromotion(evidence({ reproducible: null }));
    expect(explainPromotion(result)).toContain("not evaluable");
  });
});

describe("the gates that matter most", () => {
  it("refuses a leaked evaluation outright", () => {
    const result = evaluatePromotion(evidence({ leakageClean: false }));
    expect(verdictFor(result, "leakage")).toBe("fail");
    // Not "optimistic" — invalid.
    expect(result.blockers[0]?.detail).toContain("invalid");
  });

  it("refuses a dataset that will not rebuild", () => {
    const result = evaluatePromotion(evidence({ reproducible: false }));
    expect(explainPromotion(result)).toContain("cannot be audited");
  });

  it("refuses a holdout too small to separate two models", () => {
    const result = evaluatePromotion(evidence({ holdoutSample: DEFAULT_THRESHOLDS.minHoldoutSample - 1 }));
    expect(verdictFor(result, "sample")).toBe("fail");
    expect(result.blockers[0]?.detail).toContain("noise");
  });

  it("refuses a meaningful Brier regression", () => {
    const result = evaluatePromotion(evidence({ candidateBrier: 0.23, championBrier: 0.216 }));
    expect(verdictFor(result, "brier")).toBe("fail");
  });

  it("refuses poor calibration however good the Brier", () => {
    const result = evaluatePromotion(evidence({ candidateBrier: 0.15, candidateEce: 0.09 }));
    expect(verdictFor(result, "calibration")).toBe("fail");
  });
});

describe("segment collapse", () => {
  it("refuses an aggregate win built on a segment that got worse", () => {
    // A gain on football and a loss on tennis is not an improvement; it is a
    // model that got worse at something a reader will still be shown.
    const result = evaluatePromotion(
      evidence({
        segmentDeltas: [
          { segment: "football", delta: -0.02, sample: 1800 },
          { segment: "tennis", delta: 0.05, sample: 400 }
        ]
      })
    );
    expect(verdictFor(result, "segments")).toBe("fail");
    expect(result.blockers[0]?.detail).toContain("tennis");
  });

  it("ignores a segment too small to demonstrate a regression", () => {
    const result = evaluatePromotion(
      evidence({
        segmentDeltas: [
          { segment: "football", delta: -0.004, sample: 1800 },
          { segment: "handball", delta: 0.4, sample: 3 }
        ]
      })
    );
    expect(verdictFor(result, "segments")).toBe("pass");
  });

  it("blocks when no segment is large enough to measure at all", () => {
    const result = evaluatePromotion(
      evidence({ segmentDeltas: [{ segment: "tennis", delta: 0, sample: 5 }] })
    );
    expect(verdictFor(result, "segments")).toBe("unknown");
  });
});

describe("CLV is judged on coverage before magnitude", () => {
  it("treats a strong mean over thin coverage as unevaluable, not as a pass", () => {
    // Rewarding this is how a pipeline learns to prefer whichever model got
    // its closes captured.
    const result = evaluatePromotion(evidence({ clvMean: 0.04, clvCovered: 11, clvEligible: 400 }));
    expect(verdictFor(result, "clv")).toBe("unknown");
    expect(result.promotable).toBe(false);
  });

  it("passes a positive mean over adequate coverage", () => {
    expect(verdictFor(evaluatePromotion(evidence()), "clv")).toBe("pass");
  });

  it("fails a negative mean over adequate coverage", () => {
    const result = evaluatePromotion(evidence({ clvMean: -0.02 }));
    expect(verdictFor(result, "clv")).toBe("fail");
  });

  it("is unevaluable when nothing was eligible", () => {
    expect(verdictFor(evaluatePromotion(evidence({ clvEligible: 0, clvCovered: 0 })), "clv")).toBe("unknown");
  });
});

describe("operational gates", () => {
  it("refuses a latency regression past the ceiling", () => {
    const result = evaluatePromotion(evidence({ latencyP95Ms: DEFAULT_THRESHOLDS.maxLatencyP95Ms + 1 }));
    expect(verdictFor(result, "latency")).toBe("fail");
  });

  it("refuses any operational regression seen while shadowing", () => {
    expect(verdictFor(evaluatePromotion(evidence({ operationalRegressions: 1 })), "operations")).toBe("fail");
  });
});

describe("the explanation an operator reads", () => {
  it("names what to fix rather than that something failed", () => {
    const result = evaluatePromotion(evidence({ candidateEce: 0.087 }));
    const message = explainPromotion(result);
    expect(message).toContain("calibration");
    expect(message).toContain("0.0870");
    expect(message).toContain("0.05");
  });

  it("separates failures from unevaluable gates", () => {
    const result = evaluatePromotion(evidence({ candidateEce: 0.09, latencyP95Ms: null }));
    const message = explainPromotion(result);
    expect(message).toContain("failed:");
    expect(message).toContain("not evaluable:");
  });
});
