/**
 * Case categories — the normalized taxonomy a case carries, distinct from the
 * raw alert `kind`. A `kind` is provider/detector vocabulary
 * (`close_market_unmapped`, `reconciler_missing_closing_price`); a `category` is
 * the operational class a human triages by (`market_mismatch`, `missing_close`).
 * The dashboards, SLAs and escalation paths key off the category, so the mapping
 * lives here, once.
 */

export type CaseCategory =
  | "stale_fixture"
  | "stale_odds"
  | "identity_mismatch"
  | "market_mismatch"
  | "result_conflict"
  | "settlement_exception"
  | "missing_close"
  | "record_mismatch"
  | "content_error"
  | "user_report"
  | "community_abuse"
  | "provider_outage";

export const CASE_CATEGORIES: readonly CaseCategory[] = [
  "stale_fixture",
  "stale_odds",
  "identity_mismatch",
  "market_mismatch",
  "result_conflict",
  "settlement_exception",
  "missing_close",
  "record_mismatch",
  "content_error",
  "user_report",
  "community_abuse",
  "provider_outage"
];

/** op_settlement_exceptions kind (including reconciler_*) → category. */
const EXCEPTION_KIND_CATEGORY: Record<string, CaseCategory> = {
  // Reconciler findings.
  reconciler_publication_track_record_mismatch: "record_mismatch",
  reconciler_news_publication_mismatch: "record_mismatch",
  reconciler_unsettled_final_fixture: "settlement_exception",
  reconciler_stale_current_decision: "stale_fixture",
  reconciler_missing_closing_price: "missing_close",
  reconciler_duplicate_fixture: "identity_mismatch",
  reconciler_result_conflict: "result_conflict",
  reconciler_orphaned_community_selection: "record_mismatch",
  reconciler_projection_age_breach: "stale_fixture",
  reconciler_route_error_spike: "provider_outage",
  reconciler_model_version_mismatch: "record_mismatch",
  // Settlement exceptions.
  result_conflict: "result_conflict",
  unknown_market: "market_mismatch",
  missing_line: "market_mismatch",
  ambiguous_retirement: "result_conflict",
  abandoned_fixture: "result_conflict",
  duplicate_result: "result_conflict",
  missing_participant_identity: "identity_mismatch",
  provider_correction: "record_mismatch",
  // Closing-price exceptions.
  close_missing: "missing_close",
  close_insufficient_sources: "missing_close",
  close_identity_failure: "identity_mismatch",
  close_market_unmapped: "market_mismatch",
  close_late_data: "stale_odds",
  // Alias / mapping exceptions.
  alias_duplicate: "identity_mismatch",
  alias_impossible_line: "market_mismatch",
  alias_orientation: "market_mismatch",
  alias_incompatible_settlement: "market_mismatch",
  alias_version_conflict: "market_mismatch",
  alias_overround: "market_mismatch"
};

/** Anything unmapped falls to record_mismatch — visible and triageable, never silently dropped. */
export function categoryForExceptionKind(kind: string): CaseCategory {
  return EXCEPTION_KIND_CATEGORY[kind] ?? "record_mismatch";
}

/** op_content_reports.category → case category. Abuse classes are community_abuse; the rest are user reports. */
export function categoryForReport(reportCategory: string): CaseCategory {
  switch (reportCategory) {
    case "scam_or_paid_tips":
    case "guaranteed_win_claim":
    case "impersonation":
    case "harassment":
    case "unsafe_link":
      return "community_abuse";
    default:
      return "user_report";
  }
}

export function isCaseCategory(value: unknown): value is CaseCategory {
  return typeof value === "string" && (CASE_CATEGORIES as readonly string[]).includes(value);
}

export function humanizeCategory(category: CaseCategory): string {
  const words = category.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
