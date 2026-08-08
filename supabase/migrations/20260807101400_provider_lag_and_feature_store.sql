-- Two closures: the provider-lag alert gets its number, and the feature store
-- gets its table.
--
-- The provider-result-lag alert has reported "unknown" since it shipped,
-- because a median over observation timestamps cannot be a PostgREST count.
-- Unknown-as-unknown was the honest interim; this is the number. It reads
-- op_fixture_results — final_at is the provider's stated final moment,
-- first_observed_at is when we first saw it — so it stays null until the
-- ingestion sweep populates rows, and null still renders as unknown rather
-- than as fine.

create or replace function public.op_provider_result_lag_minutes(
  p_since timestamptz default now() - interval '24 hours'
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select percentile_cont(0.5) within group (
    order by extract(epoch from (r.first_observed_at - r.final_at)) / 60.0
  )::numeric
  from public.op_fixture_results r
  where r.is_current
    and r.final_at is not null
    and r.first_observed_at is not null
    and r.first_observed_at >= r.final_at
    and r.created_at >= p_since;
$$;

comment on function public.op_provider_result_lag_minutes is
  'Median minutes from the provider''s stated final moment to our first observation, over current results created since p_since. Null when no measurable rows exist — unknown is reported as unknown, never as fine.';

revoke all on function public.op_provider_result_lag_minutes(timestamptz) from public, anon, authenticated;

-- The feature store. The point-in-time contract has existed in code
-- (src/lib/features/pointInTime.ts) with nothing persisting it; this is the
-- table that makes a feature auditable after the decision it fed.
create table if not exists public.op_feature_values (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  name text not null,
  feature_version text not null,
  value numeric,
  -- The six timestamps that make point-in-time auditing possible. A feature
  -- that cannot answer these is inadmissible, and here that is a constraint
  -- rather than a convention.
  event_at timestamptz not null,
  source_published_at timestamptz not null,
  retrieved_at timestamptz not null,
  calculated_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_receipt_id text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  missing_reason text,
  created_at timestamptz not null default now(),
  -- A null with no reason is indistinguishable from a zero the moment a model
  -- reads it, so the pair is constrained: absent values explain themselves.
  constraint op_feature_values_missing_explained
    check ((value is null) = (missing_reason is not null)),
  constraint op_feature_values_validity_ordered
    check (valid_until is null or valid_until > valid_from),
  -- Knowability cannot run backwards: nothing is retrieved before it was
  -- published, or calculated before it was retrieved.
  constraint op_feature_values_knowability_ordered
    check (source_published_at <= retrieved_at and retrieved_at <= calculated_at)
);

-- The as-of read: the current value of a feature for an entity at a moment.
create index if not exists op_feature_values_asof_idx
  on public.op_feature_values (entity, name, feature_version, valid_from desc);

comment on table public.op_feature_values is
  'Point-in-time feature store. Each row carries the timestamps that say when the value was knowable; the leakage audit in src/lib/features/pointInTime.ts reads them. Missing values carry a reason because a bare null is indistinguishable from zero once a model reads it.';

alter table public.op_feature_values enable row level security;
grant select on public.op_feature_values to service_role;
