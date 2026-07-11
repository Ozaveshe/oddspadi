with ranked_feature_snapshots as (
  select
    id,
    row_number() over (
      partition by sport, fixture_external_id, model_key, split, source
      order by generated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from public.op_training_feature_snapshots
)
delete from public.op_training_feature_snapshots snapshots
using ranked_feature_snapshots ranked
where snapshots.id = ranked.id
  and ranked.duplicate_rank > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'op_training_feature_snapshots_unique_source_fixture_model_split'
      and conrelid = 'public.op_training_feature_snapshots'::regclass
  ) then
    alter table public.op_training_feature_snapshots
      add constraint op_training_feature_snapshots_unique_source_fixture_model_split
      unique (sport, fixture_external_id, model_key, split, source);
  end if;
end $$;
