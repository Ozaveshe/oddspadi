import { describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY, CORE_ANALYTICS_FUNNEL, hasAnalyticsConsent, trackEvent, type AnalyticsEvent } from "@/lib/analytics/events";

describe("analytics taxonomy", () => {
  it("defines the canonical route funnel and action branches", () => {
    expect(CORE_ANALYTICS_FUNNEL).toEqual([
      { step: "land", event: "site_landed" },
      { step: "view_predictions", event: "predictions_viewed" },
      { step: "open_match_detail", event: "match_detail_opened" },
      { step: "action", events: ["share_clicked", "betslip_pick_added", "team_followed", "outbound_link_clicked", "affiliate_outbound_clicked"] }
    ]);
  });

  it("does not emit before consent and emits through both configured sinks after consent", () => {
    const gtag = vi.fn(); const sendBeacon = vi.fn(() => true); const storage = new Map<string, string>();
    const previousEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT; process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = "/api/analytics-test";
    vi.stubGlobal("window", { location: { pathname: "/predictions" }, localStorage: { getItem: (key: string) => storage.get(key) ?? null }, gtag });
    vi.stubGlobal("navigator", { sendBeacon });
    trackEvent("predictions_viewed", { sport: "football", league: "NPFL" });
    expect(gtag).not.toHaveBeenCalled(); expect(sendBeacon).not.toHaveBeenCalled(); expect(hasAnalyticsConsent()).toBe(false);
    storage.set(ANALYTICS_CONSENT_KEY, "granted");
    trackEvent("predictions_viewed", { sport: "football", league: "NPFL" });
    expect(gtag).toHaveBeenCalledWith("event", "predictions_viewed", { sport: "football", league: "NPFL" });
    expect(sendBeacon).toHaveBeenCalledOnce();
    if (previousEndpoint === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT; else process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = previousEndpoint;
    vi.unstubAllGlobals();
  });

  it("keeps funnel and documented interaction events type-safe", () => {
    const events: AnalyticsEvent[] = ["value_pick_clicked", "betslip_pick_added", "share_clicked", "team_followed", "community_post_liked", "affiliate_outbound_clicked"];
    expect(new Set(events).size).toBe(events.length);
  });
});
