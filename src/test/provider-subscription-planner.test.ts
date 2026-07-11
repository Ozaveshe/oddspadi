import { describe, expect, it } from "vitest";
import type { DecisionProviderActivationQueue } from "@/lib/sports/prediction/decisionProviderActivationQueue";
import type { DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import { buildDecisionProviderSubscriptionPlanner } from "@/lib/sports/prediction/decisionProviderSubscriptionPlanner";

function activationQueue(status: DecisionProviderActivationQueue["status"] = "ready-dry-run"): DecisionProviderActivationQueue {
  return {
    mode: "provider-activation-queue",
    generatedAt: "2026-07-09T12:00:00.000Z",
    date: "2026-08-21",
    sport: "football",
    status,
    queueHash: "fnv1a-provider-queue",
    summary: "queue",
    totals: {
      items: 1,
      ready: 1,
      waitingEnv: 0,
      storageBlocked: 0,
      locked: 0,
      safeCommands: 1,
      targetTables: 2
    },
    currentBlocker: {
      label: "Run dry-run",
      missing: [],
      proofUrl: "/api/sports/decision/provider-activation-queue",
      nextAction: "Run dry-run"
    },
    eplBridge: {
      season: "2026/27",
      providerSeason: "2026",
      startDate: "2026-08-21",
      daysUntilStart: 43,
      fixtureCount: 380,
      sourceUrl: "https://www.premierleague.com/fixtures",
      status: "ready"
    },
    providerKeyPlan: keyPlan(),
    trainingBridge: {
      window: "2016-2025",
      estimatedMatches: 3800,
      estimatedOddsSnapshots: 7600,
      nextJob: "football",
      status: "ready-dry-run"
    },
    queue: [],
    nextItem: null,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: true,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: ["queue stays read-only"],
    proofUrls: ["/api/sports/decision/provider-activation-queue"]
  } as unknown as DecisionProviderActivationQueue;
}

function keyPlan(): DecisionProviderKeyPlan {
  return {
    mode: "provider-key-plan",
    status: "ready",
    summary: "keys ready",
    firstSeasonTarget: {
      competition: "Premier League",
      season: "2026/27",
      providerSeason: "2026",
      starts: "2026-08-21",
      openingFixture: "Liverpool vs Bournemouth",
      daysUntilStart: 43,
      sourceUrl: "https://www.premierleague.com/fixtures"
    },
    lanes: [],
    nextLane: null,
    missingCriticalKeys: [],
    configuredCriticalLanes: 4,
    totalCriticalLanes: 4,
    feedMatrix: {
      rows: [],
      nextFeed: null,
      totals: {
        feeds: 0,
        configured: 0,
        missingCritical: 0,
        optionalMissing: 0,
        modelFeatures: 0
      }
    }
  };
}

describe("provider subscription planner", () => {
  it("opens only read-only dry-runs for API-Football Ultra and The Odds API 100K", () => {
    const planner = buildDecisionProviderSubscriptionPlanner({
      date: "2026-08-21",
      sport: "football",
      providerActivationQueue: activationQueue(),
      providerKeyPlan: keyPlan(),
      apiFootballPlan: "ultra",
      oddsApiPlan: "100k",
      env: {
        API_FOOTBALL_KEY: "configured",
        THE_ODDS_API_KEY: "configured"
      },
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(planner.mode).toBe("provider-subscription-planner");
    expect(planner.status).toBe("ready-controlled-dry-runs");
    expect(planner.selectedPlans.apiFootball.id).toBe("ultra");
    expect(planner.selectedPlans.oddsApi.id).toBe("100k");
    expect(planner.quota.apiFootballHeadroom).toBeGreaterThan(0);
    expect(planner.quota.oddsDailyHeadroom).toBeGreaterThan(0);
    expect(planner.nextOperation?.id).toBe("epl-opening-fixtures");
    expect(planner.operations.find((item) => item.id === "epl-opening-odds")?.status).toBe("ready");
    expect(planner.checkout.filter((item) => item.action === "pay-now").map((item) => item.provider)).toEqual([
      "API-Football",
      "The Odds API"
    ]);
    expect(planner.controls.canRunProviderDryRun).toBe(true);
    expect(planner.controls.canWriteProviderRows).toBe(false);
    expect(planner.controls.canBackfillHistoricalRows).toBe(false);
    expect(planner.controls.canTrainModels).toBe(false);
    expect(planner.controls.canPublishPicks).toBe(false);
    expect(planner.controls.canStake).toBe(false);
  });

  it("keeps odds intelligence waiting on low odds credits and storage holds", () => {
    const lowOdds = buildDecisionProviderSubscriptionPlanner({
      date: "2026-08-21",
      sport: "football",
      providerActivationQueue: activationQueue(),
      providerKeyPlan: keyPlan(),
      apiFootballPlan: "ultra",
      oddsApiPlan: "20k",
      env: {
        API_FOOTBALL_KEY: "configured",
        THE_ODDS_API_KEY: "configured"
      },
      now: new Date("2026-07-09T12:00:00.000Z")
    });
    const storageHeld = buildDecisionProviderSubscriptionPlanner({
      date: "2026-08-21",
      sport: "football",
      providerActivationQueue: activationQueue("needs-supabase-secret"),
      providerKeyPlan: keyPlan(),
      apiFootballPlan: "ultra",
      oddsApiPlan: "100k",
      env: {
        API_FOOTBALL_KEY: "configured",
        THE_ODDS_API_KEY: "configured"
      },
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(lowOdds.status).toBe("waiting-paid-odds");
    expect(lowOdds.operations.find((item) => item.id === "epl-opening-odds")?.status).toBe("waiting-plan");
    expect(lowOdds.controls.canRunProviderDryRun).toBe(false);
    expect(storageHeld.status).toBe("storage-held");
    expect(storageHeld.operations.every((item) => item.status === "storage-held")).toBe(true);
    expect(storageHeld.controls.canRunProviderDryRun).toBe(false);
  });
});
