-- Model-bound calibration artifacts. Candidates are immutable evidence built from
-- settled outcomes; promotions are separate, revocable operator decisions.

create table if not exists public.op_calibration_candidates (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid references public.op_calibration_runs(id) on delete set null,
  sport text not null,
  model_key text not null,
  engine_version text not null,
  source text not null default 'settled-outcomes',
  window_start timestamptz,
  window_end timestamptz,
  sample_size integer not null default 0 check (sample_size >= 0),
  settled_size integer not null default 0 check (settled_size >= 0),
  outcome_hash text not null,
  outcome_ids jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  calibration_buckets jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (sport, model_key, engine_version, outcome_hash)
);

create table if not exists public.op_calibration_promotions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.op_calibration_candidates(id) on delete restrict,
  sport text not null,
  model_key text not null,
  engine_version text not null,
  status text not null default 'approved' check (status in ('approved', 'revoked')),
  approved_by text not null,
  rationale text not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists op_calibration_candidates_model_created_idx
  on public.op_calibration_candidates (sport, model_key, engine_version, created_at desc);

create index if not exists op_calibration_promotions_active_idx
  on public.op_calibration_promotions (sport, model_key, engine_version, approved_at desc)
  where status = 'approved' and revoked_at is null;

create unique index if not exists op_calibration_promotions_one_active_model_idx
  on public.op_calibration_promotions (sport, model_key, engine_version)
  where status = 'approved' and revoked_at is null;

create or replace function public.op_block_calibration_candidate_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Calibration candidates are immutable; create a new candidate instead.';
end;
$$;

drop trigger if exists op_calibration_candidates_block_mutation on public.op_calibration_candidates;
create trigger op_calibration_candidates_block_mutation
before update or delete on public.op_calibration_candidates
for each row execute function public.op_block_calibration_candidate_mutation();

create or replace function public.op_prevent_settled_outcome_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.result <> 'pending' then
    raise exception 'Settled prediction outcomes are immutable; create a reviewed correction record instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists op_prediction_outcomes_prevent_settled_rewrite on public.op_prediction_outcomes;
create trigger op_prediction_outcomes_prevent_settled_rewrite
before update on public.op_prediction_outcomes
for each row execute function public.op_prevent_settled_outcome_rewrite();

create or replace function public.op_validate_calibration_promotion()
returns trigger
language plpgsql
as $$
declare
  candidate record;
begin
  select sport, model_key, engine_version
  into candidate
  from public.op_calibration_candidates
  where id = new.candidate_id;

  if not found then
    raise exception 'Calibration candidate % does not exist.', new.candidate_id;
  end if;

  if new.sport <> candidate.sport or new.model_key <> candidate.model_key or new.engine_version <> candidate.engine_version then
    raise exception 'Promotion model scope must match its calibration candidate.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists op_calibration_promotions_validate on public.op_calibration_promotions;
create trigger op_calibration_promotions_validate
before insert or update on public.op_calibration_promotions
for each row execute function public.op_validate_calibration_promotion();

revoke execute on function public.op_block_calibration_candidate_mutation() from public;
revoke execute on function public.op_prevent_settled_outcome_rewrite() from public;
revoke execute on function public.op_validate_calibration_promotion() from public;

revoke all on
  public.op_calibration_candidates,
  public.op_calibration_promotions
from anon, authenticated;

grant select, insert, update, delete on
  public.op_calibration_candidates,
  public.op_calibration_promotions
to service_role;

alter table public.op_calibration_candidates enable row level security;
alter table public.op_calibration_promotions enable row level security;

comment on table public.op_calibration_candidates is
  'Immutable model/version-scoped calibration evidence generated from settled OddsPadi outcomes.';

comment on table public.op_calibration_promotions is
  'Auditable, revocable server-side approvals that activate a matching calibration candidate for live guardrails.';
