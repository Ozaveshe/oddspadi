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
  ),
  fixture_counts as (
    select
      fixtures.sport,
      count(*) as fixtures,
      count(*) filter (where fixtures.status = 'finished') as finished_fixtures,
      count(*) filter (where fixtures.status = 'finished' and coalesce(fixtures.provider, '') <> 'demo_seed') as real_finished_fixtures,
      count(*) filter (where fixtures.status = 'finished' and fixtures.provider = 'demo_seed') as demo_finished_fixtures,
      count(*) filter (
        where fixtures.sport = 'football'
          and fixtures.league_external_id in ('39', 'api-football:39')
          and fixtures.season = '2026'
      ) as epl_2026_fixtures
    from public.op_fixtures as fixtures
    where fixtures.sport in (select sport from sports)
    group by fixtures.sport
  ),
  odds_counts as (
    select
      odds.sport,
      count(*) as odds_snapshots,
      count(*) filter (where coalesce(odds.provider, '') <> 'demo_seed') as real_odds_snapshots,
      count(*) filter (where odds.provider = 'demo_seed') as demo_odds_snapshots,
      count(*) filter (where odds.market = 'match_winner') as match_winner_odds_snapshots
    from public.op_odds_snapshots as odds
    where odds.sport in (select sport from sports)
    group by odds.sport
  ),
  payload_counts as (
    select payloads.sport, count(*) as raw_provider_payloads
    from public.op_raw_provider_payloads as payloads
    where payloads.sport in (select sport from sports)
    group by payloads.sport
  ),
  feature_counts as (
    select
      features.sport,
      count(*) as feature_snapshots,
      count(*) filter (where features.split = 'live') as live_feature_snapshots,
      count(*) filter (where features.label is not null) as labeled_feature_snapshots
    from public.op_training_feature_snapshots as features
    where features.sport in (select sport from sports)
    group by features.sport
  ),
  backtest_counts as (
    select backtests.sport, count(*) filter (where backtests.status = 'completed') as completed_backtests
    from public.op_backtest_runs as backtests
    where backtests.sport in (select sport from sports)
    group by backtests.sport
  )
  select
    sports.sport,
    coalesce(fixture_counts.fixtures, 0),
    coalesce(fixture_counts.finished_fixtures, 0),
    coalesce(fixture_counts.real_finished_fixtures, 0),
    coalesce(fixture_counts.demo_finished_fixtures, 0),
    coalesce(fixture_counts.epl_2026_fixtures, 0),
    coalesce(odds_counts.odds_snapshots, 0),
    coalesce(odds_counts.real_odds_snapshots, 0),
    coalesce(odds_counts.demo_odds_snapshots, 0),
    coalesce(odds_counts.match_winner_odds_snapshots, 0),
    coalesce(payload_counts.raw_provider_payloads, 0),
    coalesce(feature_counts.feature_snapshots, 0),
    coalesce(feature_counts.live_feature_snapshots, 0),
    coalesce(feature_counts.labeled_feature_snapshots, 0),
    coalesce(backtest_counts.completed_backtests, 0)
  from sports
  left join fixture_counts on fixture_counts.sport = sports.sport
  left join odds_counts on odds_counts.sport = sports.sport
  left join payload_counts on payload_counts.sport = sports.sport
  left join feature_counts on feature_counts.sport = sports.sport
  left join backtest_counts on backtest_counts.sport = sports.sport;
$$;

revoke all on function public.op_training_corpus_training_counts() from public, anon, authenticated;
grant execute on function public.op_training_corpus_training_counts() to service_role;
