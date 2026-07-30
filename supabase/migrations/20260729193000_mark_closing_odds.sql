-- Mark closing odds snapshots for fixtures that have already kicked off.
--
-- `is_closing` was hardcoded false in the live odds write path
-- (src/lib/sports/intelligence/repository.ts), so only the historical corpus
-- importers ever produced a closing quote. Closing snapshots therefore stopped
-- at 2026-05-24 for football and 2024-11-17 for tennis, while every stored
-- decision is from 2026-07-18 onward. With zero overlap, closing-line coverage
-- for any live decision is 0.00 and the >= 0.80 promotion gate is unreachable.
--
-- A closing quote cannot be identified at capture time — you only know a
-- snapshot was the last one once kickoff has passed. So this runs as a sweep
-- after the fact rather than as a change to the write path.
--
-- Semantics deliberately match `filterClosingEligibleFootballOddsMatches`:
-- a quote is closing when it was observed at or before kickoff and no earlier
-- than `p_window_minutes` before it (the importer's default is 90). Only the
-- latest such quote per (fixture, market, selection, bookmaker) qualifies —
-- one closing price per book per selection, as the corpus stores it.
--
-- The sweep only ever sets `is_closing` true, and skips any group that already
-- has a closing row, so corpus-imported quotes are never disturbed and repeat
-- runs are no-ops.

create or replace function public.op_mark_closing_odds(
  p_since timestamptz,
  p_window_minutes integer default 90,
  p_commit boolean default false
)
returns table (
  sport text,
  fixtures_in_scope bigint,
  quotes_marked bigint,
  fixtures_with_closing bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  create temporary table _closing_candidates on commit drop as
  with scoped as (
    select f.id as fixture_id, f.sport as fx_sport, f.kickoff_at
    from op_fixtures f
    where f.kickoff_at >= p_since
      and f.kickoff_at <= now()
  ),
  eligible as (
    select
      o.id,
      s.fx_sport,
      s.fixture_id,
      row_number() over (
        partition by o.fixture_id, o.market, o.selection, o.bookmaker
        order by o.observed_at desc
      ) as recency_rank
    from op_odds_snapshots o
    join scoped s on s.fixture_id = o.fixture_id
    where coalesce(o.is_live, false) = false
      and o.observed_at is not null
      and o.observed_at <= s.kickoff_at
      and o.observed_at >= s.kickoff_at - make_interval(mins => p_window_minutes)
      -- Never touch a group the corpus already supplied a closing price for.
      and not exists (
        select 1 from op_odds_snapshots existing
        where existing.fixture_id = o.fixture_id
          and existing.market = o.market
          and existing.selection = o.selection
          and existing.bookmaker is not distinct from o.bookmaker
          and existing.is_closing
      )
  )
  select id, fx_sport, fixture_id from eligible where recency_rank = 1;

  if p_commit then
    update op_odds_snapshots o
    set is_closing = true
    from _closing_candidates c
    where o.id = c.id and o.is_closing = false;
  end if;

  return query
  select
    c.fx_sport::text,
    (select count(distinct f2.id) from op_fixtures f2
      where f2.sport = c.fx_sport and f2.kickoff_at >= p_since and f2.kickoff_at <= now()),
    count(*)::bigint,
    count(distinct c.fixture_id)::bigint
  from _closing_candidates c
  group by c.fx_sport
  order by c.fx_sport;
end;
$$;

comment on function public.op_mark_closing_odds is
  'Flags the last pre-kickoff quote per (fixture, market, selection, bookmaker) within the closing window. Dry run unless p_commit. Never unsets, never overwrites corpus-imported closing quotes.';

revoke all on function public.op_mark_closing_odds(timestamptz, integer, boolean) from public, anon, authenticated;
