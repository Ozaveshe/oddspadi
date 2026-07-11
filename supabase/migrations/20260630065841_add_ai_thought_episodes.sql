-- Private AI thought-episode ledger for OddsPadi.
-- Apply only to the OddsPadi Supabase project, not AfroTools or LATMtools.

create table if not exists public.op_ai_thought_episodes (
  id uuid primary key default gen_random_uuid(),
  episode_date date not null,
  sport text not null,
  thought_hash text not null unique,
  control_hash text not null,
  operator_episode_hash text not null,
  status text not null check (status in ('recordable', 'held', 'blocked', 'stored')),
  active_match_id text,
  active_match text,
  public_action text not null,
  public_posture text not null,
  next_move_label text not null,
  next_move_run_mode text not null check (next_move_run_mode in ('read-only', 'dry-run', 'manual-only')),
  can_run_command boolean not null default false,
  can_publish boolean not null default false,
  can_train boolean not null default false,
  stage_counts jsonb not null default '{}'::jsonb,
  thought_chain jsonb not null default '[]'::jsonb,
  replay_commands jsonb not null default '[]'::jsonb,
  proof_urls jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists op_ai_thought_episodes_date_status_idx
  on public.op_ai_thought_episodes (episode_date desc, status, created_at desc);

create index if not exists op_ai_thought_episodes_control_hash_idx
  on public.op_ai_thought_episodes (control_hash, created_at desc);

create index if not exists op_ai_thought_episodes_payload_gin_idx
  on public.op_ai_thought_episodes using gin (payload);

revoke all on public.op_ai_thought_episodes from anon, authenticated;
grant select, insert, update, delete on public.op_ai_thought_episodes to service_role;

alter table public.op_ai_thought_episodes enable row level security;

comment on table public.op_ai_thought_episodes is
  'Server-only OddsPadi AI control and operator episode snapshots for private audit, replay, and later calibration review. Keep RLS enabled and expose only through guarded API routes.';

comment on column public.op_ai_thought_episodes.payload is
  'Compact private thought payload. Do not store raw provider secrets, raw user identifiers, payment data, or unbounded provider payloads here.';
