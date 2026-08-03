import { describe, expect, it } from "vitest";
import { computeDecisionCalibrationMetrics, type OutcomeRow } from "@/lib/sports/prediction/decisionCalibration";

/**
 * Calibration readiness and the value claim are different questions.
 *
 * "Is this model's 60% actually 60%?" rests on sample size, Brier, skill, log
 * loss and calibration error. "Do picks from this model beat the closing
 * price?" rests on closing-line value and the coverage behind it. The gate used
 * to demand both before granting either, so football — Brier 0.181, skill
 * +0.179, calibration error 0.031 on 481 settled outcomes, better than tennis
 * on every calibration axis — sat at `waiting-quality` on one line: closing
 * coverage 0.319.
 *
 * That coverage will not move on our side. The odds feed stops pricing several
 * competitions near kickoff — UEFA Champions League fixtures carry a last quote
 * a median of 37 hours out, Serie A 12 hours — while Liga MX and MLS come in at
 * 4 minutes. Widening the closing window to rescue the number would relabel a
 * 37-hour-old price as a closing line, which is the dishonest fix.
 */
function outcome(index: number, probability: number, won: boolean, closing: number | null): OutcomeRow {
  return {
    id: `o-${index}`,
    decision_run_id: null,
    fixture_external_id: `f-${index}`,
    sport: "football",
    model_probability: probability,
    implied_probability: probability - 0.03,
    value_edge: 0.03,
    odds: 2,
    closing_odds: closing,
    result: won ? "won" : "lost",
    settled_at: "2026-08-01T12:00:00.000Z",
    created_at: "2026-08-01T10:00:00.000Z"
  };
}

/**
 * A genuinely calibrated set: in the 0.7 bucket 70% win, in the 0.3 bucket 30%.
 *
 * An earlier version made every 0.7 call a winner, which is perfectly
 * discriminating and badly calibrated — each bucket's realised rate sat 0.30
 * from its predicted one and expected calibration error failed. Worth keeping
 * as a note: "the model is always right" is not the same property as "the
 * model's stated confidence is accurate", and only the second is what a
 * calibration profile certifies.
 */
function calibratedOutcomes(count: number, closingFraction: number): OutcomeRow[] {
  const rows: OutcomeRow[] = [];
  const withClosing = Math.floor(count * closingFraction);
  for (let index = 0; index < count; index += 1) {
    const high = index % 2 === 0;
    const probability = high ? 0.7 : 0.3;
    // Deterministic but correctly proportioned: 7 of every 10 in the high
    // bucket win, 3 of every 10 in the low bucket.
    const position = Math.floor(index / 2) % 10;
    const won = high ? position < 7 : position < 3;
    rows.push(outcome(index, probability, won, index < withClosing ? 1.9 : null));
  }
  return rows;
}

describe("calibration readiness does not depend on closing-line coverage", () => {
  it("reaches shadow review on calibration evidence alone", () => {
    const metrics = computeDecisionCalibrationMetrics({
      outcomes: calibratedOutcomes(200, 0.32),
      decisionRuns: [],
      sport: "football"
    });
    const readiness = metrics.promotionReadiness;

    // Coverage is the football figure that used to block everything.
    expect(metrics.closingLineCoverage).toBeLessThan(0.8);
    expect(readiness.status).toBe("ready-shadow-review");
    expect(readiness.blockers).toEqual([]);
  });

  it("still refuses the value claim, and says why", () => {
    const metrics = computeDecisionCalibrationMetrics({
      outcomes: calibratedOutcomes(200, 0.32),
      decisionRuns: [],
      sport: "football"
    });
    const readiness = metrics.promotionReadiness;

    // The point of the split: calibrated does not mean profitable.
    expect(readiness.valueClaimSupported).toBe(false);
    expect(readiness.valueClaimBlockers.join(" ")).toContain("Closing-line coverage");
  });

  it("keeps blocking calibration when calibration is actually bad", () => {
    // Every row a 90% call that loses: badly miscalibrated, full coverage.
    const rows = Array.from({ length: 200 }, (_, index) => outcome(index, 0.9, false, 1.9));
    const readiness = computeDecisionCalibrationMetrics({ outcomes: rows, decisionRuns: [], sport: "football" }).promotionReadiness;
    expect(readiness.status).toBe("waiting-quality");
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it("still requires a real sample", () => {
    const readiness = computeDecisionCalibrationMetrics({
      outcomes: calibratedOutcomes(10, 1),
      decisionRuns: [],
      sport: "football"
    }).promotionReadiness;
    expect(readiness.status).toBe("waiting-sample");
  });

  it("supports the value claim when coverage and CLV are both there", () => {
    const rows = calibratedOutcomes(200, 1).map((row) => ({ ...row, odds: 2.2, closing_odds: 1.9 }));
    const readiness = computeDecisionCalibrationMetrics({ outcomes: rows, decisionRuns: [], sport: "football" }).promotionReadiness;
    expect(readiness.valueClaimSupported).toBe(true);
    expect(readiness.valueClaimBlockers).toEqual([]);
  });

  it("never grants live influence from calibration alone", () => {
    const readiness = computeDecisionCalibrationMetrics({
      outcomes: calibratedOutcomes(200, 1),
      decisionRuns: [],
      sport: "football"
    }).promotionReadiness;
    // Shadow review is the ceiling this function can reach. Promotion is a
    // separate, deliberate act.
    expect(readiness.canInfluenceLive).toBe(false);
  });
});
