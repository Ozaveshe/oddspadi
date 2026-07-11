-- Keep scheduled decision cycles idempotent while preserving any linked outcome.

create temporary table op_decision_run_dedup_map on commit drop as
select
  id as duplicate_id,
  first_value(id) over (
    partition by fixture_external_id, input_hash
    order by
      exists (
        select 1
        from public.op_prediction_outcomes outcome
        where outcome.decision_run_id = op_decision_runs.id
      ) desc,
      created_at desc,
      id desc
  ) as keeper_id
from public.op_decision_runs
where input_hash is not null;

update public.op_prediction_outcomes outcome
set decision_run_id = dedup.keeper_id,
    updated_at = now()
from op_decision_run_dedup_map dedup
where outcome.decision_run_id = dedup.duplicate_id
  and dedup.duplicate_id <> dedup.keeper_id;

delete from public.op_decision_runs decision_run
using op_decision_run_dedup_map dedup
where decision_run.id = dedup.duplicate_id
  and dedup.duplicate_id <> dedup.keeper_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.op_decision_runs'::regclass
      and conname = 'op_decision_runs_fixture_input_hash_key'
  ) then
    alter table public.op_decision_runs
      add constraint op_decision_runs_fixture_input_hash_key
      unique (fixture_external_id, input_hash);
  end if;
end
$$;

comment on constraint op_decision_runs_fixture_input_hash_key on public.op_decision_runs is
  'Prevents duplicate agent decisions when the fixture evidence and deterministic model state are unchanged.';
