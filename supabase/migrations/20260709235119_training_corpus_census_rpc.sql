create or replace function public.op_training_corpus_census()
returns table (
  sport text,
  fixtures bigint,
  finished_fixtures bigint,
  epl_2026_fixtures bigint,
  odds_snapshots bigint,
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
    (select count(*) from public.op_odds_snapshots as odds where odds.sport = sports.sport and odds.market = 'match_winner'),
    (select count(*) from public.op_raw_provider_payloads as payloads where payloads.sport = sports.sport),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport and features.split = 'live'),
    (select count(*) from public.op_training_feature_snapshots as features where features.sport = sports.sport and features.label is not null),
    (select count(*) from public.op_backtest_runs as backtests where backtests.sport = sports.sport and backtests.status = 'completed')
  from sports;
$$;

revoke all on function public.op_training_corpus_census() from public, anon, authenticated;
grant execute on function public.op_training_corpus_census() to service_role;

comment on function public.op_training_corpus_census() is
  'Returns the private OddsPadi multi-sport training corpus census in one service-role-only read.';
