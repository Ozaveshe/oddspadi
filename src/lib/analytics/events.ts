export type AnalyticsEvent =
  | "prediction_viewed"
  | "value_pick_clicked"
  | "match_detail_opened"
  | "filter_used"
  | "sport_selected"
  | "betslip_pick_added"
  | "live_score_opened";

export function trackEvent(event: AnalyticsEvent, metadata?: Record<string, string | number | boolean>) {
  void event;
  void metadata;
  // TODO: Connect to analytics once the production analytics provider is chosen.
}
