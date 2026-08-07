-- Record an exception without losing how long it has been open.
--
-- A plain upsert cannot do this. The open-row unique index is partial and its
-- key columns are nullable, so PostgREST cannot infer the conflict target; and
-- an upsert that sets first_seen_at would reset it on every sweep, turning
-- "this conflict has been open for three days" into "this conflict appeared a
-- minute ago" — every hour, forever. The age of an exception is most of its
-- information.
--
-- So: update the open row if one exists, insert if not, and never touch
-- first_seen_at after the first write.
--
-- A resolved exception recurring opens a NEW row rather than reviving the
-- closed one. An operator's decision to resolve something is a record of what
-- they saw; reopening it in place would overwrite that with a later event.

create or replace function public.op_record_settlement_exception(
  p_kind text,
  p_severity text,
  p_detail jsonb,
  p_fixture_id uuid default null,
  p_publication_id uuid default null,
  p_market text default null,
  p_selection text default null
)
returns public.op_settlement_exceptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.op_settlement_exceptions;
begin
  update public.op_settlement_exceptions
  set last_seen_at = now(),
      detail = p_detail,
      severity = p_severity
  where state = 'open'
    and kind = p_kind
    and fixture_id is not distinct from p_fixture_id
    and publication_id is not distinct from p_publication_id
    and market is not distinct from p_market
    and selection is not distinct from p_selection
  returning * into v_row;

  if found then
    return v_row;
  end if;

  insert into public.op_settlement_exceptions (
    kind, severity, fixture_id, publication_id, market, selection, detail, state
  ) values (
    p_kind, p_severity, p_fixture_id, p_publication_id, p_market, p_selection, p_detail, 'open'
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.op_record_settlement_exception is
  'Open or refresh a settlement/closing/mapping exception. Updates last_seen_at and detail on an existing open row and never resets first_seen_at, so the age of an exception survives an hourly sweep. A resolved exception recurring opens a new row rather than reviving an operator''s closed decision.';

revoke all on function public.op_record_settlement_exception(text, text, jsonb, uuid, uuid, text, text)
  from public, anon, authenticated;
