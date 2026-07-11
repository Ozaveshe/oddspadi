-- OddsPadi decision-engine persistence foundation.
-- Apply only to the OddsPadi Supabase project, not AfroTools or LATMtools.

create table if not exists public.op_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique,
  sport text not null,
  model_type text not null,
  version_label text not null,
  description text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.op_decision_runs (
  id uuid primary key default gen_random_uuid(),
  fixture_external_id text not null,
  sport text not null,
  engine_version text not null,
  model_key text,
  verdict text not null check (verdict in ('strong-value', 'lean-value', 'watchlist', 'avoid', 'insufficient-data')),
  action text not null check (action in ('consider', 'monitor', 'avoid')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  decision_score integer not null default 0,
  recommended_selection text,
  summary text not null,
  factors jsonb not null default '[]'::jsonb,
  sensitivity_checks jsonb not null default '[]'::jsonb,
  public_reasoning_steps jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  avoid_reasons jsonb not null default '[]'::jsonb,
  safer_alternatives jsonb not null default '[]'::jsonb,
  missing_signals jsonb not null default '[]'::jsonb,
  next_checks jsonb not null default '[]'::jsonb,
  model_snapshot jsonb not null default '{}'::jsonb,
  odds_snapshot jsonb not null default '{}'::jsonb,
  input_hash text,
  llm_enhanced boolean not null default false,
  llm_model text,
  llm_status text,
  llm_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.op_provider_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  sport text not null,
  ingestion_type text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  rows_received integer not null default 0,
  rows_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.op_raw_provider_payloads (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid references public.op_provider_ingestion_runs(id) on delete set null,
  provider text not null,
  sport text not null,
  payload_type text not null,
  external_id text,
  source_url text,
  payload jsonb not null,
  payload_hash text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists op_decision_runs_fixture_created_idx
  on public.op_decision_runs (fixture_external_id, created_at desc);

create index if not exists op_decision_runs_verdict_created_idx
  on public.op_decision_runs (verdict, created_at desc);

create index if not exists op_provider_ingestion_runs_status_idx
  on public.op_provider_ingestion_runs (status, created_at desc);

create index if not exists op_raw_provider_payloads_external_idx
  on public.op_raw_provider_payloads (provider, payload_type, external_id);

-- New Supabase projects require deliberate Data API grants. These MVP audit
-- tables stay server-only; Next.js API routes should write with service role.
revoke all on
  public.op_model_versions,
  public.op_decision_runs,
  public.op_provider_ingestion_runs,
  public.op_raw_provider_payloads
from anon, authenticated;

grant select, insert, update, delete on
  public.op_model_versions,
  public.op_decision_runs,
  public.op_provider_ingestion_runs,
  public.op_raw_provider_payloads
to service_role;

alter table public.op_model_versions enable row level security;
alter table public.op_decision_runs enable row level security;
alter table public.op_provider_ingestion_runs enable row level security;
alter table public.op_raw_provider_payloads enable row level security;

comment on table public.op_decision_runs is
  'Server-written OddsPadi decision engine outputs. Keep RLS enabled; expose through API routes after policies are designed.';

comment on table public.op_raw_provider_payloads is
  'Raw provider payload archive for audit and training-data reconstruction. Consider object storage for large historical payloads.';
