import { describe, expect, it } from "vitest";
import { buildFootballProviderLiveOpeningRoundDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveOpeningRoundDecisionCycleReceipt";
import type { FootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";

function oddsEvent({
  id,
  date,
  home,
  away,
  prices
}: {
  id: string;
  date: string;
  home: string;
  away: string;
  prices: [number, number, number];
}) {
  return {
    id,
    sport_key: "soccer_epl",
    sport_title: "EPL",
    commence_time: `${date}T19:00:00Z`,
    home_team: home,
    away_team: away,
    bookmakers: [
      {
        title: "Test Book",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: home, price: prices[0] },
              { name: "Draw", price: prices[1] },
              { name: away, price: prices[2] }
            ]
          }
        ]
      }
    ]
  };
}

function withStoredReadback(receipt: FootballProviderLiveFeatureStorageReceipt): FootballProviderLiveFeatureStorageReceipt {
  const rows = receipt.payload.rows.map((row, index) => {
    const features = row.features as any;
    const targets = row.targets as any;
    return {
      id: `opening-round-stored-${index + 1}`,
      fixtureExternalId: row.fixture_external_id,
      modelKey: row.model_key,
      split: "live" as const,
      source: row.source,
      label: row.label,
      featureHash: row.feature_hash,
      settlementStatus: targets.settlementStatus ?? "pending",
      rawPayloadLinked: features.evidence?.rawPayloadLinked === true,
      fixtureProvider: features.dataSource?.fixtureProvider ?? null,
      oddsProvider: features.dataSource?.oddsProvider ?? null,
      matchLabel: `${features.homeTeam?.name ?? "Home"} vs ${features.awayTeam?.name ?? "Away"}`,
      league: features.league?.name ?? null,
      generatedAt: row.generated_at,
      createdAt: row.created_at
    };
  });

  return {
    ...receipt,
    readback: {
      checked: true,
      evidenceReady: rows.length > 0,
      matchedRows: rows.length,
      rows,
      error: null
    },
    controls: {
      ...receipt.controls,
      canUseStoredMonitorEvidence: rows.length > 0
    }
  };
}

function providerFetch(): (input: string | URL) => Promise<Response> {
  return async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.the-odds-api.com/v4/sports/soccer_epl/odds")) {
      return new Response(
        JSON.stringify([
          oddsEvent({ id: "odds-arsenal-coventry", date: "2026-08-21", home: "Arsenal", away: "Coventry City", prices: [2.25, 4.8, 7.2] }),
          oddsEvent({ id: "odds-hull-man-utd", date: "2026-08-22", home: "Hull City", away: "Manchester United", prices: [5.8, 4.1, 2.25] }),
          oddsEvent({ id: "odds-everton-palace", date: "2026-08-22", home: "Everton", away: "Crystal Palace", prices: [3.05, 3.15, 3.05] })
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  };
}

describe("football provider live opening-round decision cycle", () => {
  it("ranks stored opening-round monitor evidence while keeping publishing, training, and staking locked", async () => {
    const receipt = await buildFootballProviderLiveOpeningRoundDecisionCycleReceipt({
      dates: ["2026-08-21", "2026-08-22"],
      runAi: false,
      env: {
        API_FOOTBALL_KEY: "football-key",
        THE_ODDS_API_KEY: "odds-key",
        OPENAI_API_KEY: "sk-proj-testkeyabcdefghijklmnopqrstuvwxyz",
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_service_role_key",
        ODDSPADI_ADMIN_TOKEN: "admin-token"
      },
      origin: "http://127.0.0.1:3025",
      fetchImpl: providerFetch(),
      storageReceiptDecorator: withStoredReadback,
      now: new Date("2026-07-09T21:00:00.000Z")
    });

    expect(receipt.mode).toBe("football-provider-live-opening-round-decision-cycle");
    expect(receipt.status).toBe("opening-round-monitor-ready");
    expect(receipt.totals.rowsPreviewed).toBe(3);
    expect(receipt.totals.storageReadbackRows).toBe(3);
    expect(receipt.totals.monitorCandidates).toBeGreaterThan(0);
    expect(receipt.target.selectedMatch).toBeTruthy();
    expect(receipt.selectedCycle?.status).toBe("ready-for-ai-review");
    expect(receipt.aiReview?.status).toBe("not-requested");
    expect(receipt.controls.canUseForMonitor).toBe(true);
    expect(receipt.controls.canRequestAIReview).toBe(true);
    expect(receipt.controls.canWriteLiveFeatureSnapshots).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
    expect(receipt.thinkingTrace.map((item) => item.id)).toContain("rank-slate");
  });

  it("runs bounded AI critique for only the selected opening-round candidate when explicitly requested", async () => {
    const openAiFetch = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            reviewVerdict: "agree",
            recommendedAction: "monitor",
            summary: "Monitor-only is acceptable if all locks stay enforced.",
            rationale: ["The selected candidate has cited model-vs-market edge evidence."],
            riskFlags: ["Lineups and late news can change the price."],
            dataGaps: ["Settlement label is pending."],
            saferAlternatives: ["Draw no bet remains safer."],
            evidenceChecks: [{ id: "odds-edge", status: "support", note: "The supplied edge math supports monitor-only review." }],
            unsupportedClaims: [],
            publishPermission: "never",
            persistencePermission: "never",
            trainingPermission: "never",
            stakingPermission: "never",
            publicActionUpgradePermission: "never"
          })
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const receipt = await buildFootballProviderLiveOpeningRoundDecisionCycleReceipt({
      dates: ["2026-08-21", "2026-08-22"],
      runAi: true,
      env: {
        API_FOOTBALL_KEY: "football-key",
        THE_ODDS_API_KEY: "odds-key",
        OPENAI_API_KEY: "sk-proj-testkeyabcdefghijklmnopqrstuvwxyz",
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_service_role_key",
        ODDSPADI_ADMIN_TOKEN: "admin-token"
      },
      origin: "http://127.0.0.1:3025",
      fetchImpl: providerFetch(),
      openAiFetchImpl: openAiFetch as typeof fetch,
      storageReceiptDecorator: withStoredReadback,
      now: new Date("2026-07-09T21:02:00.000Z")
    });

    expect(receipt.status).toBe("opening-round-ai-reviewed-monitor");
    expect(receipt.totals.reviewedCandidates).toBe(1);
    expect(receipt.aiReview?.status).toBe("reviewed");
    expect(receipt.aiReview?.review?.publishPermission).toBe("never");
    expect(receipt.aiReview?.review?.trainingPermission).toBe("never");
    expect(receipt.aiReview?.review?.stakingPermission).toBe("never");
    expect(receipt.selectedCycle?.status).toBe("ai-reviewed-monitor");
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });
});
