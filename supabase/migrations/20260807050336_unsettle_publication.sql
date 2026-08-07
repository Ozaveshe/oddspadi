-- Withdrawing a verdict that rested on an inference.
--
-- The ledger could already do three things to a claim: publish it, correct it,
-- settle it. It could not *un*-settle it, and that turned out to matter. 50
-- published picks were graded `void` because the stale sweep had marked their
-- fixtures `abandoned` — matches that were played, on days the provider
-- returned results for their neighbours. The verdict was wrong, and the only
-- ways to change it were a bare `update`, which erases the fact that we ever
-- claimed otherwise, or leaving it, which leaves a false public record.
--
-- So: a fourth verb, built out of the two that already exist.
--
--   1. `op_correct_publication` captures the verbatim prior row — void verdict
--      and all — into the append-only `op_publication_revisions`, bumps the
--      revision, and marks the claim `corrected`. This is what makes the
--      withdrawal show up in the public correction log rather than only in a
--      server's memory.
--   2. The settlement row that carried the wrong verdict is retired
--      (`is_current = false`) rather than deleted, so `won/lost/void` counts
--      stop including it while the row itself stays readable.
--   3. The ledger row returns to `unsettled`, which is the state that means
--      "no verdict yet" — so the settlement job will pick it up again the
--      moment a real result arrives.
--
-- An unknown goes back to being an unknown. Nothing here invents a result and
-- nothing here removes evidence.

create or replace function public.op_unsettle_publication(
  p_publication_id uuid,
  p_reason text
)
returns public.op_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.op_publications;
  v_updated public.op_publications;
begin
  select * into v_current from public.op_publications where id = p_publication_id for update;
  if not found then
    raise exception 'publication % not found', p_publication_id using errcode = 'no_data_found';
  end if;

  -- Idempotent by construction: a claim with no verdict has nothing to
  -- withdraw, and a repair run twice must not write a second revision saying
  -- the same thing.
  if v_current.settlement_status = 'unsettled' then
    return v_current;
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'withdrawing a settlement requires a reason' using errcode = 'check_violation';
  end if;

  -- Captures the prior state and bumps the revision. Deliberately the same
  -- entry point an editorial correction uses: a withdrawn verdict is a
  -- correction to the public record and belongs in the same log.
  perform public.op_correct_publication(p_publication_id, p_reason);

  -- Retired, not removed. The wrong verdict stays queryable — how often we
  -- withdraw one is exactly the number nobody should be able to hide.
  update public.op_publication_settlements
     set is_current = false
   where publication_id = p_publication_id
     and is_current;

  update public.op_publications
     set settlement_status = 'unsettled',
         settled_at = null
   where id = p_publication_id
  returning * into v_updated;

  return v_updated;
end;
$$;

comment on function public.op_unsettle_publication is
  'Withdraws a settlement that should never have been made, through the sanctioned correction path: the prior state is captured in op_publication_revisions, the settlement row is retired rather than deleted, and the claim returns to unsettled so a real result can still grade it. Idempotent.';

revoke all on function public.op_unsettle_publication(uuid, text) from public, anon, authenticated;
