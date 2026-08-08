/**
 * Whether a candidate model may replace the champion.
 *
 * Nine conditions, each reporting its own verdict. The composition is
 * deliberately unglamorous — every gate must pass — but two properties make it
 * different from the boolean it replaces.
 *
 * **A gate with no evidence does not pass.** The most expensive failure in a
 * promotion pipeline is not a bad model getting through; it is a gate that
 * cannot be evaluated returning "no objection". This repository has already
 * shipped that shape: outcomes carried no model key, so no profile could ever
 * promote, and the gate reported clean the whole time. `unknown` is a distinct
 * verdict here and it blocks.
 *
 * **Every failure names itself.** "Promotion blocked" tells an operator to
 * re-run it. "Promotion blocked: calibration ECE 0.087 above the 0.05 ceiling
 * on 2,292 outcomes" tells them what to fix.
 */

export type GateVerdict = "pass" | "fail" | "unknown";

export type GateResult = {
  gate: string;
  verdict: GateVerdict;
  detail: string;
};

export type PromotionEvidence = {
  /** No feature leaked into the candidate's training set. */
  leakageClean: boolean | null;
  /** The training dataset rebuilt to the same identifier. */
  reproducible: boolean | null;
  /** Candidate and champion Brier on the same untouched holdout. */
  candidateBrier: number | null;
  championBrier: number | null;
  /** Log loss on the same rows. */
  candidateLogLoss: number | null;
  championLogLoss: number | null;
  /** Expected calibration error on the holdout. */
  candidateEce: number | null;
  /** How many graded outcomes the holdout actually contains. */
  holdoutSample: number | null;
  /** Per-segment Brier deltas: sport, competition, odds band. */
  segmentDeltas: Array<{ segment: string; delta: number; sample: number }> | null;
  /** Mean odds-based CLV over covered picks, and how many were covered. */
  clvMean: number | null;
  clvCovered: number | null;
  clvEligible: number | null;
  /** Decision latency at p95, in milliseconds. */
  latencyP95Ms: number | null;
  /** Operational regressions observed during shadow running. */
  operationalRegressions: number | null;
};

export type PromotionThresholds = {
  minHoldoutSample: number;
  maxEce: number;
  /** A candidate must not be worse than the champion by more than this. */
  maxBrierRegression: number;
  /** No single segment may degrade by more than this. */
  maxSegmentRegression: number;
  minSegmentSample: number;
  minClvCoverage: number;
  maxLatencyP95Ms: number;
};

export const DEFAULT_THRESHOLDS: PromotionThresholds = {
  // Below this the holdout cannot separate two models; a "win" is noise.
  minHoldoutSample: 500,
  maxEce: 0.05,
  // Non-inferior rather than strictly better: a candidate that ties on Brier
  // but is simpler, faster or better calibrated is a legitimate promotion.
  maxBrierRegression: 0.002,
  maxSegmentRegression: 0.02,
  minSegmentSample: 100,
  // Below this coverage, a CLV mean is a statement about a handful of picks.
  minClvCoverage: 0.3,
  maxLatencyP95Ms: 2500
};

function unknown(gate: string, what: string): GateResult {
  return { gate, verdict: "unknown", detail: `${what} was not measured, so this gate cannot be evaluated` };
}

export function evaluatePromotion(
  evidence: PromotionEvidence,
  thresholds: PromotionThresholds = DEFAULT_THRESHOLDS
): { promotable: boolean; gates: GateResult[]; blockers: GateResult[] } {
  const gates: GateResult[] = [];

  gates.push(
    evidence.leakageClean === null
      ? unknown("leakage", "the leakage audit")
      : {
          gate: "leakage",
          verdict: evidence.leakageClean ? "pass" : "fail",
          detail: evidence.leakageClean
            ? "no feature leaked past the decision cutoff"
            : "at least one feature leaked past the decision cutoff; the evaluation is invalid rather than merely optimistic"
        }
  );

  gates.push(
    evidence.reproducible === null
      ? unknown("reproducibility", "the dataset rebuild")
      : {
          gate: "reproducibility",
          verdict: evidence.reproducible ? "pass" : "fail",
          detail: evidence.reproducible
            ? "the training dataset rebuilt to the same identifier"
            : "the training dataset did not rebuild identically, so the result cannot be audited"
        }
  );

  gates.push(
    evidence.holdoutSample === null
      ? unknown("sample", "the holdout size")
      : {
          gate: "sample",
          verdict: evidence.holdoutSample >= thresholds.minHoldoutSample ? "pass" : "fail",
          detail: `${evidence.holdoutSample} graded outcomes against a ${thresholds.minHoldoutSample} minimum${
            evidence.holdoutSample < thresholds.minHoldoutSample
              ? " — below this the holdout cannot separate two models and any win is noise"
              : ""
          }`
        }
  );

  gates.push(scoreGate("brier", evidence.candidateBrier, evidence.championBrier, thresholds.maxBrierRegression));
  gates.push(scoreGate("log-loss", evidence.candidateLogLoss, evidence.championLogLoss, thresholds.maxBrierRegression));

  gates.push(
    evidence.candidateEce === null
      ? unknown("calibration", "expected calibration error")
      : {
          gate: "calibration",
          verdict: evidence.candidateEce <= thresholds.maxEce ? "pass" : "fail",
          detail: `ECE ${evidence.candidateEce.toFixed(4)} against a ${thresholds.maxEce} ceiling`
        }
  );

  gates.push(segmentGate(evidence, thresholds));
  gates.push(clvGate(evidence, thresholds));

  gates.push(
    evidence.latencyP95Ms === null
      ? unknown("latency", "decision latency")
      : {
          gate: "latency",
          verdict: evidence.latencyP95Ms <= thresholds.maxLatencyP95Ms ? "pass" : "fail",
          detail: `p95 ${Math.round(evidence.latencyP95Ms)}ms against a ${thresholds.maxLatencyP95Ms}ms ceiling`
        }
  );

  gates.push(
    evidence.operationalRegressions === null
      ? unknown("operations", "operational regressions during shadow running")
      : {
          gate: "operations",
          verdict: evidence.operationalRegressions === 0 ? "pass" : "fail",
          detail:
            evidence.operationalRegressions === 0
              ? "no operational regression observed while shadowing"
              : `${evidence.operationalRegressions} operational regression(s) observed while shadowing`
        }
  );

  // Anything that is not an explicit pass blocks. An unevaluable gate is not a
  // silent yes.
  const blockers = gates.filter((gate) => gate.verdict !== "pass");
  return { promotable: blockers.length === 0, gates, blockers };
}

/**
 * Non-inferiority on a score where lower is better.
 *
 * A candidate does not have to beat the champion. It has to not be
 * meaningfully worse — a model that ties on Brier while being simpler, faster
 * or better calibrated is a legitimate promotion, and demanding a strict win
 * selects for overfitting to the holdout.
 */
function scoreGate(gate: string, candidate: number | null, champion: number | null, tolerance: number): GateResult {
  if (candidate === null || champion === null) return unknown(gate, `${gate} on the holdout`);
  const regression = candidate - champion;
  return {
    gate,
    verdict: regression <= tolerance ? "pass" : "fail",
    detail: `candidate ${candidate.toFixed(4)} against champion ${champion.toFixed(4)} (${
      regression >= 0 ? "+" : ""
    }${regression.toFixed(4)}, tolerance ${tolerance})`
  };
}

/**
 * No segment may collapse, however good the aggregate.
 *
 * An overall improvement built from a large gain on football and a large loss
 * on tennis is not an improvement — it is a model that got worse at something
 * a reader will still be shown.
 *
 * Segments below the minimum sample are ignored rather than failed: a
 * three-outcome segment cannot demonstrate a regression.
 */
function segmentGate(evidence: PromotionEvidence, thresholds: PromotionThresholds): GateResult {
  if (evidence.segmentDeltas === null) return unknown("segments", "per-segment performance");
  const measurable = evidence.segmentDeltas.filter((entry) => entry.sample >= thresholds.minSegmentSample);
  if (measurable.length === 0) {
    return unknown("segments", `any segment with at least ${thresholds.minSegmentSample} outcomes`);
  }
  const collapsed = measurable.filter((entry) => entry.delta > thresholds.maxSegmentRegression);
  return {
    gate: "segments",
    verdict: collapsed.length === 0 ? "pass" : "fail",
    detail:
      collapsed.length === 0
        ? `${measurable.length} measurable segment(s), none regressing beyond ${thresholds.maxSegmentRegression}`
        : `${collapsed.map((entry) => `${entry.segment} +${entry.delta.toFixed(4)}`).join(", ")} regressed beyond ${thresholds.maxSegmentRegression}`
  };
}

/**
 * CLV, judged on coverage before magnitude.
 *
 * A +4% mean over eleven covered picks out of four hundred is not evidence of
 * anything, and treating it as a pass is how a promotion pipeline learns to
 * reward whichever model happened to get its closes captured.
 */
function clvGate(evidence: PromotionEvidence, thresholds: PromotionThresholds): GateResult {
  if (evidence.clvMean === null || evidence.clvCovered === null || evidence.clvEligible === null) {
    return unknown("clv", "closing line value");
  }
  if (evidence.clvEligible === 0) return unknown("clv", "any eligible pick for closing line value");

  const coverage = evidence.clvCovered / evidence.clvEligible;
  if (coverage < thresholds.minClvCoverage) {
    return {
      gate: "clv",
      verdict: "unknown",
      detail: `only ${(coverage * 100).toFixed(1)}% of picks have a captured close (${evidence.clvCovered}/${evidence.clvEligible}); a mean over that few is not evidence`
    };
  }
  return {
    gate: "clv",
    verdict: evidence.clvMean >= 0 ? "pass" : "fail",
    detail: `mean CLV ${(evidence.clvMean * 100).toFixed(2)}% over ${evidence.clvCovered} covered picks (${(coverage * 100).toFixed(1)}% coverage)`
  };
}

/** Operator-facing summary, worst first. */
export function explainPromotion(result: ReturnType<typeof evaluatePromotion>): string {
  if (result.promotable) return `Promotable: all ${result.gates.length} gates pass.`;
  const failed = result.blockers.filter((gate) => gate.verdict === "fail");
  const unmeasured = result.blockers.filter((gate) => gate.verdict === "unknown");
  const parts: string[] = [];
  if (failed.length) parts.push(`failed: ${failed.map((gate) => `${gate.gate} (${gate.detail})`).join("; ")}`);
  if (unmeasured.length) {
    parts.push(`not evaluable: ${unmeasured.map((gate) => `${gate.gate} (${gate.detail})`).join("; ")}`);
  }
  return `Blocked — ${parts.join(". ")}.`;
}
