-- An audit trail for every lifecycle correction.
--
-- The previous sweep wrote `metadata.expiredReason` onto the fixture and moved
-- on. That is a fact about the current row, not a record of what happened, so
-- the second correction overwrote the first and there was no way to answer "how
-- often are we writing matches off that the provider later resolved?" — which
-- is exactly the question that tells you whether the windows are right.
--
-- Append-only, and it holds the reason and both states, so a wrong call is
-- visible rather than merely undone.

create table if not exists public.op_fixture_lifecycle_transitions (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    uuid not null references public.op_fixtures(id) on delete cascade,
  from_state    text not null,
  to_state      text not null,
  basis         text not null,
  overdue_hours numeric,
  -- Which run made the call, so a bad batch can be identified as a batch.
  run_id        uuid,
  occurred_at   timestamptz not null default now(),
  constraint op_fixture_lifecycle_transitions_states_differ check (from_state is distinct from to_state)
);

comment on table public.op_fixture_lifecycle_transitions is
  'Append-only record of fixture lifecycle corrections. Evidence of what reconciliation decided and why, kept so a wrong call is visible rather than silently undone.';

create index if not exists op_fixture_lifecycle_transitions_fixture_idx
  on public.op_fixture_lifecycle_transitions (fixture_id, occurred_at desc);
create index if not exists op_fixture_lifecycle_transitions_occurred_idx
  on public.op_fixture_lifecycle_transitions (occurred_at desc);

alter table public.op_fixture_lifecycle_transitions enable row level security;

-- Operator information: it exposes how often our own inference is wrong.
-- Readable by the service role only, which is what the reconciler runs as.
drop policy if exists op_fixture_lifecycle_transitions_no_public_read
  on public.op_fixture_lifecycle_transitions;
create policy op_fixture_lifecycle_transitions_no_public_read
  on public.op_fixture_lifecycle_transitions
  for select to anon, authenticated using (false);
