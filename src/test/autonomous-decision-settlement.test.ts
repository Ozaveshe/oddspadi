import { describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import { buildAutonomousPendingOutcome } from "@/lib/sports/prediction/decisionAutonomousOutcome";
import {
  runDecisionAutonomousSettlement,
  type AutonomousPendingOutcomeRow
} from "@/lib/sports/prediction/decisionAutonomousSettlement";

async function fixture() {
  const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
  const prediction = buildPrediction(match);
  return { match, prediction };
}

describe("autonomous shadow outcomes", () => {
  it("opens an auditable match-winner outcome even when the final action is avoid", async () => {
    const { match, prediction } = await fixture();
    const outcome = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "run-1",
      evidenceHash: "fnv1a-12345678",
      finalDecision: prediction.decision
    });

    expect(outcome).not.toBeNull();
    expect(outcome).toMatchObject({
      decisionRunId: "run-1",
      fixtureExternalId: match.id,
      market: "match_winner",
      result: "pending",
      source: "autonomous-shadow"
    });
    expect(outcome?.metadata).toMatchObject({ paperOnly: true, evidenceHash: "fnv1a-12345678" });
  });

  it("settles a pending outcome only from a provider final score and then runs calibration", async () => {
    const { match, prediction } = await fixture();
    const pending = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "run-1",
      evidenceHash: "fnv1a-12345678",
      finalDecision: prediction.decision
    });
    if (!pending) throw new Error("Expected a pending outcome.");
    const row: AutonomousPendingOutcomeRow = {
      id: "outcome-1",
      decision_run_id: "run-1",
      fixture_external_id: match.id,
      sport: "football",
      market: pending.market,
      selection: pending.selection,
      model_probability: pending.modelProbability ?? null,
      implied_probability: pending.impliedProbability ?? null,
      value_edge: pending.valueEdge ?? null,
      odds: pending.odds ?? null,
      closing_odds: 1.77,
      result: "pending",
      source: "autonomous-shadow",
      metadata: pending.metadata ?? {},
      created_at: "2026-07-10T06:00:00.000Z"
    };
    const finishedMatch = { ...match, status: "finished" as const, score: { home: 2, away: 1 }, oddsMarkets: [] };
    const storeOutcome = vi.fn(async () => ({
      status: "stored" as const,
      configured: true,
      table: "op_prediction_outcomes" as const,
      id: "outcome-1"
    }));
    const runCalibration = vi.fn(async () => ({ status: "stored" as const, configured: true, id: "calibration-1" }));

    const receipt = await runDecisionAutonomousSettlement({
      runRequested: true,
      adminAuthorized: true,
      rowsOverride: [row],
      matchesByDateOverride: new Map([[match.kickoffTime.slice(0, 10), [finishedMatch]]]),
      storeOutcome,
      runCalibration,
      now: new Date("2026-08-22T01:00:00.000Z")
    });

    expect(receipt.status).toBe("settled");
    expect(receipt.totals).toMatchObject({ pendingRead: 1, finalScoresMatched: 1, readyToSettle: 1, settled: 1 });
    expect(["won", "lost"]).toContain(receipt.drafts[0].result);
    expect(receipt.drafts[0].finalScore).toEqual({ home: 2, away: 1 });
    expect(receipt.drafts[0]).toMatchObject({ closingOdds: 1.77, closingOddsSource: "stored-pre-kickoff" });
    expect(storeOutcome).toHaveBeenCalledTimes(1);
    expect(storeOutcome).toHaveBeenCalledWith(expect.objectContaining({ closingOdds: 1.77 }));
    expect(runCalibration).toHaveBeenCalledWith("football");
  });

  it("stores the latest provider price only while the outcome is still pre-kickoff", async () => {
    const { match, prediction } = await fixture();
    const pending = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "run-closing-1",
      evidenceHash: "fnv1a-closing",
      finalDecision: prediction.decision
    });
    if (!pending) throw new Error("Expected a pending outcome.");
    const row: AutonomousPendingOutcomeRow = {
      id: "outcome-closing-1",
      decision_run_id: "run-closing-1",
      fixture_external_id: match.id,
      sport: "football",
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
      created_at: "2026-07-10T06:00:00.000Z"
    };
    const refreshClosingLine = vi.fn(async () => ({
      status: "stored" as const,
      configured: true,
      table: "op_prediction_outcomes" as const,
      id: row.id
    }));
    const storeOutcome = vi.fn();

    const receipt = await runDecisionAutonomousSettlement({
      runRequested: true,
      adminAuthorized: true,
      rowsOverride: [row],
      matchesByDateOverride: new Map([[match.kickoffTime.slice(0, 10), [match]]]),
      refreshClosingLine,
      storeOutcome,
      now: new Date("2026-08-20T12:00:00.000Z")
    });

    expect(receipt.status).toBe("waiting-results");
    expect(receipt.totals).toMatchObject({ closingLineCandidates: 1, closingLinesCaptured: 1, closingLineFailures: 0 });
    expect(receipt.drafts[0].closingOddsSource).toBe("provider-pre-kickoff");
    expect(receipt.drafts[0].secondsBeforeKickoff).toBeGreaterThan(0);
    expect(refreshClosingLine).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeId: row.id,
        closingOdds: expect.any(Number),
        metadata: expect.objectContaining({ source: "provider-current-pre-kickoff", market: row.market, selection: row.selection })
      })
    );
    expect(storeOutcome).not.toHaveBeenCalled();
  });

  it("rejects an available provider price after kickoff when no stored pre-kickoff quote exists", async () => {
    const { match, prediction } = await fixture();
    const pending = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "run-closing-2",
      evidenceHash: "fnv1a-closing-2",
      finalDecision: prediction.decision
    });
    if (!pending) throw new Error("Expected a pending outcome.");
    const row: AutonomousPendingOutcomeRow = {
      id: "outcome-closing-2",
      decision_run_id: "run-closing-2",
      fixture_external_id: match.id,
      sport: "football",
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
      created_at: "2026-07-10T06:00:00.000Z"
    };
    const refreshClosingLine = vi.fn();

    const receipt = await runDecisionAutonomousSettlement({
      runRequested: true,
      adminAuthorized: true,
      rowsOverride: [row],
      matchesByDateOverride: new Map([[match.kickoffTime.slice(0, 10), [match]]]),
      refreshClosingLine,
      now: new Date("2026-08-22T12:00:00.000Z")
    });

    expect(receipt.totals.closingLineCandidates).toBe(0);
    expect(receipt.drafts[0]).toMatchObject({ closingOdds: null, closingOddsSource: null });
    expect(receipt.drafts[0].secondsBeforeKickoff).toBeLessThan(0);
    expect(refreshClosingLine).not.toHaveBeenCalled();
  });

  it("keeps preview settlement read-only while results are not final", async () => {
    const { match, prediction } = await fixture();
    const pending = buildAutonomousPendingOutcome({
      match,
      prediction,
      decisionRunId: "run-2",
      evidenceHash: "fnv1a-87654321",
      finalDecision: prediction.decision
    });
    if (!pending) throw new Error("Expected a pending outcome.");
    const row: AutonomousPendingOutcomeRow = {
      id: "outcome-2",
      decision_run_id: "run-2",
      fixture_external_id: match.id,
      sport: "football",
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
      created_at: "2026-07-10T06:00:00.000Z"
    };
    const storeOutcome = vi.fn();
    const receipt = await runDecisionAutonomousSettlement({
      rowsOverride: [row],
      matchesByDateOverride: new Map([[match.kickoffTime.slice(0, 10), [match]]]),
      storeOutcome
    });

    expect(receipt.status).toBe("waiting-results");
    expect(receipt.totals.waiting).toBe(1);
    expect(storeOutcome).not.toHaveBeenCalled();
  });
});
