-- Match-level player facts are post-match evidence and may be aggregated
-- only into features for fixtures with a later kickoff_at; same-match use
-- would leak the result into the prediction.
create table if not exists public.op_player_match_performances (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('football', 'basketball', 'tennis')),
  provider text not null,
  source_kind text not null default 'real' check (source_kind in ('real', 'demo')),
  fixture_external_id text not null,
  fixture_kickoff_at timestamptz not null,
  team_external_id text not null,
  player_external_id text not null,
  player_name text not null,
  position text,
  shirt_number smallint check (shirt_number is null or shirt_number between 0 and 99),
  minutes smallint not null default 0 check (minutes between 0 and 200),
  started boolean not null default false,
  captain boolean not null default false,
  rating numeric(5, 2) check (rating is null or rating between 0 and 10),
  goals smallint not null default 0 check (goals >= 0),
  assists smallint not null default 0 check (assists >= 0),
  shots_total smallint not null default 0 check (shots_total >= 0),
  shots_on_target smallint not null default 0 check (shots_on_target >= 0),
  passes_total smallint not null default 0 check (passes_total >= 0),
  key_passes smallint not null default 0 check (key_passes >= 0),
  pass_accuracy numeric(5, 2) check (pass_accuracy is null or pass_accuracy between 0 and 100),
  tackles smallint not null default 0 check (tackles >= 0),
  interceptions smallint not null default 0 check (interceptions >= 0),
  saves smallint not null default 0 check (saves >= 0),
  yellow_cards smallint not null default 0 check (yellow_cards >= 0),
  red_cards smallint not null default 0 check (red_cards >= 0),
  data_quality numeric(5, 4) not null default 0 check (data_quality between 0 and 1),
  metrics jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint op_player_match_performances_provider_fixture_player_key
    unique (provider, fixture_external_id, team_external_id, player_external_id)
);

create index if not exists op_player_match_performances_team_recent_idx
  on public.op_player_match_performances (sport, team_external_id, fixture_kickoff_at desc)
  where source_kind = 'real' and minutes > 0;

create index if not exists op_player_match_performances_player_recent_idx
  on public.op_player_match_performances (sport, player_external_id, fixture_kickoff_at desc)
  where source_kind = 'real' and minutes > 0;

create index if not exists op_player_match_performances_fixture_idx
  on public.op_player_match_performances (fixture_external_id, team_external_id);

revoke all on table public.op_player_match_performances from anon, authenticated;
grant select, insert, update, delete on table public.op_player_match_performances to service_role;

alter table public.op_player_match_performances enable row level security;

comment on table public.op_player_match_performances is
  'Server-only post-match player performance facts. Rolling model features must filter fixture_kickoff_at strictly before the predicted fixture to prevent target leakage.';
