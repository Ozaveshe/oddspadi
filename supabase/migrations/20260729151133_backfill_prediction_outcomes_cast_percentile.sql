-- Cast the closing median so it resolves against the plausibility guard.
--
-- `percentile_cont` returns double precision while `nullif_implausible_odds`
-- takes numeric, so the previous migration failed at runtime with
-- `function nullif_implausible_odds(double precision) does not exist`.
-- Identical to it apart from the `::numeric` on the closing median.

create or replace function public.op_backfill_prediction_outcomes(
  p_since timestamptz,
  p_commit boolean default false
)
returns table (
  sport text,
  candidates bigint,
  with_struck_price bigint,
  with_closing_price bigint,
  inserted bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted bigint := 0;
begin
  create temporary table _outcome_candidates on commit drop as
  with settled as (
    select distinct on (d.fixture_id, d.market, d.selection)
      d.id as decision_id, d.fixture_id, d.market, d.selection,
      d.model_probability, d.implied_probability, d.value_edge,
      d.settlement_status, d.generated_at, d.odds_snapshot_id,
      f.sport as fx_sport, f.external_id as fixture_external_id, f.kickoff_at
    from op_market_decisions d
    join op_fixtures f on f.id = d.fixture_id
    where d.superseded_by is null
      and d.settlement_status in ('won', 'lost', 'push', 'void')
      and d.model_probability is not null
      and f.kickoff_at >= p_since
    order by d.fixture_id, d.market, d.selection, d.generated_at desc
  )
  select
    s.*,
    nullif_implausible_odds(coalesce(
      (select o.decimal_odds from op_odds_snapshots o where o.id = s.odds_snapshot_id),
      (select o.decimal_odds from op_odds_snapshots o
        where o.fixture_id = s.fixture_id and o.market = s.market and o.selection = s.selection
          and coalesce(o.is_live, false) = false
          and o.observed_at <= s.generated_at
        order by o.observed_at desc
        limit 1)
    )) as odds,
    case
      when nullif_implausible_odds(coalesce(
        (select o.decimal_odds from op_odds_snapshots o where o.id = s.odds_snapshot_id),
        (select o.decimal_odds from op_odds_snapshots o
          where o.fixture_id = s.fixture_id and o.market = s.market and o.selection = s.selection
            and coalesce(o.is_live, false) = false and o.observed_at <= s.generated_at
          order by o.observed_at desc limit 1)
      )) is null then 'implausible-price-dropped'
      when s.odds_snapshot_id is not null then 'decision-snapshot'
      else 'reconstructed'
    end as price_source,
    -- percentile_cont returns double precision; cast so it resolves against the
    -- numeric-typed plausibility guard.
    nullif_implausible_odds(
      (select percentile_cont(0.5) within group (order by o.decimal_odds)
         from op_odds_snapshots o
        where o.fixture_id = s.fixture_id and o.market = s.market and o.selection = s.selection
          and o.is_closing
          and nullif_implausible_odds(o.decimal_odds) is not null)::numeric
    ) as closing_odds
  from settled s
  where not exists (
    select 1 from op_prediction_outcomes existing
    where existing.fixture_external_id = s.fixture_external_id
      and existing.market = s.market
      and existing.selection = s.selection
      and existing.source = 'market-decision-backfill'
  );

  if p_commit then
    insert into op_prediction_outcomes (
      fixture_external_id, sport, market, selection,
      model_probability, implied_probability, value_edge,
      odds, closing_odds, result, settled_at, source, metadata
    )
    select
      c.fixture_external_id, c.fx_sport, c.market, c.selection,
      c.model_probability, c.implied_probability, c.value_edge,
      c.odds, c.closing_odds, c.settlement_status, c.kickoff_at,
      'market-decision-backfill',
      jsonb_build_object(
        'decisionId', c.decision_id,
        'priceSource', c.price_source,
        'settledAtIsKickoff', true,
        'closingOddsMethod', 'median-of-closing-quotes'
      )
    from _outcome_candidates c;
    get diagnostics v_inserted = row_count;
  end if;

  return query
  select
    c.fx_sport::text,
    count(*)::bigint,
    count(c.odds)::bigint,
    count(c.closing_odds)::bigint,
    case when p_commit then count(*)::bigint else 0::bigint end
  from _outcome_candidates c
  group by c.fx_sport
  order by c.fx_sport;
end;
$$;
