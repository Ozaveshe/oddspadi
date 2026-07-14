-- One canonical public decision per fixture and engine run.
-- Market rows remain the audit ledger; public surfaces read this aggregate.

create table if not exists public.op_fixture_decision_summaries (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.op_fixtures(id) on delete cascade,
  fixture_external_id text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  best_published_pick jsonb,
  best_lean jsonb,
  best_watchlist_candidate jsonb,
  no_pick_reason text,
  all_market_analyses jsonb not null default '[]'::jsonb,
  public_status text not null check (public_status in (
    'value_pick', 'lean', 'watchlist', 'no_clear_value', 'needs_data', 'stale', 'suspended'
  )),
  engine_status text not null check (engine_status in (
    'published', 'lean', 'watch', 'no-pick', 'needs-data', 'stale', 'suspended'
  )),
  data_quality numeric not null check (data_quality >= 0 and data_quality <= 1),
  evidence_quality text not null check (evidence_quality in ('strong', 'acceptable', 'thin', 'missing')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  audit_summary jsonb not null,
  superseded_by uuid references public.op_fixture_decision_summaries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint op_fixture_decision_summaries_analysis_array
    check (jsonb_typeof(all_market_analyses) = 'array'),
  constraint op_fixture_decision_summaries_audit_object
    check (jsonb_typeof(audit_summary) = 'object'),
  constraint op_fixture_decision_summaries_value_invariant
    check (public_status <> 'value_pick' or best_published_pick is not null)
);

create index if not exists op_fixture_decision_summaries_fixture_generated_idx
  on public.op_fixture_decision_summaries (fixture_id, generated_at desc);

create index if not exists op_fixture_decision_summaries_current_public_idx
  on public.op_fixture_decision_summaries (public_status, generated_at desc)
  where superseded_by is null;

comment on table public.op_fixture_decision_summaries is
  'Canonical fixture-level DecisionSummary used by every OddsPadi public prediction surface. Debug and agent reports cannot override it.';

revoke all on public.op_fixture_decision_summaries from public, anon, authenticated;
grant select, insert, update, delete on public.op_fixture_decision_summaries to service_role;

alter table public.op_fixture_decision_summaries enable row level security;
