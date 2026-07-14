import { describe, expect, it, vi } from "vitest";
import { buildDecisionBriefingPersistencePayload } from "@/lib/sports/prediction/decisionBriefing";
import { buildFootballProviderLiveOpeningRoundDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveOpeningRoundDecisionCycleReceipt";
import { buildFootballProviderLiveOpeningRoundOperatorBriefReceipt } from "@/lib/sports/training/footballProviderLiveOpeningRoundOperatorBriefReceipt";
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
      id: `operator-brief-stored-${index + 1}`,
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
          oddsEvent({ id: "odds-hull-man-utd", date: "2026-08-22", home: "Hull City", away: "Manchester United", prices: [5.8, 4.1, 2.25] })
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  };
}

async function aiReviewedCycle() {
  const openAiFetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          reviewVerdict: "agree",
          recommendedAction: "monitor",
          summary: "Monitor-only is acceptable if every lock stays enforced.",
          rationale: ["The evidence packet supports a watchlist note only."],
          riskFlags: ["Late team news can change the edge."],
          dataGaps: ["Closing odds and settlement are still pending."],
          saferAlternatives: ["Draw no bet is lower variance."],
          evidenceChecks: [{ id: "odds-edge", status: "support", note: "Edge math is present." }],
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

  return buildFootballProviderLiveOpeningRoundDecisionCycleReceipt({
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
    now: new Date("2026-07-09T21:10:00.000Z")
  });
}

describe("football opening-round operator brief receipt", () => {
  it("previews an AI-reviewed opening-round brief without storage side effects", async () => {
    const cycle = await aiReviewedCycle();
    const persistBriefing = vi.fn();

    const receipt = await buildFootballProviderLiveOpeningRoundOperatorBriefReceipt({
      cycle,
      persistRequested: false,
      adminAuthorized: false,
      persistBriefing,
      now: new Date("2026-07-09T21:11:00.000Z")
    });

    expect(receipt.mode).toBe("football-provider-live-opening-round-operator-brief");
    expect(receipt.status).toBe("preview-ready");
    expect(receipt.briefing.status).toBe("ready-watchlist");
    expect(receipt.briefing.action).toBe("monitor");
    expect(receipt.persistence.status).toBe("skipped");
    expect(receipt.persistence.readbackReady).toBe(false);
    expect(persistBriefing).not.toHaveBeenCalled();
    expect(receipt.briefing.controls.canPublish).toBe(false);
    expect(receipt.briefing.controls.canTrain).toBe(false);
    expect(receipt.briefing.controls.canStake).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("stores the operator brief only through an admin persistence request and records readback proof", async () => {
    const cycle = await aiReviewedCycle();

    const persistBriefing = vi.fn(async (briefing) => ({
      requested: true,
      status: "stored" as const,
      configured: true,
      table: "op_decision_briefings" as const,
      id: "briefing-row-1",
      readback: {
        id: "briefing-row-1",
        briefingHash: briefing.briefingHash,
        status: briefing.status,
        action: briefing.action,
        targetMatchId: briefing.target.matchId,
        targetMatch: briefing.target.match,
        targetSelection: briefing.target.selection,
        payloadMode: briefing.mode
      }
    }));

    const receipt = await buildFootballProviderLiveOpeningRoundOperatorBriefReceipt({
      cycle,
      persistRequested: true,
      adminAuthorized: true,
      persistBriefing,
      now: new Date("2026-07-09T21:12:00.000Z")
    });

    expect(receipt.status).toBe("stored-readback-ready");
    expect(receipt.persistence.status).toBe("stored");
    expect(receipt.persistence.readbackReady).toBe(true);
    expect(receipt.persistence.readback?.payloadMode).toBe("decision-briefing");
    expect(persistBriefing).toHaveBeenCalledWith(expect.objectContaining({ briefingHash: receipt.briefing.briefingHash }));

    const payload = buildDecisionBriefingPersistencePayload(receipt.briefing);
    const storedPayload = payload.payload as Record<string, unknown>;
    expect(storedPayload.mode).toBe("decision-briefing");
    expect(storedPayload).not.toHaveProperty("requestPreview");
    expect(storedPayload).not.toHaveProperty("deterministicFallback");
    expect(storedPayload).not.toHaveProperty("aiReview");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("api_key");
    expect(receipt.locks.join(" ")).toContain("audit proof only");
  });
});
