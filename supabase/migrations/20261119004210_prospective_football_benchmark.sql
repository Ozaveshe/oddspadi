-- Operator-only, prospective shadow study. The scheduled autonomous decision cycle
-- already archives the inputs used here. These views never dispatch a provider call.
create schema odds_benchmark;
revoke all on schema odds_benchmark from public, anon, authenticated;
grant usage on schema odds_benchmark to service_role;

-- Only ISO instants with an explicit zone may participate in temporal joins.
create function odds_benchmark.instant(value text) returns timestamptz
language sql stable strict security invoker set search_path = pg_catalog as $$
  select case when value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    and pg_input_is_valid(value, 'timestamptz') then value::timestamptz end
$$;

create view odds_benchmark.football_forecasts with (security_invoker=true) as
with evidence as (
  select b.id as evidence_id, b.evidence_hash, b.fixture_external_id, b.created_at as forecast_at,
    b.engine_version, b.model_key, b.model_version_id, b.input_snapshot->'fixture' as fixture,
    b.input_snapshot#>'{normalizedMatch,dataSource}' as source,
    jsonb_path_query_first(b.market_snapshot,'$.modelMarkets[*] ? (@.marketId == "match_winner").probabilities') as model,
    jsonb_path_query_first(b.market_snapshot,'$.observedOddsMarkets[*] ? (@.id == "match_winner")') as market
  from public.op_decision_evidence_bundles b
  where b.created_at >= timestamptz '2026-11-19 01:00:00+00'
    and b.sport='football' and b.fixture_external_id like 'api-football:%'
), paired as (
  select e.*, f.id as fixture_id, odds_benchmark.instant(fixture->>'kickoffTime') as kickoff_at,
    f.kickoff_at as current_kickoff, f.started_at,
    market#>'{consensus,probabilities}' as consensus
  from evidence e
  left join public.op_fixtures f on f.sport='football' and f.provider='api-football'
    and f.external_id=e.fixture_external_id and f.home_team_external_id=fixture#>>'{homeTeam,id}'
    and f.away_team_external_id=fixture#>>'{awayTeam,id}'
)
select p.evidence_id,p.evidence_hash,p.fixture_id,p.fixture_external_id,p.forecast_at,p.kickoff_at,
  p.engine_version,p.model_key,p.model_version_id, v.model_p,v.market_p,v.prices,v.books,
  case
    when fixture_id is null or fixture->>'id' is distinct from fixture_external_id then 'fixture_identity'
    when model_version_id is null or nullif(evidence_hash,'') is null then 'missing_version'
    when source->>'kind' is distinct from 'provider' or nullif(source->>'oddsProvider','') is null then 'missing_provider'
    when fixture->>'status' is distinct from 'scheduled' or kickoff_at is null
      or forecast_at >= least(kickoff_at,current_kickoff,started_at)
      or forecast_at < kickoff_at - interval '24 hours' then 'outside_entry_window'
    when market#>>'{consensus,method}' is distinct from 'median-shin-no-vig-v2'
      or not coalesce(jsonb_path_exists(market,'$.consensus.bookmakerCount ? (@.type() == "number" && @ >= 3)'),false)
      then 'insufficient_consensus'
    when v.n <> 3 or v.sides <> 3 or not coalesce(v.valid,false) then 'incomplete_or_stale_quote'
    when abs(v.model_sum-1)>0.001 or abs(v.market_sum-1)>0.001 then 'invalid_probability_sum'
    else 'eligible' end as eligibility
from paired p
cross join lateral (
  select count(*) n,count(distinct side) sides,bool_and(coalesce(
    mp > 0 and mp < 1 and bp > 0 and bp < 1 and price > 1 and book <> ''
    and observed_at between forecast_at - interval '60 minutes' and forecast_at,false)) valid,
    sum(mp) model_sum,sum(bp) market_sum,
    array_agg(mp order by idx) model_p,array_agg(bp order by idx) market_p,
    array_agg(price order by idx) prices,array_agg(book order by idx) books
  from (
    select side,idx, q#>>'{bookmaker,id}' book,odds_benchmark.instant(q->>'observedAt') observed_at,
      case when jsonb_typeof(q->'decimalOdds')='number' then (q->>'decimalOdds')::numeric end price,
      case when jsonb_typeof(model->side)='number' then (model->>side)::numeric end mp,
      case when jsonb_typeof(consensus->side)='number' then (consensus->>side)::numeric end bp
    from unnest(array['home','draw','away']) with ordinality as s(side,idx)
    join jsonb_array_elements(case when jsonb_typeof(market->'selections')='array'
      then market->'selections' else '[]'::jsonb end) q on q->>'id'=side
  ) cells
) v;

create view odds_benchmark.football_matches with (security_invoker=true) as
with entries as (
  select distinct on (fixture_external_id, model_version_id, engine_version) *
  from odds_benchmark.football_forecasts where eligibility='eligible'
  order by fixture_external_id, model_version_id, engine_version, forecast_at, evidence_id
), graded as (
  select e.*, r.id result_id,r.revision result_revision,
    case when r.id is null then null when r.regulation_home>r.regulation_away then 1
      when r.regulation_home=r.regulation_away then 2 else 3 end actual,
    bet.side as paper_side, bet.price as paper_price, bet.book as paper_book
  from entries e
  left join public.op_fixture_results r on r.fixture_id=e.fixture_id and r.sport='football'
    and r.is_current and r.result_status='finished' and r.verification_state='verified'
    and r.regulation_home>=0 and r.regulation_away>=0 and r.final_at>=e.kickoff_at and r.final_at<=now()
  left join lateral (
    select i as side,e.prices[i] as price,e.books[i] as book
    from generate_series(1,3) i where e.model_p[i]*e.prices[i]>=1.05
    order by e.model_p[i]*e.prices[i] desc,i limit 1
  ) bet on true
)
select g.*, -ln(model_p[actual]) as model_log_loss,-ln(market_p[actual]) as market_log_loss,
  case when actual is not null then (select sum((model_p[i]-(i=actual)::int)^2) from generate_series(1,3) i) end model_brier,
  case when actual is not null then (select sum((market_p[i]-(i=actual)::int)^2) from generate_series(1,3) i) end market_brier,
  case when actual is null or paper_side is null then null when actual=paper_side then paper_price-1 else -1 end paper_profit,
  c.id as closing_id, c.close_observed_at, c.closing_odds,
  paper_price / c.closing_odds - 1 as closing_price_gain
from graded g
left join lateral (
  select cp.id,cp.close_observed_at,cp.closing_odds from public.op_closing_prices cp
  where cp.fixture_id=g.fixture_id and cp.market='match_winner' and cp.market_line is null
    and cp.selection=(array['home','draw','away'])[paper_side]
    and cp.is_current and cp.capture_status='captured' and cp.source_count>=3
    and cp.close_observed_at>forecast_at and cp.close_observed_at<least(g.kickoff_at,cp.kickoff_at)
  order by cp.close_observed_at desc,cp.id limit 1
) c on true;

create view odds_benchmark.football_scorecard with (security_invoker=true) as
select model_key,model_version_id,engine_version,count(*) as enrolled,
  count(actual) as settled,count(*)-count(actual) as pending,
  avg(model_log_loss) model_log_loss,avg(market_log_loss) market_log_loss,
  avg(market_log_loss-model_log_loss) as log_loss_gain,
  stddev_samp(market_log_loss-model_log_loss)/sqrt(nullif(count(actual),0)) as paired_standard_error,
  avg(model_brier) model_brier,avg(market_brier) market_brier,
  count(paper_side) paper_bets,count(paper_profit) settled_paper_bets,avg(paper_profit) as gross_paper_roi,
  count(closing_id) as bets_with_close,avg(closing_price_gain) as mean_closing_price_gain
from odds_benchmark.football_matches group by model_key,model_version_id,engine_version;

revoke all on all tables in schema odds_benchmark from public, anon, authenticated;
revoke all on function odds_benchmark.instant(text) from public, anon, authenticated;
grant select on all tables in schema odds_benchmark to service_role;
grant execute on function odds_benchmark.instant(text) to service_role;
