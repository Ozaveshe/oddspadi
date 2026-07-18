-- Cover union-release foreign keys used by deletes, joins, and settlement lookups.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.
-- Remote migration receipt: 20260718070108.

create index if not exists op_community_tips_fixture_db_idx
  on public.op_community_tips (fixture_db_id);

create index if not exists op_community_tip_revisions_author_idx
  on public.op_community_tip_revisions (author_id);

create index if not exists op_community_consensus_fixture_db_idx
  on public.op_community_consensus_research_receipts (fixture_db_id);

create index if not exists op_community_consensus_decision_summary_idx
  on public.op_community_consensus_research_receipts (decision_summary_id);

create index if not exists op_shadow_predictions_model_version_idx
  on public.op_shadow_predictions (model_version_id);

create index if not exists op_shadow_predictions_champion_decision_run_idx
  on public.op_shadow_predictions (champion_decision_run_id);
