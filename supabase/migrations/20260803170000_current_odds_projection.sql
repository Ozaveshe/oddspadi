-- One row per priced selection, so the public read stops re-deriving "newest".
--
-- `op_latest_odds_for_fixtures` did `distinct on (fixture_id, market, selection)
-- ... order by captured_at desc` straight over `op_odds_snapshots`. Postgres has
-- no index skip-scan, so that reads every snapshot for every fixture and sorts
-- them to keep the first of each group.
--
-- Measured 2026-08-03 on today's board (EXPLAIN ANALYZE):
--
--   rows read      105,277   -> to return 534
--   buffers        135,345   (shared hit=120,916 read=14,429)
--   execution      8,212 ms  against an 8 s statement timeout
--
-- Landing within a few percent of the timeout is why the board was
-- intermittently blank: roughly one request in eight lost the race, the read
-- threw "canceling statement due to statement timeout", and the slate came back
-- `unavailable` — rendering as though the engine had produced nothing.
--
-- The table is 1,594,600 snapshots across 3,937 fixtures, ~405 each, and this
-- is not stale history that pruning would remove: 93,569 of the 105,277 rows
-- scanned were captured in the last 48 hours. Every refresh cycle appends
-- another quote per selection, by design, because the snapshot history is
-- calibration evidence. So the history stays and the read stops paying for it.
--
-- `op_current_odds` holds the newest quote per (fixture, market, selection),
-- maintained by trigger on insert. The write side absorbs the cost, in the cron
-- lane, instead of every anonymous page request paying it.

create table if not exists public.op_current_odds (
  fixture_id uuid not null,
  market text not null,
  selection text not null,
  snapshot_id uuid not null,
  fixture_external_id text,
  provider text,
  bookmaker text,
  decimal_odds numeric,
  observed_at timestamptz,
  captured_at timestamptz not null,
  source text,
  is_live boolean,
  expires_at timestamptz,
  metadata jsonb,
  primary key (fixture_id, market, selection)
);

comment on table public.op_current_odds is
  'Newest quote per (fixture, market, selection). A read projection maintained by trigger from op_odds_snapshots, which keeps full history as calibration evidence. Never write to this directly.';

-- The snapshot row is copied rather than referenced. `ops:prune-odds` deletes
-- superseded quotes for finished fixtures, and a foreign key would either block
-- that or cascade a delete into the projection; the values must survive either
-- way.
create index if not exists op_current_odds_fixture_idx
  on public.op_current_odds (fixture_id);

create or replace function public.op_sync_current_odds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fixture_id is null or new.market is null or new.selection is null then
    return new;
  end if;
  insert into public.op_current_odds as c (
    fixture_id, market, selection, snapshot_id, fixture_external_id, provider,
    bookmaker, decimal_odds, observed_at, captured_at, source, is_live, expires_at, metadata
  )
  values (
    new.fixture_id, new.market, new.selection, new.id, new.fixture_external_id, new.provider,
    new.bookmaker, new.decimal_odds, new.observed_at, coalesce(new.captured_at, now()),
    new.source, new.is_live, new.expires_at, new.metadata
  )
  on conflict (fixture_id, market, selection) do update
    set snapshot_id = excluded.snapshot_id,
        fixture_external_id = excluded.fixture_external_id,
        provider = excluded.provider,
        bookmaker = excluded.bookmaker,
        decimal_odds = excluded.decimal_odds,
        observed_at = excluded.observed_at,
        captured_at = excluded.captured_at,
        source = excluded.source,
        is_live = excluded.is_live,
        expires_at = excluded.expires_at,
        metadata = excluded.metadata
    -- Only move forward. Backfills and out-of-order writes must never replace a
    -- newer quote with an older one.
    where excluded.captured_at >= c.captured_at;
  return new;
end;
$$;

drop trigger if exists op_odds_snapshots_sync_current on public.op_odds_snapshots;
create trigger op_odds_snapshots_sync_current
  after insert on public.op_odds_snapshots
  for each row execute function public.op_sync_current_odds();

-- Same signature and column list as before, so no caller changes.
create or replace function public.op_latest_odds_for_fixtures(p_fixture_ids uuid[])
returns table (
  id uuid, fixture_id uuid, fixture_external_id text, provider text, bookmaker text,
  market text, selection text, decimal_odds numeric, observed_at timestamptz,
  captured_at timestamptz, source text, is_live boolean, expires_at timestamptz, metadata jsonb
)
language sql
stable
set search_path = ''
as $$
  select
    c.snapshot_id as id,
    c.fixture_id,
    c.fixture_external_id,
    c.provider,
    c.bookmaker,
    c.market,
    c.selection,
    c.decimal_odds,
    c.observed_at,
    c.captured_at,
    c.source,
    c.is_live,
    c.expires_at,
    c.metadata
  from public.op_current_odds c
  where c.fixture_id = any(p_fixture_ids)
$$;

alter table public.op_current_odds enable row level security;

-- Read-only to the public, like the snapshots it projects.
drop policy if exists op_current_odds_public_read on public.op_current_odds;
create policy op_current_odds_public_read on public.op_current_odds
  for select using (true);
