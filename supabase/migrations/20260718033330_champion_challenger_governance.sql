-- One active champion per sport and immutable, paired challenger evidence.
-- Apply only to OddsPadi project wncwtzqipnoqwmqlznqn.

create table if not exists public.op_model_comparison_receipts (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  champion_promotion_id uuid not null references public.op_calibration_promotions(id) on delete restrict,
  champion_model_key text not null,
  champion_engine_version text not null,
  challenger_candidate_id uuid not null references public.op_calibration_candidates(id) on delete restrict,
  challenger_model_key text not null,
  challenger_engine_version text not null,
  evaluation_window_start timestamptz not null,
  latest_paired_outcome_at timestamptz,
  paired_size integer not null check (paired_size >= 0),
  paired_fixture_hash text not null,
  receipt_hash text not null unique,
  status text not null check (status in ('challenger-promotable', 'champion-retained', 'inconclusive', 'warming', 'stale', 'invalid')),
  eligible_for_promotion boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (champion_model_key <> challenger_model_key or champion_engine_version <> challenger_engine_version),
  check ((status = 'challenger-promotable') = eligible_for_promotion)
);

alter table public.op_calibration_promotions
  add column if not exists comparison_receipt_id uuid references public.op_model_comparison_receipts(id) on delete restrict;

do $migration$
begin
  if exists (
    select 1
    from public.op_calibration_promotions
    where status = 'approved' and revoked_at is null
    group by sport
    having count(*) > 1
  ) then
    raise exception 'Champion governance migration requires at most one approved unrevoked promotion per sport; resolve ambiguous legacy champions first.';
  end if;
end;
$migration$;

drop index if exists public.op_calibration_promotions_one_active_sport_idx;
create unique index op_calibration_promotions_one_active_sport_idx
  on public.op_calibration_promotions (sport)
  where status = 'approved' and revoked_at is null;

create index if not exists op_model_comparison_receipts_challenger_idx
  on public.op_model_comparison_receipts (sport, challenger_candidate_id, created_at desc);

create or replace function public.op_block_model_comparison_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Model comparison receipts are immutable; create a new receipt instead.';
end;
$$;

drop trigger if exists op_model_comparison_receipts_block_mutation on public.op_model_comparison_receipts;
create trigger op_model_comparison_receipts_block_mutation
before update or delete on public.op_model_comparison_receipts
for each row execute function public.op_block_model_comparison_receipt_mutation();

create or replace function public.op_validate_calibration_promotion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  comparison record;
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

  if new.comparison_receipt_id is not null then
    select challenger_candidate_id, challenger_model_key, challenger_engine_version, status, eligible_for_promotion
    into comparison
    from public.op_model_comparison_receipts
    where id = new.comparison_receipt_id;

    if not found then
      raise exception 'Promotion comparison receipt does not exist.';
    end if;
    if comparison.challenger_candidate_id <> new.candidate_id or
       comparison.challenger_model_key <> new.model_key or comparison.challenger_engine_version <> new.engine_version or
       comparison.status <> 'challenger-promotable' or not comparison.eligible_for_promotion then
      raise exception 'Promotion requires an eligible comparison receipt for the exact challenger candidate.';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.op_promote_calibration_challenger(
  p_candidate_id uuid,
  p_approved_by text,
  p_rationale text,
  p_expires_at timestamptz default null,
  p_comparison_receipt_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  champion record;
  incumbent_candidate record;
  comparison record;
  new_promotion_id uuid;
begin
  if nullif(btrim(p_approved_by), '') is null or nullif(btrim(p_rationale), '') is null then
    raise exception 'Promotion requires an operator identity and rationale.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Promotion expiry must be in the future.';
  end if;

  select id, sport, model_key, engine_version, window_end, metrics
  into candidate
  from public.op_calibration_candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Calibration candidate % does not exist.', p_candidate_id;
  end if;
  if coalesce(candidate.metrics #>> '{promotionReadiness,status}', '') <> 'ready-shadow-review' then
    raise exception 'Calibration candidate has not passed shadow review.';
  end if;

  select id, candidate_id, sport, model_key, engine_version, expires_at
  into champion
  from public.op_calibration_promotions
  where sport = candidate.sport and status = 'approved' and revoked_at is null
  order by approved_at desc
  limit 1
  for update;

  if found and champion.expires_at is not null and champion.expires_at <= now() then
    update public.op_calibration_promotions
    set status = 'revoked', revoked_at = now(), revoked_by = p_approved_by,
        revocation_reason = 'Expired before replacement champion approval.'
    where id = champion.id;
    champion := null;
  end if;

  if champion.id is not null then
    if champion.model_key = candidate.model_key and champion.engine_version = candidate.engine_version then
      if p_comparison_receipt_id is not null then
        raise exception 'Exact-identity calibration refreshes cannot claim a challenger comparison receipt.';
      end if;
      select window_end into incumbent_candidate
      from public.op_calibration_candidates
      where id = champion.candidate_id;
      if candidate.id = champion.candidate_id or candidate.window_end is null or incumbent_candidate.window_end is null or
         candidate.window_end <= incumbent_candidate.window_end then
        raise exception 'Exact-identity calibration refresh requires a distinct candidate with a strictly later frozen window.';
      end if;
    else
      if p_comparison_receipt_id is null then
        raise exception 'Replacing an active champion requires a comparison receipt.';
      end if;
      select *
      into comparison
      from public.op_model_comparison_receipts
      where id = p_comparison_receipt_id
      for share;

      if not found then
        raise exception 'Comparison receipt does not exist.';
      end if;
      if comparison.champion_promotion_id <> champion.id or
         comparison.champion_model_key <> champion.model_key or comparison.champion_engine_version <> champion.engine_version or
         comparison.challenger_candidate_id <> candidate.id or comparison.challenger_model_key <> candidate.model_key or
         comparison.challenger_engine_version <> candidate.engine_version or comparison.status <> 'challenger-promotable' or
         not comparison.eligible_for_promotion or comparison.latest_paired_outcome_at is null or
         comparison.latest_paired_outcome_at < now() - interval '7 days' or
         comparison.generated_at < now() - interval '7 days' or comparison.generated_at > now() then
        raise exception 'Comparison receipt is stale, ineligible, or does not bind the active champion to this challenger.';
      end if;
    end if;

    update public.op_calibration_promotions
    set status = 'revoked', revoked_at = now(), revoked_by = p_approved_by,
        revocation_reason = case
          when champion.model_key = candidate.model_key and champion.engine_version = candidate.engine_version
            then 'Superseded by a strictly later exact-identity calibration refresh.'
          else 'Superseded by paired champion-challenger promotion.'
        end
    where id = champion.id;
  elsif p_comparison_receipt_id is not null then
    raise exception 'Bootstrap promotion cannot claim a comparison receipt without an active champion.';
  end if;

  insert into public.op_calibration_promotions (
    candidate_id, sport, model_key, engine_version, status, approved_by, rationale, expires_at, comparison_receipt_id
  ) values (
    candidate.id, candidate.sport, candidate.model_key, candidate.engine_version, 'approved',
    btrim(p_approved_by), btrim(p_rationale), p_expires_at, p_comparison_receipt_id
  ) returning id into new_promotion_id;

  return new_promotion_id;
end;
$$;

revoke all on public.op_model_comparison_receipts from service_role;
revoke all on public.op_model_comparison_receipts from anon, authenticated;
grant select, insert on public.op_model_comparison_receipts to service_role;
alter table public.op_model_comparison_receipts enable row level security;

revoke all on function public.op_block_model_comparison_receipt_mutation() from public, anon, authenticated;
revoke all on function public.op_promote_calibration_challenger(uuid, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.op_promote_calibration_challenger(uuid, text, text, timestamptz, uuid) to service_role;

comment on table public.op_model_comparison_receipts is
  'Immutable paired proper-scoring evidence that binds one active sport champion to one challenger candidate.';
comment on function public.op_promote_calibration_challenger(uuid, text, text, timestamptz, uuid) is
  'Atomically replaces a sport champion only after an exact fresh challenger comparison receipt, while allowing one bootstrap champion.';
