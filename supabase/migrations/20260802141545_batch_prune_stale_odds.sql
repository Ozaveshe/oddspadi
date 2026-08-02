-- Correct forward: op_prune_stale_odds could never complete.
--
-- The function materialised EVERY prunable row before deleting. Measured on
-- production, selecting just the first 5,000 candidates costs 1.67s against an
-- 8s statement timeout, and roughly 197,000 rows qualify — so the unbounded
-- scan was cancelled on every run and no odds history was ever pruned. The
-- table had grown to 1.26M rows / 685 MB unchecked, and the outcome-ledger
-- sweep recorded "odds-prune: canceling statement due to statement timeout"
-- on every pass.
--
-- The prune is now bounded per call. Hourly runs drain the backlog across a
-- couple of days and then keep pace, which is what a maintenance job should do
-- rather than attempting the whole table in one transaction.
--
-- The old two-argument signature is dropped rather than left alongside: two
-- overloads would make the PostgREST call ambiguous.
drop function if exists public.op_prune_stale_odds(integer, boolean);

create function public.op_prune_stale_odds(
  p_older_than_days integer default 14,
  p_commit boolean default false,
  p_max_rows integer default 5000
)
returns table (sport text, prunable bigint, deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(1, p_older_than_days));
  v_limit integer := greatest(100, least(50000, p_max_rows));
begin
  create temporary table _prunable_odds on commit drop as
  select o.id, o.sport as odds_sport
  from public.op_odds_snapshots o
  join public.op_fixtures f on f.id = o.fixture_id
  where o.is_closing = false
    and o.observed_at < v_cutoff
    and f.status in ('finished', 'cancelled', 'postponed')
    and not exists (
      select 1 from public.op_market_decisions d where d.odds_snapshot_id = o.id
    )
  limit v_limit;

  if p_commit then
    delete from public.op_odds_snapshots o using _prunable_odds p where o.id = p.id;
  end if;

  return query
  select p.odds_sport::text, count(*)::bigint,
    case when p_commit then count(*)::bigint else 0::bigint end
  from _prunable_odds p group by p.odds_sport order by p.odds_sport;
end;
$$;

comment on function public.op_prune_stale_odds(integer, boolean, integer) is
  'Deletes up to p_max_rows superseded non-closing odds snapshots for finished fixtures older than the cutoff. Bounded per call so it completes inside the statement timeout; repeated runs drain the backlog. Never touches closing quotes or struck prices.';

revoke all on function public.op_prune_stale_odds(integer, boolean, integer) from public, anon, authenticated;
