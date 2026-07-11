import { describe, expect, it } from "vitest";
import type { DecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import type { DecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";
import { buildDecisionProviderEnrichedRetestReadiness } from "@/lib/sports/prediction/decisionProviderEnrichedRetestReadiness";
import type { DecisionProviderSubscriptionPlanner } from "@/lib/sports/prediction/decisionProviderSubscriptionPlanner";

function historicalDiscipline(status: DecisionHistoricalDisciplineReceipt["status"] = "market-prior-enforced"): DecisionHistoricalDisciplineReceipt {
  return {
    mode: "decision-historical-discipline-receipt",
    date: "2026-08-21",
    sport: "football",
    status,
    chain: {
      publicHistory: {
        status: "market-prior-dominant",
        diagnosticScore: 73,
        fixtures: 3800,
        oddsRows: 3800,
        bookmakerMarkets: 22000,
        benchmarkVerdict: "market-beats-model"
      },
      marketPrior: {
        status: "market-prior-required",
        action: "defer-to-market-prior",
        cappedCandidates: 3
      },
      fusion: {
        status: "ready-shadow",
        action: "defer-to-market-prior",
        marketCapped: 3,
        shadowValue: 0
      },
      promotion: {
        status: "blocked",
        marketCalibrationStatus: "block",
        nextBlockingCheck: "market-calibration"
      },
      aiPacket: {
        status: "ready-preview",
        hasPublicHistoricalEvidence: true,
        publicInstruction: "Public history says market prior dominates; treat raw model edge as blocked evidence."
      }
    },
    controls: {
      canInspectReadOnly: true,
      canUseAsAiEvidence: true,
      canMutateProbabilities: false,
      canPersistDecision: false,
      canPersistTrainingRows: false,
      canApplyLearnedWeights: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/historical-discipline"],
    locks: ["history remains read-only"]
  } as unknown as DecisionHistoricalDisciplineReceipt;
}

function providerLedger(status: DecisionProviderDryRunObservationLedger["status"]): DecisionProviderDryRunObservationLedger {
  const oddsStatus = status === "proof-ready" || status === "provider-rate-limited" ? "verified" : "plan-blocked";
  const fixtureStatus = status === "proof-ready" ? "verified" : status === "provider-rate-limited" ? "rate-limited" : "observed-zero";

  return {
    mode: "provider-dry-run-observation-ledger",
    date: "2026-08-21",
    sport: "football",
    status,
    rows: [
      {
        id: "football-fixtures",
        provider: "api-football",
        status: fixtureStatus,
        normalizedRows: fixtureStatus === "verified" ? 10 : 0,
        nextAction: "Retry API-Football fixture proof."
      },
      {
        id: "odds-markets",
        provider: "the-odds-api",
        status: oddsStatus,
        normalizedRows: oddsStatus === "verified" ? 42 : 0,
        nextAction: "Upgrade The Odds API to a paid historical plan."
      }
    ],
    nextAction: {
      label: status === "proof-ready" ? "Review storage readiness only" : "Upgrade odds plan and rerun dry-run",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger",
      expectedEvidence: "Provider dry-run evidence."
    },
    controls: {
      canInspectReadOnly: true,
      canRunAdminDryRun: status !== "proof-ready",
      canWriteProviderRows: false,
      canWriteFixtures: false,
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/provider-dry-run-observation-ledger"],
    locks: ["provider ledger remains read-only"]
  } as unknown as DecisionProviderDryRunObservationLedger;
}

function subscriptionPlanner(status: DecisionProviderSubscriptionPlanner["status"] = "ready-controlled-dry-runs"): DecisionProviderSubscriptionPlanner {
  return {
    mode: "provider-subscription-planner",
    status,
    selectedPlans: {
      apiFootball: {
        id: "ultra",
        label: "Ultra",
        dailyRequests: 75000,
        configured: true,
        recommended: "ultra"
      },
      oddsApi: {
        id: status === "waiting-paid-odds" ? "free" : "100k",
        label: status === "waiting-paid-odds" ? "Starter" : "100K",
        monthlyCredits: status === "waiting-paid-odds" ? 500 : 100000,
        estimatedDailyCredits: status === "waiting-paid-odds" ? 16 : 3225,
        configured: true,
        recommended: "100k"
      }
    },
    nextOperation: {
      id: "epl-opening-odds",
      label: "Attach opening EPL bookmaker odds from The Odds API",
      status: status === "ready-controlled-dry-runs" ? "ready" : "waiting-plan",
      priority: 2,
      sport: "football",
      provider: "the-odds-api",
      cadence: "once",
      estimatedApiFootballCalls: 0,
      estimatedOddsCredits: 120,
      verifyUrl: "/api/sports/decision/epl-odds-dry-run-receipt?run=1&dryRun=1",
      reason: "odds proof",
      expectedEvidence: "normalized odds rows",
      blocks: []
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: status === "ready-controlled-dry-runs",
      canWriteProviderRows: false,
      canBackfillHistoricalRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/provider-subscription-planner"],
    locks: ["subscription planner remains read-only"]
  } as unknown as DecisionProviderSubscriptionPlanner;
}

describe("provider-enriched retest readiness", () => {
  it("keeps the retest blocked when historical discipline is proven but odds plan proof is blocked", () => {
    const readiness = buildDecisionProviderEnrichedRetestReadiness({
      date: "2026-08-21",
      sport: "football",
      historicalDiscipline: historicalDiscipline(),
      providerDryRunObservationLedger: providerLedger("odds-plan-blocked"),
      providerSubscriptionPlanner: subscriptionPlanner("waiting-paid-odds"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(readiness.status).toBe("odds-plan-blocked");
    expect(readiness.chain.historicalDiscipline.fixtures).toBe(3800);
    expect(readiness.chain.historicalDiscipline.marketPriorAction).toBe("defer-to-market-prior");
    expect(readiness.gates.find((gate) => gate.id === "history")?.status).toBe("pass");
    expect(readiness.gates.find((gate) => gate.id === "odds-proof")?.status).toBe("watch");
    expect(readiness.nextAction.label).toBe("Upgrade The Odds API and rerun odds dry-run");
    expect(readiness.controls.canRunProviderRetestDryRun).toBe(false);
    expect(readiness.controls.canTrainModels).toBe(false);
    expect(readiness.controls.canPublishPicks).toBe(false);
    expect(readiness.controls.canStake).toBe(false);
  });

  it("treats paid-provider plan blocks or rate limits as propagation/backoff instead of a new purchase request", () => {
    const readiness = buildDecisionProviderEnrichedRetestReadiness({
      date: "2026-08-21",
      sport: "football",
      historicalDiscipline: historicalDiscipline(),
      providerDryRunObservationLedger: providerLedger("odds-plan-blocked"),
      providerSubscriptionPlanner: subscriptionPlanner("ready-controlled-dry-runs"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });
    const rateLimited = buildDecisionProviderEnrichedRetestReadiness({
      date: "2026-08-21",
      sport: "football",
      historicalDiscipline: historicalDiscipline(),
      providerDryRunObservationLedger: providerLedger("provider-rate-limited"),
      providerSubscriptionPlanner: subscriptionPlanner("ready-controlled-dry-runs"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(readiness.status).toBe("paid-provider-propagating");
    expect(readiness.nextAction.label).toBe("Wait for paid provider activation and rerun one dry-run");
    expect(readiness.controls.canRunProviderRetestDryRun).toBe(false);
    expect(rateLimited.status).toBe("paid-provider-propagating");
    expect(rateLimited.gates.find((gate) => gate.id === "fixture-proof")?.status).toBe("watch");
    expect(rateLimited.controls.canTrainModels).toBe(false);
    expect(rateLimited.controls.canPublishPicks).toBe(false);
    expect(rateLimited.controls.canStake).toBe(false);
  });

  it("keeps preview mode waiting until provider dry-run proof exists", () => {
    const readiness = buildDecisionProviderEnrichedRetestReadiness({
      date: "2026-08-21",
      sport: "football",
      historicalDiscipline: historicalDiscipline(),
      providerDryRunObservationLedger: providerLedger("not-run"),
      providerSubscriptionPlanner: subscriptionPlanner("ready-controlled-dry-runs"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(readiness.status).toBe("provider-proof-waiting");
    expect(readiness.chain.providerDryRun.status).toBe("not-run");
    expect(readiness.controls.canRunProviderRetestDryRun).toBe(false);
  });

  it("opens only the provider-enriched retest dry-run when history, provider proof, and plans are ready", () => {
    const readiness = buildDecisionProviderEnrichedRetestReadiness({
      date: "2026-08-21",
      sport: "football",
      historicalDiscipline: historicalDiscipline(),
      providerDryRunObservationLedger: providerLedger("proof-ready"),
      providerSubscriptionPlanner: subscriptionPlanner("ready-controlled-dry-runs"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(readiness.status).toBe("ready-provider-retest-dry-run");
    expect(readiness.controls.canRunProviderRetestDryRun).toBe(true);
    expect(readiness.controls.canWriteProviderRows).toBe(false);
    expect(readiness.controls.canPersistTrainingRows).toBe(false);
    expect(readiness.controls.canPersistBacktestRun).toBe(false);
    expect(readiness.controls.canApplyLearnedWeights).toBe(false);
    expect(readiness.controls.canPublishPicks).toBe(false);
    expect(readiness.controls.canStake).toBe(false);
  });
});
