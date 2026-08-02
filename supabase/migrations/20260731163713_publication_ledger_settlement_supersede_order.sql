-- Correct forward: op_settle_publication inserted the replacement settlement
-- while the previous one was still current, which collides with the
-- one-current-per-publication unique index. The old row must be retired first.
--
-- Found by probing the invariants against the real database rather than
-- assuming the function was right: settling the same publication twice with a
-- different verdict raised a duplicate-key error instead of superseding.
create or replace function public.op_settle_publication(
  p_publication_id uuid,
  p_status text,
  p_resolution_basis jsonb default '{}'::jsonb
)
returns public.op_publication_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.op_publications;
  v_existing public.op_publication_settlements;
  v_new public.op_publication_settlements;
begin
  select * into v_publication from public.op_publications where id = p_publication_id for update;
  if not found then
    raise exception 'publication % not found', p_publication_id using errcode = 'no_data_found';
  end if;
  if v_publication.publication_status = 'retracted' then
    raise exception 'retracted publication % cannot be settled', p_publication_id using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.op_publication_settlements
  where publication_id = p_publication_id and is_current;

  if found and v_existing.status = p_status then
    return v_existing;
  end if;

  if v_existing.id is not null then
    update public.op_publication_settlements set is_current = false where id = v_existing.id;
  end if;

  insert into public.op_publication_settlements (publication_id, status, resolution_basis)
  values (p_publication_id, p_status, coalesce(p_resolution_basis, '{}'::jsonb))
  returning * into v_new;

  if v_existing.id is not null then
    update public.op_publication_settlements
    set superseded_by_settlement_id = v_new.id
    where id = v_existing.id;
  end if;

  update public.op_publications
  set settlement_status = p_status,
      settled_at = case when p_status = 'pending_verification' then null else v_new.settled_at end
  where id = p_publication_id;

  return v_new;
end;
$$;

revoke all on function public.op_settle_publication(uuid, text, jsonb) from public, anon, authenticated;
