-- Retrying a closing-price capture, atomically.
--
-- The capture sweep skipped any claim that already had a current row. That made
-- a miss permanent: the first run after kickoff wrote `no_quotes`, and the row
-- it wrote was the reason it never looked again. Measured on 2026-08-08, all
-- 139 eligible claims carried an absent-capture row and none was ever revisited,
-- so late-arriving quotes could not become a close no matter how many times the
-- sweep ran.
--
-- A retry must supersede rather than duplicate: `op_closing_prices_current_idx`
-- allows exactly one current row per publication, so retiring the old row and
-- inserting the new one have to happen together. Doing that from the client
-- takes three statements, and a failure between them leaves a claim with no
-- current row at all. Here it is one statement or none.
--
-- What this deliberately does NOT do: touch op_publications. The published
-- probability and odds are immutability-guarded, and a closing price is new
-- evidence attached to a claim after the fact, not an edit of the claim.

create or replace function public.op_supersede_closing_price(
  p_publication_id uuid,
  p_fixture_id uuid,
  p_market text,
  p_selection text,
  p_market_line numeric,
  p_canonical_selection_key text,
  p_closing_odds numeric,
  p_closing_probability numeric,
  p_published_probability_novig numeric,
  p_source text,
  p_source_count integer,
  p_source_bookmakers text[],
  p_close_observed_at timestamptz,
  p_kickoff_at timestamptz,
  p_captured_at timestamptz,
  p_capture_status text,
  p_missing_reason text,
  p_policy_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_id uuid;
  v_prior_revision integer;
  v_new_id uuid;
begin
  -- Lock the current row so two concurrent sweeps cannot both retire it and
  -- race to insert, which the unique index would turn into an error for one of
  -- them and a lost capture for whichever lost.
  select id, revision into v_prior_id, v_prior_revision
  from public.op_closing_prices
  where publication_id = p_publication_id and is_current
  for update;

  -- An operator's "unavailable" is a decision, not a measurement. A sweep does
  -- not get to overrule it; clearing it is an explicit operator action.
  if v_prior_id is not null and exists (
    select 1 from public.op_closing_prices
    where id = v_prior_id and capture_status = 'operator_unavailable'
  ) then
    return v_prior_id;
  end if;

  if v_prior_id is not null then
    update public.op_closing_prices
    set is_current = false
    where id = v_prior_id;
  end if;

  insert into public.op_closing_prices (
    publication_id, fixture_id, market, selection, market_line, canonical_selection_key,
    closing_odds, closing_probability, published_probability_novig,
    source, source_count, source_bookmakers,
    close_observed_at, kickoff_at, captured_at,
    capture_status, missing_reason, policy_version,
    revision, is_current
  ) values (
    p_publication_id, p_fixture_id, p_market, p_selection, p_market_line, p_canonical_selection_key,
    p_closing_odds, p_closing_probability, p_published_probability_novig,
    coalesce(p_source, 'consensus'), coalesce(p_source_count, 0), coalesce(p_source_bookmakers, '{}'),
    p_close_observed_at, p_kickoff_at, coalesce(p_captured_at, now()),
    p_capture_status, p_missing_reason, p_policy_version,
    coalesce(v_prior_revision, 0) + 1, true
  )
  returning id into v_new_id;

  if v_prior_id is not null then
    update public.op_closing_prices
    set superseded_by_closing_id = v_new_id
    where id = v_prior_id;
  end if;

  return v_new_id;
end;
$$;

comment on function public.op_supersede_closing_price is
  'Replace a claim''s current closing-price row with a new attempt, atomically. Retires the prior row and links it forward so the history of attempts survives. Refuses to overrule an operator_unavailable mark. Never writes to op_publications: a close is evidence attached to a claim, not an edit of it.';

revoke all on function public.op_supersede_closing_price(
  uuid, uuid, text, text, numeric, text, numeric, numeric, numeric,
  text, integer, text[], timestamptz, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
