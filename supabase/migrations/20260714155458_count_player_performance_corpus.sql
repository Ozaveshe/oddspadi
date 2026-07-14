create function public.op_player_performance_corpus_counts()
returns table (
  sport text,
  player_performance_rows bigint,
  player_performance_fixtures bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sports(sport) as (
    values ('football'::text), ('basketball'::text), ('tennis'::text)
  ),
  performance_counts as (
    select
      performances.sport,
      count(*) as player_performance_rows,
      count(distinct performances.fixture_external_id) as player_performance_fixtures
    from public.op_player_match_performances as performances
    where performances.source_kind = 'real'
      and performances.sport in (select sport from sports)
    group by performances.sport
  )
  select
    sports.sport,
    coalesce(performance_counts.player_performance_rows, 0),
    coalesce(performance_counts.player_performance_fixtures, 0)
  from sports
  left join performance_counts on performance_counts.sport = sports.sport;
$$;

revoke all on function public.op_player_performance_corpus_counts() from public, anon, authenticated;
grant execute on function public.op_player_performance_corpus_counts() to service_role;

comment on function public.op_player_performance_corpus_counts() is
  'Returns service-role-only real player-performance corpus rows and fixture coverage for operational readiness checks.';
