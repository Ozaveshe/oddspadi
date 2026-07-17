import { describe, expect, it } from "vitest";
import { applyLearnedProbabilityCalibration } from "@/lib/sports/prediction/learnedProbabilityCalibration";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import type { DecisionLearningProfile, PredictionMarket } from "@/lib/sports/types";

function profile(overrides: Partial<DecisionLearningProfile> = {}): DecisionLearningProfile {
  return {
    status: "active",
    source: "validated-holdout",
    active: true,
    modelKey: "football-poisson-v3",
    engineVersion: "decision-engine-v1",
    sampleSize: 1200,
    realFinishedFixtures: 1200,
    minimumRecommendedFixtures: 1000,
    minimumEdge: 0.03,
    valueEdgeWeight: 0.32,
    dataQualityWeight: 0.18,
    marketAdjustmentWeight: 0.14,
    homeAdvantageElo: 62,
    brierScore: 0.18,
    yield: 0.04,
    closingLineValue: 0.015,
    calibrationBuckets: [
      { minProbability: 0, maxProbability: 0.3, sampleSize: 1300, averageProbability: 0.2, observedRate: 0.17, calibrationError: 0.03 },
      { minProbability: 0.3, maxProbability: 0.7, sampleSize: 1500, averageProbability: 0.5, observedRate: 0.44, calibrationError: 0.06 },
      { minProbability: 0.7, maxProbability: 1, sampleSize: 900, averageProbability: 0.78, observedRate: 0.73, calibrationError: 0.05 }
    ],
    generatedAt: "2026-07-11T00:00:00.000Z",
    reason: "Validated calibration profile.",
    notes: [],
    ...overrides
  };
}

describe("learned probability calibration", () => {
  it("applies a promoted calibration curve to match-winner probabilities and preserves normalization", () => {
    const markets: PredictionMarket[] = [
      { marketId: "match_winner", probabilities: { home: 0.6, draw: 0.25, away: 0.15 } },
      { marketId: "over_under_25", probabilities: { over_25: 0.54, under_25: 0.46 } }
    ];

    const result = applyLearnedProbabilityCalibration({ markets, profile: profile(), modelKey: "football-poisson-v3", engineVersion: "decision-engine-v1" });
    const winner = result.markets.find((market) => market.marketId === "match_winner");

    expect(result.adjustment.status).toBe("applied");
    expect(result.adjustment.calibratedMarkets).toEqual(["match_winner"]);
    expect(result.adjustment.meanAbsoluteShift).toBeGreaterThan(0);
    expect(winner).toBeDefined();
    expect(Object.values(winner?.probabilities ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    expect(winner?.probabilities.home).not.toBe(markets[0].probabilities.home);
    expect(result.markets.find((market) => market.marketId === "over_under_25")).toEqual(markets[1]);
  });

  it("does not apply a curve until the learning profile is explicitly active", () => {
    const markets: PredictionMarket[] = [{ marketId: "match_winner", probabilities: { home: 0.6, draw: 0.25, away: 0.15 } }];
    const result = applyLearnedProbabilityCalibration({
      markets,
      profile: profile({ active: false, status: "shadow-only" }),
      modelKey: "football-poisson-v3",
      engineVersion: "decision-engine-v1"
    });

    expect(result.adjustment.status).toBe("inactive");
    expect(result.markets).toBe(markets);
  });

  it("feeds the promoted curve into the prediction path before value edges are ranked", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const baseline = buildPrediction(match);
    const calibrated = buildPrediction(match, { learningProfile: profile() });
    const baselineWinner = baseline.markets.find((market) => market.marketId === "match_winner");
    const calibratedWinner = calibrated.markets.find((market) => market.marketId === "match_winner");

    expect(calibrated.calibrationAdjustment?.status).toBe("applied");
    expect(calibrated.diagnostics.calibrationNotes.join(" ")).toContain("Applied a 3-bucket promoted calibration curve");
    expect(calibratedWinner?.probabilities).not.toEqual(baselineWinner?.probabilities);
  });

  it("prefers a validated training-window temperature over the legacy bucket residual curve", () => {
    const markets: PredictionMarket[] = [
      { marketId: "match_winner", probabilities: { home: 0.8, draw: 0.12, away: 0.08 } }
    ];
    const result = applyLearnedProbabilityCalibration({
      markets,
      profile: profile({
        probabilityTemperaturePolicy: {
          version: "temperature-scaling-v1",
          source: "chronological-training-window",
          status: "active",
          temperature: 1.5,
          fitSampleSize: 700,
          validationSampleSize: 300,
          fitWindowStart: "2022-01-01T00:00:00.000Z",
          fitWindowEnd: "2024-12-31T00:00:00.000Z",
          validationWindowStart: "2025-01-01T00:00:00.000Z",
          validationWindowEnd: "2025-12-31T00:00:00.000Z",
          holdoutWindowStart: "2026-01-01T00:00:00.000Z",
          baselineValidation: { sampleSize: 300, brierScore: 0.21, logLoss: 0.62 },
          calibratedValidation: { sampleSize: 300, brierScore: 0.2, logLoss: 0.6 },
          reason: "validated-proper-score-improvement"
        }
      }),
      modelKey: "football-poisson-v3",
      engineVersion: "decision-engine-v1"
    });

    expect(result.adjustment).toMatchObject({ status: "applied", method: "temperature-scaling", temperature: 1.5 });
    expect(result.adjustment.summary).toContain("temperature scaling 1.500");
    expect(result.markets[0]!.probabilities.home).toBeLessThan(0.8);
  });

  it("treats a validated identity policy as an explicit no-op instead of falling back to holdout buckets", () => {
    const markets: PredictionMarket[] = [{ marketId: "match_winner", probabilities: { home: 0.6, draw: 0.25, away: 0.15 } }];
    const result = applyLearnedProbabilityCalibration({
      markets,
      profile: profile({
        probabilityTemperaturePolicy: {
          version: "temperature-scaling-v1",
          source: "chronological-training-window",
          status: "identity",
          temperature: 1,
          fitSampleSize: 700,
          validationSampleSize: 300,
          fitWindowStart: "2022-01-01T00:00:00.000Z",
          fitWindowEnd: "2024-12-31T00:00:00.000Z",
          validationWindowStart: "2025-01-01T00:00:00.000Z",
          validationWindowEnd: "2025-12-31T00:00:00.000Z",
          holdoutWindowStart: "2026-01-01T00:00:00.000Z",
          baselineValidation: { sampleSize: 300, brierScore: 0.2, logLoss: 0.6 },
          calibratedValidation: { sampleSize: 300, brierScore: 0.2, logLoss: 0.6 },
          reason: "identity-won-fit"
        }
      }),
      modelKey: "football-poisson-v3",
      engineVersion: "decision-engine-v1"
    });

    expect(result.adjustment).toMatchObject({ status: "applied", method: "none", temperature: 1 });
    expect(result.markets).toBe(markets);
  });

  it("keeps every learned parameter shadow-only when the promoted model does not match runtime", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(match, {
      learningProfile: profile({ modelKey: "football-poisson-elo-v1" })
    });

    expect(prediction.calibrationAdjustment?.status).toBe("inactive");
    expect(prediction.decision.learningProfile).toMatchObject({
      status: "shadow-only",
      active: false
    });
    expect(prediction.decision.learningProfile?.reason).toContain("does not match runtime football-poisson-v3");
  });
});
