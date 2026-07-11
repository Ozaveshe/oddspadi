-- Server-only decision briefing ledger for OddsPadi.
-- Apply only to the OddsPadi Supabase project, not AfroTools or LATMtools.

create table if not exists public.op_decision_briefings (
  id uuid primary key default gen_random_uuid(),
  briefing_date date not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  briefing_hash text not null unique,
  status text not null check (status in ('ready-watchlist', 'needs-review', 'blocked', 'no-candidates')),
  posture text not null check (posture in ('monitor-only', 'avoid', 'hold')),
  action text not null check (action in ('consider', 'monitor', 'avoid', 'hold')),
  target_match_id text,
  target_match text,
  target_league text,
  target_selection text,
  model_probability numeric(8, 6),
  market_probability numeric(8, 6),
  posterior_probability numeric(8, 6),
  value_edge numeric(8, 6),
  expected_value numeric(8, 6),
  headline text not null,
  thesis text not null,
  counter_thesis text not null,
  decision text not null,
  risks jsonb not null default '[]'::jsonb,
  safer_alternatives jsonb not null default '[]'::jsonb,
  next_evidence jsonb not null default '[]'::jsonb,
  proof_chain jsonb not null default '[]'::jsonb,
  proof_urls jsonb not null default '[]'::jsonb,
  locks jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists op_decision_briefings_date_status_idx
  on public.op_decision_briefings (briefing_date desc, status, created_at desc);

create index if not exists op_decision_briefings_target_idx
  on public.op_decision_briefings (target_match_id, created_at desc)
  where target_match_id is not null;

create index if not exists op_decision_briefings_payload_gin_idx
  on public.op_decision_briefings using gin (payload);

revoke all on public.op_decision_briefings from anon, authenticated;
grant select, insert, update, delete on public.op_decision_briefings to service_role;

alter table public.op_decision_briefings enable row level security;

comment on table public.op_decision_briefings is
  'Server-only OddsPadi decision briefing ledger. Stores final operator-facing proof summaries for audit and later calibration; expose only through guarded API routes.';

comment on column public.op_decision_briefings.payload is
  'Full decision briefing receipt. Do not store provider secrets, service keys, payment data, identity documents, or unbounded raw provider payloads here.';
