-- The canonical result, stored beside op_fixtures rather than inside it.
--
-- op_fixtures holds home_score and away_score, and it is upserted on every
-- results refresh. Two consequences follow.
--
-- First, a cup tie decided on penalties has no recoverable normal-time score,
-- so football 1X2 has been settling against a post-shootout result. That is a
-- wrong verdict, produced silently, on a public record.
--
-- Second, verification state and correction history cannot survive in a row
-- that ingest overwrites. This is the same reasoning that put lifecycle_state
-- beside status rather than inside it: the provider's statement and our reading
-- of it are different objects, and when they disagree the disagreement is the
-- finding.
--
-- Score basis is declared in the column comments because a reader who has to
-- work out whether extra_time includes regulation will eventually work it out
-- wrong.

create table if not exists public.op_fixture_results (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.op_fixtures (id) on delete cascade,
  sport text not null check (sport in ('football', 'basketball', 'tennis')),

  result_status text not null check (result_status in (
    'finished', 'postponed', 'cancelled', 'abandoned', 'retired', 'walkover', 'awarded'
  )),

  regulation_home smallint check (regulation_home is null or regulation_home >= 0),
  regulation_away smallint check (regulation_away is null or regulation_away >= 0),
  extra_time_home smallint check (extra_time_home is null or extra_time_home >= 0),
  extra_time_away smallint check (extra_time_away is null or extra_time_away >= 0),
  shootout_home smallint check (shootout_home is null or shootout_home >= 0),
  shootout_away smallint check (shootout_away is null or shootout_away >= 0),

  sets_home smallint check (sets_home is null or sets_home >= 0),
  sets_away smallint check (sets_away is null or sets_away >= 0),
  games_home smallint check (games_home is null or games_home >= 0),
  games_away smallint check (games_away is null or games_away >= 0),

  period_scores jsonb not null default '[]'::jsonb,

  winner text not null check (winner in ('home', 'away', 'draw', 'none')),
  winner_basis text check (winner_basis is null or winner_basis in (
    'regulation', 'extra_time', 'shootout', 'retirement', 'walkover', 'awarded'
  )),

  final_at timestamptz,
  primary_provider text not null,
  primary_receipt_id text,
  secondary_provider text,
  secondary_receipt_id text,
  observation_count integer not null default 1 check (observation_count >= 1),
  first_observed_at timestamptz,
  last_observed_at timestamptz,

  verification_state text not null default 'provisional'
    check (verification_state in ('provisional', 'verified', 'conflicted', 'manual_review')),
  verified_at timestamptz,
  verified_by text,

  revision integer not null default 1 check (revision >= 1),
  is_current boolean not null default true,
  superseded_by_result_id uuid references public.op_fixture_results (id) on delete set null,
  correction_reason text,

  created_at timestamptz not null default now(),

  -- A verified row says when and by whom; an unverified one must not pretend to.
  constraint op_fixture_results_verified_coherent
    check ((verification_state = 'verified') = (verified_at is not null and verified_by is not null)),
  -- Extra time is inclusive of regulation, so it can never be behind it.
  constraint op_fixture_results_extra_time_not_behind
    check (
      extra_time_home is null or regulation_home is null or extra_time_home >= regulation_home
    ),
  constraint op_fixture_results_extra_time_away_not_behind
    check (
      extra_time_away is null or regulation_away is null or extra_time_away >= regulation_away
    ),
  -- A superseded row is not current; a current row supersedes nothing.
  constraint op_fixture_results_supersession_coherent
    check ((superseded_by_result_id is null) or (is_current = false)),
  -- Only a correction explains itself.
  constraint op_fixture_results_correction_reason
    check (revision = 1 or correction_reason is not null)
);

-- Exactly one current result per fixture, enforced continuously so no window
-- exists in which two results are both live. Mirrors
-- op_publication_settlements_current_idx.
create unique index if not exists op_fixture_results_current_idx
  on public.op_fixture_results (fixture_id)
  where is_current;

create index if not exists op_fixture_results_verification_idx
  on public.op_fixture_results (verification_state)
  where is_current;

comment on table public.op_fixture_results is
  'Canonical, verified results. Separate from op_fixtures because that table is upserted by ingest and would clobber verification state and corrections. Settlement reads only rows with verification_state = verified.';
comment on column public.op_fixture_results.regulation_home is
  'Score at the end of normal time. Football 1X2, double chance, DNB, totals and BTTS all settle on this and nothing else.';
comment on column public.op_fixture_results.extra_time_home is
  'Score at the end of extra time, INCLUSIVE of regulation (API-Football score.extratime convention). Never a period-only figure.';
comment on column public.op_fixture_results.shootout_home is
  'Penalty shootout only, exclusive of everything before it.';
comment on column public.op_fixture_results.result_status is
  'Our classification of the event, not the provider''s raw status string. abandoned and retired are distinct: an abandoned match stopped without a result, a retirement produces an awarded winner that some markets settle on.';

alter table public.op_fixture_results enable row level security;
grant select on public.op_fixture_results to service_role;
