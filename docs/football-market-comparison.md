# Does the football model improve on bookmaker odds?

Run [the checkpoint query](../scripts/football-market-comparison.sql) in the [OddsPadi SQL Editor](https://supabase.com/dashboard/project/wncwtzqipnoqwmqlznqn/sql/new). An empty cohort returns **awaiting first eligible forecast**. The private database views update as the scheduled decision cycle stores evidence and the results pipeline verifies regulation scores. Reading the report uses zero sports-provider credits.

## Which forecasts count

The study opens on 19 November 2026 at 01:00 UTC. It takes the first eligible football home/draw/away forecast in the 24 hours before kickoff for each API-Football fixture, registered model version and engine version. All three sides must have a probability from the model, a bookmaker consensus probability, and a named bookmaker quote observed within the preceding hour. Consensus uses the existing margin-adjusted multi-book method with at least three books. Reruns contribute one entry. Abstentions count toward forecasting accuracy.

This measures the deployed model, which can blend bookmaker probabilities into its forecast. A positive paired log-loss gain means the adjustments improved prediction of observed outcomes over the bookmaker consensus available at the time. Lower Brier scores indicate better probability forecasts across all three sides.

## When to judge it

The checkpoint is the first 200 eligible fixtures per version, ordered by forecast time. All 200 need verified regulation results across at least 20 UTC matchdays. Later results cannot fill holes in those first 200. The report estimates uncertainty from paired log-loss differences grouped by matchday and uses an approximate 95% interval. Its lower bound must exceed zero to label the model ahead. A result applies to that version, market and cohort. A new version gets its own checkpoint. Comparisons across many versions or leagues need separate validation.

## What a better forecast would have earned

The paper strategy risks one unit on at most one outcome per fixture. It takes the highest model probability times quoted decimal odds when that product is at least 1.05. Ties resolve in home, draw, away order. Gross paper ROI is the mean profit per settled paper bet. The strategy tests the archived prices before commissions, stake limits and execution delays. It runs independently of the public recommendation.

Closing-price gain compares the entry price with a later, captured multi-book close for the same fixture and outcome. The report shows how many paper bets have a qualifying close. A missing close stays blank. Current verified result revisions supply the scores, so a provider correction can change a previously reported figure.

## Audit a result

The forecast view explains exclusions by evidence revision. The match view links each enrolled forecast to its evidence hash, recorded prices, bookmaker IDs and result revision. Arrays use home, draw, away order. The scorecard view shows running totals across the full cohort.

```sql
select eligibility, count(*) as forecast_revisions
from odds_benchmark.football_forecasts
group by eligibility order by forecast_revisions desc;

select fixture_external_id, forecast_at, evidence_id, model_p, market_p, prices,
       books, actual, result_id, result_revision, paper_profit, closing_id
from odds_benchmark.football_matches
order by forecast_at desc limit 25;
```
