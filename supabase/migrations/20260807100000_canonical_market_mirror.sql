-- The canonical market ontology, mirrored from code.
--
-- Market identity in this repository has been bookmaker display text: a flat
-- string union in src/lib/sports/types.ts with the line baked into the name
-- (over_under_25, over_under_505, over_under_545 — seven members for one
-- market) and no line at all on spread, set_handicap or total_games. An Asian
-- handicap was therefore unrepresentable, which is the real reason those
-- decisions could only ever reach needs_review.
--
-- The definitions themselves live in src/lib/markets/canonicalMarkets.ts, not
-- here. Every column below is settlement semantics, and settlement semantics
-- that can be edited as data can be changed between a publication and its
-- result with nothing standing between the edit and the record. A pull request
-- is the review step.
--
-- These tables exist so the mapping workbench can join impact queries in SQL
-- against the largest tables rather than paging them into application memory.
-- They are a cache of the code, and writes are revoked from every role
-- including the service key so that stays true. A test compares them to the
-- registry and fails on divergence.

create table if not exists public.op_canonical_markets (
  key text primary key,
  version text not null,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  family text not null,
  period text not null,
  participant_scope text not null
    check (participant_scope in ('match', 'team_home', 'team_away', 'player', 'either')),
  selection_type text not null
    check (selection_type in ('binary', 'ternary', 'handicap', 'total', 'exact_score')),
  line_required boolean not null,
  line_granularity text not null check (line_granularity in ('none', 'integer', 'half', 'quarter')),
  basis text not null check (basis in (
    'regulation', 'including_extra_time', 'including_shootout',
    'full_game_including_ot', 'regulation_excluding_ot', 'sets', 'games', 'match_award'
  )),
  overtime_rule text not null check (overtime_rule in ('excluded', 'included', 'not_applicable')),
  push_rule text not null check (push_rule in (
    'exact_line_push', 'half_line_no_push', 'quarter_line_half_push', 'no_push'
  )),
  void_rule text not null check (void_rule in ('void_on_no_result', 'void_on_abandonment', 'settle_if_awarded')),
  retirement_rule text not null check (retirement_rule in ('settle_on_award', 'void', 'not_applicable')),
  settlement_rule_version text not null,
  settlement_basis_statement text not null,
  -- A line is required exactly when the market declares a granularity.
  constraint op_canonical_markets_line_coherent
    check (line_required = (line_granularity <> 'none'))
);

comment on table public.op_canonical_markets is
  'Read-only mirror of the canonical market registry in src/lib/markets/canonicalMarkets.ts. Populated by migration only; a test asserts it matches the code. Never edit here — settlement semantics change by pull request.';

create table if not exists public.op_canonical_selections (
  key text primary key,
  market_key text not null references public.op_canonical_markets (key) on delete cascade,
  selection text not null,
  label text not null,
  unique (market_key, selection)
);

comment on table public.op_canonical_selections is
  'Read-only mirror of canonical selections. Selection keys carry the line as a trailing segment with the decimal point encoded as underscore (football.asian_handicap.regulation.home.-0_25).';

create index if not exists op_canonical_markets_sport_family_idx
  on public.op_canonical_markets (sport, family);

alter table public.op_canonical_markets enable row level security;
alter table public.op_canonical_selections enable row level security;

-- Readable by the application, writable by nobody. The mirror is a cache; if it
-- can be edited independently it is a second source of settlement truth, which
-- is the failure this design exists to prevent.
grant select on public.op_canonical_markets to anon, authenticated, service_role;
grant select on public.op_canonical_selections to anon, authenticated, service_role;
revoke insert, update, delete on public.op_canonical_markets from anon, authenticated, service_role;
revoke insert, update, delete on public.op_canonical_selections from anon, authenticated, service_role;

drop policy if exists op_canonical_markets_read on public.op_canonical_markets;
create policy op_canonical_markets_read on public.op_canonical_markets for select using (true);
drop policy if exists op_canonical_selections_read on public.op_canonical_selections;
create policy op_canonical_selections_read on public.op_canonical_selections for select using (true);
