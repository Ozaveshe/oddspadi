import { describe, expect, it } from "vitest";
import {
  assessTrainingFeatureQuality,
  strictTrainingFeatureJsonColumns,
  trainingFeatureRequirements
} from "@/lib/sports/training/featureQuality";

function marketEvidence() {
  return {
    odds: { home: 1.8, away: 2.1 },
    marketProbabilities: { home: 0.54, away: 0.46 },
    modelProbabilities: { home: 0.58, away: 0.42 }
  };
}

function providerIdentity() {
  return {
    kind: "provider",
    fixtureProvider: "the-odds-api-events",
    fixtureProviderId: "fixture-1",
    oddsProvider: "the-odds-api",
    oddsProviderEventId: "fixture-1"
  };
}

function teams(source: string) {
  return {
    homeTeam: { id: "home", name: "Home", ratingEvidence: { source } },
    awayTeam: { id: "away", name: "Away", ratingEvidence: { source } },
    league: { id: "league", name: "League" }
  };
}

describe("training feature quality", () => {
  it("accepts complete provider-backed basketball model inputs", () => {
    const source = "supabase-basketball-historical-strength-v1";
    const side = {
      eloRating: 1580,
      pace: 99.2,
      offensiveEfficiency: 118.4,
      defensiveEfficiency: 109.8,
      restDays: 2,
      recentFormPoints: 9
    };
    const quality = assessTrainingFeatureQuality({
      sport: "basketball",
      source: "the-odds-api",
      split: "live",
      features: {
        ...teams(source),
        ...marketEvidence(),
        dataSource: providerIdentity(),
        homeFeatures: side,
        awayFeatures: { ...side, eloRating: 1510 }
      }
    });

    expect(quality).toMatchObject({
      status: "complete",
      score: 100,
      completeForTraining: true,
      providerBacked: true,
      providerIdentity: true,
      providerStrength: true,
      marketEvidence: true,
      proxyFree: true,
      missingCoreFeatures: []
    });
  });

  it("rejects a provider fixture whose strength still uses a baseline proxy", () => {
    const side = {
      eloRating: 1500,
      pace: 98,
      offensiveEfficiency: 112,
      defensiveEfficiency: 112,
      restDays: 2,
      recentFormPoints: 7
    };
    const quality = assessTrainingFeatureQuality({
      sport: "basketball",
      source: "the-odds-api",
      split: "live",
      features: {
        ...teams("league-strength-baseline-v1"),
        ...marketEvidence(),
        dataSource: providerIdentity(),
        homeFeatures: side,
        awayFeatures: side
      }
    });

    expect(quality.status).toBe("proxy");
    expect(quality.completeForTraining).toBe(false);
    expect(quality.providerStrength).toBe(false);
    expect(quality.proxyFree).toBe(false);
  });

  it("requires surface evidence for complete tennis rows", () => {
    const source = "supabase-tennis-historical-overall-strength-v1";
    const side = {
      eloRating: 2250,
      attackStrength: 0.75,
      defenseStrength: 0.73,
      restDays: 5,
      recentFormPoints: 8
    };
    const quality = assessTrainingFeatureQuality({
      sport: "tennis",
      source: "the-odds-api",
      split: "live",
      features: {
        ...teams(source),
        ...marketEvidence(),
        dataSource: providerIdentity(),
        homeFeatures: side,
        awayFeatures: side
      }
    });

    expect(quality.status).toBe("partial");
    expect(quality.missingCoreFeatures).toContain("court surface");
  });

  it("keeps database completeness columns aligned with sport requirements", () => {
    expect(strictTrainingFeatureJsonColumns("football")).toContain("features->homeFeatures->>attackStrength");
    expect(strictTrainingFeatureJsonColumns("basketball")).toContain("features->awayFeatures->metadata->>defensiveEfficiency");
    expect(strictTrainingFeatureJsonColumns("tennis")).toContain("features->homeFeatures->metadata->>surface");
    expect(trainingFeatureRequirements("basketball").length).toBeGreaterThan(trainingFeatureRequirements("football").length);
  });
});
