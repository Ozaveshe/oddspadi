-- Write a canonical result revision.
--
-- Retiring the current row and inserting the new one must be one statement's
-- worth of atomicity. Done as two round trips from the application, a failure
-- between them leaves a fixture with no current result at all — and the partial
-- unique index means the *next* run would happily insert one, so the gap would
-- close silently and nobody would learn the write had been half-applied.
--
-- Idempotent in the way that matters: a call whose material fields match the
-- current row writes nothing and returns it. A retried sweep therefore cannot
-- inflate the revision counter, which would otherwise make an unchanged result
-- look like a series of provider corrections.

create or replace function public.op_record_fixture_result(
  p_fixture_id uuid,
  p_result jsonb,
  p_correction_reason text default null
)
returns public.op_fixture_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.op_fixture_results;
  v_next public.op_fixture_results;
  v_revision integer := 1;
begin
  select * into v_current
  from public.op_fixture_results
  where fixture_id = p_fixture_id and is_current
  for update;

  if found then
    -- Unchanged in every field settlement can read, and unchanged in how much
    -- we believe it. Anything else is a revision.
    if v_current.result_status is not distinct from (p_result ->> 'result_status')
      and v_current.regulation_home is not distinct from (p_result ->> 'regulation_home')::smallint
      and v_current.regulation_away is not distinct from (p_result ->> 'regulation_away')::smallint
      and v_current.extra_time_home is not distinct from (p_result ->> 'extra_time_home')::smallint
      and v_current.extra_time_away is not distinct from (p_result ->> 'extra_time_away')::smallint
      and v_current.shootout_home is not distinct from (p_result ->> 'shootout_home')::smallint
      and v_current.shootout_away is not distinct from (p_result ->> 'shootout_away')::smallint
      and v_current.sets_home is not distinct from (p_result ->> 'sets_home')::smallint
      and v_current.sets_away is not distinct from (p_result ->> 'sets_away')::smallint
      and v_current.games_home is not distinct from (p_result ->> 'games_home')::smallint
      and v_current.games_away is not distinct from (p_result ->> 'games_away')::smallint
      and v_current.winner is not distinct from (p_result ->> 'winner')
      and v_current.verification_state is not distinct from (p_result ->> 'verification_state')
    then
      return v_current;
    end if;

    v_revision := v_current.revision + 1;

    -- A revision must explain itself; the check constraint enforces it, and
    -- defaulting here rather than failing keeps a caller that forgot from
    -- blocking a real correction.
    if p_correction_reason is null then
      p_correction_reason := 'Result revised without a stated reason.';
    end if;
  end if;

  insert into public.op_fixture_results (
    fixture_id, sport, result_status,
    regulation_home, regulation_away, extra_time_home, extra_time_away,
    shootout_home, shootout_away, sets_home, sets_away, games_home, games_away,
    period_scores, winner, winner_basis, final_at,
    primary_provider, primary_receipt_id, secondary_provider, secondary_receipt_id,
    observation_count, first_observed_at, last_observed_at,
    verification_state, verified_at, verified_by,
    revision, is_current, correction_reason
  ) values (
    p_fixture_id,
    p_result ->> 'sport',
    p_result ->> 'result_status',
    (p_result ->> 'regulation_home')::smallint,
    (p_result ->> 'regulation_away')::smallint,
    (p_result ->> 'extra_time_home')::smallint,
    (p_result ->> 'extra_time_away')::smallint,
    (p_result ->> 'shootout_home')::smallint,
    (p_result ->> 'shootout_away')::smallint,
    (p_result ->> 'sets_home')::smallint,
    (p_result ->> 'sets_away')::smallint,
    (p_result ->> 'games_home')::smallint,
    (p_result ->> 'games_away')::smallint,
    coalesce(p_result -> 'period_scores', '[]'::jsonb),
    p_result ->> 'winner',
    p_result ->> 'winner_basis',
    (p_result ->> 'final_at')::timestamptz,
    coalesce(p_result ->> 'primary_provider', 'unknown'),
    p_result ->> 'primary_receipt_id',
    p_result ->> 'secondary_provider',
    p_result ->> 'secondary_receipt_id',
    coalesce((p_result ->> 'observation_count')::integer, 1),
    (p_result ->> 'first_observed_at')::timestamptz,
    (p_result ->> 'last_observed_at')::timestamptz,
    p_result ->> 'verification_state',
    (p_result ->> 'verified_at')::timestamptz,
    p_result ->> 'verified_by',
    v_revision,
    true,
    case when v_revision > 1 then p_correction_reason else null end
  )
  returning * into v_next;

  -- Retire the previous row only after the new one exists, and link it forward
  -- so the superseded verdict stays readable rather than merely historical.
  if v_current.id is not null then
    update public.op_fixture_results
    set is_current = false, superseded_by_result_id = v_next.id
    where id = v_current.id;
  end if;

  return v_next;
end;
$$;

comment on function public.op_record_fixture_result is
  'Insert a canonical result revision and retire the previous one atomically. Returns the current row unchanged when nothing material moved, so a retried sweep cannot inflate the revision counter into a series of phantom corrections.';

revoke all on function public.op_record_fixture_result(uuid, jsonb, text) from public, anon, authenticated;
