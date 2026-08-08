-- Populate the settlement provenance columns.
--
-- 20260807100500 added market_key, rule_version, settlement_basis,
-- return_multiple and result_id to op_publication_settlements, and nothing
-- writes them: callers pass that provenance inside p_resolution_basis, and
-- op_settle_publication only ever stored the jsonb. Five columns that would
-- have been permanently null while the data sat one field away — queryable
-- from the jsonb, but not by any index, and invisible to anything reading the
-- schema to find out what a verdict was produced under.
--
-- Lifted from the jsonb rather than added as parameters, so every existing
-- caller keeps working unchanged and the audit record stays the single thing a
-- caller has to construct.
--
-- return_multiple is derived here rather than trusted from the caller: it is a
-- function of the outcome and nothing else, and a caller that computes it
-- wrongly would put a number into the ROI column that no test would catch.

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
  v_basis jsonb := coalesce(p_resolution_basis, '{}'::jsonb);
  v_return numeric;
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

  -- Idempotent: the same verdict twice writes nothing and returns what is
  -- already there, so a duplicated settlement job cannot double-count.
  if found and v_existing.status = p_status then
    return v_existing;
  end if;

  -- Profit per unit staked, from the outcome alone.
  v_return := case p_status
    when 'won' then v_publication.odds_at_publication - 1
    when 'half_won' then (v_publication.odds_at_publication - 1) / 2
    when 'half_lost' then -0.5
    when 'lost' then -1
    when 'push' then 0
    when 'void' then 0
    when 'cancelled' then 0
    else null
  end;

  if v_existing.id is not null then
    -- Retire first: inserting while the previous row is still current collides
    -- with the one-current-per-publication index.
    update public.op_publication_settlements set is_current = false where id = v_existing.id;
  end if;

  insert into public.op_publication_settlements (
    publication_id, status, resolution_basis,
    market_key, rule_version, settlement_basis, return_multiple, result_id
  )
  values (
    p_publication_id,
    p_status,
    v_basis,
    v_basis ->> 'marketKey',
    v_basis ->> 'ruleVersion',
    v_basis ->> 'settlementBasis',
    v_return,
    -- Absent or malformed leaves the link null rather than failing the
    -- settlement: a verdict is worth recording even when its provenance
    -- pointer is not resolvable.
    case
      when v_basis ->> 'resultId' ~ '^[0-9a-fA-F-]{36}$' then (v_basis ->> 'resultId')::uuid
      else null
    end
  )
  returning * into v_new;

  if v_existing.id is not null then
    update public.op_publication_settlements
    set superseded_by_settlement_id = v_new.id
    where id = v_existing.id;
  end if;

  update public.op_publications
  set settlement_status = p_status,
      settled_at = case when p_status in ('unsettled', 'pending_verification') then null else v_new.settled_at end
  where id = p_publication_id;

  return v_new;
end;
$$;

comment on function public.op_settle_publication is
  'Settle or supersede a publication. Idempotent on an identical verdict. Lifts market_key, rule_version and settlement_basis out of the resolution basis into columns; derives return_multiple from the outcome rather than trusting a caller with the ROI figure.';
