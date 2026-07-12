export type AnalyticsEvent =
  | "prediction_viewed"
  | "value_pick_clicked"
  | "match_detail_opened"
  | "filter_used"
  | "sport_selected"
  | "betslip_pick_added"
  | "live_score_opened"
  | "account_auth_completed"
  | "account_signed_out"
  | "community_post_created"
  | "forum_thread_created"
  | "forum_reply_created"
  | "outbound_link_clicked"
  | "web_vital"
  | "client_error";

export type AnalyticsMetadata = Record<string, string | number | boolean>;

export const ANALYTICS_CONSENT_KEY = "oddspadi-analytics-consent-v1";
export const ANALYTICS_PREFERENCES_EVENT = "oddspadi:analytics-preferences";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

export function hasAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

/**
 * Privacy-gated, vendor-neutral analytics sink. Events are sent only after the
 * visitor has opted in. Google Analytics is used when a measurement ID is set;
 * the optional collector endpoint remains available for a future first-party
 * pipeline. Analytics failures must never break the product experience.
 */
export function trackEvent(event: AnalyticsEvent, metadata: AnalyticsMetadata = {}) {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return;

  try {
    window.gtag?.("event", event, metadata);

    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
    if (!endpoint) return;

    const payload = JSON.stringify({
      event,
      metadata,
      path: window.location.pathname,
      at: new Date().toISOString()
    });
    if (typeof navigator.sendBeacon === "function") {
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
    // Telemetry is best-effort and must never surface errors to visitors.
  }
}
