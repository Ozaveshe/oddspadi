alter table public.op_decision_runs
  add column if not exists context_adjustment jsonb not null default '{}'::jsonb;

comment on column public.op_decision_runs.context_adjustment is
  'Structured context signal snapshot applied before value-edge ranking, including bounded probability shifts, risk flags, and remaining missing signals.';

create index if not exists op_decision_runs_context_adjustment_gin_idx
  on public.op_decision_runs using gin (context_adjustment);
