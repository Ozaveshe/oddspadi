create index if not exists op_calibration_candidates_calibration_run_idx
  on public.op_calibration_candidates (calibration_run_id);

create index if not exists op_calibration_promotions_candidate_idx
  on public.op_calibration_promotions (candidate_id);

create index if not exists op_fixture_decision_summaries_superseded_by_idx
  on public.op_fixture_decision_summaries (superseded_by);

create index if not exists op_market_decisions_odds_snapshot_idx
  on public.op_market_decisions (odds_snapshot_id);

create index if not exists op_market_decisions_public_decision_idx
  on public.op_market_decisions (public_decision_id);

create index if not exists op_market_decisions_superseded_by_idx
  on public.op_market_decisions (superseded_by);

create index if not exists op_public_picks_fixture_db_idx
  on public.op_public_picks (fixture_db_id);

create index if not exists op_public_picks_prediction_run_idx
  on public.op_public_picks (prediction_run_id);

create index if not exists op_public_picks_public_decision_idx
  on public.op_public_picks (public_decision_id);

create index if not exists op_raw_provider_payloads_ingestion_run_idx
  on public.op_raw_provider_payloads (ingestion_run_id);
