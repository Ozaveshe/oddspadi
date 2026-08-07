-- Undoing what the sweep wrote, without pretending it never happened.
--
-- 1,841 fixtures carry `status = 'abandoned'` with
-- `metadata.expiredReason = 'no-provider-result'`. Every one of those is the
-- old sweep's inference recorded in the provider's column. 50 of them back a
-- published pick that was then graded `void` — 50 of 134 settled publications,
-- which is 37% of the public record decided by a clock rather than a result.
--
-- The evidence that these matches were played is in the same table. On
-- 2026-08-03 the Toronto WTA 1/64-finals had 17 fixtures finish with a score
-- and one expire; the M25+H Tauste 1/16-finals on 2026-08-04, 13 and one. The
-- provider was answering that day. It just did not answer about that match, and
-- "did not answer" is not "called off".
--
-- This is written as a function, not as DML in the migration body, for three
-- reasons: it can be previewed (`p_commit => false` reports and writes
-- nothing), it is idempotent (a second run finds nothing left to repair), and
-- an operator can re-run it if the sweep is ever pointed at production again
-- before this branch ships.
--
-- What it does not do: invent a result, invent a timestamp, or delete a row.
-- The fixtures return to the provider status they held before the sweep touched
-- them (`metadata.statusBeforeExpiry`, which the sweep recorded and which is
-- the only reason this is repairable at all), and gain
-- `lifecycle_state = 'unresolved'` — our reading, in our column, saying we do
-- not know. `metadata.expiredReason` is left in place: the fact that we once
-- wrote the match off is part of the record now.

create or replace function public.op_repair_inference_expired_fixtures(
  p_commit boolean default false
)
returns table (scope text, affected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_run uuid := gen_random_uuid();
  v_fixtures uuid[];
  v_publications uuid[];
  v_publication uuid;
  v_reason constant text :=
    'Settled void on inference, not evidence: the stale-fixture sweep wrote status=abandoned because no provider result had arrived, and settlement read that as the match having been called off. The match was played. The verdict is withdrawn and the claim returns to unsettled so a real result can grade it.';
begin
  -- Only rows the sweep forged. A provider-stated abandonment carries no
  -- `expiredReason`, and must keep its status and its void settlement.
  select coalesce(array_agg(f.id), '{}'::uuid[])
    into v_fixtures
    from public.op_fixtures f
   where f.status = 'abandoned'
     and f.metadata ->> 'expiredReason' = 'no-provider-result'
     and f.metadata ->> 'statusBeforeExpiry' is not null;

  -- Captured before anything moves, and narrowed to verdicts that actually
  -- rest on the forged status: the settlement job records the fixture status it
  -- graded against, so a void reached any other way is left alone.
  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_publications
    from public.op_publications p
    join public.op_publication_settlements s
      on s.publication_id = p.id and s.is_current
   where p.settlement_status = 'void'
     and p.publication_status <> 'retracted'
     and s.resolution_basis ->> 'fixtureStatus' = 'abandoned'
     and p.fixture_id = any (v_fixtures);

  scope := 'fixtures';
  affected := coalesce(array_length(v_fixtures, 1), 0);
  return next;
  scope := 'publications';
  affected := coalesce(array_length(v_publications, 1), 0);
  return next;

  if not p_commit then
    return;
  end if;

  -- Audit first, same as the reconciler and for the same reason.
  insert into public.op_fixture_lifecycle_transitions
    (fixture_id, from_state, to_state, basis, overdue_hours, run_id)
  select f.id,
         coalesce(f.lifecycle_state, 'abandoned'),
         'unresolved',
         'no-evidence',
         round((extract(epoch from (
           v_now - f.kickoff_at - case f.sport
             when 'football'   then interval '4 hours'
             when 'basketball' then interval '4 hours 30 minutes'
             when 'tennis'     then interval '8 hours'
             else interval '6 hours'
           end)) / 3600)::numeric, 1),
         v_run
    from public.op_fixtures f
   where f.id = any (v_fixtures)
     and coalesce(f.lifecycle_state, 'abandoned') is distinct from 'unresolved';

  update public.op_fixtures f
     set status = f.metadata ->> 'statusBeforeExpiry',
         lifecycle_state = 'unresolved',
         lifecycle_state_at = v_now,
         updated_at = v_now,
         metadata = f.metadata || jsonb_build_object(
           -- The sweep's own record stays; this says what we did about it.
           'quarantineRepairedAt', to_jsonb(v_now),
           'quarantineRepairedFrom', to_jsonb('abandoned'::text),
           'quarantineRepairRunId', to_jsonb(v_run)
         )
   where f.id = any (v_fixtures);

  foreach v_publication in array v_publications loop
    perform public.op_unsettle_publication(v_publication, v_reason);
  end loop;

  return;
end;
$$;

comment on function public.op_repair_inference_expired_fixtures is
  'Repairs fixtures the stale sweep marked abandoned on inference: restores the provider status it overwrote, records lifecycle_state=unresolved with a transition row, and withdraws every publication verdict that rested on the forged status. Preview unless p_commit. Idempotent.';

revoke all on function public.op_repair_inference_expired_fixtures(boolean) from public, anon, authenticated;
