import { describe, expect, it } from "vitest";
import {
  learnMarketPriorScalingPolicy,
  marketPriorPolicyValidationRows,
  type MarketPriorScalingObservation
} from "@/lib/sports/prediction/marketPriorScaling";
import { applyMarketPriorAdjustmentToMarkets } from "@/lib/sports/prediction/odds";

function observation(index: number, marketHome = 0.7, actualHome = index % 10 < 7): MarketPriorScalingObservation {
  return {
    kickoffAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    markets: [{ marketId: "match_winner", probabilities: { home: 0.9, away: 0.1 } }],
    oddsMarkets: [{
      id: "match_winner",
      name: "Match Winner",
      selections: [
        { id: "home", label: "Home", decimalOdds: 1 / marketHome },
        { id: "away", label: "Away", decimalOdds: 1 / (1 - marketHome) }
      ]
    }],
    dataQuality: 0.8,
    actualOutcome: actualHome ? "home" : "away"
  };
}

describe("prospective market-prior scaling", () => {
  it("activates a frozen scale only when a later priced window improves proper scores", () => {
    const rows = Array.from({ length: 80 }, (_, index) => observation(index));
    const policy = learnMarketPriorScalingPolicy({
      trainingRows: rows,
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });

    expect(policy).toMatchObject({
      version: "market-prior-scaling-v1",
      source: "chronological-priced-training-window",
      status: "active",
      fitSampleSize: 40,
      validationSampleSize: 40,
      reason: "validated-proper-score-improvement"
    });
    expect(policy.weightScale).toBeGreaterThan(1);
    expect(policy.candidateValidation.logLoss).toBeLessThan(policy.baselineValidation.logLoss!);
    expect(Date.parse(policy.validationWindowEnd!)).toBeLessThan(Date.parse(policy.holdoutWindowStart!));
    expect(marketPriorPolicyValidationRows(rows, policy)).toHaveLength(40);
  });

  it("rejects an early-window winner when the later validation window reverses", () => {
    const rows = Array.from({ length: 80 }, (_, index) =>
      index < 40 ? observation(index, 0.7) : observation(index, 0.3, true)
    );
    const policy = learnMarketPriorScalingPolicy({
      trainingRows: rows,
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });

    expect(policy).toMatchObject({ status: "identity", weightScale: 1, reason: "validation-did-not-improve" });
    expect(policy.candidateWeightScale).not.toBe(1);
    expect(policy.candidateValidation.logLoss).toBeGreaterThan(policy.baselineValidation.logLoss!);
  });

  it("keeps identity for thin evidence and fails closed without a strict timestamp boundary", () => {
    const thin = learnMarketPriorScalingPolicy({
      trainingRows: Array.from({ length: 39 }, (_, index) => observation(index)),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const simultaneous = learnMarketPriorScalingPolicy({
      trainingRows: Array.from({ length: 50 }, (_, index) => ({
        ...observation(index),
        kickoffAt: "2024-01-01T12:00:00.000Z"
      })),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });

    expect(thin).toMatchObject({ status: "identity", weightScale: 1, reason: "insufficient-priced-sample" });
    expect(simultaneous).toMatchObject({ status: "identity", weightScale: 1, reason: "invalid-chronology" });
  });

  it("scales only the heuristic component while preserving an evidence floor", () => {
    const model = [{ marketId: "match_winner" as const, probabilities: { home: 0.9, away: 0.1 } }];
    const odds = observation(0).oddsMarkets;
    const withoutFloor = applyMarketPriorAdjustmentToMarkets(model, odds, 0.8, undefined, { weightScale: 0 });
    const withFloor = applyMarketPriorAdjustmentToMarkets(
      model,
      odds,
      0.8,
      { minimumWeight: 0.2, reason: "thin football history" },
      { weightScale: 0 }
    );

    expect(withoutFloor.adjustment).toMatchObject({ applied: true, weightScale: 0, averageWeight: 0 });
    expect(withoutFloor.markets[0]?.probabilities.home).toBeCloseTo(0.9);
    expect(withFloor.adjustment.averageWeight).toBeGreaterThan(0);
    expect(withFloor.markets[0]?.probabilities.home).toBeLessThan(0.9);
  });
});
