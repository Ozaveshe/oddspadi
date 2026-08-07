-- Closing prices, the exception queue, and the operator action log.
--
-- Closing price today is a boolean: op_mark_closing_odds() flips is_closing on
-- the last pre-kickoff quote per book. That records which row was last. It does
-- not record how many books were behind it, how stale the quote was, or — the
-- part that matters — why a close is absent when it is.
--
-- The failure being designed out is the one where a missing close becomes a
-- zero downstream and a CLV average quietly includes fixtures nobody priced.
-- Here that is structurally impossible: a check constraint ties the presence of
-- odds to the captured status, so a row can say "no close, and here is why" but
-- cannot say "no close, and the close was 0".

create table if not exists public.op_closing_prices (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.op_publications (id) on delete cascade,
  fixture_id uuid references public.op_fixtures (id) on delete set null,

  market text not null,
  selection text not null,
  market_line numeric,
  canonical_selection_key text,

  closing_odds numeric check (closing_odds is null or closing_odds > 1),
  closing_probability numeric check (closing_probability is null or (closing_probability > 0 and closing_probability < 1)),
  -- Describes the publication rather than the close, so it is recorded on every
  -- capture attempt including the failed ones. Without it a retry could not
  -- reproduce the CLV figure.
  published_probability_novig numeric
    check (published_probability_novig is null or (published_probability_novig > 0 and published_probability_novig < 1)),

  source text not null default 'consensus',
  source_count integer not null default 0 check (source_count >= 0),
  source_bookmakers text[] not null default '{}',

  close_observed_at timestamptz,
  kickoff_at timestamptz not null,
  captured_at timestamptz not null default now(),

  capture_status text not null check (capture_status in (
    'captured', 'insufficient_sources', 'no_quotes', 'stale',
    'market_unmapped', 'identity_failure', 'late_provider_data', 'operator_unavailable'
  )),
  missing_reason text,
  policy_version text not null,

  revision integer not null default 1 check (revision >= 1),
  is_current boolean not null default true,
  superseded_by_closing_id uuid references public.op_closing_prices (id) on delete set null,

  -- A missing close cannot become a number. This is the constraint the whole
  -- design turns on.
  constraint op_closing_prices_odds_only_when_captured
    check ((capture_status = 'captured') = (closing_odds is not null)),
  -- A post-start price is refused by the database, not merely by the query.
  constraint op_closing_prices_never_after_start
    check (close_observed_at is null or close_observed_at <= kickoff_at),
  -- An absent close explains itself.
  constraint op_closing_prices_reason_required
    check ((capture_status = 'captured') = (missing_reason is null)),
  constraint op_closing_prices_supersession_coherent
    check ((superseded_by_closing_id is null) or (is_current = false))
);

create unique index if not exists op_closing_prices_current_idx
  on public.op_closing_prices (publication_id)
  where is_current;

create index if not exists op_closing_prices_status_idx
  on public.op_closing_prices (capture_status)
  where is_current;

comment on table public.op_closing_prices is
  'Closing price per published claim under a stated policy. capture_status with a missing_reason is a first-class outcome: a close that was never captured stays absent rather than becoming a zero.';

-- ---------------------------------------------------------------- exceptions

-- One queue for settlement and closing both. Two queues would mean two places
-- to look and two backlogs to forget about.
create table if not exists public.op_settlement_exceptions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'result_conflict', 'unknown_market', 'missing_line', 'ambiguous_retirement',
    'abandoned_fixture', 'duplicate_result', 'missing_participant_identity', 'provider_correction',
    'close_missing', 'close_insufficient_sources', 'close_identity_failure',
    'close_market_unmapped', 'close_late_data',
    'alias_duplicate', 'alias_impossible_line', 'alias_orientation',
    'alias_incompatible_settlement', 'alias_version_conflict', 'alias_overround'
  )),
  severity text not null check (severity in ('critical', 'warning', 'info')),

  fixture_id uuid references public.op_fixtures (id) on delete cascade,
  publication_id uuid references public.op_publications (id) on delete cascade,
  market text,
  selection text,

  detail jsonb not null default '{}'::jsonb,
  state text not null default 'open' check (state in ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolution text,
  resolved_by text,
  resolved_at timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint op_settlement_exceptions_resolution_coherent
    check ((state in ('resolved', 'dismissed')) = (resolved_at is not null))
);

-- One open row per problem. An hourly sweep touching the same unresolved
-- exception updates last_seen_at rather than growing a pile that makes the
-- queue useless precisely when it matters.
create unique index if not exists op_settlement_exceptions_open_idx
  on public.op_settlement_exceptions (
    kind,
    coalesce(fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(publication_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(market, ''),
    coalesce(selection, '')
  )
  where state = 'open';

create index if not exists op_settlement_exceptions_state_idx
  on public.op_settlement_exceptions (state, severity, last_seen_at desc);

comment on table public.op_settlement_exceptions is
  'Operations queue for settlement, closing-price and market-mapping exceptions. Partial unique index on open rows so repeat sweeps update rather than duplicate.';

-- ----------------------------------------------------------- operator audit

create table if not exists public.op_settlement_operator_actions (
  id uuid primary key default gen_random_uuid(),
  -- Supplied by the caller, not authenticated: the admin surface holds one
  -- shared token and has no per-analyst identity. This is accountability, not
  -- access control, and is documented as such rather than implying otherwise.
  actor text not null,
  action text not null,
  target_kind text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  evidence text,
  created_at timestamptz not null default now()
);

create index if not exists op_settlement_operator_actions_target_idx
  on public.op_settlement_operator_actions (target_kind, target_id, created_at desc);

comment on table public.op_settlement_operator_actions is
  'Append-only log of operator actions. actor is caller-supplied because the admin token is shared; an unreviewed approval is therefore visible in the trail rather than indistinguishable from a reviewed one.';

alter table public.op_closing_prices enable row level security;
alter table public.op_settlement_exceptions enable row level security;
alter table public.op_settlement_operator_actions enable row level security;
