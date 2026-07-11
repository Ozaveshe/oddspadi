import { describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import { buildAutonomousPendingOutcome } from "@/lib/sports/prediction/decisionAutonomousOutcome";
import { runDecisionAutonomousSettlement, type AutonomousPendingOutcomeRow } from "@/lib/sports/prediction/decisionAutonomousSettlement";
import { buildMultiSportLiveSettlementLabelReceipt } from "@/lib/sports/training/multiSportLiveSettlementLabelReceipt";
import { trainingModelKey } from "@/lib/sports/training/trainingRepository";
import type { FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";

describe("multi-sport settlement and calibration", () => {
  it("settles a basketball shadow outcome and calibrates the basketball model only", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-07-10", "basketball");
    const prediction = buildPrediction(match);
    const pending = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "basketball-run-1",
      evidenceHash: "fnv1a-basketball",
      finalDecision: prediction.decision
    });
    if (!pending) throw new Error("Expected basketball pending outcome.");
    const row: AutonomousPendingOutcomeRow = {
      id: "basketball-outcome-1",
      decision_run_id: "basketball-run-1",
      fixture_external_id: match.id,
      sport: "basketball",
      market: pending.market,
      selection: pending.selection,
      model_probability: pending.modelProbability ?? null,
      implied_probability: pending.impliedProbability ?? null,
      value_edge: pending.valueEdge ?? null,
      odds: pending.odds ?? null,
      closing_odds: null,
      result: "pending",
      source: "autonomous-shadow",
      metadata: pending.metadata ?? {},
      created_at: "2026-07-10T01:00:00.000Z"
    };
    const finished = { ...match, status: "finished" as const, score: { home: 91, away: 84 } };
    const storeOutcome = vi.fn(async () => ({ status: "stored" as const, configured: true, table: "op_prediction_outcomes" as const, id: row.id }));
    const runCalibration = vi.fn(async () => ({ status: "stored" as const, configured: true, id: "basketball-calibration-1" }));
    const receipt = await runDecisionAutonomousSettlement({
      sport: "basketball",
      runRequested: true,
      adminAuthorized: true,
      rowsOverride: [row],
      matchesByDateOverride: new Map([["2026-07-10", [finished]]]),
      storeOutcome,
      runCalibration
    });
    expect(receipt.status).toBe("settled");
    expect(receipt.request.sport).toBe("basketball");
    expect(receipt.totals.settled).toBe(1);
    expect(runCalibration).toHaveBeenCalledWith("basketball");
    expect(receipt.controls.canApplyLearnedWeights).toBe(false);
  });

  it("drafts a provider-final tennis feature label while keeping training locked", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-07-10", "tennis");
    const eventId = "tennis-score-event-1";
    const finished = {
      ...match,
      id: `the-odds-api:${eventId}`,
      status: "finished" as const,
      score: { home: 3, away: 1 },
      dataSource: { kind: "provider" as const, fixtureProvider: "the-odds-api-scores", fixtureProviderId: eventId }
    };
    const row: FootballDataProviderRetestFeatureRow = {
      id: "feature-row-1",
      fixture_external_id: `the-odds-api:${eventId}`,
      sport: "tennis",
      model_key: trainingModelKey("tennis"),
      generated_at: "2026-07-10T01:00:00.000Z",
      label: null,
      features: {
        kickoffAt: "2026-07-10T02:00:00.000Z",
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        dataSource: { kind: "provider", fixtureProviderId: eventId, oddsProviderEventId: eventId },
        evidence: { providerIdentity: true, providerStrength: true }
      },
      targets: { actualOutcome: null, settlementStatus: "pending" },
      split: "live",
      source: "the-odds-api-events",
      feature_hash: "fnv1a-original",
      created_at: "2026-07-10T01:00:00.000Z"
    };
    const receipt = await buildMultiSportLiveSettlementLabelReceipt({
      sport: "tennis",
      rowsOverride: [row],
      matchesByDateOverride: new Map([["2026-07-10", [finished]]]),
      now: new Date("2026-07-10T05:00:00.000Z")
    });
    expect(receipt.status).toBe("labels-ready");
    expect(receipt.totals).toMatchObject({ rowsRead: 1, finalScoresMatched: 1, labelsDrafted: 1, rowsUpdated: 0 });
    expect(receipt.drafts[0]).toMatchObject({ actualOutcome: "home", finalScore: { home: 3, away: 1 }, canUpdateRow: true });
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canApplyLearnedWeights).toBe(false);
  });
});
