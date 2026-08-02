-- Prepared read models for every public surface.
--
-- Measured problem (pg_stat_statements, 2026-08-01):
--   op_training_snapshot_counts()  1320 calls, mean 3743 ms, max 7975 ms
--   op_training_corpus_census()     109 calls, mean 5083 ms, max 7999 ms
--   op_odds_snapshots by sport       21 calls, mean 6158 ms, max 7761 ms
-- The API role's statement timeout is 8000 ms, so those public paths were
-- rendering a coin-flip away from cancellation — and a cancellation was being
-- caught and rendered as "0 fixtures / no value picks".
--
-- Even the healthy path was expensive: today's slate join touches ~13.8k
-- buffers (~108 MB of heap) to return 340 rows, because it filters 618k
-- summary rows (2.4 GB table) on every request.
--
-- Public pages now read ONE row from this table: a prepared jsonb payload with
-- its own freshness metadata. Refresh happens on a schedule, in the database,
-- off the request path. Measured after: 0.101 ms, 2 buffers.

create table if not exists public.op_public_projections (
  name text not null,
  -- Sub-key: a date for daily slates, a sport for boards, '' for singletons.
  scope text not null default '',
  payload jsonb not null,
  -- Rows represented by the payload; 0 with status 'ready' means genuinely
  -- nothing qualified, which is a different fact from a failed refresh.
  row_count integer not null default 0,
  -- Newest source record the payload reflects. Drives "data as of" copy.
  source_max_at timestamptz,
  built_at timestamptz not null default now(),
  -- Bumped when the shape or semantics of a payload change, so a reader can
  -- refuse a payload it does not understand instead of misreading it.
  builder_version integer not null default 1,
  status text not null default 'ready' check (status in ('ready', 'partial', 'confirmed_empty', 'refresh_failed')),
  -- Observability: every attempt is recorded even when the payload is not
  -- replaced, so a silently failing refresh is visible rather than inferred
  -- from staleness.
  last_attempt_at timestamptz not null default now(),
  last_error text,
  build_duration_ms integer,
  primary key (name, scope)
);

comment on table public.op_public_projections is
  'Prepared public read models. Public pages read exactly one row from here; they never scan operational history. A failed refresh preserves the previous payload and records the failure rather than publishing an empty one.';

alter table public.op_public_projections enable row level security;

drop policy if exists op_public_projections_read on public.op_public_projections;
create policy op_public_projections_read on public.op_public_projections for select using (true);

-- Central writer. The critical property: a refresh that produces nothing
-- because its source failed must NOT replace a good payload with an empty one.
-- That single rule is what stops a database hiccup from becoming "no fixtures
-- today" on the homepage.
create or replace function private.write_public_projection(
  p_name text,
  p_scope text,
  p_payload jsonb,
  p_row_count integer,
  p_source_max_at timestamptz,
  p_status text,
  p_builder_version integer,
  p_duration_ms integer,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'refresh_failed' then
    -- Keep the last good payload; record only that the attempt failed.
    update public.op_public_projections
    set last_attempt_at = now(), last_error = p_error, status = case when status = 'refresh_failed' then 'refresh_failed' else status end
    where name = p_name and scope = p_scope;
    if not found then
      insert into public.op_public_projections (name, scope, payload, row_count, status, last_error, builder_version, build_duration_ms)
      values (p_name, p_scope, '[]'::jsonb, 0, 'refresh_failed', p_error, p_builder_version, p_duration_ms);
    end if;
    return;
  end if;

  insert into public.op_public_projections as target
    (name, scope, payload, row_count, source_max_at, built_at, builder_version, status, last_attempt_at, last_error, build_duration_ms)
  values
    (p_name, p_scope, p_payload, p_row_count, p_source_max_at, now(), p_builder_version, p_status, now(), null, p_duration_ms)
  on conflict (name, scope) do update set
    payload = excluded.payload,
    row_count = excluded.row_count,
    source_max_at = excluded.source_max_at,
    built_at = excluded.built_at,
    builder_version = excluded.builder_version,
    status = excluded.status,
    last_attempt_at = excluded.last_attempt_at,
    last_error = null,
    build_duration_ms = excluded.build_duration_ms;
end;
$$;

revoke all on function private.write_public_projection(text, text, jsonb, integer, timestamptz, text, integer, integer, text) from public, anon, authenticated;
