import { describe, expect, it } from "vitest";
import { buildModelSkillAnchor, MAX_TRUSTED_CALIBRATION_ERROR } from "@/lib/sports/prediction/modelSkillAnchor";
import { applyMarketPriorAdjustmentToMarkets } from "@/lib/sports/prediction/odds";
import type { DecisionLearningProfile, OddsMarket, PredictionMarket } from "@/lib/sports/types";

function profile(overrides: Partial<DecisionLearningProfile> = {}): DecisionLearningProfile {
  return {
    status: "active",
    source: "settled-outcomes",
    active: true,
    calibrationBucketSource: "promoted-cohort",
    sampleSize: 200,
    realFinishedFixtures: 200,
    minimumRecommendedFixtures: 30,
    minimumEdge: null,
    valueEdgeWeight: null,
    dataQualityWeight: null,
    marketAdjustmentWeight: null,
    homeAdvantageElo: null,
    brierScore: 0.19,
    calibrationError: 0.04,
    yield: null,
    closingLineValue: null,
    ...overrides
  } as DecisionLearningProfile;
}

/** A liquid, tightly-agreeing three-way market priced near 40/30/30. */
function market(): OddsMarket {
  return {
    id: "match_winner",
    name: "Match winner",
    priceMethod: "best-price-per-selection-v1",
    selections: [
      { id: "home", label: "Home", decimalOdds: 2.5 },
      { id: "draw", label: "Draw", decimalOdds: 3.33 },
      { id: "away", label: "Away", decimalOdds: 3.33 }
    ],
    consensus: {
      method: "median-no-vig-v1",
      bookmakerCount: 12,
      averageMargin: 0.04,
      maxProbabilitySpread: 0.01,
      probabilities: { home: 0.4, draw: 0.3, away: 0.3 }
    }
  } as OddsMarket;
}

/** The failure mode from production: the model asserts a wild edge over the market. */
function overconfidentModel(): PredictionMarket[] {
  return [{ marketId: "match_winner", probabilities: { home: 0.9, draw: 0.05, away: 0.05 } } as PredictionMarket];
}

function blendedHome(anchorProfile?: DecisionLearningProfile): number {
  const result = applyMarketPriorAdjustmentToMarkets(
    overconfidentModel(),
    [market()],
    0.9,
    undefined,
    undefined,
    anchorProfile === undefined ? undefined : buildModelSkillAnchor(anchorProfile)
  );
  return result.markets[0]!.probabilities.home!;
}

describe("model skill anchor", () => {
  it("treats a runtime with no promoted cohort as unproven", () => {
    const anchor = buildModelSkillAnchor(undefined);

    expect(anchor.status).toBe("unproven");
    expect(anchor.marketWeightFloor).toBe(0.8);
  });

  it("treats a backtest-only curve as unproven, not proven", () => {
    // Economic confidence already refuses backtest curves; the anchor must agree.
    const anchor = buildModelSkillAnchor(profile({ calibrationBucketSource: "backtest" }));

    expect(anchor.status).toBe("unproven");
  });

  it("holds a promoted but miscalibrated curve close to the market", () => {
    const anchor = buildModelSkillAnchor(profile({ calibrationError: MAX_TRUSTED_CALIBRATION_ERROR + 0.15 }));

    expect(anchor.status).toBe("developing");
    expect(anchor.reason).toContain("exceeds");
  });

  it("gives a thin sample less room than a full one", () => {
    const thin = buildModelSkillAnchor(profile({ realFinishedFixtures: 3 }));
    const full = buildModelSkillAnchor(profile({ realFinishedFixtures: 30 }));

    expect(thin.status).toBe("developing");
    expect(thin.marketWeightFloor).toBeGreaterThan(full.marketWeightFloor);
  });

  it("earns room to disagree once calibrated on a real sample", () => {
    const anchor = buildModelSkillAnchor(profile());

    expect(anchor.status).toBe("proven");
    expect(anchor.marketWeightFloor).toBe(0.25);
  });

  it("pulls the unproven blend most of the way back to the priced market", () => {
    // This is the production failure: without an anchor the market held only
    // ~10% of the blend, so a 0.90 model probability against a 0.40 market
    // survived almost intact and published as a huge edge.
    const unanchored = blendedHome(undefined);
    const anchored = applyMarketPriorAdjustmentToMarkets(
      overconfidentModel(),
      [market()],
      0.9,
      undefined,
      undefined,
      buildModelSkillAnchor(undefined)
    ).markets[0]!.probabilities.home!;

    expect(anchored).toBeLessThan(unanchored);
    // 0.80 floor on a 12-book, tight-spread market lands the blend near 0.50,
    // not the 0.85+ the unanchored path produced.
    expect(anchored).toBeLessThan(0.56);
    expect(anchored).toBeGreaterThan(0.4);
  });

  it("lets a proven model keep more of its own disagreement", () => {
    const proven = applyMarketPriorAdjustmentToMarkets(
      overconfidentModel(),
      [market()],
      0.9,
      undefined,
      undefined,
      buildModelSkillAnchor(profile())
    ).markets[0]!.probabilities.home!;
    const unproven = applyMarketPriorAdjustmentToMarkets(
      overconfidentModel(),
      [market()],
      0.9,
      undefined,
      undefined,
      buildModelSkillAnchor(undefined)
    ).markets[0]!.probabilities.home!;

    expect(proven).toBeGreaterThan(unproven);
  });
});
