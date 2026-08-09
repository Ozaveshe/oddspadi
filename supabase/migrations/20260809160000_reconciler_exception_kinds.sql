-- Extend the shared exception queue with the production reconciler's finding
-- kinds. The scheduled reconciler ALERTS through op_settlement_exceptions (the
-- same queue settlement/closing already use) and never rewrites a source table;
-- these kinds give its findings a distinct, filterable namespace so the staff
-- case system can route them.

alter table public.op_settlement_exceptions drop constraint op_settlement_exceptions_kind_check;
alter table public.op_settlement_exceptions add constraint op_settlement_exceptions_kind_check check (kind in (
  'result_conflict', 'unknown_market', 'missing_line', 'ambiguous_retirement',
  'abandoned_fixture', 'duplicate_result', 'missing_participant_identity', 'provider_correction',
  'close_missing', 'close_insufficient_sources', 'close_identity_failure',
  'close_market_unmapped', 'close_late_data',
  'alias_duplicate', 'alias_impossible_line', 'alias_orientation',
  'alias_incompatible_settlement', 'alias_version_conflict', 'alias_overround',
  -- Production reconciler findings (alert-only; entity + message live in detail).
  'reconciler_publication_track_record_mismatch', 'reconciler_news_publication_mismatch',
  'reconciler_unsettled_final_fixture', 'reconciler_stale_current_decision',
  'reconciler_missing_closing_price', 'reconciler_duplicate_fixture',
  'reconciler_result_conflict', 'reconciler_orphaned_community_selection',
  'reconciler_projection_age_breach', 'reconciler_route_error_spike',
  'reconciler_model_version_mismatch'
));
