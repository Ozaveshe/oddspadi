-- Our interpretation, stored beside the provider's statement rather than over it.
--
-- The obvious move was to add 'due' and 'unresolved' to `op_fixtures.status`.
-- That would have been wrong twice. It overwrites what the provider actually
-- told us with what we inferred — destroying the very evidence the inference
-- was drawn from — and it silently widens a vocabulary that a dozen consumers
-- already switch on, several of which would have fallen through to a default.
--
-- So `status` keeps its meaning: the provider's last word. `lifecycle_state` is
-- ours, derived by `fixtureLifecycle()` from the timestamps, and the two are
-- readable side by side. When they disagree, that disagreement is the finding —
-- a fixture the provider still calls 'scheduled' that we call 'unresolved' is
-- exactly the row an operator wants to see.
--
-- Null means "not yet reconciled", which is honest for history and lets the
-- read path fall back to deriving the state itself.

alter table public.op_fixtures
  add column if not exists lifecycle_state text,
  add column if not exists lifecycle_state_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'op_fixtures_lifecycle_state_check'
  ) then
    alter table public.op_fixtures
      add constraint op_fixtures_lifecycle_state_check
      check (lifecycle_state is null or lifecycle_state = any (array[
        'scheduled','due','live','finished','unresolved',
        'postponed','cancelled','abandoned','suspended'
      ]));
  end if;
end
$$;

comment on column public.op_fixtures.lifecycle_state is
  'Our derived lifecycle state, from fixtureLifecycle(). Distinct from status, which stays the provider''s last word — when the two disagree, that disagreement is the finding.';
comment on column public.op_fixtures.lifecycle_state_at is
  'When lifecycle_state was last reconciled. Null with a non-null state should never occur.';

-- Operators look for exactly one thing here: fixtures we have quarantined.
create index if not exists op_fixtures_lifecycle_state_idx
    on public.op_fixtures (lifecycle_state, kickoff_at desc)
 where lifecycle_state in ('due', 'unresolved');
