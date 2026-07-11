import { describe, expect, it } from "vitest";

import { GET as getResidualTrainer } from "@/app/api/sports/decision/training/football-provider-residual-trainer/route";
import type { FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { buildFootballProviderResidualTrainer } from "@/lib/sports/training/footballProviderResidualTrainer";

type Outcome = "home" | "draw" | "away";

function row({
  index,
  split,
  actual,
  market,
  structural
}: {
  index: number;
  split: "train" | "validation" | "test";
  actual: Outcome;
  market: Record<Outcome, number>;
  structural: Record<Outcome, number>;
}): FootballDataProviderRetestFeatureRow {
  return {
    id: `row-${index}`,
    fixture_external_id: `fixture-${index}`,
    sport: "football",
    model_key: "football-provider-enriched-retest-v1",
    generated_at: "2026-07-10T10:00:00.000Z",
    label: actual,
    features: {
      modelProbabilities: structural,
      marketProbabilities: market,
      homeFeatures: { eloRating: 1500, attackStrength: 1, defenseStrength: 1, recentFormPoints: 7.5 },
      awayFeatures: { eloRating: 1500, attackStrength: 1, defenseStrength: 1, recentFormPoints: 7.5 }
    },
    targets: { actualOutcome: actual },
    split,
    source: "api_football",
    feature_hash: `hash-${index}`,
    created_at: "2026-07-10T10:00:00.000Z"
  };
}

function learnableRows(): FootballDataProviderRetestFeatureRow[] {
  return Array.from({ length: 150 }, (_, index) => {
    const actual: Outcome = index % 2 === 0 ? "home" : "away";
    return row({
      index,
      split: index < 100 ? "train" : "validation",
      actual,
      market: { home: 0.34, draw: 0.32, away: 0.34 },
      structural: actual === "home"
        ? { home: 0.72, draw: 0.14, away: 0.14 }
        : { home: 0.14, draw: 0.14, away: 0.72 }
    });
  });
}

function marketDominantRows(): FootballDataProviderRetestFeatureRow[] {
  return Array.from({ length: 150 }, (_, index) => {
    const actual: Outcome = (["home", "draw", "away"] as const)[index % 3]!;
    const market = actual === "home"
      ? { home: 0.9, draw: 0.07, away: 0.03 }
      : actual === "draw"
        ? { home: 0.05, draw: 0.9, away: 0.05 }
        : { home: 0.03, draw: 0.07, away: 0.9 };
    return row({
      index,
      split: index < 100 ? "train" : "validation",
      actual,
      market,
      structural: market
    });
  });
}

describe("football provider residual trainer", () => {
  it("learns deterministic validation improvements without test rows", () => {
    const rows = [
      ...learnableRows(),
      row({
        index: 999,
        split: "test",
        actual: "draw",
        market: { home: 0.33, draw: 0.34, away: 0.33 },
        structural: { home: 0.01, draw: 0.01, away: 0.98 }
      })
    ];
    const first = buildFootballProviderResidualTrainer({ rows, now: new Date("2026-07-10T11:00:00.000Z") });
    const second = buildFootballProviderResidualTrainer({ rows, now: new Date("2026-07-10T11:00:00.000Z") });

    expect(first.status).toBe("validation-pass");
    expect(first.corpus).toEqual(expect.objectContaining({ inputRows: 151, trainingRows: 100, validationRows: 50, rejectedRows: 1 }));
    expect(first.selection.passedValidation).toBe(true);
    expect(first.selection.brierImprovementVsMarket).toBeGreaterThan(0);
    expect(first.selection.logLossImprovementVsMarket).toBeGreaterThan(0);
    expect(first.controls.canQueueUntouchedTest).toBe(true);
    expect(first.controls.canApplyResidualModel).toBe(false);
    expect(first.model?.modelHash).toBe(second.model?.modelHash);
    expect(first.trainerHash).toBe(second.trainerHash);
  });

  it("keeps the market dominant and records zero-variance context features", () => {
    const receipt = buildFootballProviderResidualTrainer({
      rows: marketDominantRows(),
      now: new Date("2026-07-10T11:00:00.000Z")
    });

    expect(receipt.status).toBe("market-prior-dominant");
    expect(receipt.selection.passedValidation).toBe(false);
    expect(receipt.featureAudit.droppedZeroVarianceFeatures).toEqual(expect.arrayContaining(["absence_edge", "lineup_edge"]));
    expect(receipt.controls.canQueueUntouchedTest).toBe(false);
    expect(receipt.controls.canPersistModelArtifact).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("rejects write-mode route requests", async () => {
    const response = await getResidualTrainer(
      new Request("http://127.0.0.1:3025/api/sports/decision/training/football-provider-residual-trainer?dryRun=0")
    );
    expect(response.status).toBe(400);
  });
});
