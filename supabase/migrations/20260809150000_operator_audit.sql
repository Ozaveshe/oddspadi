-- General operator audit log for destructive admin actions.
--
-- op_settlement_operator_actions already records settlement-operator moves;
-- this is the equivalent for the rest of the destructive class (production
-- model runs, model promotion/rollback, provider disable, destructive
-- migration). Append-only, service-role only, and the actor is a
-- non-reversible fingerprint of the acting token rather than the token itself.

create table if not exists public.op_operator_audit (
  id uuid primary key default gen_random_uuid(),
  actor_fingerprint text not null check (char_length(actor_fingerprint) between 4 and 64),
  action text not null check (char_length(action) between 3 and 80),
  target text check (target is null or char_length(target) <= 200),
  detail jsonb not null default '{}'::jsonb,
  outcome text not null default 'applied' check (outcome in ('applied', 'rejected', 'failed')),
  created_at timestamptz not null default now()
);

create index op_operator_audit_action_idx on public.op_operator_audit (action, created_at desc);

alter table public.op_operator_audit enable row level security;
revoke all on public.op_operator_audit from public, anon, authenticated;
grant select, insert on public.op_operator_audit to service_role;

comment on table public.op_operator_audit is
  'Append-only audit of destructive admin actions. Service-role only; actor is a token fingerprint, never the secret.';
