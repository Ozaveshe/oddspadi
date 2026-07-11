-- Replayable public shadow-memory drafts for OddsPadi's decision engine.
-- Server-only by default; do not expose to anon/authenticated browser clients.

create table if not exists public.op_shadow_memory_replay (
  id uuid primary key default gen_random_uuid(),
  replay_date date not null,
  sport text not null,
  status text not null check (status in ('ready-replay', 'waiting-proof', 'blocked')),
  replay_bank_hash text not null,
  payload_hash text not null,
  selected_episode_id text,
  episode_count integer not null default 0 check (episode_count >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists op_shadow_memory_replay_date_status_idx
  on public.op_shadow_memory_replay (replay_date desc, status, created_at desc);

create index if not exists op_shadow_memory_replay_hash_idx
  on public.op_shadow_memory_replay (replay_bank_hash, created_at desc);

create index if not exists op_shadow_memory_replay_payload_gin_idx
  on public.op_shadow_memory_replay using gin (payload);

revoke all on public.op_shadow_memory_replay from anon, authenticated;
grant select, insert, update, delete on public.op_shadow_memory_replay to service_role;

alter table public.op_shadow_memory_replay enable row level security;

comment on table public.op_shadow_memory_replay is
  'Server-written public shadow-memory replay drafts for OddsPadi audit and learning review. Keeps hidden chain-of-thought out of storage.';

comment on column public.op_shadow_memory_replay.payload is
  'Public replay payload with proof hashes, episode summaries, blockers, and controls; never store hidden chain-of-thought.';
