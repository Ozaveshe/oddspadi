-- The rest of the "engine went silent" fix: the slate read's other two queries,
-- and the supersession bug that made one of them enormous.
--
-- With the odds projection in place (20260803170000) the remaining slate reads
-- were still sitting on the 8s statement timeout. Measured on today's 256
-- fixtures, inside the same Promise.all:
--
--   op_current_odds                    534 rows      0 ms
--   op_market_decisions             43,384 rows  5,027 ms
--   op_fixture_decision_summaries      256 rows  6,226 ms
--
-- Two different causes.

-- 1. Both queries filter `fixture_id in (...) and superseded_by is null`, and
--    the only index matching the second half was on `superseded_by` alone. The
--    planner drove off that: for the summaries it walked 19,867 index entries
--    and 6,706 heap rows across 10,098 blocks to return 256. Driving from
--    fixture_id makes the lookup proportional to the day, not the table.
create index if not exists op_fixture_decision_summaries_current_fixture_idx
  on public.op_fixture_decision_summaries (fixture_id, generated_at desc)
  where superseded_by is null;

create index if not exists op_market_decisions_current_fixture_idx
  on public.op_market_decisions (fixture_id, generated_at desc)
  where superseded_by is null;

-- 2. `op_market_decisions` genuinely held 43,384 rows for 256 fixtures — 534
--    distinct selections at 81.6 generations each, every one marked current,
--    going back six days.
--
--    `persistMarketDecisions` built its prior lookup with
--    `new Map(rows.map(row => [key, row]))`, which keeps a single row per
--    duplicate key. There is one prior per selection per engine run, so
--    supersession retired one arbitrary row and left the rest current; the
--    backlog could only grow. It also skipped the whole key when that arbitrary
--    prior was not `pending`, so a settled sibling blocked its neighbours.
--
--    Fixed in repository.ts. This collapses what accumulated. The newest
--    generation per (fixture, market, selection) stays current and the older
--    pending ones point at it. Settled rows are left alone: marking a decision
--    stale after it has been graded would rewrite the record.
--
--    Batched by fixture because ranking all 561k current rows at once trips the
--    same timeout this work exists to remove.
create or replace function public.op_collapse_superseded_decisions(p_fixture_limit integer default 25)
returns table (fixtures_processed integer, rows_retired integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixtures uuid[];
  v_retired integer;
begin
  select array_agg(fixture_id) into v_fixtures
  from (
    select d.fixture_id
    from public.op_market_decisions d
    where d.superseded_by is null and d.settlement_status = 'pending'
    group by d.fixture_id
    having count(*) > count(distinct (d.market, d.selection))
    limit greatest(1, least(200, p_fixture_limit))
  ) pending;

  if v_fixtures is null then
    return query select 0, 0;
    return;
  end if;

  with ranked as (
    select d.id,
           first_value(d.id) over w as newest_id,
           row_number()      over w as rn
    from public.op_market_decisions d
    where d.fixture_id = any(v_fixtures)
      and d.superseded_by is null
      and d.settlement_status = 'pending'
    window w as (
      partition by d.fixture_id, d.market, d.selection
      order by d.generated_at desc, d.id desc
    )
  ),
  stale as (select id, newest_id from ranked where rn > 1)
  update public.op_market_decisions t
     set superseded_by = s.newest_id,
         decision_status = 'stale',
         public_status = 'stale',
         updated_at = now()
    from stale s
   where t.id = s.id;
  get diagnostics v_retired = row_count;

  return query select coalesce(array_length(v_fixtures, 1), 0), coalesce(v_retired, 0);
end;
$$;

comment on function public.op_collapse_superseded_decisions is
  'Retires duplicate current decisions left behind by the supersession bug. Newest generation per (fixture, market, selection) stays current; older pending ones point at it; settled rows are never touched. Call until fixtures_processed is 0.';

revoke all on function public.op_collapse_superseded_decisions(integer) from public, anon, authenticated;

-- Seeds op_current_odds for fixtures that have snapshots but no projection row.
-- Batched for the same reason.
create or replace function public.op_backfill_current_odds(p_fixture_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixtures uuid[];
  v_done integer;
begin
  select array_agg(id) into v_fixtures
  from (
    select f.id
    from public.op_fixtures f
    where f.kickoff_at >= now() - interval '30 days'
      and exists (select 1 from public.op_odds_snapshots s where s.fixture_id = f.id)
      and not exists (select 1 from public.op_current_odds c where c.fixture_id = f.id)
    order by f.kickoff_at desc
    limit greatest(1, least(1000, p_fixture_limit))
  ) pending;

  if v_fixtures is null then return 0; end if;

  insert into public.op_current_odds (
    fixture_id, market, selection, snapshot_id, fixture_external_id, provider,
    bookmaker, decimal_odds, observed_at, captured_at, source, is_live, expires_at, metadata
  )
  select distinct on (s.fixture_id, s.market, s.selection)
    s.fixture_id, s.market, s.selection, s.id, s.fixture_external_id, s.provider,
    s.bookmaker, s.decimal_odds, s.observed_at, coalesce(s.captured_at, s.observed_at, now()),
    s.source, s.is_live, s.expires_at, s.metadata
  from public.op_odds_snapshots s
  where s.fixture_id = any(v_fixtures)
    and s.market is not null and s.selection is not null
  order by s.fixture_id, s.market, s.selection, s.captured_at desc
  on conflict (fixture_id, market, selection) do nothing;

  v_done := array_length(v_fixtures, 1);
  return coalesce(v_done, 0);
end;
$$;

revoke all on function public.op_backfill_current_odds(integer) from public, anon, authenticated;

analyze public.op_fixture_decision_summaries;
analyze public.op_market_decisions;
