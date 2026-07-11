create table if not exists public.op_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_run_id uuid references public.op_decision_runs(id) on delete set null,
  fixture_external_id text not null,
  sport text not null,
  market text not null,
  selection text not null,
  model_probability numeric(8, 6),
  implied_probability numeric(8, 6),
  value_edge numeric(8, 6),
  odds numeric(10, 4),
  closing_odds numeric(10, 4),
  result text not null check (result in ('pending', 'won', 'lost', 'push', 'void')),
  settled_at timestamptz,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.op_calibration_runs (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  model_key text,
  engine_version text not null,
  window_start timestamptz,
  window_end timestamptz,
  sample_size integer not null default 0,
  settled_size integer not null default 0,
  win_rate numeric(8, 6),
  brier_score numeric(8, 6),
  average_edge numeric(8, 6),
  average_closing_line_value numeric(8, 6),
  roi_units numeric(12, 6),
  calibration_by_confidence jsonb not null default '{}'::jsonb,
  calibration_by_health jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists op_prediction_outcomes_fixture_idx
  on public.op_prediction_outcomes (fixture_external_id, created_at desc);

create index if not exists op_prediction_outcomes_result_idx
  on public.op_prediction_outcomes (result, settled_at desc);

create index if not exists op_prediction_outcomes_run_idx
  on public.op_prediction_outcomes (decision_run_id);

create index if not exists op_calibration_runs_sport_created_idx
  on public.op_calibration_runs (sport, created_at desc);

revoke all on
  public.op_prediction_outcomes,
  public.op_calibration_runs
from anon, authenticated;

grant select, insert, update, delete on
  public.op_prediction_outcomes,
  public.op_calibration_runs
to service_role;

alter table public.op_prediction_outcomes enable row level security;
alter table public.op_calibration_runs enable row level security;

comment on table public.op_prediction_outcomes is
  'Settled outcomes for stored OddsPadi decision runs. Used for backtesting, calibration, CLV, and learning-loop evaluation.';

comment on table public.op_calibration_runs is
  'Aggregated model and agent calibration runs computed from settled outcomes and historical decision runs.';
