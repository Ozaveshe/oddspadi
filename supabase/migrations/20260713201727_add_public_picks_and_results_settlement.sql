-- Separate internal market evaluations from the immutable public pick ledger.
-- Legacy op_prediction_outcomes rows remain available to the private learning
-- loop, but are explicitly tagged internal and are no longer publicly exposed.

alter table public.op_fixtures drop constraint if exists op_fixtures_status_check;
alter table public.op_fixtures add constraint op_fixtures_status_check
  check (status in ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'suspended'));

alter table public.op_market_decisions
  add column if not exists internal_only boolean not null default true,
  add column if not exists public_decision_id uuid references public.op_fixture_decision_summaries(id) on delete set null;

comment on column public.op_market_decisions.internal_only is
  'True for model analyses that were not published. Public accuracy never reads these rows directly.';
comment on column public.op_market_decisions.public_decision_id is
  'Canonical fixture DecisionSummary that authorized publication, when one exists.';

create table public.op_public_picks (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null,
  fixture_db_id uuid references public.op_fixtures(id) on delete set null,
  prediction_run_id uuid references public.op_market_decisions(id) on delete set null,
  public_decision_id uuid references public.op_fixture_decision_summaries(id) on delete set null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  league text not null,
  country text,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  market text not null,
  selection text not null,
  selection_label text not null,
  market_line numeric(10, 4),
  odds numeric(10, 4) not null check (odds > 1),
  model_version text not null,
  engine_version text not null,
  model_probability numeric(8, 6) not null check (model_probability between 0 and 1),
  implied_probability numeric(8, 6) not null check (implied_probability between 0 and 1),
  no_vig_probability numeric(8, 6) not null check (no_vig_probability between 0 and 1),
  value_edge numeric(8, 6) not null check (value_edge > 0),
  expected_value numeric(8, 6) not null check (expected_value > 0),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  risk text not null check (risk in ('low', 'medium', 'high')),
  published_at timestamptz not null,
  published_date date not null,
  status text not null default 'published'
    check (status in ('published', 'stale', 'suspended', 'settled', 'void')),
  settlement_status text not null default 'waiting_kickoff'
    check (settlement_status in (
      'waiting_kickoff', 'match_live', 'awaiting_final_score',
      'awaiting_market_resolution', 'settled', 'void',
      'needs_manual_review', 'provider_missing'
    )),
  result text not null default 'pending'
    check (result in ('pending', 'won', 'lost', 'push', 'void')),
  settlement_reason text not null default 'Waiting for kickoff.',
  settled_at timestamptz,
  closing_odds numeric(10, 4) check (closing_odds is null or closing_odds > 1),
  closing_line_value numeric(10, 6),
  provider text not null,
  provider_fixture_id text not null,
  final_status_observed_at timestamptz,
  final_score jsonb,
  revision integer not null default 1 check (revision > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint op_public_picks_unique_publication
    unique (fixture_id, market, selection, model_version, published_date)
);

comment on table public.op_public_picks is
  'Provider-backed canonical value picks that were actually published. This is the sole source for public accuracy and ROI.';
comment on constraint op_public_picks_unique_publication
  on public.op_public_picks is
  'Prevents scheduler retries and odds refreshes from duplicating the same public pick.';

create index op_public_picks_published_at_idx
  on public.op_public_picks (published_at desc);
create index op_public_picks_settlement_queue_idx
  on public.op_public_picks (settlement_status, kickoff_at)
  where settlement_status not in ('settled', 'void');
create index op_public_picks_public_metrics_idx
  on public.op_public_picks (sport, result, published_at desc);

alter table public.op_public_picks enable row level security;
revoke all on table public.op_public_picks from public, anon, authenticated;
grant select, insert, update, delete on table public.op_public_picks to service_role;

-- The previous projection mirrored every internal outcome, including avoid,
-- watchlist, negative-edge, mock, and paper-only rows. Keep it for forensic
-- migration history, but remove it from the public Data API.
drop policy if exists "Public outcomes are readable" on public.op_public_prediction_outcomes;
revoke all on table public.op_public_prediction_outcomes from public, anon, authenticated;

update public.op_prediction_outcomes
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'internalOnly', true,
  'publicLedgerEligible', false,
  'legacyClassification', case
    when source = 'autonomous-shadow' then 'internal-shadow-run'
    when coalesce((metadata ->> 'paperOnly')::boolean, false) then 'paper-only-run'
    when coalesce(value_edge, 0) <= 0 then 'non-positive-edge-analysis'
    else 'legacy-unverified-publication'
  end
),
updated_at = now()
where result = 'pending'
  and (
    coalesce((metadata ->> 'internalOnly')::boolean, false) is not true
    or coalesce((metadata ->> 'publicLedgerEligible')::boolean, true) is not false
  );

comment on table public.op_prediction_outcomes is
  'Internal model-run outcome archive used for learning and calibration. Public accuracy reads only op_public_picks.';
