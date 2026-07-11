export type AnalyticsEvent =
  | "prediction_viewed"
  | "value_pick_clicked"
  | "match_detail_opened"
  | "filter_used"
  | "sport_selected"
  | "betslip_pick_added"
  | "live_score_opened";

/**
 * Vendor-agnostic analytics sink. No-ops until `NEXT_PUBLIC_ANALYTICS_ENDPOINT`
 * is set, then POSTs events there (via sendBeacon in the browser, keepalive
 * fetch otherwise). Never throws — analytics must not break the app. Call sites
 * still need to be added at the points events should be emitted.
 */
export function trackEvent(event: AnalyticsEvent, metadata?: Record<string, string | number | boolean>) {
  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
  if (!endpoint) return;

  try {
    const payload = JSON.stringify({ event, metadata: metadata ?? {}, at: new Date().toISOString() });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, payload);
      return;
    }
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch {
    // Swallow — telemetry failures must never surface to users.
  }
}
