import { describe, expect, it } from "vitest";
import { buildCalibrationDriftReceipt } from "@/lib/sports/prediction/calibrationDriftGuard";
import type { ActiveCalibrationPromotion } from "@/lib/sports/prediction/decisionCalibrationPromotion";
import type { DecisionRunRow, OutcomeRow } from "@/lib/sports/prediction/decisionCalibration";

const APPROVED_AT = "2026-01-01T00:00:00.000Z";
const NOW = new Date("2026-01-23T12:00:00.000Z");

function promotion(): ActiveCalibrationPromotion {
  return {
    id: "promotion-1",
    candidateId: "candidate-1",
    sport: "football",
    modelKey: "football-runtime",
    engineVersion: "engine-v1",
    approvedAt: APPROVED_AT,
    expiresAt: null,
    approvedBy: "operator",
    rationale: "Validated shadow candidate",
    candidate: {
      id: "candidate-1",
      source: "settled-outcomes",
      windowStart: "2025-12-01T00:00:00.000Z",
      windowEnd: APPROVED_AT,
      sampleSize: 40,
      settledSize: 40,
      outcomeHash: "fnv1a-baseline",
      probabilityBuckets: [{
        id: "p60-70",
        lowerBound: 0.6,
        upperBound: 0.7,
        sampleSize: 40,
        settledSize: 40,
        winRate: 0.65,
        brierScore: 0.2,
        logLoss: 0.62,
        averageProbability: 0.65,
        calibrationGap: 0,
        winRateInterval: null,
        roiUnits: 2
      }],
      metrics: {
        brierScore: 0.2,
        brierSkillScore: 0.1,
        logLoss: 0.62,
        expectedCalibrationError: 0.02,
        roiYield: 0.05
      }
    }
  };
}

function run(id = "run-1", modelKey = "football-runtime"): DecisionRunRow {
  return { id, confidence: "medium", health: "stable", engine_version: "engine-v1", model_key: modelKey };
}

function outcomes({
  probability = 0.65,
  earlierWins = 13,
  recentWins = 13,
  countPerRegime = 20,
  runId = "run-1",
  identicalSettlements = false,
  startDay = 2
}: {
  probability?: number;
  earlierWins?: number;
  recentWins?: number;
  countPerRegime?: number;
  runId?: string;
  identicalSettlements?: boolean;
  startDay?: number;
} = {}): OutcomeRow[] {
  return Array.from({ length: countPerRegime * 2 }, (_, index) => {
    const regimeIndex = index % countPerRegime;
    const won = index < countPerRegime ? regimeIndex < earlierWins : regimeIndex < recentWins;
    const settledAt = identicalSettlements
      ? "2026-01-19T12:00:00.000Z"
      : new Date(Date.UTC(2026, 0, startDay + Math.floor(index / 2), 12)).toISOString();
    return {
      id: `outcome-${index}`,
      decision_run_id: runId,
      fixture_external_id: `fixture-${index}`,
      sport: "football",
      model_probability: probability,
      implied_probability: 0.55,
      value_edge: probability - 0.55,
      odds: 1.9,
      closing_odds: 1.85,
      result: won ? "won" : "lost",
      settled_at: settledAt,
      created_at: settledAt
    };
  });
}

describe("live calibration drift guard", () => {
  it("passes a fresh exact-identity window with stable earlier and recent calibration", () => {
    const receipt = buildCalibrationDriftReceipt({ promotion: promotion(), outcomes: outcomes(), decisionRuns: [run()], now: NOW });
    expect(receipt).toMatchObject({
      version: "live-calibration-drift-v1",
      status: "pass",
      eligibleForLive: true,
      monitoringWindowStart: APPROVED_AT,
      current: { sampleSize: 40 },
      earlier: { sampleSize: 20 },
      recent: { sampleSize: 20 },
      latestOutcomeAt: "2026-01-21T12:00:00.000Z"
    });
    expect(receipt.blockers).toEqual([]);
    expect(receipt.deltas.probabilityPopulationStabilityIndex).toBe(0);
  });

  it("uses the frozen candidate window, not operator approval time, as the prospective monitoring boundary", () => {
    const delayedPromotion = promotion();
    delayedPromotion.approvedAt = "2026-01-10T00:00:00.000Z";
    const receipt = buildCalibrationDriftReceipt({ promotion: delayedPromotion, outcomes: outcomes(), decisionRuns: [run()], now: NOW });

    expect(receipt).toMatchObject({
      status: "pass",
      eligibleForLive: true,
      monitoringWindowStart: APPROVED_AT,
      current: { sampleSize: 40 }
    });
  });

  it("detects recent calibration decay even when the earlier live regime was healthy", () => {
    const receipt = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes({ earlierWins: 13, recentWins: 2 }),
      decisionRuns: [run()],
      now: new Date("2026-01-23T12:00:00.000Z")
    });
    expect(receipt.status).toBe("drifted");
    expect(receipt.eligibleForLive).toBe(false);
    expect(receipt.deltas.recentBrierFromEarlier).toBeGreaterThan(0.06);
    expect(receipt.blockers).toEqual(expect.arrayContaining([expect.stringContaining("Recent Brier deterioration")]));
  });

  it("blocks a shifted probability population before aggregate accuracy can disguise it", () => {
    const receipt = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes({ probability: 0.85, earlierWins: 17, recentWins: 17 }),
      decisionRuns: [run()],
      now: new Date("2026-01-23T12:00:00.000Z")
    });
    expect(receipt.status).toBe("drifted");
    expect(receipt.deltas.probabilityPopulationStabilityIndex).toBeGreaterThan(0.25);
    expect(receipt.blockers).toEqual(expect.arrayContaining([expect.stringContaining("population stability index")]));
  });

  it("keeps sparse or wrong-model out-of-sample evidence fail closed", () => {
    const sparse = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes({ countPerRegime: 5, earlierWins: 3, recentWins: 3, startDay: 17 }),
      decisionRuns: [run()],
      now: NOW
    });
    const wrongModel = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes(),
      decisionRuns: [run("run-1", "legacy-model")],
      now: NOW
    });
    expect(sparse).toMatchObject({ status: "warming", eligibleForLive: false, current: { sampleSize: 10 } });
    expect(wrongModel).toMatchObject({ status: "stale", eligibleForLive: false, current: { sampleSize: 0 } });
  });

  it("fails closed when promotion or outcome evidence is stale", () => {
    const receipt = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes(),
      decisionRuns: [run()],
      now: new Date("2026-03-01T12:00:00.000Z")
    });
    expect(receipt).toMatchObject({ status: "stale", eligibleForLive: false });
    expect(receipt.blockers).toEqual(expect.arrayContaining([expect.stringContaining("Promotion age"), expect.stringContaining("Latest exact outcome")]));
  });

  it("never splits an identical settlement cohort to manufacture live stability", () => {
    const receipt = buildCalibrationDriftReceipt({
      promotion: promotion(),
      outcomes: outcomes({ identicalSettlements: true }),
      decisionRuns: [run()],
      now: NOW
    });
    expect(receipt).toMatchObject({ status: "drifted", eligibleForLive: false });
    expect(receipt.blockers).toEqual(expect.arrayContaining([expect.stringContaining("no strict earlier/recent settlement boundary")]));
  });
});
