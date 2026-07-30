-- Project settled market decisions into op_prediction_outcomes.
--
-- Settlement and promotion read different tables. `ops:settle` writes
-- `op_market_decisions.settlement_status`, but the calibration candidate that
-- gates promotion is built by `decisionCalibration` from
-- `op_prediction_outcomes` — it needs `odds` and `closing_odds`, which the
-- decisions table does not carry. So settling 10k decisions moved the promotion
-- gate not at all: as of 2026-07-29 that table held 19 settled football rows
-- against 2,296 settled football decisions.
--
-- Price provenance is recorded rather than assumed:
--   * `decision-snapshot`  the decision carried `odds_snapshot_id`, so this is
--                          the price the call was actually struck at.
--   * `reconstructed`      the decision predates the fix that made
--                          `odds_snapshot_id` land (a timestamp-format mismatch
--                          meant it was always null), so the price is the last
--                          pre-match quote at or before `generated_at`. That is
--                          an inference, not a record, and is labelled as one in
--                          metadata so calibration can exclude it if wanted.
--
-- `closing_odds` is the median across closing quotes for the selection
-- (averaging 1.13 rows, max 5), which is the consensus close rather than the
-- best available price — using the best would flatter closing-line value.
--
-- `settled_at` uses the fixture kickoff. Nothing stores a match end time, and a
-- kickoff is the honest lower bound; it is not presented as the settlement
-- instant anywhere that matters.
--
-- Implausible prices are dropped to null rather than carried. Seven settled
-- football decisions were struck against feed sentinels — 1001.00, 1000.00,
-- 201.00 — and four of them alone dragged average closing-line value to +4.35,
-- a 435% edge, which would have satisfied the `averageCLV > 0` promotion gate
-- on nothing but garbage. The probability record is kept (Brier and ECE read
-- `model_probability`, not price) while `odds` goes null so closing-line value
-- ignores the row. `1 / 100` is the bound: a genuine 1X2 quote does not imply
-- under a 1% chance, and the repo enforces only `> 1` anywhere else.

-- A tradeable decimal price. Anything at or below evens, or implying under a
-- 1% chance, is a feed sentinel rather than a quote anyone could have taken.
create or replace function public.nullif_implausible_odds(p_odds numeric)
returns numeric
language sql
immutable
-- Pinned even though this touches no tables: an unset search_path trips the
-- Supabase security linter (0011_function_search_path_mutable).
set search_path = ''
as $$
  select case when p_odds is null or p_odds <= 1 or p_odds > 100 then null else p_odds end;
$$;

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
    -- Every candidate is written, including one whose price was dropped: the
    -- probability record is what Brier and ECE need, and discarding it because
    -- the feed returned a sentinel would quietly shrink the settled sample.
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

comment on function public.op_backfill_prediction_outcomes is
  'Projects settled op_market_decisions into op_prediction_outcomes with struck and closing prices. Dry run unless p_commit. Idempotent on (fixture_external_id, market, selection, source).';

revoke all on function public.op_backfill_prediction_outcomes(timestamptz, boolean) from public, anon, authenticated;
