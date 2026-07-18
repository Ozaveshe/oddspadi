-- Private, pre-kickoff challenger predictions paired to exact champion outcomes.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.

create table if not exists public.op_shadow_predictions (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.op_model_versions(id) on delete restrict,
  champion_outcome_id uuid not null references public.op_prediction_outcomes(id) on delete restrict,
  champion_decision_run_id uuid not null references public.op_decision_runs(id) on delete restrict,
  fixture_external_id text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  market text not null,
  selection text not null,
  model_key text not null,
  engine_version text not null,
  model_artifact_hash text not null,
  input_hash text not null,
  champion_model_probability numeric(8, 6) not null check (champion_model_probability between 0 and 1),
  model_probability numeric(8, 6) not null check (model_probability between 0 and 1),
  implied_probability numeric(8, 6) check (implied_probability is null or implied_probability between 0 and 1),
  odds numeric(10, 4) check (odds is null or odds > 1),
  closing_odds numeric(10, 4) check (closing_odds is null or closing_odds > 1),
  result text not null default 'pending' check (result in ('pending', 'won', 'lost', 'push', 'void')),
  kickoff_at timestamptz not null,
  generated_at timestamptz not null,
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (champion_outcome_id, model_artifact_hash),
  check (generated_at < kickoff_at),
  check (settled_at is null or settled_at >= kickoff_at),
  check (
    (result = 'pending' and settled_at is null) or
    (result <> 'pending' and settled_at is not null)
  )
);

create index if not exists op_shadow_predictions_pending_idx
  on public.op_shadow_predictions (sport, created_at)
  where result = 'pending';

create index if not exists op_shadow_predictions_model_settled_idx
  on public.op_shadow_predictions (sport, model_key, engine_version, settled_at desc)
  where result in ('won', 'lost');

create or replace function public.op_guard_shadow_prediction_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.result <> 'pending' then
    raise exception 'Settled shadow predictions are immutable; store a reviewed correction separately.';
  end if;

  if new.model_version_id is distinct from old.model_version_id or
     new.champion_outcome_id is distinct from old.champion_outcome_id or
     new.champion_decision_run_id is distinct from old.champion_decision_run_id or
     new.fixture_external_id is distinct from old.fixture_external_id or
     new.sport is distinct from old.sport or
     new.market is distinct from old.market or
     new.selection is distinct from old.selection or
     new.model_key is distinct from old.model_key or
     new.engine_version is distinct from old.engine_version or
     new.model_artifact_hash is distinct from old.model_artifact_hash or
     new.input_hash is distinct from old.input_hash or
     new.champion_model_probability is distinct from old.champion_model_probability or
     new.model_probability is distinct from old.model_probability or
     new.implied_probability is distinct from old.implied_probability or
     new.odds is distinct from old.odds or
     new.kickoff_at is distinct from old.kickoff_at or
     new.generated_at is distinct from old.generated_at or
     new.created_at is distinct from old.created_at then
    raise exception 'Shadow prediction evidence and model identity are immutable.';
  end if;

  if new.result = 'pending' or new.settled_at is null then
    raise exception 'A shadow prediction update must finalize its result and settlement timestamp atomically.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists op_shadow_predictions_guard_mutation on public.op_shadow_predictions;
create trigger op_shadow_predictions_guard_mutation
before update on public.op_shadow_predictions
for each row execute function public.op_guard_shadow_prediction_mutation();

create or replace function public.op_block_shadow_prediction_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Shadow predictions are append-only and cannot be deleted.';
end;
$$;

drop trigger if exists op_shadow_predictions_block_delete on public.op_shadow_predictions;
create trigger op_shadow_predictions_block_delete
before delete on public.op_shadow_predictions
for each row execute function public.op_block_shadow_prediction_delete();

revoke all on public.op_shadow_predictions from public, service_role, anon, authenticated;
grant select, insert, update on public.op_shadow_predictions to service_role;
alter table public.op_shadow_predictions enable row level security;

revoke all on function public.op_guard_shadow_prediction_mutation() from public, anon, authenticated;
revoke all on function public.op_block_shadow_prediction_delete() from public, anon, authenticated;

comment on table public.op_shadow_predictions is
  'Server-only, pre-kickoff challenger probabilities paired to exact champion outcomes. Never exposed as public picks.';
