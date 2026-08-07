-- Provider and platform aliases, with time as a first-class dimension.
--
-- The mapping from a bookmaker's display text to a canonical selection, and —
-- the part that does the real work — when that mapping was true.
--
-- Resolution takes an as-of timestamp and returns the alias effective then, not
-- the one effective now. A June odds snapshot resolves through June's alias, so
-- approving a better mapping today cannot change what a June decision meant.
-- "Do not silently remap historical official records" is therefore a property
-- of the lookup rather than a policy somebody has to remember.
--
-- Correcting what history means is still possible, but only through
-- scripts/remap-historical-aliases.ts, which is dry-run by default and writes
-- one audit row per record it changes. There is no path from the workbench to a
-- historical rewrite.

create extension if not exists btree_gist;

create table if not exists public.op_market_aliases (
  id uuid primary key default gen_random_uuid(),

  provider text not null,
  source_sport text not null,
  raw_market text not null,
  raw_selection text not null,
  raw_line text,
  participant_order text not null default 'unknown'
    check (participant_order in ('as_listed', 'reversed', 'unknown')),

  canonical_market_key text references public.op_canonical_markets (key) on delete restrict,
  canonical_selection_key text references public.op_canonical_selections (key) on delete restrict,

  mapping_state text not null check (mapping_state in (
    'exact_equivalent', 'conditionally_equivalent', 'different_settlement',
    'unsupported', 'ambiguous', 'rejected'
  )),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  conditions text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  notes text,

  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  version integer not null default 1 check (version >= 1),
  supersedes_alias_id uuid references public.op_market_aliases (id) on delete set null,

  status text not null default 'draft' check (status in ('draft', 'pending_review', 'active', 'retired')),
  created_by text not null,
  reviewer text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint op_market_aliases_window_ordered
    check (effective_to is null or effective_to > effective_from),
  -- Only the states that name a usable canonical selection may carry one, and
  -- those states must carry one.
  constraint op_market_aliases_target_coherent
    check (
      (mapping_state in ('exact_equivalent', 'conditionally_equivalent', 'different_settlement'))
      = (canonical_selection_key is not null)
    ),
  -- An exactly-equivalent mapping cannot be conditional. This is the defect
  -- that turns a comparison into a wrong result, so it is refused at write time
  -- rather than flagged afterwards.
  constraint op_market_aliases_exact_is_unconditional
    check (mapping_state <> 'exact_equivalent' or cardinality(conditions) = 0),
  -- An active mapping must know which participant is which; otherwise home and
  -- away are a coin flip.
  constraint op_market_aliases_orientation_known
    check (
      status <> 'active'
      or participant_order <> 'unknown'
      or mapping_state in ('unsupported', 'ambiguous', 'rejected')
    ),
  -- A reviewed row says who and when.
  constraint op_market_aliases_review_coherent
    check ((reviewer is null) = (reviewed_at is null))
);

-- Two live mappings for one source key would make settlement a coin flip.
-- An exclusion constraint rather than a unique index, because the conflict is
-- an overlap in time and not an equality.
alter table public.op_market_aliases
  drop constraint if exists op_market_aliases_no_overlap;
alter table public.op_market_aliases
  add constraint op_market_aliases_no_overlap
  exclude using gist (
    provider with =,
    source_sport with =,
    raw_market with =,
    raw_selection with =,
    coalesce(raw_line, '') with =,
    tstzrange(effective_from, effective_to) with &&
  )
  where (status = 'active');

create index if not exists op_market_aliases_lookup_idx
  on public.op_market_aliases (provider, source_sport, raw_market, raw_selection)
  where status = 'active';

create index if not exists op_market_aliases_review_idx
  on public.op_market_aliases (status, mapping_state)
  where status in ('draft', 'pending_review');

comment on table public.op_market_aliases is
  'Provider and platform market aliases, resolved as-of a timestamp. Approving a new alias creates a new version with effective_from = now(); it never rewrites what a historical record meant.';
comment on column public.op_market_aliases.created_by is
  'Caller-supplied actor. The admin surface holds one shared token, so this is accountability rather than authentication — approval is refused when it equals the creator, but the token holder could supply any value.';

alter table public.op_market_aliases enable row level security;
