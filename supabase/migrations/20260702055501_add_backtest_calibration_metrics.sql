-- Store calibration diagnostics from historical backtests.
-- These columns let the decision engine ask whether predicted probabilities
-- were empirically reliable, not merely profitable in a thin sample.

alter table public.op_backtest_runs
  add column if not exists calibration_error numeric(10, 6),
  add column if not exists calibration_buckets jsonb not null default '[]'::jsonb;

comment on column public.op_backtest_runs.calibration_error is
  'Expected calibration error across probability buckets for the holdout forecast set.';

comment on column public.op_backtest_runs.calibration_buckets is
  'Probability-bucket reliability table: average forecast probability, observed rate, bucket Brier score, and sample size.';
