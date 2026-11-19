-- Run in the OddsPadi SQL Editor. Uses stored evidence only.
-- One checkpoint per model version, on the first 200 eligible fixtures.
with ranked as (
  select m.*, row_number() over (
    partition by model_version_id,engine_version order by forecast_at,evidence_id
  ) as entry_number
  from odds_benchmark.football_matches m
), checkpoint as (
  select * from ranked where entry_number<=200
), by_day as (
  select model_version_id,engine_version,(kickoff_at at time zone 'UTC')::date as matchday,
    count(actual) as scored, sum(market_log_loss-model_log_loss) as total_gain
  from checkpoint where actual is not null group by 1,2,3
), point as (
  select model_version_id,engine_version,sum(total_gain)/sum(scored) as gain,
    sum(scored) as n,count(*) as days
  from by_day group by 1,2
), uncertainty as (
  -- Cluster by UTC matchday so fixtures on the same day can move together.
  select p.model_version_id,p.engine_version,p.days,p.gain,
    sqrt(sum((d.total_gain-d.scored*p.gain)^2)*p.days/nullif(p.days-1,0))/p.n as se
  from point p join by_day d using(model_version_id,engine_version)
  group by p.model_version_id,p.engine_version,p.days,p.gain,p.n
), totals as (
  select model_key,model_version_id,engine_version,count(*) enrolled,count(actual) scored,
    avg(model_brier) model_brier,avg(market_brier) market_brier,count(paper_profit) settled_paper_bets,
    avg(paper_profit) gross_paper_roi,count(closing_id) bets_with_close,avg(closing_price_gain) closing_price_gain
  from checkpoint group by 1,2,3
)
select t.*,u.days as scored_matchdays,u.gain as paired_log_loss_gain,
  case when t.scored=200 and u.days>=20 then u.gain-2.1*u.se end as lower_approx_95,
  case when t.scored=200 and u.days>=20 then u.gain+2.1*u.se end as upper_approx_95,
  case when t.enrolled<200 then 'collecting'
       when t.scored<200 then 'awaiting verified results'
       when u.days<20 then 'insufficient matchday coverage'
       when u.gain-2.1*u.se>0 then 'model ahead at checkpoint'
       when u.gain+2.1*u.se<0 then 'market ahead at checkpoint'
       else 'inconclusive' end as assessment
from totals t left join uncertainty u using(model_version_id,engine_version)
union all
select null,null,null,0,0,null,null,0,null,0,null,0,null,null,null,'awaiting first eligible forecast'
where not exists(select 1 from totals)
order by model_key,engine_version;
