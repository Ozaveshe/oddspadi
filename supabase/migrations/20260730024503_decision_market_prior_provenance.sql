-- Record how much of the priced market each decision actually holds.
--
-- A decision stores `no_vig_probability` whether or not the model ever saw it:
-- the prediction is built from `match.oddsMarkets`, while the market price is
-- read from snapshots the pipeline merges separately. So nothing stored could
-- distinguish
--
--   "the model looked at the price and disagreed"
--
-- from
--
--   "the model never saw a price at all"
--
-- and both look identical in the calibration report. That is how tennis ran at
-- corr(model, market) 0.078 while every tennis decision recorded a market
-- probability, and it took a correlation diagnostic and a provider-level
-- investigation to notice. With these columns it is one query.
--
-- `null` is not the same as `0`: null means the pipeline reported no market prior
-- adjustment for the run at all, while 0 means the blend ran and found no priced
-- market for that specific market to anchor to.

alter table op_market_decisions
  add column if not exists market_prior_weight numeric,
  add column if not exists market_prior_applied boolean;

comment on column op_market_decisions.market_prior_weight is
  'Share of the priced market held by this probability (0-0.9). Null when the pipeline reported no market prior adjustment; 0 when the blend ran but no priced market matched.';
comment on column op_market_decisions.market_prior_applied is
  'True when a priced market was blended into this probability. Null when the pipeline reported no adjustment.';

-- Segmenting calibration by whether the anchor applied is the point of the
-- columns, so index the flag alongside the settlement status the report filters on.
create index if not exists op_market_decisions_market_prior_applied_idx
  on op_market_decisions (sport, market_prior_applied, settlement_status)
  where superseded_by is null;
