import { describe, expect, it } from "vitest";
import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import { buildDecisionEplProviderDryRunInterpreter } from "@/lib/sports/prediction/decisionEplProviderDryRunInterpreter";
import { observeDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";

function readyIntake(): DecisionEplFixtureIntake {
  return {
    date: "2026-08-21",
    intakeHash: "fnv1a-intake",
    nextTask: {
      id: "fetch-official-fixtures",
      status: "ready",
      verifyUrl: "/api/sports/decision/epl-provider-dry-run-receipt?provider=api-football&league=39&season=2026&dryRun=1"
    },
    proofUrls: ["/api/sports/decision/epl-fixture-intake"],
    locks: ["fixture intake stays read-only"]
  } as unknown as DecisionEplFixtureIntake;
}

function verifiedOddsReceipt(): DecisionEplOddsDryRunReceipt {
  return {
    date: "2026-08-21",
    status: "verified",
    receiptHash: "fnv1a-odds",
    summary: "odds verified",
    observation: {
      attempted: true,
      dryRun: true,
      fetchedEvents: 1,
      normalizedOddsRows: 10,
      responseHash: "fnv1a-odds-response",
      reason: null,
      error: null,
      signals: ["status:dry-run", "oddsRows:10"]
    },
    controls: {
      canRunOddsDryRun: false,
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/epl-odds-dry-run-receipt"],
    locks: ["odds receipt remains read-only"]
  } as unknown as DecisionEplOddsDryRunReceipt;
}

describe("EPL API-Football dry-run rate-limit handling", () => {
  it("classifies HTTP 429 as rate-limited without retrying or leaking secrets", async () => {
    const env = {
      API_FOOTBALL_KEY: "football-secret-should-not-render",
      ODDSPADI_ADMIN_TOKEN: "admin-secret-should-not-render"
    };
    let syncCalls = 0;

    const receipt = await observeDecisionEplProviderDryRunReceipt({
      intake: readyIntake(),
      runRequested: true,
      adminAuthorized: true,
      env,
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-09T12:00:00.000Z"),
      syncImpl: async ({ request }) => {
        syncCalls += 1;
        expect(request).toEqual(
          expect.objectContaining({
            provider: "api-football",
            league: "39",
            season: "2026",
            date: "2026-08-21",
            dryRun: true
          })
        );
        return {
          status: "provider-error",
          configured: true,
          provider: "api-football",
          dryRun: true,
          endpoint: "https://v3.football.api-sports.io/fixtures?league=39&season=2026&date=2026-08-21&timezone=UTC",
          fetched: 0,
          normalized: 0,
          reason: "Provider returned HTTP 429."
        };
      }
    });

    const interpreter = buildDecisionEplProviderDryRunInterpreter({
      receipt,
      now: new Date("2026-07-09T12:01:00.000Z")
    });
    const ledger = buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt: receipt,
      eplOddsDryRunReceipt: verifiedOddsReceipt(),
      runRequested: true,
      adminAuthorized: true,
      now: new Date("2026-07-09T12:02:00.000Z")
    });

    expect(syncCalls).toBe(1);
    expect(receipt.status).toBe("rate-limited");
    expect(receipt.summary).toContain("throttled");
    expect(receipt.verification.fallbackAction).toContain("Cool down");
    expect(receipt.observation.error).toContain("HTTP 429");
    expect(receipt.controls.canWriteFixtures).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(interpreter.status).toBe("rate-limited");
    expect(interpreter.interpretation.risk).toContain("missing key");
    expect(interpreter.nextTurn.label).toContain("Cool down");
    expect(interpreter.nextTurn.safeToRun).toBe(false);
    expect(interpreter.controls.canUseProviderProofForStorageReview).toBe(false);
    expect(ledger.status).toBe("provider-rate-limited");
    expect(ledger.rows.find((row) => row.id === "football-fixtures")?.status).toBe("rate-limited");
    expect(ledger.nextAction.label).toBe("Wait for provider quota window and rerun dry-run");
    expect(JSON.stringify({ receipt, interpreter, ledger })).not.toContain("football-secret-should-not-render");
    expect(JSON.stringify({ receipt, interpreter, ledger })).not.toContain("admin-secret-should-not-render");
  });
});
