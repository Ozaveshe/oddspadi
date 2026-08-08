export type AnalyticsEvent =
  | "site_landed"
  | "predictions_viewed"
  /**
   * A view of a surface the funnel does not otherwise name.
   *
   * Fifteen routes emitted nothing on view, including three of the four
   * top-level surfaces, so the funnel could not answer whether anyone used
   * Explore, Track Record or My Padi — the exact question the v1.7
   * consolidation was meant to make answerable. One event with a
   * `page_context` of the owning surface covers all of them without adding
   * fifteen names to this union or a second event per navigation.
   */
  | "surface_viewed"
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
  | "affiliate_outbound_clicked"
  | "share_clicked"
  | "team_followed"
  | "team_unfollowed"
  | "community_post_liked"
  | "community_post_unliked"
  | "community_comment_posted"
  | "web_vital"
  | "client_error";

export type AnalyticsMetadata = Record<string, string | number | boolean>;

/**
 * Per-event property allowlist. Marketing analytics must never carry personal
 * slip contents, an exact personal betting record, private follows, or account
 * details. Any key not listed for an event is dropped before the event is sent
 * — including keys smuggled through the declarative `data-analytics-*` channel.
 */
const EVENT_PROPERTY_ALLOWLIST: Record<AnalyticsEvent, readonly string[]> = {
  site_landed: ["page_context"],
  predictions_viewed: ["page_context", "sport", "league", "country", "confidence"],
  surface_viewed: ["page_context", "surface_route"],
  value_pick_clicked: ["sport", "league", "match_id"],
  match_detail_opened: ["page_context", "match_id", "sport"],
  filter_used: ["selected_value", "filter_date", "filter_sport", "filter_league", "filter_country", "filter_confidence"],
  sport_selected: ["sport"],
  // Personal slip contents (selection label, odds) are deliberately NOT here.
  betslip_pick_added: ["sport", "league", "source", "match_id"],
  live_score_opened: ["page_context"],
  account_auth_completed: ["auth_mode", "requires_email_confirmation"],
  account_signed_out: [],
  community_post_created: ["match_id"],
  forum_thread_created: ["category_id"],
  forum_reply_created: ["thread_id"],
  outbound_link_clicked: ["destination_host"],
  affiliate_outbound_clicked: ["bookmaker_id", "bookmaker", "destination_host", "country", "match_id", "sport", "league", "placement"],
  share_clicked: ["channel", "page_context", "match_id", "sport", "league"],
  // The followed team's identity is a private follow — only the sport survives.
  team_followed: ["sport"],
  team_unfollowed: ["sport"],
  community_post_liked: ["post_id", "match_id"],
  community_post_unliked: ["post_id", "match_id"],
  community_comment_posted: ["post_id"],
  web_vital: ["metric_name", "value", "rating", "navigation_type"],
  client_error: ["error_kind", "boundary", "digest"]
};

/** Keep only the keys allowlisted for this event. */
export function filterAnalyticsMetadata(event: AnalyticsEvent, metadata: AnalyticsMetadata): AnalyticsMetadata {
  const allowed = EVENT_PROPERTY_ALLOWLIST[event] ?? [];
  const filtered: AnalyticsMetadata = {};
  for (const key of allowed) {
    if (key in metadata) filtered[key] = metadata[key];
  }
  return filtered;
}

const STATIC_PATH_SEGMENTS = new Set([
  "", "predictions", "league", "table", "team", "player", "today", "tomorrow", "week", "history",
  "value-picks", "decision-engine", "bet-slip", "live-scores", "news", "community", "u", "moderation",
  "forums", "season-outlooks", "track-record", "publication", "engine", "performance", "my", "account",
  "workspace", "shared", "responsible-use", "about", "terms", "privacy", "explore", "daily-double", "tips", "rss.xml", "feed.json"
]);

/**
 * A path safe to attach to a telemetry beacon: dynamic segments (share tokens,
 * handles, fixture/publication ids) are replaced with `:id`, so no private
 * value ever rides in the analytics path.
 */
export function safeAnalyticsPath(pathname: string): string {
  return (
    "/" +
    pathname
      .split("/")
      .filter((segment, index) => !(index === 0 && segment === ""))
      .map((segment) => (STATIC_PATH_SEGMENTS.has(segment) ? segment : ":id"))
      .join("/")
  ).replace(/\/$/, "") || "/";
}

export const CORE_ANALYTICS_FUNNEL = [
  { step: "land", event: "site_landed" },
  { step: "view_predictions", event: "predictions_viewed" },
  { step: "open_match_detail", event: "match_detail_opened" },
  { step: "action", events: ["share_clicked", "betslip_pick_added", "team_followed", "outbound_link_clicked", "affiliate_outbound_clicked"] }
] as const satisfies ReadonlyArray<{ step: string; event?: AnalyticsEvent; events?: readonly AnalyticsEvent[] }>;

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

  // Redact BEFORE anything is sent: private fields never reach gtag or the beacon.
  const safe = filterAnalyticsMetadata(event, metadata);

  try {
    if (process.env.NODE_ENV !== "production") console.debug("[OddsPadi analytics]", event, safe);
    window.gtag?.("event", event, safe);

    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
    if (!endpoint) return;

    const payload = JSON.stringify({
      event,
      metadata: safe,
      path: safeAnalyticsPath(window.location.pathname),
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
