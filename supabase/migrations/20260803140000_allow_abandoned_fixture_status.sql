-- `abandoned` was added to the TypeScript fixture-status union and to the
-- settlement grader, but never to the database. The check constraint still
-- listed six statuses, so op_expire_stale_fixtures failed on its first commit:
--
--   new row for relation "op_fixtures" violates check constraint
--   "op_fixtures_status_check"
--
-- The constraint was right to fail. It is the only place that knew the two
-- halves disagreed.
--
-- `abandoned` is distinct from `cancelled`: cancelled means the match never
-- started, abandoned means it started and did not produce a usable result.
-- Both settle as void, but they are different facts and the settlement grader
-- already branches on them separately.

alter table public.op_fixtures
  drop constraint if exists op_fixtures_status_check;

alter table public.op_fixtures
  add constraint op_fixtures_status_check
  check (status = any (array[
    'scheduled'::text,
    'live'::text,
    'finished'::text,
    'postponed'::text,
    'cancelled'::text,
    'abandoned'::text,
    'suspended'::text
  ]));
