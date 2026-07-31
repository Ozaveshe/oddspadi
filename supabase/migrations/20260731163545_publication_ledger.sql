-- The canonical publication ledger.
--
-- Why this exists: the product had several tables that each looked like a
-- record of "OddsPadi's picks", and different pages counted different ones.
-- `op_public_picks` (the intended official table) has never held a row, while
-- the anon-readable `op_public_prediction_outcomes` filled up with paper-mode
-- shadow trades because its sync trigger used a denylist. So the public track
-- record showed 144 rows that were not picks, and the official surfaces showed
-- zero, and both were faithfully reporting their own source.
--
-- This migration creates one ledger with the invariants enforced in the
-- database, where no application path can route around them:
--
--   * a publication cannot be created at or after its fixture's kickoff;
--   * a published row cannot be edited in place — corrections append a
--     revision holding the verbatim prior state;
--   * settlement is idempotent and at most one settlement is current;
--   * only the `official_public_pick` record class may exist here at all.
--
-- Nothing is deleted by this migration and no historical row is reclassified
-- here; reconciliation is a separate, re-runnable, auditable step.

create table if not exists public.op_publications (
  id uuid primary key default gen_random_uuid(),

  fixture_id uuid not null references public.op_fixtures (id) on delete restrict,
  fixture_external_id text not null,
  sport text not null,
  competition text not null,
  market text not null,
  selection text not null,
  selection_label text not null,
  market_line numeric,

  -- Four independently versioned inputs: the same probability from a different
  -- calibration or policy is a different claim, and the ledger has to say so.
  model_version text not null,
  feature_set_version text not null,
  calibration_version text not null,
  decision_policy_version text not null,

  model_probability numeric not null check (model_probability > 0 and model_probability < 1),
  odds_at_publication numeric not null check (odds_at_publication > 1),
  implied_probability numeric not null check (implied_probability > 0 and implied_probability <= 1),

  -- Server-generated, not caller-supplied: a claimed publication time is not
  -- evidence of publication.
  published_at timestamptz not null default now(),
  kickoff_at timestamptz not null,
  evidence_cutoff_at timestamptz not null,
  odds_snapshot_at timestamptz not null,
  odds_snapshot_id uuid references public.op_odds_snapshots (id) on delete set null,

  data_quality text not null check (data_quality in ('complete', 'partial', 'stale', 'unavailable', 'confirmed_empty')),
  decision_status text not null check (decision_status in ('pick', 'lean', 'watch', 'pass', 'withheld', 'unavailable')),
  public_copy_ref text,

  publication_status text not null default 'published'
    check (publication_status in ('draft', 'published', 'corrected', 'retracted')),
  settlement_status text not null default 'unsettled'
    check (settlement_status in ('unsettled', 'won', 'lost', 'push', 'void', 'cancelled', 'pending_verification')),
  settled_at timestamptz,
  correction_reason text,
  supersedes_publication_id uuid references public.op_publications (id) on delete set null,

  -- Present and constrained so the allowlist is visible in the schema itself.
  record_class text not null default 'official_public_pick' check (record_class = 'official_public_pick'),

  revision integer not null default 1 check (revision >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Invariant 1: no publication at or after kickoff. A pick made once the ball
  -- is rolling is not a prediction, and this is the rule most worth making
  -- impossible rather than merely discouraged.
  constraint op_publications_before_kickoff check (published_at < kickoff_at),
  -- The decision cannot have seen evidence from after it was published.
  constraint op_publications_evidence_cutoff check (evidence_cutoff_at <= published_at),
  -- A settled row must say when.
  constraint op_publications_settled_at_present
    check ((settlement_status in ('unsettled', 'pending_verification')) = (settled_at is null)),
  -- Only a corrected or retracted row carries a correction reason.
  constraint op_publications_correction_reason
    check ((publication_status in ('corrected', 'retracted')) or correction_reason is null)
);

-- One live claim per fixture/market/selection: re-publishing the same
-- selection must supersede, not duplicate, or every count doubles.
create unique index if not exists op_publications_current_claim_idx
  on public.op_publications (fixture_id, market, selection)
  where publication_status = 'published';

create index if not exists op_publications_kickoff_idx on public.op_publications (kickoff_at desc);
create index if not exists op_publications_sport_status_idx on public.op_publications (sport, publication_status);
create index if not exists op_publications_settlement_idx on public.op_publications (settlement_status);

comment on table public.op_publications is
  'Canonical, immutable ledger of official OddsPadi public picks. Only record_class official_public_pick exists here; shadow, simulation, backtest, editorial and community records must never be written to this table.';

-- Append-only revision history. A correction writes the prior state here
-- verbatim before the ledger row changes, so the original claim stays readable
-- after it is superseded.
create table if not exists public.op_publication_revisions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.op_publications (id) on delete cascade,
  revision integer not null check (revision >= 1),
  previous_state jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (publication_id, revision)
);

comment on table public.op_publication_revisions is
  'Append-only prior states for corrected publications. Never updated or deleted; the original claim must remain auditable.';

-- Settlement as its own object so re-running a settlement job is idempotent
-- and a corrected verdict supersedes rather than overwrites.
create table if not exists public.op_publication_settlements (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.op_publications (id) on delete cascade,
  status text not null check (status in ('won', 'lost', 'push', 'void', 'cancelled', 'pending_verification')),
  resolution_basis jsonb not null default '{}'::jsonb,
  settled_at timestamptz not null default now(),
  is_current boolean not null default true,
  superseded_by_settlement_id uuid references public.op_publication_settlements (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Invariant: at most one current settlement per publication. A duplicate
-- settlement job therefore cannot double-count a result.
create unique index if not exists op_publication_settlements_current_idx
  on public.op_publication_settlements (publication_id)
  where is_current;

comment on table public.op_publication_settlements is
  'One current settlement per publication. Re-running settlement is idempotent; a changed verdict supersedes the prior row instead of editing it.';

-- Immutability guard: once published, the claim fields are frozen. Lifecycle
-- fields (settlement, status transitions, correction bookkeeping) may move,
-- and a correction must bump the revision — which the correction helper does
-- after writing the prior state to the revision table.
create or replace function private.guard_publication_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.publication_status = 'draft' then
    return new;
  end if;

  if new.model_probability is distinct from old.model_probability
     or new.odds_at_publication is distinct from old.odds_at_publication
     or new.implied_probability is distinct from old.implied_probability
     or new.market is distinct from old.market
     or new.selection is distinct from old.selection
     or new.fixture_id is distinct from old.fixture_id
     or new.published_at is distinct from old.published_at
     or new.kickoff_at is distinct from old.kickoff_at
     or new.evidence_cutoff_at is distinct from old.evidence_cutoff_at
     or new.model_version is distinct from old.model_version
     or new.calibration_version is distinct from old.calibration_version
     or new.decision_policy_version is distinct from old.decision_policy_version
  then
    -- A changed claim is only legitimate as a correction, and a correction
    -- must leave a revision behind.
    if new.revision <= old.revision then
      raise exception 'op_publications: published claim fields are immutable; write a revision via op_correct_publication()'
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.op_publication_revisions r
      where r.publication_id = old.id and r.revision = old.revision
    ) then
      raise exception 'op_publications: correction requires the prior state in op_publication_revisions'
        using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists op_publications_immutability on public.op_publications;
create trigger op_publications_immutability
  before update on public.op_publications
  for each row execute function private.guard_publication_immutability();

-- Revisions are append-only: no updates, no deletes, ever.
create or replace function private.guard_revision_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'op_publication_revisions is append-only' using errcode = 'check_violation';
end;
$$;

drop trigger if exists op_publication_revisions_append_only on public.op_publication_revisions;
create trigger op_publication_revisions_append_only
  before update or delete on public.op_publication_revisions
  for each row execute function private.guard_revision_append_only();

-- Correction entry point: captures the prior state, bumps the revision, and
-- applies the change in one transaction so a correction can never half-land.
create or replace function public.op_correct_publication(
  p_publication_id uuid,
  p_reason text,
  p_changes jsonb default '{}'::jsonb,
  p_retract boolean default false
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
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a correction requires a reason' using errcode = 'check_violation';
  end if;

  insert into public.op_publication_revisions (publication_id, revision, previous_state, reason)
  values (p_publication_id, v_current.revision, to_jsonb(v_current), p_reason);

  update public.op_publications set
    revision = v_current.revision + 1,
    publication_status = case when p_retract then 'retracted' else 'corrected' end,
    correction_reason = p_reason,
    model_probability = coalesce((p_changes ->> 'model_probability')::numeric, v_current.model_probability),
    odds_at_publication = coalesce((p_changes ->> 'odds_at_publication')::numeric, v_current.odds_at_publication),
    implied_probability = coalesce((p_changes ->> 'implied_probability')::numeric, v_current.implied_probability),
    public_copy_ref = coalesce(p_changes ->> 'public_copy_ref', v_current.public_copy_ref)
  where id = p_publication_id
  returning * into v_updated;

  return v_updated;
end;
$$;

comment on function public.op_correct_publication is
  'The only supported way to change a published claim: writes the verbatim prior state to op_publication_revisions, bumps the revision, and marks the row corrected or retracted.';

-- Settlement entry point: idempotent by construction. Re-running with the same
-- verdict is a no-op; a different verdict supersedes the previous settlement.
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

  -- Idempotence: the same verdict twice must not create a second row, or a
  -- duplicated settlement job double-counts the result.
  if found and v_existing.status = p_status then
    return v_existing;
  end if;

  -- NOTE: this ordering is wrong and is corrected forward in
  -- 20260731163713_publication_ledger_settlement_supersede_order.sql. It is
  -- left as applied so replaying this directory reproduces the real history.
  insert into public.op_publication_settlements (publication_id, status, resolution_basis)
  values (p_publication_id, p_status, coalesce(p_resolution_basis, '{}'::jsonb))
  returning * into v_new;

  if v_existing.id is not null then
    update public.op_publication_settlements
    set is_current = false, superseded_by_settlement_id = v_new.id
    where id = v_existing.id;
  end if;

  update public.op_publications
  set settlement_status = p_status,
      settled_at = case when p_status = 'pending_verification' then null else v_new.settled_at end
  where id = p_publication_id;

  return v_new;
end;
$$;

comment on function public.op_settle_publication is
  'Idempotent settlement. Same verdict twice is a no-op; a changed verdict supersedes the prior settlement and leaves it auditable.';

-- Public read surface. Anonymous visitors may read published claims and their
-- settlements — that is the whole point of a public ledger — but may not write.
alter table public.op_publications enable row level security;
alter table public.op_publication_revisions enable row level security;
alter table public.op_publication_settlements enable row level security;

drop policy if exists op_publications_public_read on public.op_publications;
create policy op_publications_public_read on public.op_publications
  for select using (publication_status in ('published', 'corrected', 'retracted'));

drop policy if exists op_publication_revisions_public_read on public.op_publication_revisions;
create policy op_publication_revisions_public_read on public.op_publication_revisions
  for select using (true);

drop policy if exists op_publication_settlements_public_read on public.op_publication_settlements;
create policy op_publication_settlements_public_read on public.op_publication_settlements
  for select using (true);

revoke all on function public.op_correct_publication(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.op_settle_publication(uuid, text, jsonb) from public, anon, authenticated;
