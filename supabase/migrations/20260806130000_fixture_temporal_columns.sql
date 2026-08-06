-- The four times a fixture lifecycle needs and did not have.
--
-- `op_fixtures` carried exactly one instant that meant anything about the
-- match itself: `kickoff_at`, the scheduled time. Everything else on the table
-- described our own bookkeeping — `created_at`, `updated_at`, `last_synced_at`
-- (when *we* last read the provider, not when the provider last changed).
--
-- That single instant is why expiry is kickoff-relative arithmetic: with no
-- record of when a match actually started or when its result became final,
-- there is nothing else to reason from. A match is called finished because
-- enough hours have passed, which is a guess dressed as a state. These four
-- columns are what let a later change stop guessing.
--
-- Nothing is backfilled with an invention. `provider_kickoff_at` is set to
-- `kickoff_at` because at ingest they were the same value and no reschedule
-- was ever recorded, so that is true rather than assumed. `started_at` and
-- `resulted_at` are left null on history: we genuinely do not know when those
-- matches kicked off or when their scores settled, and writing `updated_at`
-- into them would manufacture evidence. Null means unknown, and the read path
-- must treat it that way.

alter table public.op_fixtures
  add column if not exists provider_kickoff_at timestamptz,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists started_at          timestamptz,
  add column if not exists resulted_at         timestamptz;

comment on column public.op_fixtures.provider_kickoff_at is
  'Kickoff exactly as the provider last stated it. Differs from kickoff_at only when a reschedule was ingested; keeping both makes a reschedule visible instead of silently overwriting the original.';
comment on column public.op_fixtures.provider_updated_at is
  'When the provider says the fixture last changed. Distinct from last_synced_at, which is when we last read it — a sync that returns identical data advances last_synced_at and must not advance this.';
comment on column public.op_fixtures.started_at is
  'When the match was first observed in play. Null means unknown, never "not started" — history predates this column and must not be read as though the match never began.';
comment on column public.op_fixtures.resulted_at is
  'When a final score was first observed. Null means unknown. This is the only honest basis for "finished"; kickoff plus a sport-shaped guess is not.';

-- Backfill only the one value that is knowable in retrospect.
update public.op_fixtures
   set provider_kickoff_at = kickoff_at
 where provider_kickoff_at is null;

-- Reconciliation reads "past kickoff, no result yet" constantly, and that is a
-- small slice of a large table. A partial index keeps it small.
create index if not exists op_fixtures_unresolved_kickoff_idx
    on public.op_fixtures (kickoff_at)
 where resulted_at is null and status in ('scheduled', 'live');

-- Reading a day in the visitor's timezone means range-scanning kickoff_at
-- across an offset boundary, on every board read.
create index if not exists op_fixtures_kickoff_sport_idx
    on public.op_fixtures (kickoff_at, sport);
