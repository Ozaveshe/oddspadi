-- Canonical daily sports intelligence persistence.
-- Server-written only: public product reads continue through audited Next.js routes.
-- Remote migration version: 20260713191454.

alter table public.op_fixtures
  add column if not exists provider_fixture_id text,
  add column if not exists league_name text,
  add column if not exists home_team_name text,
  add column if not exists away_team_name text,
  add column if not exists last_synced_at timestamptz not null default now();

alter table public.op_odds_snapshots
  add column if not exists fixture_id uuid references public.op_fixtures(id) on delete cascade,
  add column if not exists captured_at timestamptz,
  add column if not exists source text,
  add column if not exists is_live boolean not null default false,
  add column if not exists expires_at timestamptz;

update public.op_odds_snapshots
set
  captured_at = coalesce(captured_at, observed_at, created_at),
  source = coalesce(nullif(source, ''), provider),
  expires_at = coalesce(expires_at, observed_at + interval '30 minutes')
where captured_at is null or source is null or expires_at is null;

alter table public.op_odds_snapshots
  alter column captured_at set default now(),
  alter column captured_at set not null,
  alter column source set default 'unknown',
  alter column source set not null;

create table if not exists public.op_market_decisions (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.op_fixtures(id) on delete cascade,
  fixture_external_id text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  market text not null,
  selection text not null,
  odds_snapshot_id uuid references public.op_odds_snapshots(id) on delete set null,
  model_version text not null,
  engine_version text not null,
  model_probability numeric,
  implied_probability numeric,
  no_vig_probability numeric,
  value_edge numeric,
  expected_value numeric,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  data_quality numeric not null,
  evidence_quality text not null check (evidence_quality in ('strong', 'acceptable', 'thin', 'missing')),
  decision_status text not null check (decision_status in (
    'published_value_pick', 'published_lean', 'watchlist', 'avoid', 'needs_data',
    'stale', 'suspended', 'settled', 'void'
  )),
  public_status text not null check (public_status in (
    'value_pick', 'lean', 'watchlist', 'no_clear_value', 'preliminary', 'ready',
    'stale', 'settled', 'needs_review'
  )),
  reason text not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  superseded_by uuid references public.op_market_decisions(id) on delete set null,
  settlement_status text not null default 'pending' check (settlement_status in (
    'pending', 'won', 'lost', 'push', 'void', 'needs_review'
  )),
  is_preliminary boolean not null default false,
  provider text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.op_provider_ingestion_runs
  add column if not exists job_type text,
  add column if not exists finished_at timestamptz,
  add column if not exists fixtures_found integer not null default 0,
  add column if not exists odds_found integer not null default 0,
  add column if not exists predictions_generated integer not null default 0,
  add column if not exists value_picks_published integer not null default 0,
  add column if not exists errors jsonb not null default '[]'::jsonb;

update public.op_provider_ingestion_runs
set
  job_type = coalesce(nullif(job_type, ''), ingestion_type),
  finished_at = coalesce(finished_at, completed_at)
where job_type is null or finished_at is null;

alter table public.op_provider_ingestion_runs
  alter column job_type set default 'provider_sync';

create index if not exists op_fixtures_window_sync_idx
  on public.op_fixtures (kickoff_at, last_synced_at desc);

create index if not exists op_odds_snapshots_fixture_captured_idx
  on public.op_odds_snapshots (fixture_id, market, selection, captured_at desc);

create index if not exists op_market_decisions_fixture_generated_idx
  on public.op_market_decisions (fixture_id, generated_at desc);

create index if not exists op_market_decisions_public_window_idx
  on public.op_market_decisions (public_status, generated_at desc)
  where superseded_by is null;

create index if not exists op_provider_ingestion_runs_job_created_idx
  on public.op_provider_ingestion_runs (job_type, created_at desc);

comment on table public.op_market_decisions is
  'Canonical market-level OddsPadi decisions. Superseded rows remain for audit; public reads use current rows through server routes.';

revoke all on public.op_market_decisions from public, anon, authenticated;
grant select, insert, update, delete on public.op_market_decisions to service_role;

grant select, insert, update, delete on
  public.op_fixtures,
  public.op_odds_snapshots,
  public.op_provider_ingestion_runs
to service_role;

alter table public.op_market_decisions enable row level security;
