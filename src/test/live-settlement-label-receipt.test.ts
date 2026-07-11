import { describe, expect, it } from "vitest";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { buildFootballProviderLiveSettlementLabelReceipt } from "@/lib/sports/training/footballProviderLiveSettlementLabelReceipt";

function liveRow(overrides: Partial<FootballDataProviderRetestFeatureRow> = {}): FootballDataProviderRetestFeatureRow {
  return {
    id: "stored-live-arsenal-coventry",
    fixture_external_id: "epl-2026-arsenal-coventry-city",
    sport: "football",
    model_key: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
    generated_at: "2026-08-21T18:30:00.000Z",
    label: null,
    split: "live",
    source: "epl-2026-opening-live-provider",
    feature_hash: "fnv1a-live",
    created_at: "2026-08-21T18:30:00.000Z",
    features: {
      providerFixtureExternalId: "api-football:1557367",
      canonicalFixtureExternalId: "epl-2026-arsenal-coventry-city",
      kickoffAt: "2026-08-21T19:00:00Z",
      homeTeam: { id: "api-football:42", name: "Arsenal", rating: 91 },
      awayTeam: { id: "api-football:999", name: "Coventry City", rating: 72 },
      modelProbabilities: { home: 0.48, draw: 0.24, away: 0.28 },
      marketProbabilities: { home: 0.68, draw: 0.2, away: 0.12 },
      odds: { home: 1.48, draw: 4.8, away: 7.2 },
      closingOdds: {},
      evidence: {
        fixtureIdentity: true,
        marketOdds: true,
        teamStrength: true,
        availabilityContext: false,
        newsWeatherContext: false,
        liveAndSettlement: false,
        featureSnapshot: true,
        rawPayloadLinked: true
      },
      dataSource: { kind: "provider", fixtureProvider: "api-football", oddsProvider: "the-odds-api" }
    },
    targets: {
      actualOutcome: null,
      settlementStatus: "pending",
      currentScore: null
    },
    ...overrides
  };
}

function providerFetch(status: "FT" | "NS" = "FT"): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("football.api-sports.io/fixtures?") && url.includes("team=")) {
      return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("football.api-sports.io/fixtures?") && url.includes("date=2026-08-21")) {
      expect(new Headers(init?.headers).get("x-apisports-key")).toBe("football-key");
      return new Response(
        JSON.stringify({
          response: [
            {
              fixture: { id: 1557367, date: "2026-08-21T19:00:00Z", status: { short: status }, venue: { name: "Emirates Stadium", city: "London" } },
              league: { id: 39, name: "Premier League", country: "England", season: 2026 },
              teams: {
                home: { id: 42, name: "Arsenal" },
                away: { id: 999, name: "Coventry" }
              },
              goals: status === "FT" ? { home: 2, away: 1 } : { home: null, away: null }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("football.api-sports.io/fixtures/lineups") || url.includes("football.api-sports.io/injuries") || url.includes("football.api-sports.io/fixtures/events")) {
      return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("football.api-sports.io/standings")) {
      return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("football provider live settlement label receipt", () => {
  it("drafts outcome labels from provider final scores without unlocking training or public action", async () => {
    const receipt = await buildFootballProviderLiveSettlementLabelReceipt({
      rowsOverride: [liveRow()],
      env: { API_FOOTBALL_KEY: "football-key" },
      origin: "http://127.0.0.1:3025",
      fetchImpl: providerFetch("FT"),
      now: new Date("2026-08-22T00:10:00.000Z")
    });

    expect(receipt.mode).toBe("football-provider-live-settlement-label-receipt");
    expect(receipt.status).toBe("labels-ready");
    expect(receipt.totals.rowsRead).toBe(1);
    expect(receipt.totals.labelsDrafted).toBe(1);
    expect(receipt.drafts[0]).toMatchObject({
      fixtureExternalId: "epl-2026-arsenal-coventry-city",
      matchedProviderFixtureId: "api-football:1557367",
      actualOutcome: "home",
      finalScore: { home: 2, away: 1 },
      status: "ready"
    });
    expect(receipt.controls.canDraftOutcomeLabels).toBe(true);
    expect(receipt.controls.canPersistOutcomeLabels).toBe(false);
    expect(receipt.controls.canFeedProviderRetestRunner).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("keeps rows pending until the provider fixture is finished", async () => {
    const receipt = await buildFootballProviderLiveSettlementLabelReceipt({
      rowsOverride: [liveRow()],
      env: { API_FOOTBALL_KEY: "football-key" },
      origin: "http://127.0.0.1:3025",
      fetchImpl: providerFetch("NS"),
      now: new Date("2026-08-21T12:00:00.000Z")
    });

    expect(receipt.status).toBe("waiting-final-score");
    expect(receipt.totals.labelsDrafted).toBe(0);
    expect(receipt.drafts[0]?.actualOutcome).toBeNull();
    expect(receipt.controls.canPersistOutcomeLabels).toBe(false);
  });

  it("requires admin authorization before settlement labels can be persisted", async () => {
    const receipt = await buildFootballProviderLiveSettlementLabelReceipt({
      rowsOverride: [liveRow()],
      runRequested: true,
      adminAuthorized: false,
      env: { API_FOOTBALL_KEY: "football-key", ODDSPADI_ADMIN_TOKEN: "admin-token" },
      origin: "http://127.0.0.1:3025",
      fetchImpl: providerFetch("FT"),
      now: new Date("2026-08-22T00:15:00.000Z")
    });

    expect(receipt.status).toBe("waiting-admin");
    expect(receipt.totals.labelsDrafted).toBe(1);
    expect(receipt.storage.updated).toBe(false);
    expect(receipt.controls.canPersistOutcomeLabels).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
  });
});
