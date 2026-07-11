create function public.op_training_snapshot_counts()
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
  event_snapshots bigint,
  demo_event_snapshots bigint,
  news_snapshots bigint,
  demo_news_snapshots bigint,
  standings_snapshots bigint,
  demo_standings_snapshots bigint,
  availability_snapshots bigint,
  demo_availability_snapshots bigint,
  lineup_snapshots bigint,
  demo_lineup_snapshots bigint,
  weather_snapshots bigint,
  demo_weather_snapshots bigint,
  feature_snapshots bigint,
  complete_feature_snapshots bigint,
  complete_live_feature_snapshots bigint,
  proxy_feature_snapshots bigint,
  live_feature_snapshots bigint,
  labeled_feature_snapshots bigint,
  backtest_runs bigint,
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
      count(*) filter (where fixtures.status = 'finished' and fixtures.provider <> 'demo_seed') as real_finished_fixtures,
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
      count(*) filter (where odds.provider <> 'demo_seed') as real_odds_snapshots,
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
  event_counts as (
    select
      events.sport,
      count(*) as event_snapshots,
      count(*) filter (where events.provider = 'demo_seed') as demo_event_snapshots
    from public.op_live_match_events as events
    where events.sport in (select sport from sports)
    group by events.sport
  ),
  news_counts as (
    select
      news.sport,
      count(*) as news_snapshots,
      count(*) filter (where news.provider = 'demo_seed') as demo_news_snapshots
    from public.op_news_signals as news
    where news.sport in (select sport from sports)
    group by news.sport
  ),
  standings_counts as (
    select
      standings.sport,
      count(*) as standings_snapshots,
      count(*) filter (where standings.provider = 'demo_seed') as demo_standings_snapshots
    from public.op_standings_snapshots as standings
    where standings.sport in (select sport from sports)
    group by standings.sport
  ),
  availability_counts as (
    select
      availability.sport,
      count(*) as availability_snapshots,
      count(*) filter (where availability.provider = 'demo_seed') as demo_availability_snapshots
    from public.op_player_availability_snapshots as availability
    where availability.sport in (select sport from sports)
    group by availability.sport
  ),
  lineup_counts as (
    select
      lineups.sport,
      count(*) as lineup_snapshots,
      count(*) filter (where lineups.provider = 'demo_seed') as demo_lineup_snapshots
    from public.op_lineup_snapshots as lineups
    where lineups.sport in (select sport from sports)
    group by lineups.sport
  ),
  weather_counts as (
    select
      weather.sport,
      count(*) as weather_snapshots,
      count(*) filter (where weather.provider = 'demo_seed') as demo_weather_snapshots
    from public.op_weather_snapshots as weather
    where weather.sport in (select sport from sports)
    group by weather.sport
  ),
  feature_counts as (
    select
      features.sport,
      count(*) as feature_snapshots,
      count(*) filter (where features.source = 'demo_seed') as proxy_feature_snapshots,
      count(*) filter (where features.split = 'live') as live_feature_snapshots,
      count(*) filter (where features.label is not null) as labeled_feature_snapshots,
      count(*) filter (
        where features.source <> 'demo_seed'
          and case features.sport
            when 'football' then
              features.features->'homeFeatures'->>'attackStrength' is not null
              and features.features->'homeFeatures'->>'defenseStrength' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->>'attackStrength' is not null
              and features.features->'awayFeatures'->>'defenseStrength' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
            when 'basketball' then
              features.features->'homeFeatures'->>'eloRating' is not null
              and features.features->'homeFeatures'->>'restDays' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'homeFeatures'->'metadata'->>'pace' is not null
              and features.features->'homeFeatures'->'metadata'->>'offensiveEfficiency' is not null
              and features.features->'homeFeatures'->'metadata'->>'defensiveEfficiency' is not null
              and features.features->'awayFeatures'->>'eloRating' is not null
              and features.features->'awayFeatures'->>'restDays' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->'metadata'->>'pace' is not null
              and features.features->'awayFeatures'->'metadata'->>'offensiveEfficiency' is not null
              and features.features->'awayFeatures'->'metadata'->>'defensiveEfficiency' is not null
            when 'tennis' then
              features.features->'homeFeatures'->>'eloRating' is not null
              and features.features->'homeFeatures'->>'attackStrength' is not null
              and features.features->'homeFeatures'->>'defenseStrength' is not null
              and features.features->'homeFeatures'->>'restDays' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'homeFeatures'->'metadata'->>'surface' is not null
              and features.features->'awayFeatures'->>'eloRating' is not null
              and features.features->'awayFeatures'->>'attackStrength' is not null
              and features.features->'awayFeatures'->>'defenseStrength' is not null
              and features.features->'awayFeatures'->>'restDays' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->'metadata'->>'surface' is not null
            else false
          end
      ) as complete_feature_snapshots,
      count(*) filter (
        where features.split = 'live'
          and features.source <> 'demo_seed'
          and case features.sport
            when 'football' then
              features.features->'homeFeatures'->>'attackStrength' is not null
              and features.features->'homeFeatures'->>'defenseStrength' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->>'attackStrength' is not null
              and features.features->'awayFeatures'->>'defenseStrength' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
            when 'basketball' then
              features.features->'homeFeatures'->>'eloRating' is not null
              and features.features->'homeFeatures'->>'restDays' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'homeFeatures'->'metadata'->>'pace' is not null
              and features.features->'homeFeatures'->'metadata'->>'offensiveEfficiency' is not null
              and features.features->'homeFeatures'->'metadata'->>'defensiveEfficiency' is not null
              and features.features->'awayFeatures'->>'eloRating' is not null
              and features.features->'awayFeatures'->>'restDays' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->'metadata'->>'pace' is not null
              and features.features->'awayFeatures'->'metadata'->>'offensiveEfficiency' is not null
              and features.features->'awayFeatures'->'metadata'->>'defensiveEfficiency' is not null
            when 'tennis' then
              features.features->'homeFeatures'->>'eloRating' is not null
              and features.features->'homeFeatures'->>'attackStrength' is not null
              and features.features->'homeFeatures'->>'defenseStrength' is not null
              and features.features->'homeFeatures'->>'restDays' is not null
              and features.features->'homeFeatures'->>'recentFormPoints' is not null
              and features.features->'homeFeatures'->'metadata'->>'surface' is not null
              and features.features->'awayFeatures'->>'eloRating' is not null
              and features.features->'awayFeatures'->>'attackStrength' is not null
              and features.features->'awayFeatures'->>'defenseStrength' is not null
              and features.features->'awayFeatures'->>'restDays' is not null
              and features.features->'awayFeatures'->>'recentFormPoints' is not null
              and features.features->'awayFeatures'->'metadata'->>'surface' is not null
            else false
          end
      ) as complete_live_feature_snapshots
    from public.op_training_feature_snapshots as features
    where features.sport in (select sport from sports)
    group by features.sport
  ),
  backtest_counts as (
    select
      backtests.sport,
      count(*) as backtest_runs,
      count(*) filter (where backtests.status = 'completed') as completed_backtests
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
    coalesce(event_counts.event_snapshots, 0),
    coalesce(event_counts.demo_event_snapshots, 0),
    coalesce(news_counts.news_snapshots, 0),
    coalesce(news_counts.demo_news_snapshots, 0),
    coalesce(standings_counts.standings_snapshots, 0),
    coalesce(standings_counts.demo_standings_snapshots, 0),
    coalesce(availability_counts.availability_snapshots, 0),
    coalesce(availability_counts.demo_availability_snapshots, 0),
    coalesce(lineup_counts.lineup_snapshots, 0),
    coalesce(lineup_counts.demo_lineup_snapshots, 0),
    coalesce(weather_counts.weather_snapshots, 0),
    coalesce(weather_counts.demo_weather_snapshots, 0),
    coalesce(feature_counts.feature_snapshots, 0),
    coalesce(feature_counts.complete_feature_snapshots, 0),
    coalesce(feature_counts.complete_live_feature_snapshots, 0),
    coalesce(feature_counts.proxy_feature_snapshots, 0),
    coalesce(feature_counts.live_feature_snapshots, 0),
    coalesce(feature_counts.labeled_feature_snapshots, 0),
    coalesce(backtest_counts.backtest_runs, 0),
    coalesce(backtest_counts.completed_backtests, 0)
  from sports
  left join fixture_counts on fixture_counts.sport = sports.sport
  left join odds_counts on odds_counts.sport = sports.sport
  left join payload_counts on payload_counts.sport = sports.sport
  left join event_counts on event_counts.sport = sports.sport
  left join news_counts on news_counts.sport = sports.sport
  left join standings_counts on standings_counts.sport = sports.sport
  left join availability_counts on availability_counts.sport = sports.sport
  left join lineup_counts on lineup_counts.sport = sports.sport
  left join weather_counts on weather_counts.sport = sports.sport
  left join feature_counts on feature_counts.sport = sports.sport
  left join backtest_counts on backtest_counts.sport = sports.sport;
$$;

revoke all on function public.op_training_snapshot_counts() from public, anon, authenticated;
grant execute on function public.op_training_snapshot_counts() to service_role;
