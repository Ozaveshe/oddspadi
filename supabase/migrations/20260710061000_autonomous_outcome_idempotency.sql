-- One evaluation outcome per stored decision, market, and selection.

create temporary table op_prediction_outcome_dedup_map on commit drop as
select
  id as duplicate_id,
  first_value(id) over (
    partition by decision_run_id, market, selection
    order by
      (result <> 'pending') desc,
      settled_at desc nulls last,
      updated_at desc,
      id desc
  ) as keeper_id
from public.op_prediction_outcomes
where decision_run_id is not null;

delete from public.op_prediction_outcomes outcome
using op_prediction_outcome_dedup_map dedup
where outcome.id = dedup.duplicate_id
  and dedup.duplicate_id <> dedup.keeper_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.op_prediction_outcomes'::regclass
      and conname = 'op_prediction_outcomes_run_market_selection_key'
  ) then
    alter table public.op_prediction_outcomes
      add constraint op_prediction_outcomes_run_market_selection_key
      unique (decision_run_id, market, selection);
  end if;
end
$$;

comment on constraint op_prediction_outcomes_run_market_selection_key on public.op_prediction_outcomes is
  'Keeps autonomous shadow evaluation idempotent and prevents settled rows from being duplicated by scheduler retries.';
