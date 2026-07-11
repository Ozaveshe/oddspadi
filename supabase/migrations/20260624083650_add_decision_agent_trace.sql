alter table public.op_decision_runs
  add column if not exists health text not null default 'review'
    check (health in ('stable', 'review', 'fragile')),
  add column if not exists calibration jsonb not null default '{}'::jsonb,
  add column if not exists agent_stages jsonb not null default '[]'::jsonb,
  add column if not exists contradiction_checks jsonb not null default '[]'::jsonb,
  add column if not exists scenario_matrix jsonb not null default '[]'::jsonb,
  add column if not exists abstention_rules jsonb not null default '[]'::jsonb;

create index if not exists op_decision_runs_health_created_idx
  on public.op_decision_runs (health, created_at desc);

comment on column public.op_decision_runs.agent_stages is
  'Structured agent-stage audit trail for the OddsPadi decision engine.';

comment on column public.op_decision_runs.contradiction_checks is
  'Self-critique checks that look for conflicts between model, market, risk, and context.';

comment on column public.op_decision_runs.abstention_rules is
  'Rules that force avoid/abstain behavior when data, edge, or live-state requirements are not met.';
