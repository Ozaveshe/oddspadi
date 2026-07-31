-- Remove odds snapshots that no longer serve any purpose.
--
-- `op_odds_snapshots` grows without bound (~1M rows) and most of it is
-- superseded pre-match quotes for fixtures that finished long ago. Three kinds
-- of row are load-bearing and are never touched:
--
--   * closing quotes (`is_closing`) — calibration and CLV evidence;
--   * quotes referenced by a decision's `odds_snapshot_id` — the struck price;
--   * anything for a fixture that has not finished yet.
--
-- Everything else older than the cutoff is deletable history. Dry run unless
-- p_commit; returns per-sport counts either way.

create or replace function public.op_prune_stale_odds(
  p_older_than_days integer default 14,
  p_commit boolean default false
)
returns table (sport text, prunable bigint, deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(1, p_older_than_days));
begin
  create temporary table _prunable_odds on commit drop as
  select o.id, o.sport as odds_sport
  from op_odds_snapshots o
  join op_fixtures f on f.id = o.fixture_id
  where o.is_closing = false
    and o.observed_at < v_cutoff
    and f.status in ('finished', 'cancelled', 'postponed')
    and not exists (
      select 1 from op_market_decisions d where d.odds_snapshot_id = o.id
    );

  if p_commit then
    delete from op_odds_snapshots o using _prunable_odds p where o.id = p.id;
  end if;

  return query
  select p.odds_sport::text, count(*)::bigint,
    case when p_commit then count(*)::bigint else 0::bigint end
  from _prunable_odds p group by p.odds_sport order by p.odds_sport;
end;
$$;

comment on function public.op_prune_stale_odds is
  'Deletes superseded non-closing odds snapshots for finished fixtures older than the cutoff. Never touches closing quotes or struck prices. Dry run unless p_commit.';

revoke all on function public.op_prune_stale_odds(integer, boolean) from public, anon, authenticated;
