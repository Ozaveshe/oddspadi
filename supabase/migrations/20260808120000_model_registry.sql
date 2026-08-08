-- The model registry: lifecycle state machine, persisted with its paths enforced.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.
--
-- Mirrors src/lib/model/registry.ts. Six states; the transitions between them
-- are a closed list enforced by trigger rather than a status column anyone can
-- update. The failure this prevents is not an invalid state — it is an invalid
-- *path*: a candidate reaching `approved` without passing through `shadow`, or
-- a degraded model quietly returning to service because someone set the column
-- back. Every transition demands its evidence and appends to history.

create table if not exists public.op_model_registry (
  model_id text primary key,
  state text not null default 'candidate'
    check (state in ('candidate', 'shadow', 'approved', 'degraded', 'retired', 'rolled_back')),
  dataset_version_id text not null,
  feature_set_version text not null,
  hyperparameters jsonb not null default '{}'::jsonb,
  calibration_method text not null,
  decision_policy_version text not null,
  evaluation jsonb,
  approved_at timestamptz,
  approved_by text,
  rollback_target_id text references public.op_model_registry(model_id),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Approval evidence travels with the state, both directions.
  check (state <> 'approved' or (approved_at is not null and approved_by is not null)),
  check (state <> 'rolled_back' or rollback_target_id is not null)
);

create or replace function public.op_guard_model_registry_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state <> 'candidate' then
    raise exception 'Models are born candidates; % is not an entry state.', new.state;
  end if;
  if new.history <> '[]'::jsonb then
    raise exception 'A new candidate has no transition history.';
  end if;
  return new;
end;
$$;

drop trigger if exists op_model_registry_guard_insert on public.op_model_registry;
create trigger op_model_registry_guard_insert
before insert on public.op_model_registry
for each row execute function public.op_guard_model_registry_insert();

create or replace function public.op_guard_model_registry_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allowed boolean;
  last_step jsonb;
  target_approved timestamptz;
begin
  -- Identity and provenance are immutable; the registry records a model, it
  -- does not let one be rewritten into another.
  if new.model_id is distinct from old.model_id or
     new.dataset_version_id is distinct from old.dataset_version_id or
     new.feature_set_version is distinct from old.feature_set_version or
     new.hyperparameters is distinct from old.hyperparameters or
     new.calibration_method is distinct from old.calibration_method or
     new.created_at is distinct from old.created_at then
    raise exception 'Model identity and provenance are immutable; register a new model id instead.';
  end if;

  if new.state is distinct from old.state then
    allowed := case old.state
      when 'candidate'   then new.state in ('shadow')
      when 'shadow'      then new.state in ('approved', 'retired')
      when 'approved'    then new.state in ('degraded', 'retired')
      when 'degraded'    then new.state in ('approved', 'rolled_back')
      when 'rolled_back' then new.state in ('retired')
      else false -- retired is terminal
    end;
    if not allowed then
      raise exception '% -> % is not a path.', old.state, new.state;
    end if;

    -- Every transition appends exactly one history step naming the path and
    -- carrying a reason. History never shrinks and never rewrites.
    if jsonb_array_length(new.history) <> jsonb_array_length(old.history) + 1 then
      raise exception 'A state change must append exactly one history step.';
    end if;
    if new.history - (jsonb_array_length(new.history) - 1) <> old.history then
      raise exception 'History is append-only; earlier steps are immutable.';
    end if;
    last_step := new.history -> (jsonb_array_length(new.history) - 1);
    if last_step ->> 'from' is distinct from old.state or
       last_step ->> 'to' is distinct from new.state or
       length(coalesce(last_step ->> 'reason', '')) < 10 then
      raise exception 'The appended history step must record from=%, to=%, and a reason of at least 10 characters.',
        old.state, new.state;
    end if;

    if new.state = 'approved' then
      -- From shadow this is promotion; from degraded it is recovery. Both
      -- demand fresh gate evidence — "it seems fine again" is exactly the
      -- evidence-free judgement the gate exists to replace.
      if new.evaluation is null or new.evaluation -> 'gates' is null then
        raise exception 'Approval requires evaluation evidence with a gates result.';
      end if;
      if new.approved_at is null or new.approved_by is null then
        raise exception 'Approval requires approved_at and approved_by on the record.';
      end if;
    end if;

    if new.state = 'rolled_back' then
      select approved_at into target_approved
        from public.op_model_registry
        where model_id = new.rollback_target_id;
      if target_approved is null then
        raise exception 'Rollback target % was never approved; rolling back onto it would promote it by accident.',
          coalesce(new.rollback_target_id, '(none)');
      end if;
    end if;
  elsif new.history is distinct from old.history then
    raise exception 'History changes only alongside the state change they record.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists op_model_registry_guard_update on public.op_model_registry;
create trigger op_model_registry_guard_update
before update on public.op_model_registry
for each row execute function public.op_guard_model_registry_update();

create or replace function public.op_block_model_registry_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Registry rows are never deleted; retire the model instead.';
end;
$$;

drop trigger if exists op_model_registry_block_delete on public.op_model_registry;
create trigger op_model_registry_block_delete
before delete on public.op_model_registry
for each row execute function public.op_block_model_registry_delete();

revoke all on public.op_model_registry from public, service_role, anon, authenticated;
grant select, insert, update on public.op_model_registry to service_role;
alter table public.op_model_registry enable row level security;

revoke all on function public.op_guard_model_registry_insert() from public, anon, authenticated;
revoke all on function public.op_guard_model_registry_update() from public, anon, authenticated;
revoke all on function public.op_block_model_registry_delete() from public, anon, authenticated;

comment on table public.op_model_registry is
  'Model lifecycle registry. States and paths mirror src/lib/model/registry.ts; transitions are trigger-enforced with append-only history.';

-- ---------------------------------------------------------------------------
-- Register the two evaluated lab candidates and move them to shadow.
-- Neither beats the de-vigged market on its chronological holdout — which is
-- exactly what shadow is for: observe on live fixtures, publish nothing.
-- Evidence is recorded verbatim from docs/model-evaluation-report*.md.
-- ---------------------------------------------------------------------------

insert into public.op_model_registry
  (model_id, dataset_version_id, feature_set_version, hyperparameters, calibration_method, decision_policy_version, evaluation)
values
  (
    'football-1x2-dixon-coles-v1',
    'standard-v1',
    'dc-strengths-home-decay-v1',
    '{"decayPerDay": 0.0065, "iterations": 250, "learningRate": 0.02, "ridge": 0.02, "maxGoals": 8}'::jsonb,
    'identity (temperature rejected on holdout; isotonic under the 2000-sample floor at 802)',
    'decision-policy-v1',
    '{"harness": "scripts/model-lab-run.ts", "holdout": {"n": 950, "window": "2026", "brier": 0.6165, "logLoss": 1.0302, "ece": 0.0665}, "market": {"brier": 0.5927, "logLoss": 0.9926}, "deltaBrierVsClose": {"diff": 0.0238, "low95": 0.0131, "high95": 0.0343}, "ensembleWeight": 0.0, "verdict": "does not beat the closing market; challenger only"}'::jsonb
  ),
  (
    'tennis-mw-surface-elo-v1',
    'standard-v1',
    'surface-elo-rank-prior-v1',
    '{"surfaceBlend": 0.5, "kFactor": "250/(n+5)^0.4", "rankPrior": "max(1200, 2000 - 120*ln(rank))", "orientation": "deterministic hash flip (winner-canonicalised corpus)"}'::jsonb,
    'isotonic per class, renormalised, floored at 0.5% (selected on 2072 validation forecasts)',
    'decision-policy-v1',
    '{"harness": "scripts/tennis-lab-run.ts", "holdout": {"n": 3264, "window": "2026", "brier": 0.4408, "logLoss": 0.631, "ece": 0.0095}, "market": {"brier": 0.3957, "logLoss": 0.5783}, "deltaBrierVsConsensus": {"diff": 0.0451, "low95": 0.0368, "high95": 0.0533}, "ensembleWeight": 0.15, "verdict": "does not beat the bookmaker consensus; challenger only"}'::jsonb
  )
on conflict (model_id) do nothing;

update public.op_model_registry
set state = 'shadow',
    history = history || jsonb_build_array(jsonb_build_object(
      'from', 'candidate',
      'to', 'shadow',
      'at', now(),
      'reason', 'Chronological 2026 holdout: behind the de-vigged close (dBrier +0.0238, 95% CI [0.0131, 0.0343]). Shadow observes, publishes nothing.'
    ))
where model_id = 'football-1x2-dixon-coles-v1' and state = 'candidate';

update public.op_model_registry
set state = 'shadow',
    history = history || jsonb_build_array(jsonb_build_object(
      'from', 'candidate',
      'to', 'shadow',
      'at', now(),
      'reason', 'Chronological 2026 holdout: behind the bookmaker consensus (dBrier +0.0451, 95% CI [0.0368, 0.0533]). Shadow observes, publishes nothing.'
    ))
where model_id = 'tennis-mw-surface-elo-v1' and state = 'candidate';
