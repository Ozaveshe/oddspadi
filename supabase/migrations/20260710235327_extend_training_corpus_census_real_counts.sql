create or replace function public.op_training_corpus_training_counts()
returns table (
  sport text,
  fixtures bigint,
  finished_fixtures bigint,
  real_finished_fixtures bigint,
  demo_finished_fixtures bigint,
  epl_2026_fixtures bigint,
  odds_snapshots bigint,
  real_odds_snapshots bigint,
  demo_odds_snapshots bigint,
  match_winner_odds_snapshots bigint,
  raw_provider_payloads bigint,
  feature_snapshots bigint,
  live_feature_snapshots bigint,
  labeled_feature_snapshots bigint,
  completed_backtests bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sports(sport) as (
    values ('football'::text), ('basketball'::text), ('tennis'::text)
  )
  select
    sports.sport,
    (select count(*) from public.op_fixtures as fixtures where fixtures.sport = sports.sport),
    (select count(*) from public.op_fixtures as fixtures where fixtures.sport = sports.sport and fixtures.status = 'finished'),
    (
      select count(*)
      from public.op_fixtures as fixtures
      where fixtures.sport = sports.sport
        and fixtures.status = 'finished'
        and coalesce(fixtures.provider, '') <> 'demo_seed'
    ),
    (
      select count(*)
      from public.op_fixtures as fixtures
      where fixtures.sport = sports.sport
        and fixtures.status = 'finished'
        and fixtures.provider = 'demo_seed'
    ),
    case
      when sports.sport = 'football' then (
        select count(*)
        from public.op_fixtures as fixtures
        where fixtures.sport = 'football'
          and fixtures.league_external_id in ('39', 'api-football:39')
          and fixtures.season = '2026'
      )
      else 0::bigint
    end,
    (select count(*) from public.op_odds_snapshots as odds where odds.sport = sports.sport),
    (
      select count(*)
      from public.op_odds_snapshots as odds
      where odds.sport = sports.sport
        and coalesce(odds.provider, '') <> 'demo_seed'
    ),
    (
      select count(*)
      from public.op_odds_snapshots as odds
      where odds.sport = sports.sport
        and odds.provider = 'demo_seed'
    ),
    (select count(*) from public.op_odds_snapshots as odds where odds.sport = sports.sport and odds.market = 'match_winner'),
    (select count(*) from public.op_raw_provider_payloads as payloads where payloads.sport = sports.sport),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport and features.split = 'live'),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport and features.label is not null),
    (select count(*) from public.op_backtest_runs as backtests where backtests.sport = sports.sport and backtests.status = 'completed')
  from sports;
$$;

revoke all on function public.op_training_corpus_training_counts() from public, anon, authenticated;
grant execute on function public.op_training_corpus_training_counts() to service_role;

comment on function public.op_training_corpus_training_counts() is
  'Returns private multi-sport corpus totals and atomic real/demo training counts for service-role readiness checks.';
