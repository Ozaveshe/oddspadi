-- The publication path: the half of the ledger that was never built.
--
-- `op_correct_publication` and `op_settle_publication` have existed since the
-- ledger shipped, so a publication could be amended and graded but never
-- created. Every code reference to `op_publications` was a read. That is why
-- the table has held zero rows since it was created and why the public track
-- record has been empty by construction rather than by policy.
--
-- Approval attaches to the model, not to each pick: once a calibration profile
-- is approved for a sport, the pipeline publishes anything clearing the gates
-- with no human in the loop. That is a deliberate operating choice, and it puts
-- weight on two controls that would otherwise be nice-to-have.

-- ---------------------------------------------------------------------------
-- Controls
-- ---------------------------------------------------------------------------

create table if not exists public.op_publication_controls (
  -- Single row. The primary key is a constant so a second row cannot exist and
  -- silently shadow the first.
  id boolean primary key default true check (id),

  -- The kill switch. With nobody reviewing each pick, this is the only thing
  -- between a model fault and the permanent record, and it must work without a
  -- deploy.
  publishing_enabled boolean not null default false,
  disabled_reason text,
  disabled_at timestamptz,
  disabled_by text,

  -- Blast radius, not a quality cap. A bug that loops must not be able to write
  -- tens of thousands of immutable rows before anyone notices.
  max_publications_per_run integer not null default 400 check (max_publications_per_run between 1 and 2000),

  updated_at timestamptz not null default now()
);

insert into public.op_publication_controls (id, publishing_enabled)
values (true, false)
on conflict (id) do nothing;

comment on table public.op_publication_controls is
  'Single-row operational control for the publication path. Publishing starts disabled and must be switched on deliberately.';
comment on column public.op_publication_controls.publishing_enabled is
  'Kill switch. False halts all publication immediately without a deploy.';
comment on column public.op_publication_controls.max_publications_per_run is
  'Blast-radius bound per run. Not a quality cap — a limit on how much damage one faulty run can do.';

alter table public.op_publication_controls enable row level security;
revoke all on table public.op_publication_controls from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publish
-- ---------------------------------------------------------------------------

create or replace function public.op_publish_pick(
  p_fixture_id uuid,
  p_fixture_external_id text,
  p_sport text,
  p_competition text,
  p_market text,
  p_selection text,
  p_selection_label text,
  p_model_version text,
  p_feature_set_version text,
  p_calibration_version text,
  p_decision_policy_version text,
  p_model_probability numeric,
  p_odds_at_publication numeric,
  p_implied_probability numeric,
  p_kickoff_at timestamptz,
  p_evidence_cutoff_at timestamptz,
  p_odds_snapshot_at timestamptz,
  p_odds_snapshot_id uuid,
  p_data_quality text,
  p_market_line numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_controls record;
  v_approved record;
  v_now timestamptz := now();
  v_id uuid;
begin
  select * into v_controls from public.op_publication_controls where id;
  if not found or not v_controls.publishing_enabled then
    raise exception 'Publishing is disabled.%',
      case when v_controls.disabled_reason is null then '' else ' Reason: ' || v_controls.disabled_reason end;
  end if;

  -- Approval attaches to the model. Without a live promotion for this sport and
  -- model there is no authority to publish under it, and the named approver on
  -- that promotion is what makes a published pick traceable to a person.
  select * into v_approved
  from public.op_calibration_promotions
  where sport = p_sport
    and model_key = p_model_version
    and status = 'approved'
    and (expires_at is null or expires_at > v_now)
  order by approved_at desc
  limit 1;

  if not found then
    raise exception 'No approved calibration promotion for % / %; publication refused.', p_sport, p_model_version;
  end if;

  -- Pre-kickoff is enforced by a table constraint too. Checking here as well
  -- turns a constraint violation into a sentence an operator can act on.
  if v_now >= p_kickoff_at then
    raise exception 'Kickoff has passed for this fixture; a pick published after the event is not a forecast.';
  end if;

  -- Re-publishing the same selection must supersede, not duplicate. Returning
  -- the existing id keeps the caller idempotent: a retried run republishes
  -- nothing and double-counts nothing.
  select id into v_id
  from public.op_publications
  where fixture_id = p_fixture_id
    and market = p_market
    and selection = p_selection
    and publication_status = 'published';
  if found then
    return v_id;
  end if;

  insert into public.op_publications (
    fixture_id, fixture_external_id, sport, competition, market, selection, selection_label, market_line,
    model_version, feature_set_version, calibration_version, decision_policy_version,
    model_probability, odds_at_publication, implied_probability,
    published_at, kickoff_at, evidence_cutoff_at, odds_snapshot_at, odds_snapshot_id,
    data_quality, decision_status, publication_status, settlement_status, record_class
  ) values (
    p_fixture_id, p_fixture_external_id, p_sport, p_competition, p_market, p_selection, p_selection_label, p_market_line,
    p_model_version, p_feature_set_version, p_calibration_version, p_decision_policy_version,
    p_model_probability, p_odds_at_publication, p_implied_probability,
    v_now, p_kickoff_at, p_evidence_cutoff_at, p_odds_snapshot_at, p_odds_snapshot_id,
    p_data_quality, 'pick', 'published', 'unsettled', 'official_public_pick'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.op_publish_pick is
  'Creates one official publication. Refuses when the kill switch is off, when no approved promotion exists for the sport and model, or after kickoff. Idempotent per live claim.';

revoke all on function public.op_publish_pick from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Kill switch, operable without a deploy
-- ---------------------------------------------------------------------------

create or replace function public.op_set_publishing(
  p_enabled boolean,
  p_actor text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'An actor is required to change publishing state.';
  end if;
  if not p_enabled and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A reason is required to disable publishing.';
  end if;

  update public.op_publication_controls
     set publishing_enabled = p_enabled,
         disabled_reason = case when p_enabled then null else p_reason end,
         disabled_at = case when p_enabled then null else now() end,
         disabled_by = case when p_enabled then null else p_actor end,
         updated_at = now()
   where id;
end;
$$;

comment on function public.op_set_publishing is
  'Flips the publication kill switch. Disabling requires a reason; both require a named actor.';

revoke all on function public.op_set_publishing from public, anon, authenticated;
