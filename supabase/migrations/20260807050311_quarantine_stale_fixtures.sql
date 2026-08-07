-- The stale sweep stops forging a provider statement.
--
-- `op_expire_stale_fixtures` wrote `status = 'abandoned'` on any scheduled or
-- live fixture past kickoff plus its sport's window. Its own comment admitted
-- the defect in plain words: *in most of these cases the match did finish and
-- we simply never received the result.*
--
-- `abandoned` is not a description of our knowledge. It is a claim that the
-- match was called off, and `op_fixtures.status` is the column that holds what
-- the provider told us. Writing an inference there destroyed the evidence the
-- inference was drawn from — and then settlement read it back as fact and
-- graded 50 published picks `void` on matches that were played.
--
-- `lifecycle_state = 'unresolved'` is the right column and the right word:
-- "past its plausible window with no evidence either way". It is deliberately
-- **not** terminal, so a result arriving tomorrow still grades the pick
-- honestly instead of finding the fixture already written off.
--
-- What does not change:
--
--   * the per-sport windows, which `temporal-lifecycle.test.ts` holds equal to
--     the TypeScript copy in `fixtureState.ts` (they are stated once here now,
--     rather than twice, so the two copies of the policy cannot drift inside a
--     single function either);
--   * `metadata.expiredReason` / `expiredAt` / `statusBeforeExpiry`, which are
--     a good audit trail and now say what happened without also claiming it;
--   * a provider-stated cancellation or abandonment, which never came through
--     this function and still settles void.
--
-- What is added: every quarantine call appends to
-- `op_fixture_lifecycle_transitions`, so the sweep is as auditable as the
-- reconciler that shares its rules. The run id groups a batch, so a bad batch
-- is identifiable as a batch.
--
-- The return column is renamed `expired` -> `quarantined` because that is what
-- the number now counts. Renaming an OUT column needs a drop and recreate;
-- nothing but the function definition is dropped.

drop function if exists public.op_expire_stale_fixtures(boolean);

create function public.op_expire_stale_fixtures(
  p_commit boolean default false
)
returns table (sport text, quarantined integer, oldest_hours numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  -- One id per invocation, stamped on every row this run quarantines.
  v_run uuid := gen_random_uuid();
begin
  return query
  with candidates as (
    -- Windows are measured from kickoff, per sport, deliberately. A calendar
    -- cutoff ("clear yesterday at midnight") would write off a match that
    -- started at 23:00 and is still being played at 00:30, and a best-of-five
    -- tennis match starting at 22:00 can still be running at 02:00.
    --
    --   football     2h00 play  + 2h grace  = 4h00
    --   basketball   2h30 play  + 2h grace  = 4h30
    --   tennis       5h00 play  + 3h grace  = 8h00
    --   anything else                       = 6h00
    select f.id,
           f.sport as fixture_sport,
           f.kickoff_at,
           coalesce(f.lifecycle_state, 'unreconciled') as from_state,
           case f.sport
             when 'football'   then interval '4 hours'
             when 'basketball' then interval '4 hours 30 minutes'
             when 'tennis'     then interval '8 hours'
             else interval '6 hours'
           end as play_window
      from public.op_fixtures f
     where f.status in ('scheduled', 'live')
       -- Already quarantined is not news. Skipping it keeps the reported count
       -- a delta rather than a standing total, and keeps the audit table from
       -- gaining an identical row every time the cron fires.
       and coalesce(f.lifecycle_state, '') is distinct from 'unresolved'
       and f.kickoff_at < v_now
  ),
  stale as (
    select c.* from candidates c where c.kickoff_at < v_now - c.play_window
  ),
  -- A data-modifying CTE always executes, referenced or not, so the commit
  -- flag has to gate it from the inside rather than by skipping the branch.
  --
  -- The audit row goes in before the state change, matching `reconcile.ts`: a
  -- claimed transition that did not happen is noisy but detectable, whereas a
  -- silent state change with no record is the failure this table exists to
  -- prevent.
  audited as (
    insert into public.op_fixture_lifecycle_transitions
      (fixture_id, from_state, to_state, basis, overdue_hours, run_id)
    select s.id,
           s.from_state,
           'unresolved',
           'no-evidence',
           round((extract(epoch from (v_now - s.kickoff_at - s.play_window)) / 3600)::numeric, 1),
           v_run
      from stale s
     where p_commit
    returning fixture_id
  ),
  updated as (
    update public.op_fixtures t
       -- `status` is untouched on purpose. It stays the provider's last word,
       -- and when it disagrees with our reading that disagreement is the
       -- finding an operator wants to see.
       set lifecycle_state = 'unresolved',
           lifecycle_state_at = v_now,
           updated_at = v_now,
           metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
             'expiredReason', 'no-provider-result',
             'expiredAt', to_jsonb(v_now),
             'statusBeforeExpiry', to_jsonb(t.status)
           )
      from stale s
     where t.id = s.id
       and p_commit
    returning t.id
  )
  select s.fixture_sport,
         count(*)::integer,
         round(max(extract(epoch from (v_now - s.kickoff_at)) / 3600)::numeric, 1)
    from stale s
   group by s.fixture_sport
   order by count(*) desc;
end;
$$;

comment on function public.op_expire_stale_fixtures is
  'Quarantines fixtures as lifecycle_state=unresolved when kickoff plus the sport''s realistic duration and grace has passed with no provider update. Never writes op_fixtures.status: an inference must not be recorded as a provider statement. Dry run unless p_commit. Never touches a fixture that could still be in play.';

revoke all on function public.op_expire_stale_fixtures(boolean) from public, anon, authenticated;
